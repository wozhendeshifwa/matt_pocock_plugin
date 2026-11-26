import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TaskManager } from './manager.mjs';
import { dispatchSandbox } from './adapter.mjs';

const tick = () => new Promise(resolve => setTimeout(resolve, 20));
async function until(predicate) { const end = Date.now() + 4000; while (!predicate()) { if (Date.now() > end) assert.fail('condition timed out'); await tick(); } }
function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'sandbox-manager-test-'));
  const running = new Map(), launched = [];
  const engine = {
    async prepare(project, input) { return { base: input.base ?? 'fixed-sha', model: 'model', dirty: true, excluded: 2 }; },
    async launch(task) { launched.push(task.id); running.set(task.id, { state: 'running' }); },
    async inspect(task) { return running.get(task.id) ?? { state: 'absent' }; },
    async cancel(task) { if (running.get(task.id)?.state !== 'terminal') running.set(task.id, { state: 'terminal', result: { status: 'cancelled' } }); },
    async detail() { return { log: 'evidence' }; },
    async mergePreview() { return { targetHead: 'head', fingerprint: 'target' }; },
    async merge() { return { merged: true }; },
    async clean() {},
  };
  let manager = new TaskManager({ directory, engine });
  return { directory, engine, running, launched, get manager() { return manager; },
    replace() { manager.close(); manager = new TaskManager({ directory, engine }); return manager; },
    close() { manager.close(); rmSync(directory, { recursive: true }); } };
}
async function draft(manager, project = 'A', input = {}) { return manager.prepare(project, { prompt: 'task', minutes: 60, ...input }); }

test('durable start token deduplicates simultaneous/replayed start and never crosses projects', async () => {
  const f = fixture();
  try {
    const p = await draft(f.manager);
    const a = f.manager.start('A', p.token), b = f.manager.start('A', p.token);
    assert.equal(a.id, b.id);
    await until(() => f.launched.length === 1);
    assert.throws(() => f.manager.start('B', p.token));
    assert.throws(() => f.manager.task('B', a.id));
    const next = f.replace(); await next.recover();
    assert.equal(next.start('A', p.token).id, a.id);
    assert.equal(f.launched.length, 1);
  } finally { f.close(); }
});
test('global limit queues across projects; baseline is frozen; queued cancellation never launches', async () => {
  const f = fixture();
  try {
    const a = f.manager.start('A', (await draft(f.manager)).token);
    f.manager.start('B', (await draft(f.manager, 'B')).token);
    const third = f.manager.start('A', (await draft(f.manager)).token);
    assert.equal(f.manager.task('A', third.id).status, 'queued');
    assert.equal(f.launched.length, 2);
    assert.equal(f.manager.task('A', third.id).base, 'fixed-sha');
    await f.manager.cancel('A', third.id);
    f.running.set(a.id, { state: 'terminal', result: { status: 'completed', checks: { state: 'passed' } } });
    await until(() => f.manager.task('A', a.id).status === 'completed');
    assert.equal(f.launched.length, 2);
  } finally { f.close(); }
});
test('completion wins cancellation race; unknown execution stays nonterminal', async () => {
  const f = fixture();
  try {
    const a = f.manager.start('A', (await draft(f.manager)).token);
    await tick();
    f.running.set(a.id, { state: 'terminal', result: { status: 'completed' } });
    await f.manager.cancel('A', a.id);
    await until(() => f.manager.task('A', a.id).status === 'completed');
    const b = f.manager.start('A', (await draft(f.manager)).token);
    f.running.set(b.id, { state: 'unknown' });
    await until(() => f.manager.task('A', b.id).unverified);
    assert.ok(['preparing', 'running'].includes(f.manager.task('A', b.id).status));
    await assert.rejects(() => f.manager.prepare('A', { prompt: 'rerun', rerunId: b.id }));
    await assert.rejects(() => f.manager.actionPreview('A', b.id, 'clean'));
  } finally { f.close(); }
});
test('restart pauses queued work; only proven absent execution becomes interrupted', async () => {
  const f = fixture();
  try {
    f.manager.setLimit(1);
    const a = f.manager.start('A', (await draft(f.manager)).token);
    const b = f.manager.start('A', (await draft(f.manager)).token);
    await tick(); f.running.delete(a.id);
    const manager = f.replace(); await manager.recover();
    await until(() => manager.task('A', a.id).status === 'interrupted');
    assert.equal(manager.task('A', b.id).paused, true);
    assert.equal(f.launched.length, 1);
    manager.resume('A', b.id);
    await until(() => f.launched.length === 2);
    assert.equal(manager.limit(), 1);
  } finally { f.close(); }
});

test('failed observation marks a running execution unknown without freeing its slot', async () => {
  const f = fixture();
  try {
    f.manager.setLimit(1);
    const active = f.manager.start('A', (await draft(f.manager)).token);
    await until(() => f.manager.task('A', active.id).status === 'running');
    f.engine.inspect = async () => { throw new Error('connection lost'); };
    const queued = f.manager.start('A', (await draft(f.manager)).token);
    await until(() => f.manager.task('A', active.id).unverified);
    assert.equal(f.manager.task('A', active.id).status, 'running');
    assert.equal(f.manager.task('A', queued.id).status, 'queued');
    assert.equal(f.launched.length, 1);
  } finally { f.close(); }
});

test('legacy abnormal check failure is reconciled after stop verification with raw history retained', async () => {
  const f = fixture();
  try {
    f.manager.setLimit(1);
    const active = f.manager.start('A', (await draft(f.manager)).token);
    const queued = f.manager.start('A', (await draft(f.manager)).token);
    await tick();
    f.manager.save({ ...f.manager.task('A', active.id), status: 'failed', message: 'shutdown killed host Git', checks: { state: 'failed', exitCode: 4294967295 }, endedAt: 123 });
    f.running.set(active.id, { state: 'unknown' });
    const next = f.replace(); await next.recover();
    assert.equal(next.task('A', active.id).status, 'stopping');
    assert.equal(next.task('A', active.id).unverified, true);
    assert.equal(next.task('A', queued.id).paused, true);
    f.running.set(active.id, { state: 'terminal', result: { status: 'interrupted', checks: { state: 'unknown', exitCode: 4294967295 } } });
    await until(() => next.task('A', active.id).status === 'interrupted');
    assert.equal(next.task('A', active.id).reconciliation.originalEndedAt, 123);
    assert.equal(next.task('A', active.id).reconciliation.fromStatus, 'failed');
    assert.equal(f.launched.length, 1);
  } finally { f.close(); }
});
test('merge only allows completed changed results; unchecked result needs extra confirmation; cleanup preserves dedupe', async () => {
  const f = fixture();
  try {
    const p = await draft(f.manager), a = f.manager.start('A', p.token);
    await tick();
    await assert.rejects(() => f.manager.actionPreview('A', a.id, 'merge'));
    f.running.set(a.id, { state: 'terminal', result: { status: 'completed', checks: { state: 'failed' }, result: { changed: true } } });
    await until(() => f.manager.task('A', a.id).status === 'completed');
    const preview = await f.manager.actionPreview('A', a.id, 'merge');
    await assert.rejects(() => f.manager.confirm('A', preview.token, 'merge', false));
    assert.equal((await f.manager.confirm('A', preview.token, 'merge', true)).merged, true);
    const cleaning = await f.manager.actionPreview('A', a.id, 'clean');
    assert.equal((await f.manager.confirm('A', cleaning.token, 'clean')).cleaned, true);
    assert.equal(f.manager.list('A').tasks.length, 0);
    assert.equal(f.manager.start('A', p.token).cleaned, true);
    assert.equal(f.launched.length, 1);
  } finally { f.close(); }
});
test('read/write route and stale thread identities fail closed before service access', async () => {
  const project = { projectRoot: '/trusted', threadId: 'current' };
  await assert.rejects(() => dispatchSandbox('deck_sandbox_read', { method: 'start', expectedThreadId: 'current' }, project));
  await assert.rejects(() => dispatchSandbox('deck_sandbox_write', { method: 'start', expectedThreadId: 'old' }, project));
  await assert.rejects(() => dispatchSandbox('deck_sandbox_read', { method: 'list', expectedThreadId: 'current' }, { threadId: 'current' }));
});
