// Real Docker/Codex scheduling acceptance; only a new disposable directory.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { git } from './engine.mjs';
import { callService, loadConfig } from './service.mjs';

const directory = path.resolve(process.argv[2]);
if (fs.existsSync(directory)) throw new Error('Acceptance requires a new disposable directory.');
fs.mkdirSync(directory, { recursive: true });
const config = { ...loadConfig(), directory: path.join(directory, 'data'), token: randomBytes(32).toString('hex') };
const configFile = path.join(directory, 'config.json');
fs.writeFileSync(configFile, JSON.stringify(config), { mode: 0o600 });
const project = path.join(directory, 'source');
fs.mkdirSync(project);
git(project, ['init', '-b', 'main']);
git(project, ['config', 'user.name', 'Acceptance']);
git(project, ['config', 'user.email', 'acceptance@localhost']);
fs.writeFileSync(path.join(project, 'baseline.txt'), 'original\n');
git(project, ['add', '.']); git(project, ['commit', '-m', 'baseline']);
const base = git(project, ['rev-parse', 'HEAD']);
const log = fs.openSync(path.join(directory, 'service.log'), 'a');
const daemon = spawn(process.execPath, [fileURLToPath(new URL('service.mjs', import.meta.url)), configFile], { windowsHide: true, stdio: ['ignore', log, log] });
const call = (method, input) => callService(project, method, input, configFile);
const until = async fn => {
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) { const result = await fn(); if (result) return result; await new Promise(r => setTimeout(r, 500)); }
  throw new Error('Concurrent real task acceptance timed out');
};
const evidence = { started: new Date().toISOString(), assertions: [], tasks: [] };
try {
  await until(async () => { try { return await call('list'); } catch { return false; } });
  const tasks = [];
  for (let index = 0; index < 3; index++) {
    const preview = await call('prepare', { prompt: 'Reply only DONE. Do not read or change files or use tools.', model: config.defaultModel, effort: 'low', minutes: 3,
      check: index < 2 ? `node -e "setTimeout(()=>process.exit(${index === 1 ? 9 : 0}),30000)"` : '' });
    tasks.push(await call('start', { token: preview.token }));
  }
  const initial = (await call('list')).tasks;
  assert.equal(initial.filter(t => ['preparing', 'running'].includes(t.status)).length, 2);
  assert.equal(initial.find(t => t.id === tasks[2].id).status, 'queued');
  evidence.assertions.push('two real executions and third queued at default machine limit');
  fs.writeFileSync(path.join(project, 'later.txt'), 'new source commit\n');
  git(project, ['add', '.']); git(project, ['commit', '-m', 'advance source after enqueue']);
  const head = git(project, ['rev-parse', 'HEAD']);
  const final = await until(async () => {
    const rows = (await call('list')).tasks;
    if (rows.some(t => ['failed', 'cancelled', 'interrupted'].includes(t.status))) throw new Error('An actual execution failed');
    return rows.every(t => t.status === 'completed') ? rows : false;
  });
  for (const task of final) assert.equal(task.base, base);
  assert.equal(final.find(t => t.id === tasks[1].id).checks.state, 'failed');
  assert.equal(final.find(t => t.id === tasks[1].id).checks.exitCode, 9);
  assert.equal(final.find(t => t.id === tasks[2].id).checks.state, 'not-run');
  assert.equal(final.find(t => t.id === tasks[0].id).checks.state, 'passed');
  assert.equal(git(project, ['rev-parse', 'HEAD']), head);
  assert.equal(git(project, ['status', '--porcelain']), '');
  evidence.tasks = final;
  evidence.assertions.push('all executions retain original committed base after source advances', 'completed is independent of passed/failed/not-run check evidence', 'source HEAD and clean index preserved');
  evidence.status = 'passed';
  console.log('PASS real concurrency, frozen queue baseline and three independent check states');
} catch (error) { evidence.status = 'failed'; evidence.error = String(error.stack); process.exitCode = 1; console.error(error.message); }
finally {
  fs.writeFileSync(path.join(directory, 'acceptance.json'), JSON.stringify(evidence, null, 2));
  // All tasks above have ended on success. On failure, retain workers and pause
  // the supervisor for explicit investigation rather than discarding evidence.
  daemon.kill('SIGKILL');
  fs.closeSync(log);
}
