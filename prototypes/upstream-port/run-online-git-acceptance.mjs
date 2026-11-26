// This is backend evidence. It does not exercise native desktop tool approval.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createOriginalHost } from './node-host.mjs';

const target = 'wozhendeshifwa/deck-git-acceptance-20261123';
if (process.argv[2] !== '--confirmed-target' || process.argv[3] !== target) throw new Error('Pass the explicitly approved test target');
const root = path.resolve(fileURLToPath(new URL('../../.scratch/issue34-git-acceptance/', import.meta.url)));
const baseline = JSON.parse(await readFile(path.join(root, 'baseline.json'), 'utf8'));
const project = baseline.project;
const output = path.join(root, 'online-result.json');
try { await access(output); throw new Error('Prior attempt exists. Inspect its outcome; use retryPush for half-created repositories, never rerun initPublish blindly.'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const run = (program, args) => execFileSync(program, args, { cwd: project, windowsHide: true, encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
assert.equal(run('gh', ['api', 'user', '--jq', '.login']), target.split('/')[0]);
assert.equal(run('git', ['rev-parse', 'HEAD']), baseline.seedHead);
assert.equal(run('git', ['remote']), '');
const dataRoot = path.join(root, 'online-host-data');
await mkdir(dataRoot, { recursive: true });
const originalCwd = process.cwd();
process.chdir(dataRoot);
const host = await createOriginalHost({ dataRoot, workspaceRoot: project });
const evidence = { target, confirmation: 'User explicitly approved private test target in chat', nativeDesktopApprovalVerified: false, startedAt: new Date().toISOString() };
await writeFile(output, JSON.stringify({ ...evidence, status: 'started; inspect remote before any retry' }, null, 2));
try {
  const result = await host.call('initPublish', { name: target.split('/')[1], visibility: 'private' });
  evidence.publish = result?.value ?? result;
  await writeFile(output, JSON.stringify(evidence, null, 2));
  assert.equal(evidence.publish.ok, true, JSON.stringify(evidence.publish));
  const metadata = JSON.parse(run('gh', ['api', 'repos/' + target]));
  assert.equal(metadata.full_name, target);
  assert.equal(metadata.private, true);
  evidence.localHead = run('git', ['rev-parse', 'HEAD']);
  evidence.branch = run('git', ['branch', '--show-current']);
  evidence.remoteHead = run('gh', ['api', 'repos/' + target + '/git/ref/heads/' + evidence.branch, '--jq', '.object.sha']);
  assert.equal(evidence.remoteHead, evidence.localHead);
  evidence.remoteUrl = run('git', ['remote', 'get-url', 'origin']);
  evidence.private = metadata.private;
  evidence.finishedAt = new Date().toISOString();
  await writeFile(output, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} finally { host.dispose(); process.chdir(originalCwd); }
