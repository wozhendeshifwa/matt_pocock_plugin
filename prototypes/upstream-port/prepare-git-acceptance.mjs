import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repo = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const directory = path.join(repo, '.scratch', 'issue34-git-acceptance');
const project = path.join(directory, 'project');
try {
  await access(directory);
  throw new Error('Acceptance directory already exists; preserve it and inspect before retrying: ' + directory);
} catch (error) { if (error.code !== 'ENOENT') throw error; }
await mkdir(project, { recursive: true });
const git = (...args) => execFileSync('git', args, { cwd: project, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
git('init', '-b', 'acceptance/issue34');
git('config', 'user.name', 'Deck Acceptance');
git('config', 'user.email', 'deck-acceptance@example.test');
git('config', 'commit.gpgsign', 'false');
await writeFile(path.join(project, 'sample.txt'), 'seed\n');
git('add', '--', 'sample.txt');
git('commit', '-m', 'Seed isolated Git acceptance');
await writeFile(path.join(project, 'sample.txt'), 'seed\npending desktop acceptance\n');
await writeFile(path.join(project, 'literal[1].txt'), 'Only synthetic test data; safe for private test publication.\n');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const files = {};
for (const name of ['sidebar-server.mjs', 'node-host.mjs', 'git-write-gate.mjs', 'rpc-endpoints.mjs', 'sidebar-bridge.js', 'upstream-host.mjs', 'build.mjs', 'dist/client.js', 'dist/manifest.json']) {
  files[name] = hash(await readFile(path.join(repo, 'prototypes', 'upstream-port', name)));
}
const manifest = {
  createdAt: new Date().toISOString(), project, branch: git('branch', '--show-current'),
  seedHead: git('rev-parse', 'HEAD'), initialStatus: git('status', '--porcelain=v1'),
  origin: null, onlinePublication: 'pending explicit user confirmation',
  sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8', windowsHide: true }).trim(),
  sourceStatus: execFileSync('git', ['status', '--porcelain=v1'], { cwd: repo, encoding: 'utf8', windowsHide: true }),
  sha256: files,
};
await writeFile(path.join(directory, 'baseline.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest, null, 2));
