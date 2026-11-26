// Requires the already published, explicitly approved synthetic fixture.
import assert from 'node:assert/strict';
import { readFile, writeFile, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createOriginalHost } from './node-host.mjs';
const target = 'wozhendeshifwa/deck-git-acceptance-20261123';
assert.deepEqual(process.argv.slice(2), ['--confirmed-target', target]);
const root = fileURLToPath(new URL('../../.scratch/issue34-git-acceptance/', import.meta.url));
const baseline = JSON.parse(await readFile(path.join(root, 'baseline.json'), 'utf8'));
const publication = JSON.parse(await readFile(path.join(root, 'online-result.json'), 'utf8'));
assert.equal(publication.target, target);
assert.equal(publication.private, true);
const project = baseline.project, output = path.join(root, 'online-network-result.json');
try { await access(output); throw new Error('Prior attempt exists; inspect before retrying'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const run = (program, args) => execFileSync(program, args, { cwd: project, windowsHide: true, encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
assert.equal(run('git', ['remote', 'get-url', 'origin']), 'https://github.com/' + target + '.git');
assert.equal(run('git', ['branch', '--show-current']), 'acceptance/issue34');
assert.equal(run('git', ['status', '--porcelain']), '');
const originalCwd = process.cwd();
const dataRoot = path.join(root, 'online-host-data');
process.chdir(dataRoot);
const host = await createOriginalHost({ dataRoot, workspaceRoot: project });
const evidence = { target, nativeDesktopApprovalVerified: false, operations: [], startedAt: new Date().toISOString() };
const save = () => writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
async function call(method, payload = {}) {
  const raw = await host.call(method, payload), value = raw?.value ?? raw;
  evidence.operations.push({ method, result: value });
  await save();
  assert.equal(value.ok, true, JSON.stringify(value));
  return value;
}
async function checked(op, payload = {}) {
  const check = await call('gitWriteCheck', { op, ...payload });
  return call('git' + op[0].toUpperCase() + op.slice(1), { ...payload, ticketId: check.ticket.id, requestId: 'issue34-online-' + op + '-' + Date.now() });
}
await save();
try {
  await checked('fetch');
  await checked('pull');
  await writeFile(path.join(project, 'network.txt'), 'Synthetic online Git acceptance.\n');
  await call('gitStage', { paths: ['network.txt'] });
  assert.equal(run('git', ['diff', '--cached', '--name-only']), 'network.txt');
  await call('gitUnstage', { paths: ['network.txt'] });
  assert.equal(run('git', ['diff', '--cached', '--name-only']), '');
  await call('gitStage', { paths: ['network.txt'] });
  await checked('commit', { message: 'Verify isolated online Git network writes' });
  await checked('push');
  evidence.localHead = run('git', ['rev-parse', 'HEAD']);
  evidence.remoteHead = run('gh', ['api', 'repos/' + target + '/git/ref/heads/acceptance/issue34', '--jq', '.object.sha']);
  assert.equal(evidence.remoteHead, evidence.localHead);
  await writeFile(path.join(project, 'desktop-only.txt'), 'Pending native desktop stage/unstage/commit and approval acceptance.\n');
  evidence.pendingDesktopFile = 'desktop-only.txt';
  evidence.finishedAt = new Date().toISOString();
  await save();
  console.log(JSON.stringify({ ...evidence, operations: evidence.operations.map(x => ({ method: x.method, ok: x.result.ok })) }, null, 2));
} finally { host.dispose(); process.chdir(originalCwd); }
