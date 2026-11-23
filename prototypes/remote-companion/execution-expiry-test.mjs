import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import { Journal } from './journal.mjs';
import { WriteLedger } from './write-ledger.mjs';
import { createExecutor } from './companion.mjs';
import { digest, requestHash } from './protocol.mjs';

// Regression: a real SQLite lock on the separate pairing journal outlived the
// last deadline check. Before the fix, a 100 ms request dispatched at 558 ms
// after a worker released its 500 ms transaction. The write ledger had already
// reserved/prepared it, so check again at the actual adapter dispatch boundary.
test('journal lock wait cannot dispatch an expired prepared write and its known rejection releases the barrier', { timeout: 10000 }, async t => {
  const base = fileURLToPath(new URL('../../.scratch/', import.meta.url)); await mkdir(base, { recursive: true });
  const root = await realpath(await mkdtemp(path.join(base, 'execution-expiry-test-'))), project = path.join(root, 'project'); await mkdir(project);
  const journalFile = path.join(root, 'pairing-journal.sqlite'), journal = new Journal(journalFile), ledger = new WriteLedger(path.join(root, 'installation-ledger.sqlite'));
  let worker, execute;
  t.after(async () => {
    await worker?.terminate(); await execute?.drain(); ledger.close(); journal.close();
    const actual = await realpath(root), parent = await realpath(base);
    assert.equal(path.dirname(actual).toLowerCase(), parent.toLowerCase()); assert.ok(path.basename(actual).startsWith('execution-expiry-test-'));
    await rm(actual, { recursive: true, maxRetries: 5, retryDelay: 100 });
  });
  const threadId = '01a1b180-89f8-7291-beb2-43f569f3709c', pairingId = 'expiry-regression';
  const source = `const {parentPort,workerData}=await import('node:worker_threads');
const {DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync(workerData);
db.exec('BEGIN IMMEDIATE');parentPort.postMessage('locked');
setTimeout(()=>{db.exec('COMMIT');db.close();parentPort.close();},500);`;
  worker = new Worker(source, { eval: true, workerData: journalFile });
  const exited = new Promise((resolve, reject) => { worker.once('exit', code => code === 0 ? resolve() : reject(new Error('Journal fixture worker exited ' + code))); worker.once('error', reject); });
  void exited.catch(() => {});
  await new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); });
  let dispatched = 0, prepared = 0, enteredAt;
  const begin = journal.begin.bind(journal); journal.begin = (...args) => { enteredAt = Date.now(); return begin(...args); };
  execute = createExecutor({ journal, writeLedger: ledger, pairingId,
    resolveProject: async () => ({ threadId, projectRoot: project, associated: true }), isReadMethod: () => false,
    writeGrant: { enabled: true, projectRoots: [project], methods: ['gitStage'] },
    // The synthetic adapter/proof isolate dispatch control only. They do not
    // claim a business write occurred or replace the separate real Git tests.
    adapter: { async request(request) { dispatched++; return { jsonrpc: '2.0', id: request.id, result: { structuredContent: { ok: true } } }; } },
    prepareWrite: async () => { prepared++; return { target: { paths: ['sample.txt'] }, verify: async () => ({ target: { paths: ['sample.txt'] }, resultSha256: 'e'.repeat(64) }) }; },
  });
  const request = id => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'deck_upstream_write',
    arguments: { method: 'gitStage', payload: { paths: ['sample.txt'], expectedThreadId: threadId } }, _meta: { threadId } } });
  const job = (value, expiresAt) => ({ version: 1, operationId: digest(JSON.stringify(value)), request: value, fingerprint: requestHash(value), expiresAt });
  const expiresAt = Date.now() + 100, operation = job(request(1), expiresAt), response = await execute(operation);
  await exited;
  assert.equal(prepared, 1); assert.ok(enteredAt < expiresAt, 'the request was still live before journal lock acquisition');
  assert.equal(response.error.data.state, 'not-executed'); assert.equal(dispatched, 0);
  const scope = { pairingId, threadId, projectRoot: process.platform === 'win32' ? project.toLowerCase() : project };
  const status = ledger.inspect({ operationId: operation.operationId, projectKey: scope.projectRoot, ownerScope: scope });
  assert.equal(status.state, 'completed'); assert.equal(status.outcome, 'failed'); assert.equal(status.result.errorKind, 'rejected');
  assert.ok((await execute(job(request(2), Date.now() + 1000))).result, 'a new explicit live request can pass after this known rejection');
  assert.equal(dispatched, 1);
});
