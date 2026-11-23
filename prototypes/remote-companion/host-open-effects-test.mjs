import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHostOpenEffects, createHostOpenRuntime } from './host-open-effects.mjs';
import { apply } from './host-open-overlay.mjs';
import { createPickerShell } from '../../vendor/mattskills-1.8.0-rc.7/lib/pickerShell.js';
import { composePlatform } from '../../vendor/mattskills-1.8.0-rc.7/lib/platform/index.js';
import win32Adapter from '../../vendor/mattskills-1.8.0-rc.7/lib/platform/win32/index.js';
import { classifyOpenCommand } from '../upstream-port/open-command.mjs';

const windows = { skip: process.platform !== 'win32' }, fsp = fs.promises;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const operationId = () => randomBytes(32).toString('hex');
const base = fileURLToPath(new URL('../../.scratch/', import.meta.url));
async function fixture(t, { receiptWaitMs = 1200 } = {}) {
  await fsp.mkdir(base, { recursive: true }); const directory = await fsp.realpath(await fsp.mkdtemp(path.join(base, 'host-open-test-')));
  t.after(async () => {
    assert.equal(path.dirname(directory).toLowerCase(), path.resolve(base).toLowerCase()); assert.ok(path.basename(directory).startsWith('host-open-test-'));
    await fsp.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });
  const project = path.join(directory, 'Project With Spaces'), other = path.join(directory, 'Other'), local = path.join(directory, 'private-data');
  await Promise.all([project, other, local].map(file => fsp.mkdir(file)));
  const data = path.join(local, 'projects', hash(project)); await fsp.mkdir(data, { recursive: true });
  const adapterPath = path.join(directory, 'frozen/prototypes/upstream-port/sidebar-server.mjs');
  await fsp.mkdir(path.dirname(adapterPath), { recursive: true }); await fsp.writeFile(adapterPath, '// Test entrypoint; not executed.\n');
  const sentinel = path.join(directory, 'providers.toml'); await fsp.writeFile(sentinel, '[model_providers.deepseek]\n[model_providers.openai]\n');
  const fake = path.join(directory, 'fixed fake opener.mjs'); await fsp.writeFile(fake, 'setTimeout(()=>process.exit(Number(process.argv[2])),Number(process.argv[3]));\n');
  const effects = await createHostOpenEffects({ adapterPath, localDataRoot: local, receiptWaitMs });
  const runtime = createHostOpenRuntime({ fs, path, createHash, workspaceRoot: project, dataRoot: data });
  const state = { spawned: 0, mode: 'ok', delay: 0, beforeClaim: null }, children = [];
  const finished = [];
  let active;
  const subprocess = {
    resolveExecutable: async name => name === 'cmd.exe' ? path.join(process.env.SystemRoot, 'System32/cmd.exe') : null,
    spawn(options) {
      const opened = classifyOpenCommand(options.argv, [project, data]); assert.ok(opened, 'the unchanged original Windows recipe must be classified');
      state.beforeClaim?.(); const receipt = runtime.claim(active, opened);
      const executable = state.mode === 'spawn-error' ? path.join(directory, 'nonexistent-opener.exe') : process.execPath;
      // Local test seam: only this fixed fake program runs, never cmd/Explorer.
      const child = spawn(executable, [fake, state.mode === 'exit-error' ? '7' : '0', String(state.delay)], { windowsHide: true, stdio: 'ignore' });
      children.push(child); state.spawned++; receipt.observe(child);
      const done = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', exitCode => resolve({ exitCode })); });
      finished.push(done.catch(() => {})); return { done, terminate() {}, collected: {} };
    },
  };
  const platform = await composePlatform({ get: name => name === 'subprocess' ? subprocess : fs }, 'win32', win32Adapter);
  const picker = createPickerShell({ DEFAULT_CWD: project, getPlatform: async () => platform });
  t.after(async () => { await Promise.all(finished); });
  const prepare = (method, parameters, id = operationId()) => effects.prepare({ method, parameters, projectRoot: project, operationId: id });
  const call = async (method, parameters, prepared) => {
    const context = prepared.dispatchContext.open; runtime.remember(context, { method, parameters }); active = { method, localOpen: context };
    return method === 'openFolder' ? picker.handleOpenFolder(parameters) : picker.handleOpenPath(parameters);
  };
  const receipt = prepared => path.join(data, 'open-receipts', prepared.dispatchContext.open.operationId + '.json');
  const settle = () => Promise.all(finished);
  return { directory, project, other, data, local, adapterPath, sentinel, effects, runtime, state, prepare, call, receipt, settle };
}

test('original folder handler plus real fake-opener close produces only an OS dispatch receipt', windows, async t => {
  const f = await fixture(t), parameters = { cwd: f.project }, prepared = await f.prepare('openFolder', parameters);
  await assert.rejects(fsp.stat(path.join(f.data, 'open-receipts')), { code: 'ENOENT' }); // prepare is read-only
  const response = await f.call('openFolder', parameters, prepared); assert.equal(response.ok, true);
  const proof = await prepared.verify({ ok: false }); assert.match(proof.resultSha256, /^[a-f0-9]{64}$/); assert.equal(f.state.spawned, 1);
  const receipt = JSON.parse(await fsp.readFile(f.receipt(prepared))); assert.equal(receipt.status, 'exit-zero'); assert.equal(receipt.method, 'openFolder');
  assert.deepEqual(Object.keys(receipt).sort(), ['operationId', 'method', 'targetSha256', 'commandTargetSha256', 'status'].sort());
  assert.equal(JSON.stringify(receipt).includes(f.project), false); assert.equal(JSON.stringify(receipt).includes('argv'), false);
  assert.equal(await fsp.readFile(f.sentinel, 'utf8'), '[model_providers.deepseek]\n[model_providers.openai]\n');
});

test('original file URL conversion preserves ASCII select and space/non-ASCII file fallback', windows, async t => {
  const f = await fixture(t);
  for (const name of ['issue.md', 'issue with spaces.md', '中文.md']) {
    const target = path.join(f.project, name); await fsp.writeFile(target, 'local document');
    const parameters = { path: pathToFileURL(target).href }, prepared = await f.prepare('openPath', parameters);
    const actual = f.runtime.inspect({ method: 'openPath', parameters }); assert.equal(actual.kind, 'file');
    assert.equal(actual.commandKind, name === 'issue.md' ? 'file' : 'folder');
    assert.equal((await f.call('openPath', parameters, prepared)).ok, true); assert.ok(await prepared.verify());
  }
  assert.equal(f.state.spawned, 3);
});

test('spawn event without close remains unknown; later close can verify without another dispatch', windows, async t => {
  const f = await fixture(t, { receiptWaitMs: 0 }); f.state.delay = 200;
  const parameters = { cwd: f.project }, prepared = await f.prepare('openFolder', parameters);
  assert.equal((await f.call('openFolder', parameters, prepared)).ok, true); assert.equal(await prepared.verify(), null);
  await f.settle(); assert.ok(await prepared.verify()); assert.equal(f.state.spawned, 1);
});

test('real spawn error is known failed despite the original fire-and-forget ok result', windows, async t => {
  const f = await fixture(t); f.state.mode = 'spawn-error';
  const parameters = { cwd: f.project }, prepared = await f.prepare('openFolder', parameters);
  assert.equal((await f.call('openFolder', parameters, prepared)).ok, true);
  const proof = await prepared.verify(); assert.equal(proof.outcome, 'failed'); assert.equal(proof.result.errorKind, 'backend');
  assert.equal(JSON.parse(await fsp.readFile(f.receipt(prepared))).status, 'spawn-error'); assert.equal(f.state.spawned, 1);
});

test('exit error, missing receipt, malformed/foreign receipt and ok-only responses stay unknown', windows, async t => {
  const f = await fixture(t, { receiptWaitMs: 0 }); f.state.mode = 'exit-error';
  const parameters = { cwd: f.project }, prepared = await f.prepare('openFolder', parameters);
  assert.equal(await prepared.verify({ ok: true }), null);
  await f.call('openFolder', parameters, prepared); await f.settle(); assert.equal(await prepared.verify(), null);
  const original = JSON.parse(await fsp.readFile(f.receipt(prepared)));
  for (const patch of [{ status: 'window-visible' }, { status: 'exit-zero', method: 'openPath' }, { status: 'exit-zero', targetSha256: '0'.repeat(64) }, { status: 'exit-zero', argv: 'forged' }]) {
    await fsp.writeFile(f.receipt(prepared), JSON.stringify({ ...original, ...patch })); assert.equal(await prepared.verify(), null);
  }
  await fsp.unlink(f.receipt(prepared)); assert.equal(await prepared.verify({ ok: true }), null); assert.equal(f.state.spawned, 1);
});

test('same operation is fenced before a second spawn and old receipt cannot prepare a replay', windows, async t => {
  const f = await fixture(t), parameters = { cwd: f.project }, prepared = await f.prepare('openFolder', parameters);
  await f.call('openFolder', parameters, prepared); assert.ok(await prepared.verify());
  assert.equal((await f.call('openFolder', parameters, prepared)).ok, false); assert.equal(f.state.spawned, 1);
  await assert.rejects(f.prepare('openFolder', parameters, prepared.dispatchContext.open.operationId), /already has a receipt/);
});

test('replacement after preparation and replacement between remember and spawn are rejected', windows, async t => {
  const f = await fixture(t), file = path.join(f.project, 'document.md'); await fsp.writeFile(file, 'before');
  const parameters = { path: file }, prepared = await f.prepare('openPath', parameters);
  await fsp.rename(file, file + '.retained'); await fsp.writeFile(file, 'replacement');
  await assert.rejects(f.call('openPath', parameters, prepared), /no longer matches/); assert.equal(f.state.spawned, 0);
  const next = await f.prepare('openPath', parameters);
  f.state.beforeClaim = () => { fs.renameSync(file, file + '.again'); fs.writeFileSync(file, 'changed immediately before spawn'); };
  assert.equal((await f.call('openPath', parameters, next)).ok, false); assert.equal(f.state.spawned, 0);
  await assert.rejects(fsp.stat(f.receipt(next)), { code: 'ENOENT' });
});

test('foreign root, junction and shell execution disguised as folder are rejected read-only', windows, async t => {
  const f = await fixture(t), alias = path.join(f.project, 'alias'); await fsp.symlink(f.other, alias, 'junction');
  await assert.rejects(f.prepare('openFolder', { cwd: f.other }), /outside/);
  await assert.rejects(f.prepare('openFolder', { cwd: alias }), /redirect/);
  const binary = path.join(f.project, 'never-run.exe'); await fsp.writeFile(binary, 'not an executable');
  await assert.rejects(f.prepare('openFolder', { cwd: binary }), /requires a directory/);
  await assert.rejects(f.prepare('openFolder', { cwd: 'relative/path' }), /absolute/);
  const prepared = await f.prepare('openFolder', { cwd: f.data }); assert.equal((await f.call('openFolder', { cwd: f.data }, prepared)).ok, true); assert.ok(await prepared.verify());
});

test('exact command target is checked and redirected receipt folder cannot write outside worker', windows, async t => {
  const f = await fixture(t), parameters = { cwd: f.project }, prepared = await f.prepare('openFolder', parameters), context = prepared.dispatchContext.open;
  f.runtime.remember(context, { method: 'openFolder', parameters });
  assert.throws(() => f.runtime.claim({ method: 'openFolder', localOpen: context }, { kind: 'folder', target: f.data }), /changed before dispatch/);
  await fsp.symlink(f.other, path.join(f.data, 'open-receipts'), 'junction');
  assert.equal((await f.call('openFolder', parameters, prepared)).ok, false); assert.equal(f.state.spawned, 0);
  assert.deepEqual(await fsp.readdir(f.other), []); assert.equal(await prepared.verify(), null);
});

test('freeze overlay is narrow, fail-closed on drift and leaves shared dispatch anchors to root', async () => {
  const original = await fsp.readFile(new URL('../upstream-port/node-host.mjs', import.meta.url), 'utf8'), eol = original.includes('\r\n') ? '\r\n' : '\n';
  const transformed = apply(original, eol);
  assert.ok(transformed.includes('localOpenRuntime.remember(localOpen, { method, parameters: scoped })'));
  assert.ok(transformed.includes('openReceipt?.observe(child)'));
  assert.ok(transformed.includes('const execute = () => operation.run({ method, identity: {} }, () => route(request));'));
  assert.throws(() => apply(original.replace('  const operation = new AsyncLocalStorage();', '')), /anchor drift/);
  // Parse the exact generated module without loading its host/UI or running it.
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--check', '--input-type=module'], { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
    let error = ''; child.stderr.on('data', bytes => { error += bytes; }); child.once('error', reject); child.once('close', code => code === 0 ? resolve() : reject(new Error(error))); child.stdin.end(transformed);
  });
});
