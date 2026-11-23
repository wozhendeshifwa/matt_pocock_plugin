import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { WriteLedger } from './write-ledger.mjs';

const id = () => randomBytes(32).toString('hex');
const owner = { pairingId: 'pair-a', threadId: 'thread-a', sessionId: 'session-a' };
const project = 'trusted-project-a';
const intent = { method: 'gitStage', parametersSha256: 'a'.repeat(64), target: { paths: ['note.txt'] } };
const reserve = (operationId, overrides = {}) => ({ operationId, projectKey: project, ownerScope: owner, intent, ...overrides });
async function fixture(t) {
  const base = fileURLToPath(new URL('../../.scratch/', import.meta.url));
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(path.join(base, 'write-ledger-test-'));
  const file = path.join(directory, 'installation-writes.sqlite');
  const handles = [], beforeClose = [];
  t.after(async () => {
    for (const callback of beforeClose.reverse()) await callback();
    for (const ledger of handles.reverse()) ledger.close();
    const parent = await realpath(base), target = await realpath(directory);
    const relative = path.relative(parent.toLowerCase(), target.toLowerCase());
    assert.ok(relative && relative.startsWith('write-ledger-test-') && !relative.includes(path.sep) && !path.isAbsolute(relative), 'Delete only the exact freshly-created fixture directory');
    await rm(target, { recursive: true });
  });
  return { file, beforeClose(callback) { beforeClose.push(callback); }, open() { const ledger = new WriteLedger(file); handles.push(ledger); return ledger; } };
}
function assertBlocked(callback, operationId) {
  assert.throws(callback, error => error.code === 'PROJECT_WRITE_UNRESOLVED' && error.blockingOperationId === operationId);
}

test('project barrier survives new sessions, threads and pairings but does not block another project', async t => {
  const f = await fixture(t), a = f.open(), b = f.open(), first = id();
  assert.equal(a.reserve(reserve(first)).reserved, true);
  for (const changed of [{ ...owner, sessionId: 'session-b' }, { ...owner, threadId: 'thread-b' }, { ...owner, pairingId: 'pair-b' }]) {
    assertBlocked(() => b.reserve(reserve(id(), { ownerScope: changed })), first);
  }
  assert.equal(b.reserve(reserve(id(), { projectKey: 'trusted-project-b' })).reserved, true);
  const running = a.inspect({ operationId: first, projectKey: project, ownerScope: owner });
  assert.equal(running.state, 'running', 'opening a second handle must not reset another live execution');
  a.markUnknown({ operationId: first, projectKey: project, ownerScope: owner, reason: 'connection-lost' });
  assertBlocked(() => b.reserve(reserve(id())), first);
});

test('reopening the installation database preserves running and unknown barriers', async t => {
  const f = await fixture(t), operationId = id();
  let ledger = f.open(); ledger.reserve(reserve(operationId)); ledger.close();
  ledger = f.open();
  assert.equal(ledger.inspect({ operationId, projectKey: project, ownerScope: owner }).state, 'running');
  assertBlocked(() => ledger.reserve(reserve(id())), operationId);
  ledger.markUnknown({ operationId, projectKey: project, ownerScope: owner, reason: 'process-ended' }); ledger.close();
  ledger = f.open();
  assert.equal(ledger.inspect({ operationId, projectKey: project, ownerScope: owner }).state, 'unknown');
  assertBlocked(() => ledger.reserve(reserve(id(), { ownerScope: { ...owner, threadId: 'after-restart' } })), operationId);
});

test('same operation never executes again; mismatched intent or owner is rejected', async t => {
  const f = await fixture(t), ledger = f.open(), operationId = id();
  ledger.reserve(reserve(operationId));
  assert.deepEqual(ledger.reserve(reserve(operationId)), { reserved: false, operationId, state: 'running', reason: 'already-recorded' });
  assert.throws(() => ledger.reserve(reserve(operationId, { intent: { ...intent, parametersSha256: 'b'.repeat(64) } })), { code: 'OPERATION_CONFLICT' });
  assert.throws(() => ledger.reserve(reserve(operationId, { ownerScope: { ...owner, pairingId: 'other' } })), { code: 'OPERATION_CONFLICT' });
  ledger.complete({ operationId, projectKey: project, ownerScope: owner, outcome: 'succeeded', result: { target: intent.target, resultSha256: 'c'.repeat(64) } });
  ledger.close();
  const after = f.open();
  assert.equal(after.reserve(reserve(operationId)).reserved, false);
  assert.equal(after.reserve(reserve(operationId)).state, 'completed');
  assert.throws(() => after.complete({ operationId, projectKey: project, ownerScope: owner, outcome: 'succeeded' }), { code: 'TERMINAL_RECORD' });
});

test('late known completion records the result and releases only its project barrier', async t => {
  const f = await fixture(t), ledger = f.open(), operationId = id(), other = id();
  ledger.reserve(reserve(operationId)); ledger.reserve(reserve(other, { projectKey: 'project-b' }));
  ledger.markUnknown({ operationId, projectKey: project, ownerScope: owner, reason: 'adapter-timeout' });
  ledger.complete({ operationId, projectKey: project, ownerScope: owner, outcome: 'succeeded', result: { target: { paths: ['note.txt'] } } });
  assert.equal(ledger.reserve(reserve(id(), { ownerScope: { ...owner, threadId: 'thread-b' } })).reserved, true);
  assertBlocked(() => ledger.reserve(reserve(id(), { projectKey: 'project-b' })), other);
  const result = ledger.inspect({ operationId, projectKey: project, ownerScope: owner });
  assert.equal(result.outcome, 'succeeded'); assert.deepEqual(result.result.target, intent.target);
  assert.equal(ledger.markUnknown({ operationId, projectKey: project, ownerScope: owner, reason: 'connection-lost' }).changed, false);
});

test('scope protects intent and result even when project is known', async t => {
  const f = await fixture(t), ledger = f.open(), operationId = id();
  ledger.reserve(reserve(operationId));
  for (const scope of [{ ...owner, threadId: 'another-thread' }, { ...owner, pairingId: 'another-pair' }]) {
    assert.deepEqual(ledger.inspect({ operationId, projectKey: project, ownerScope: scope }), { state: 'not-found' });
    assert.throws(() => ledger.markUnknown({ operationId, projectKey: project, ownerScope: scope, reason: 'operator-uncertain' }), { code: 'OPERATION_NOT_FOUND' });
  }
  assert.deepEqual(ledger.inspect({ operationId, projectKey: 'another-project', ownerScope: owner }), { state: 'not-found' });
  assert.deepEqual(ledger.inspect({ operationId, projectKey: project, ownerScope: owner }).intent, intent);
});

test('local preparation can add readback facts without changing ownership, parameters or reserved correlation', async t => {
  const f = await fixture(t), ledger = f.open(), operationId = id();
  const provisional = { method: 'gitStage', parametersSha256: 'a'.repeat(64), target: { correlationKey: operationId } };
  const record = { operationId, projectKey: project, ownerScope: owner };
  ledger.reserve({ ...record, intent: provisional });
  assertBlocked(() => f.open().assertAvailable({ projectKey: project }), operationId);
  const refined = { ...provisional, target: { ...provisional.target, paths: ['note.txt'], beforeStateSha256: 'b'.repeat(64) } };
  assert.deepEqual(ledger.refineIntent({ ...record, intent: refined }), refined);
  for (const changed of [{ ...refined, method: 'gitUnstage' }, { ...refined, parametersSha256: 'c'.repeat(64) },
    { ...refined, target: { ...refined.target, correlationKey: id() } }, { ...refined, target: { correlationKey: operationId } }]) {
    assert.throws(() => ledger.refineIntent({ ...record, intent: changed }), { code: 'INTENT_REFINEMENT_CONFLICT' });
  }
  assert.throws(() => ledger.refineIntent({ ...record, ownerScope: { ...owner, pairingId: 'other' }, intent: refined }), { code: 'OPERATION_NOT_FOUND' });
  ledger.markUnknown({ ...record, reason: 'process-ended' });
  assert.throws(() => ledger.refineIntent({ ...record, intent: refined }), { code: 'INTENT_REFINEMENT_CONFLICT' });
  assert.deepEqual(f.open().inspect(record).intent, refined);
});

test('only explicit correlated local readback evidence can reconcile, never a confirmed flag', async t => {
  const f = await fixture(t), ledger = f.open(), operationId = id();
  ledger.reserve(reserve(operationId));
  ledger.markUnknown({ operationId, projectKey: project, ownerScope: owner, reason: 'partial-result' });
  for (const evidence of [undefined, { confirmed: true }, { kind: 'git-readback', verdict: 'not-executed' }]) {
    assert.throws(() => ledger.reconcile({ operationId, projectKey: project, evidence }), { code: 'RECONCILIATION_EVIDENCE_REQUIRED' });
    assertBlocked(() => ledger.reserve(reserve(id())), operationId);
  }
  const evidence = { kind: 'git-readback', verdict: 'not-executed', observedAt: Date.now(), verificationSha256: 'd'.repeat(64), target: intent.target,
    executionStoppedAt: Date.now() - 1, executionFenceSha256: 'e'.repeat(64) };
  assert.throws(() => ledger.reconcile({ operationId, projectKey: project, evidence: { ...evidence, executionStoppedAt: undefined } }), { code: 'EXECUTION_FENCE_REQUIRED' });
  assert.throws(() => ledger.reconcile({ operationId, projectKey: project, evidence: { ...evidence, target: { paths: ['different.txt'] } } }), { code: 'EVIDENCE_TARGET_MISMATCH' });
  assert.equal(ledger.reconcile({ operationId, projectKey: project, evidence }).state, 'not-executed');
  assert.equal(ledger.reserve(reserve(operationId)).reserved, false, 'even confirmed-not-executed keeps its permanent operation tombstone');
  assert.equal(ledger.reserve(reserve(id())).reserved, true);
  assert.deepEqual(ledger.inspect({ operationId, projectKey: project, ownerScope: owner }).evidence, evidence);
});

test('local reconciliation cannot clear a still-running executor even with readback evidence', async t => {
  const f = await fixture(t), ledger = f.open(), operationId = id();
  ledger.reserve(reserve(operationId));
  const evidence = { kind: 'git-readback', verdict: 'completed', observedAt: Date.now(), verificationSha256: 'd'.repeat(64), target: intent.target };
  assert.throws(() => ledger.reconcile({ operationId, projectKey: project, evidence }), { code: 'RUNNING_WRITE_CANNOT_BE_RECONCILED' });
  assertBlocked(() => ledger.reserve(reserve(id())), operationId);
  ledger.markUnknown({ operationId, projectKey: project, ownerScope: owner, reason: 'process-ended' });
  assert.equal(ledger.reconcile({ operationId, projectKey: project, evidence }).state, 'completed');
  assert.equal(ledger.inspect({ operationId, projectKey: project, ownerScope: owner }).outcome, 'readback-confirmed');
});

test('ledger rejects credentials, arbitrary commands and raw response data before registration', async t => {
  const f = await fixture(t), ledger = f.open();
  for (const badIntent of [
    { ...intent, authorization: 'Bearer do-not-store' },
    { ...intent, command: 'git commit -m arbitrary' },
    { ...intent, target: { ...intent.target, token: 'do-not-store' } },
    { ...intent, target: { paths: ['../outside'] } },
    { ...intent, method: 'execCommand' },
    { ...intent, target: { remote: 'https://token@github.com/user/repo' } },
  ]) assert.throws(() => ledger.reserve(reserve(id(), { intent: badIntent })), { code: 'INVALID_INTENT' });
  const operationId = id(); ledger.reserve(reserve(operationId));
  assert.throws(() => ledger.complete({ operationId, projectKey: project, ownerScope: owner, outcome: 'succeeded', result: { authorization: 'do-not-store' } }), { code: 'INVALID_RESULT' });
  assert.equal(ledger.inspect({ operationId, projectKey: project, ownerScope: owner }).state, 'running');
  assert.throws(() => new WriteLedger(':memory:'), { code: 'PERSISTENT_FILE_REQUIRED' });
});

test('independent SQLite connections atomically allow only one concurrent project write', { timeout: 10000 }, async t => {
  const f = await fixture(t); f.open().close();
  const gate = new SharedArrayBuffer(4), module = new URL('./write-ledger.mjs', import.meta.url).href;
  const workerSource = `
    const {parentPort,workerData}=await import('node:worker_threads');
    const {WriteLedger}=await import(workerData.module);
    const ledger=new WriteLedger(workerData.file);
    parentPort.postMessage({kind:'ready'});
    Atomics.wait(new Int32Array(workerData.gate),0,0);
    try { parentPort.postMessage({kind:'result',result:ledger.reserve(workerData.request)}); }
    catch(error) { parentPort.postMessage({kind:'result',code:error.code}); }
    finally { ledger.close(); parentPort.close(); }
  `;
  const workers = [0, 1].map(index => {
    const worker = new Worker(workerSource, { eval: true, workerData: { module, file: f.file, gate, request: reserve(id(), { ownerScope: { ...owner, threadId: 'thread-' + index } }) } });
    let readyResolve, readyReject, resultResolve, resultReject, exitResolve, exitReject;
    const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    const result = new Promise((resolve, reject) => { resultResolve = resolve; resultReject = reject; });
    const exit = new Promise((resolve, reject) => { exitResolve = resolve; exitReject = reject; });
    worker.on('message', value => { if (value.kind === 'ready') readyResolve(); else if (value.kind === 'result') resultResolve(value); });
    worker.on('error', error => { readyReject(error); resultReject(error); exitReject(error); });
    worker.on('exit', code => { if (code === 0) exitResolve(); else { const error = new Error('Ledger worker failed'); readyReject(error); resultReject(error); exitReject(error); } });
    return { ready, result, exit, worker };
  });
  f.beforeClose(() => Promise.all(workers.map(({ worker }) => worker.terminate())));
  await Promise.all(workers.map(worker => worker.ready));
  Atomics.store(new Int32Array(gate), 0, 1); Atomics.notify(new Int32Array(gate), 0, workers.length);
  const results = await Promise.all(workers.map(worker => worker.result));
  await Promise.all(workers.map(worker => worker.exit));
  assert.equal(results.filter(value => value.result?.reserved === true).length, 1);
  assert.equal(results.filter(value => value.code === 'PROJECT_WRITE_UNRESOLVED').length, 1);
});
