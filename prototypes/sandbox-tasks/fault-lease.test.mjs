import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { FaultLease, armFault, startTokenHash, MAX_FAULT_MS } from './fault-lease.mjs';
import { serve, callService } from './service.mjs';

const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
function fixture() {
  const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-fault-')));
  return { project, file: path.join(project, 'control.json') };
}

test('fault leases require exact scope, expire by clock and reject legacy/unbounded controls', () => {
  const { project, file } = fixture(); let clock = 1000;
  const lease = new FaultLease({ project, file, now: () => clock });
  try {
    assert.throws(() => armFault(file, { mode: 'disconnect', ttlMs: 50 }, clock), /绑定/);
    assert.throws(() => armFault(file, { mode: 'disconnect', taskId: id, ttlMs: MAX_FAULT_MS + 1 }, clock), /有效期/);
    armFault(file, { mode: 'hold-observation', taskId: id, ttlMs: 50 }, clock);
    assert.equal(lease.matches('hold-observation', project, id), true);
    assert.equal(lease.matches('hold-observation', project + '-other', id), false);
    assert.equal(lease.matches('hold-observation', project, id.replace('a', 'b')), false);
    clock += 50;
    assert.equal(lease.matches('hold-observation', project, id), false);
    assert.equal(JSON.parse(fs.readFileSync(file)).enabled, false);
    fs.writeFileSync(file, JSON.stringify({ dropStartOnce: true, enabled: true }));
    assert.equal(lease.status().enabled, false);
  } finally { lease.close(); fs.rmSync(project, { recursive: true }); }
});

test('idle expiry is persisted, close and a fresh harness invalidate a prior live lease', async () => {
  const { project, file } = fixture();
  let lease = new FaultLease({ project, file });
  try {
    armFault(file, { mode: 'disconnect', taskId: id, ttlMs: 20 });
    const deadline = Date.now() + 2000;
    while (JSON.parse(fs.readFileSync(file)).enabled && Date.now() < deadline) await new Promise(r => setTimeout(r, 20));
    assert.equal(JSON.parse(fs.readFileSync(file)).enabled, false);
    armFault(file, { mode: 'disconnect', taskId: id });
    const previous = fs.readFileSync(file);
    lease.close();
    assert.equal(JSON.parse(fs.readFileSync(file)).enabled, false);
    // Simulate an abrupt exit leaving an unexpired control behind.
    fs.writeFileSync(file, previous);
    lease = new FaultLease({ project, file });
    assert.equal(lease.status().enabled, false);
    assert.notEqual(JSON.parse(previous).sessionId, lease.sessionId);
  } finally { lease.close(); fs.rmSync(project, { recursive: true }); }
});

test('real IPC loses only the bound start reply once, retries deduplicate and shutdown disarms', async () => {
  const { project, file } = fixture(); const events = [];
  const lease = new FaultLease({ project, file, onEvent: event => events.push(event) });
  const config = { directory: path.join(project, 'data'), token: randomBytes(32).toString('hex') };
  const configFile = path.join(project, 'config.json'); fs.writeFileSync(configFile, JSON.stringify(config));
  let launches = 0;
  const engine = { async prepare() { return { base: 'a'.repeat(40), model: 'fixture' }; },
    async launch() { launches++; }, async inspect() { return { state: 'running' }; }, async detail() { return {}; } };
  const app = await serve(config, { engine, faults: lease });
  try {
    const first = await callService(project, 'prepare', { prompt: 'first' }, configFile);
    const other = await callService(project, 'prepare', { prompt: 'other' }, configFile);
    armFault(file, { mode: 'drop-start-reply', tokenHash: startTokenHash(first.token) });
    const unaffected = await callService(project, 'start', { token: other.token }, configFile);
    assert.ok(unaffected.id);
    assert.equal(lease.status().enabled, true);
    await assert.rejects(callService(project, 'start', { token: first.token }, configFile), /状态待核实/);
    assert.equal(lease.status().enabled, false);
    const original = await callService(project, 'start', { token: first.token }, configFile);
    const replay = await callService(project, 'start', { token: first.token }, configFile);
    assert.equal(original.id, replay.id);
    assert.equal((await callService(project, 'list', {}, configFile)).tasks.length, 2);
    assert.equal(launches, 2);
    assert.equal(events.filter(event => event.kind === 'dropped-start-reply').length, 1);
    armFault(file, { mode: 'disconnect', taskId: original.id });
    assert.ok((await callService(project, 'detail', { id: unaffected.id }, configFile)).id);
    await assert.rejects(callService(project, 'detail', { id: original.id }, configFile), /状态待核实/);
  } finally {
    await app.close();
    assert.equal(JSON.parse(fs.readFileSync(file)).enabled, false);
    fs.rmSync(project, { recursive: true });
  }
});
