import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { callService } from './service.mjs';
import { git } from './engine.mjs';

const directory = path.resolve(process.argv[2]);
const authDirectory = fs.realpathSync(process.argv[3]);
fs.mkdirSync(directory, { recursive: true });
const project = path.join(directory, 'source');
fs.mkdirSync(project, { recursive: true });
git(project, ['init', '-b', 'main']);
git(project, ['config', 'user.name', 'Sandbox Acceptance']); git(project, ['config', 'user.email', 'acceptance@localhost']);
fs.writeFileSync(path.join(project, 'baseline.txt'), 'original\n');
fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ scripts: { check: 'node -e "console.log(123)"' } }));
git(project, ['add', '.']); git(project, ['commit', '-m', 'Acceptance baseline']);
const base = git(project, ['rev-parse', 'HEAD']);
const configFile = path.join(directory, 'config.json');
fs.writeFileSync(configFile, JSON.stringify({ directory: path.join(directory, 'data'), authDirectory, token: randomBytes(32).toString('hex'), image: 'sandcastle-gate:20261126', dockerPath: path.join(process.env.LOCALAPPDATA, 'Programs/DockerDesktop/resources/bin/docker.exe'), models: ['gpt-6.1-sol'], defaultModel: 'gpt-6.1-sol' }));
const log = fs.openSync(path.join(directory, 'service.log'), 'a');
let daemon;
function launch() { daemon = spawn(process.execPath, [fileURLToPath(new URL('service.mjs', import.meta.url)), configFile], { windowsHide: true, stdio: ['ignore', log, log] }); }
const call = (method, input) => callService(project, method, input, configFile);
async function until(fn, timeout = 180000) { const end = Date.now() + timeout; for (;;) { const value = await fn(); if (value) return value; if (Date.now() > end) throw new Error('Acceptance timed out'); await new Promise(r => setTimeout(r, 500)); } }
const evidence = { started: new Date().toISOString(), assertions: [] };
const ok = value => { evidence.assertions.push(value); console.log(value); };
try {
  launch(); await until(async () => { try { return await call('list'); } catch { return false; } }, 15000);
  await call('limit', { value: 1 });
  fs.writeFileSync(path.join(project, 'untracked.txt'), 'stay local\n');
  const originalStatus = git(project, ['status', '--porcelain']);
  const preview = await call('prepare', { prompt: 'Only in this disposable project, create manager-result.txt with the text manager-acceptance-ok. Run npm run check. Commit your new file on the current branch. Do not modify other files, merge, push, inspect credentials, or use network tools. Reply COMPLETE when done.', check: 'npm run check', model: 'gpt-6.1-sol', effort: 'medium', minutes: 3 });
  assert.equal(preview.base, base); assert.equal(preview.dirty, true);
  const first = await call('start', { token: preview.token });
  assert.equal((await call('start', { token: preview.token })).id, first.id);
  const queuedPreview = await call('prepare', { prompt: 'queued fixture', minutes: 1 });
  const queued = await call('start', { token: queuedPreview.token });
  assert.equal(queued.status, 'queued');
  ok('real-start-idempotency-and-frozen-dirty-source');
  await until(async () => { const task = await call('detail', { id: first.id }); if (task.status === 'failed') throw new Error(task.message); return task.log.includes('Agent started'); });
  daemon.kill('SIGKILL'); await new Promise(r => daemon.once('exit', r));
  launch(); await until(async () => { try { return await call('list'); } catch { return false; } }, 15000);
  assert.equal((await call('detail', { id: queued.id })).paused, true);
  ok('supervisor-restart-does-not-kill-worker-and-pauses-queue');
  const done = await until(async () => { const task = await call('detail', { id: first.id }); return ['completed', 'failed', 'cancelled', 'interrupted'].includes(task.status) ? task : false; });
  evidence.firstTask = done;
  assert.equal(done.status, 'completed', done.message);
  assert.equal(done.checks.state, 'passed'); assert.equal(done.result.changed, true);
  assert.equal(git(project, ['status', '--porcelain']), originalStatus);
  assert.equal(git(project, ['rev-parse', 'HEAD']), base);
  ok('real-task-checks-result-and-source-preserved-after-reconnect');
  await assert.rejects(() => call('mergePreview', { id: first.id }));
  fs.renameSync(path.join(project, 'untracked.txt'), path.join(directory, 'preserved-untracked.txt'));
  const merge = await call('mergePreview', { id: first.id });
  assert.equal(merge.targetHead, base);
  assert.equal((await call('merge', { token: merge.token })).merged, true);
  assert.equal(fs.readFileSync(path.join(project, 'manager-result.txt'), 'utf8').trim(), 'manager-acceptance-ok');
  ok('manual-merge-previews-dirty-target-blocks-and-confirmed-result-merges');
  const cancelled = await call('cancel', { id: queued.id }); assert.equal(cancelled.status, 'cancelled');
  const again = await call('prepare', { prompt: 'Run sleep 90 in the sandbox without changing files, then say done.', rerunId: first.id, minutes: 2 });
  assert.equal(again.base, base);
  const active = await call('start', { token: again.token });
  await until(async () => (await call('detail', { id: active.id })).status === 'running');
  await call('cancel', { id: active.id });
  const stopped = await until(async () => { const t = await call('detail', { id: active.id }); return ['cancelled', 'failed', 'completed'].includes(t.status) ? t : false; });
  evidence.cancelledTask = stopped; assert.equal(stopped.status, 'cancelled');
  ok('real-running-cancel-stops-owned-container-and-rerun-keeps-original-base');
  const clean = await call('cleanPreview', { id: active.id }); assert.equal((await call('clean', { token: clean.token })).cleaned, true);
  assert.ok(!(await call('list')).tasks.some(t => t.id === active.id));
  ok('confirmed-cleanup-removes-only-owned-task');
  evidence.status = 'passed';
} catch (error) { evidence.status = 'failed'; evidence.error = String(error.stack ?? error); console.error(evidence.error); process.exitCode = 1; }
finally {
  fs.writeFileSync(path.join(directory, 'acceptance.json'), JSON.stringify(evidence, null, 2));
  if (daemon && daemon.exitCode === null) { daemon.kill('SIGTERM'); await new Promise(r => { daemon.once('exit', r); setTimeout(r, 20000).unref(); }); if (daemon.exitCode === null) daemon.kill('SIGKILL'); }
  fs.closeSync(log);
}
