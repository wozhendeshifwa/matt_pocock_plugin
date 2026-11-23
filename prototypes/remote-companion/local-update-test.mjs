import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as fs from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { createLocalUpdater } from './local-update.mjs';
import { legacyAdapterDataRoot, registeredProjectDataBucket } from './local-data-upgrade.mjs';
import { OVERLAY_VERSION } from './freeze-adapter.mjs';
import { WriteLedger } from './write-ledger.mjs';
import { createPairing, loadPairing, createRuntimeControl } from './lifecycle.mjs';
import { digest } from './protocol.mjs';

const json = async file => JSON.parse(await fs.readFile(file, 'utf8'));
async function fixture(t, { oldCompatible = false, shared = false, actualDpapi = false } = {}) {
  const base = fileURLToPath(new URL('../../.scratch/', import.meta.url)); await fs.mkdir(base, { recursive: true });
  const directory = await fs.realpath(await fs.mkdtemp(path.join(base, 'local-update-test-')));
  t.after(async () => { const actual = await fs.realpath(directory); assert.equal(path.dirname(actual).toLowerCase(), (await fs.realpath(base)).toLowerCase()); assert.ok(path.basename(actual).startsWith('local-update-test-')); await fs.rm(actual, { recursive: true, maxRetries: 10, retryDelay: 100 }); });
  const project = path.join(directory, 'RegisteredProject'), historical = path.join(directory, 'HistoricalTest'), snapshots = path.join(directory, 'archives'), stable = path.join(directory, 'installation/data');
  await Promise.all([project, historical, snapshots].map(file => fs.mkdir(file)));
  const { bucket } = await registeredProjectDataBucket(project), historicalBucket = (await registeredProjectDataBucket(historical)).bucket, prefix = 'projects/' + bucket + '/';
  const put = async (root, relative, content) => { const file = path.join(root, relative); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, content); return file; };
  const frozen = async (name, overlayVersion) => {
    const root = path.join(directory, name), rows = [ ['prototypes/upstream-port/sidebar-server.mjs', '// frozen local fixture ' + name + '\n'], ['vendor/mattskills-1.8.0-rc.7/package.json', '{"type":"module"}\n'] ];
    for (const [relative, content] of rows) await put(root, relative, content);
    const manifest = { schemaVersion: 1, ready: true, overlayVersion, adapterRelativePath: rows[0][0], files: rows.map(([file, content]) => ({ path: file, bytes: Buffer.byteLength(content), sha256: digest(content) })) };
    const text = JSON.stringify(manifest) + '\n'; await fs.writeFile(path.join(root, 'frozen-adapter.json'), text);
    const description = { schemaVersion: 1, version: name, pluginProtocolVersion: 1, relayProtocolVersion: 1, localDataSchemaVersion: 1, baseline: { directory: root, manifestSha256: digest(text) } };
    const releaseText = JSON.stringify(description) + '\n', manifestFile = path.join(directory, name + '-release.json'); await fs.writeFile(manifestFile, releaseText);
    return { root, description, pin: { manifestFile, manifestSha256: digest(releaseText) }, adapter: path.join(root, rows[0][0]) };
  };
  const old = await frozen('old-release', oldCompatible || shared ? OVERLAY_VERSION : 'choices-bound-project-and-log-load-v3'), target = await frozen('new-release', OVERLAY_VERSION);
  const legacy = (await legacyAdapterDataRoot(old.adapter)).dataRoot, sourceData = shared ? stable : legacy;
  await fs.mkdir(sourceData, { recursive: true });
  const business = await put(sourceData, prefix + 'manual-naming.json', '{"manual":"original"}\n');
  await put(sourceData, prefix + '.dsh-mattskillsdeck-cache/session-tickets.json', '{"thread":{"issues":[44]}}\n');
  await put(sourceData, prefix + '.dsh-mattskillsdeck-cache/snapshot.json', '{"stale":"cache"}\n');
  await put(sourceData, prefix + 'publication/half-created.json', '{"halfCreated":true,"repository":"fixture-owner/repo"}\n');
  await put(sourceData, prefix + 'write-backups/label-colors/fixture.json', '{"custom":"123456"}\n');
  if (!shared) await put(sourceData, 'projects/' + historicalBucket + '/manual-naming.json', 'unregistered historical test\n');
  const provider = path.join(directory, 'provider-config.toml'); await fs.writeFile(provider, '[model_providers.deepseek]\nname="preserved"\n');
  const ledgerFile = path.join(directory, 'write-ledger.sqlite'); const ledger = new WriteLedger(ledgerFile); ledger.close();
  const pairingFile = path.join(directory, 'pairing.json'), pairingId = randomUUID(), journalPath = path.join(directory, 'journal.sqlite');
  if (actualDpapi) await createPairing({ file: pairingFile, relayOrigin: 'https://relay.example.invalid', adapterPath: old.adapter, journalPath,
    baseline: old.description.baseline, deviceToken: randomBytes(32).toString('hex'), ...(shared ? { localDataRoot: stable } : {}) });
  else await fs.writeFile(pairingFile, JSON.stringify({ protocolVersion: 1, pairingId, relayOrigin: 'https://relay.example.invalid', adapterPath: old.adapter, journalPath,
    baseline: old.description.baseline, secretDPAPI: Buffer.from('opaque-fixture-envelope-never-decrypted').toString('base64'), writeEnabled: false, revoked: false,
    ...(shared ? { localDataRoot: stable } : {}) }) + '\n');
  const actualId = (await json(pairingFile)).pairingId, runtimeFile = pairingFile + '.runtime.json';
  const state = { registered: [project], stopped: [], claims: [], keepOld: false, replacement: false, runtimeId: randomUUID() };
  await fs.writeFile(runtimeFile, JSON.stringify({ pairingId: actualId, instanceId: state.runtimeId, pid: 2147483647, state: 'connected', updatedAt: Date.now() }) + '\n');
  const runtime = {
    async read() { try { return await json(runtimeFile); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } },
    async stop() { const value = await this.read(); state.stopped.push(value.instanceId); if (!state.keepOld) await fs.unlink(runtimeFile); if (state.replacement) await fs.writeFile(runtimeFile, JSON.stringify({ ...value, instanceId: randomUUID() })); return { requested: true, instanceId: value.instanceId }; },
    async claim() { const instanceId = randomUUID(); await fs.writeFile(runtimeFile, JSON.stringify({ pairingId: actualId, instanceId, pid: 2147483647, state: 'updating', updatedAt: Date.now() }), { flag: 'wx' }); state.claims.push(instanceId);
      return { instanceId, async close() { const current = await runtime.read(); if (current?.instanceId === instanceId) await fs.unlink(runtimeFile); } }; },
  };
  const make = options => createLocalUpdater({ pairingFile, sourceRelease: old.pin, targetRelease: target.pin, snapshotParent: snapshots, stableDataRoot: stable,
    registeredProjectRoots: async () => state.registered, writeLedgerFile: ledgerFile, runtime, stopTimeoutMs: 80, ...options });
  const apply = async (updater, plan) => updater.apply({ planSha256: plan.planSha256, confirmation: 'APPLY ' + plan.planSha256 });
  const reserve = (suffix, outcome) => {
    const db = new WriteLedger(ledgerFile), operationId = digest(suffix), ownerScope = { pairingId: actualId, threadId: 'fixture-thread' };
    const common = { operationId, projectKey: project, ownerScope };
    db.reserve({ ...common, intent: { method: 'logSetSwitch', parametersSha256: digest(suffix), target: { localStateKey: 'log-switch' } } });
    if (outcome === 'completed') db.complete({ ...common, outcome: 'succeeded', result: { resultSha256: digest('completed') } });
    if (outcome === 'unknown') db.markUnknown({ ...common, reason: 'process-ended' }); db.close(); return operationId;
  };
  return { directory, project, historicalBucket, prefix, sourceData, stable, snapshots, business, pairingFile, runtimeFile, provider, ledgerFile, state, runtime, make, apply, put, reserve, old, target };
}

test('plan is read-only, shows exact releases/protocols and filters historical business while preserving archival cache', async t => {
  const f = await fixture(t), updater = await f.make(), original = await fs.readFile(f.pairingFile), p = await updater.plan();
  assert.deepEqual(p.blockers, []); assert.equal(p.source.version, 'old-release'); assert.equal(p.target.version, 'new-release'); assert.equal(p.target.pluginProtocolVersion, 1);
  assert.equal(p.mode, 'migrate-legacy'); assert.equal(p.activationReady, false); assert.equal(p.files.selected.length, 4); assert.equal(p.files.filtered.length, 1); assert.equal(p.files.invalidate.length, 1);
  assert.ok(p.files.selected.every(item => !item.path.includes(f.historicalBucket))); assert.deepEqual(await fs.readdir(f.snapshots), []); await assert.rejects(fs.stat(f.stable), { code: 'ENOENT' });
  assert.deepEqual(await fs.readFile(f.pairingFile), original); assert.equal(f.state.stopped.length, 0);
  await assert.rejects(updater.apply({ planSha256: p.planSha256, confirmation: true }), /Explicit local APPLY/);
});

test('a saved opener receipt remains durable audit state during the next update instead of blocking it', async t => {
  const f = await fixture(t, { shared: true }), operationId = digest('verified-local-opener');
  const relative = f.prefix + 'open-receipts/' + operationId + '.json';
  const receipt = { operationId, method: 'openFolder', targetSha256: digest('owned-target'), commandTargetSha256: digest('owned-command'), status: 'exit-zero' };
  const saved = JSON.stringify(receipt) + '\n'; await f.put(f.sourceData, relative, saved);
  const updater = await f.make(), plan = await updater.plan(); assert.deepEqual(plan.blockers, []);
  assert.ok(plan.files.selected.some(entry => entry.path === relative && entry.kind === 'audit'));
  await f.apply(updater, plan); assert.equal(await fs.readFile(path.join(f.stable, relative), 'utf8'), saved);
});

test('configuration disappearance during the first claimed-fence check always closes only that update lease', async t => {
  const f = await fixture(t), displaced = f.pairingFile + '.concurrent-move'; let closes = 0;
  const runtime = { ...f.runtime, async claim(file) {
    const lease = await f.runtime.claim(file); await fs.rename(f.pairingFile, displaced);
    return { instanceId: lease.instanceId, async close() { closes++; await lease.close(); } };
  } };
  const updater = await f.make({ runtime }), plan = await updater.plan();
  await assert.rejects(f.apply(updater, plan), { code: 'ENOENT' });
  assert.equal(closes, 1); assert.equal(await f.runtime.read(), null);
  await fs.rename(displaced, f.pairingFile);
  const following = await f.runtime.claim(f.pairingFile); assert.ok(following.instanceId); await following.close();
  await assert.rejects(fs.stat(f.stable), { code: 'ENOENT' });
});

test('a ledger moved after planning is never recreated by the writable lock or a failed update', async t => {
  const f = await fixture(t); f.reserve('historical-known-operation', 'completed');
  const updater = await f.make(), plan = await updater.plan(), originalConfig = await fs.readFile(f.pairingFile), retained = f.ledgerFile + '.retained';
  assert.equal(plan.ledger.rowCount, 1); await fs.rename(f.ledgerFile, retained);
  await assert.rejects(f.apply(updater, plan), /unable to open database file/);
  await assert.rejects(fs.stat(f.ledgerFile), { code: 'ENOENT' });
  const previous = new DatabaseSync(retained, { readOnly: true });
  try { assert.equal(previous.prepare('SELECT COUNT(*) AS n FROM write_ledger').get().n, 1); } finally { previous.close(); }
  assert.deepEqual(await fs.readFile(f.pairingFile), originalConfig); assert.equal(await f.runtime.read(), null);
  await assert.rejects(fs.stat(f.stable), { code: 'ENOENT' });
});

test('existing-ledger URI locking works with encoded spaces and Unicode without changing its authority', async t => {
  const f = await fixture(t), ledgerFile = path.join(f.directory, '写入记录 with spaces.sqlite');
  f.reserve('original-history', 'completed'); await fs.rename(f.ledgerFile, ledgerFile);
  const updater = await f.make({ writeLedgerFile: ledgerFile }), plan = await updater.plan();
  assert.equal(plan.ledger.rowCount, 1); await f.apply(updater, plan);
  const previous = new DatabaseSync(ledgerFile, { readOnly: true });
  try { assert.equal(previous.prepare('SELECT COUNT(*) AS n FROM write_ledger').get().n, 1); } finally { previous.close(); }
  await assert.rejects(fs.stat(f.ledgerFile), { code: 'ENOENT' });
});

test('configuration A-to-B-to-A replacement cannot mix A authority with inactive B business data', async t => {
  const f = await fixture(t), original = await fs.readFile(f.pairingFile), initial = JSON.parse(original), inactive = path.join(f.directory, 'inactive-business-data');
  await fs.mkdir(inactive); await f.put(inactive, f.prefix + 'manual-naming.json', 'stale inactive B state\n');
  const replacement = { ...initial, localDataRoot: inactive };
  const updater = await f.make({ testHooks: {
    async afterPairingSnapshot() { await fs.writeFile(f.pairingFile, JSON.stringify(replacement) + '\n'); },
    async afterPairingValidation() { await fs.writeFile(f.pairingFile, original); },
  } });
  await assert.rejects(updater.plan(), /same reviewed byte snapshot/);
  assert.deepEqual(await fs.readFile(f.pairingFile), original);
  assert.equal(await fs.readFile(f.business, 'utf8'), '{"manual":"original"}\n');
  assert.equal(f.state.stopped.length, 0); assert.equal(f.state.claims.length, 0);
  await assert.rejects(fs.stat(f.stable), { code: 'ENOENT' });
});
test('apply holds exact stop/fresh-instance and SQLite fences, seeds only registered durable state, backs up config and preserves security scope', async t => {
  const f = await fixture(t), original = await json(f.pairingFile), provider = await fs.readFile(f.provider), ledgerBytes = await fs.readFile(f.ledgerFile);
  const updater = await f.make({ testHooks: { async afterSnapshot({ snapshot }) {
    const active = await f.runtime.read(); assert.ok(f.state.claims.includes(active.instanceId)); assert.equal(active.state, 'updating');
    const archived = path.join(snapshot.directory, 'data', f.prefix + '.dsh-mattskillsdeck-cache/snapshot.json'); assert.equal(await fs.readFile(archived, 'utf8'), '{"stale":"cache"}\n');
    const contender = new DatabaseSync(f.ledgerFile); contender.exec('PRAGMA busy_timeout=1;'); assert.throws(() => contender.exec('BEGIN IMMEDIATE;'), /locked/); contender.close();
    await assert.rejects(fs.stat(f.stable), { code: 'ENOENT' });
  } } });
  const result = await f.apply(updater, await updater.plan()), next = await json(f.pairingFile), receipt = await json(result.receiptFile);
  assert.equal(result.activationReady, false); assert.equal(result.runtimeStarted, false); assert.deepEqual(f.state.stopped, [f.state.runtimeId]); assert.equal(await f.runtime.read(), null);
  assert.equal(next.adapterPath, f.target.adapter); assert.equal(next.localDataRoot, f.stable); assert.equal(next.secretDPAPI, original.secretDPAPI); assert.equal(next.journalPath, original.journalPath); assert.equal(next.writeEnabled, false); assert.equal(next.writeGrant, original.writeGrant);
  assert.deepEqual(await json(receipt.originalConfiguration), original); assert.equal(await fs.readFile(path.join(f.stable, f.prefix + 'manual-naming.json'), 'utf8'), '{"manual":"original"}\n');
  await assert.rejects(fs.stat(path.join(f.stable, f.prefix + '.dsh-mattskillsdeck-cache/snapshot.json')), { code: 'ENOENT' });
  await assert.rejects(fs.stat(path.join(f.stable, 'projects', f.historicalBucket)), { code: 'ENOENT' });
  assert.deepEqual(await fs.readFile(f.provider), provider); assert.deepEqual(await fs.readFile(f.ledgerFile), ledgerBytes);
});
test('mutating the returned display plan cannot alter the locally retained reviewed operation', async t => {
  const f = await fixture(t), updater = await f.make(), p = await updater.plan(); p.files.selected[0].path = '../provider-config.toml'; p.target.adapterPath = 'C:\\unreviewed.mjs'; p.stableDataRoot = f.directory;
  await f.apply(updater, p); assert.equal((await json(f.pairingFile)).adapterPath, f.target.adapter); assert.equal((await json(f.pairingFile)).localDataRoot, f.stable);
  assert.equal(await fs.readFile(f.provider, 'utf8'), '[model_providers.deepseek]\nname="preserved"\n');
});
test('uncleared old ownership and a replacement runtime are rejected without trusting a stale PID', async t => {
  for (const mode of ['keepOld', 'replacement']) {
    const f = await fixture(t); f.state[mode] = true; const updater = await f.make(), p = await updater.plan();
    await assert.rejects(f.apply(updater, p), /release its ownership|Another runtime/); assert.equal(f.state.claims.length, 0); assert.equal((await json(f.pairingFile)).adapterPath, f.old.adapter); await assert.rejects(fs.stat(f.stable), { code: 'ENOENT' });
  }
});
test('an unresolved real installation ledger blocks update and is never recreated or cleared', async t => {
  const f = await fixture(t); const operationId = f.reserve('unknown-write', 'unknown'), updater = await f.make(), p = await updater.plan();
  assert.ok(p.blockers.includes('missing-installation-ledger-or-unresolved-write')); await assert.rejects(f.apply(updater, p), /blockers/); assert.equal(f.state.stopped.length, 0);
  const db = new DatabaseSync(f.ledgerFile, { readOnly: true }); assert.equal(db.prepare('SELECT state FROM write_ledger WHERE operation_id=?').get(operationId).state, 'unknown'); db.close();
});
test('source mutation, registry drift and a new stable destination reject a stale plan without overwriting existing data', async t => {
  for (const mode of ['source', 'registry', 'destination']) {
    const f = await fixture(t), updater = await f.make(), p = await updater.plan();
    if (mode === 'source') await fs.writeFile(f.business, 'new user state');
    if (mode === 'registry') f.state.registered = [];
    if (mode === 'destination') { await fs.mkdir(f.stable, { recursive: true }); await fs.writeFile(path.join(f.stable, 'sentinel'), 'existing'); }
    await assert.rejects(f.apply(updater, p), /state changed|scope changed|destination appeared/); assert.equal((await json(f.pairingFile)).adapterPath, f.old.adapter);
    if (mode === 'source') assert.equal(await fs.readFile(f.business, 'utf8'), 'new user state'); if (mode === 'destination') assert.equal(await fs.readFile(path.join(f.stable, 'sentinel'), 'utf8'), 'existing');
  }
});
test('CAS preserves concurrent in-place edits and a new config created after move-claim', async t => {
  for (const hook of ['beforeConfigurationClaim', 'afterConfigurationClaim']) {
    const f = await fixture(t), original = await json(f.pairingFile), concurrent = { ...original, operatorNote: hook };
    const updater = await f.make({ testHooks: { async [hook]() { await fs.writeFile(f.pairingFile, JSON.stringify(concurrent) + '\n'); } } });
    await assert.rejects(f.apply(updater, await updater.plan()), /CAS refused|EEXIST/); assert.deepEqual(await json(f.pairingFile), concurrent);
    const backups = (await fs.readdir(f.directory)).filter(name => name.startsWith('pairing.json.backup-')); assert.equal(backups.length, 1); assert.deepEqual(await json(path.join(f.directory, backups[0])), original);
  }
});
test('a revocation marker created while copying remains authoritative and no config switch occurs', async t => {
  const f = await fixture(t), updater = await f.make({ testHooks: { async afterSnapshot() { await fs.writeFile(f.pairingFile + '.revoked', '{"revoked":true}\n'); } } });
  await assert.rejects(f.apply(updater, await updater.plan()), /revoked/); assert.equal((await loadPairing(f.pairingFile, { allowRevoked: true })).revoked, true); assert.equal((await json(f.pairingFile)).adapterPath, f.old.adapter);
  assert.equal(await fs.readFile(f.pairingFile + '.revoked', 'utf8'), '{"revoked":true}\n');
});
test('rollback to incompatible old overlay is allowed only before any extra state/ledger write, and never copies old snapshot over new data', async t => {
  const f = await fixture(t), updater = await f.make(), applied = await f.apply(updater, await updater.plan()), p = await updater.planRollback(applied);
  assert.equal(p.shareStable, false); assert.deepEqual(p.blockers, []); await assert.rejects(updater.rollback({ planSha256: p.planSha256, confirmation: true }), /Explicit local ROLLBACK/);
  const result = await updater.rollback({ planSha256: p.planSha256, confirmation: 'ROLLBACK ' + p.planSha256 }); assert.equal(result.dataRestoredFromOldSnapshot, false); assert.equal((await json(f.pairingFile)).adapterPath, f.old.adapter); assert.equal((await json(f.pairingFile)).localDataRoot, undefined);
  assert.equal(await fs.readFile(path.join(f.stable, f.prefix + 'manual-naming.json'), 'utf8'), '{"manual":"original"}\n');
});
test('new business writes or even a new completed ledger operation block rollback into incompatible legacy state', async t => {
  for (const mode of ['state', 'ledger']) {
    const f = await fixture(t), updater = await f.make(), applied = await f.apply(updater, await updater.plan());
    if (mode === 'state') await fs.writeFile(path.join(f.stable, f.prefix + 'manual-naming.json'), 'new live business data'); else f.reserve('post-upgrade-write', 'completed');
    const p = await updater.planRollback(applied); assert.ok(p.blockers.includes('new-writes-cannot-be-restored-into-incompatible-old-state')); await assert.rejects(updater.rollback({ planSha256: p.planSha256, confirmation: 'ROLLBACK ' + p.planSha256 }), /blockers/);
    assert.equal((await json(f.pairingFile)).adapterPath, f.target.adapter);
  }
});
test('compatible code rollback shares the latest stable root and preserves newly completed writes', async t => {
  const f = await fixture(t, { oldCompatible: true }), updater = await f.make(), applied = await f.apply(updater, await updater.plan());
  const latest = path.join(f.stable, f.prefix + 'manual-naming.json'); await fs.writeFile(latest, 'latest live state'); f.reserve('completed-new-version-write', 'completed');
  const p = await updater.planRollback(applied); assert.equal(p.shareStable, true); assert.deepEqual(p.blockers, []);
  await updater.rollback({ planSha256: p.planSha256, confirmation: 'ROLLBACK ' + p.planSha256 }); assert.equal((await json(f.pairingFile)).adapterPath, f.old.adapter); assert.equal((await json(f.pairingFile)).localDataRoot, f.stable); assert.equal(await fs.readFile(latest, 'utf8'), 'latest live state');
});
test('rollback rejects corrupted original config, unresolved writes, and writes after its reviewed plan', async t => {
  const f = await fixture(t, { oldCompatible: true }), updater = await f.make(), applied = await f.apply(updater, await updater.plan()), receipt = await json(applied.receiptFile);
  const original = await fs.readFile(receipt.originalConfiguration); await fs.writeFile(receipt.originalConfiguration, original.toString().replace('"writeEnabled":false', '"writeEnabled":true'));
  await assert.rejects(updater.planRollback(applied), /backup changed/); await fs.writeFile(receipt.originalConfiguration, original);
  const p = await updater.planRollback(applied); await fs.writeFile(path.join(f.stable, f.prefix + 'manual-naming.json'), 'new state after review');
  await assert.rejects(updater.rollback({ planSha256: p.planSha256, confirmation: 'ROLLBACK ' + p.planSha256 }), /state changed/);
  f.reserve('unresolved-before-code-rollback', 'unknown'); const blocked = await updater.planRollback(applied); assert.ok(blocked.blockers.includes('installation-write-unresolved'));
});
test('existing curated stable root updates in place and archives invalidated cache without discarding current business', async t => {
  const f = await fixture(t, { shared: true }), updater = await f.make(), p = await updater.plan(); assert.equal(p.mode, 'shared-stable'); assert.deepEqual(p.blockers, []);
  const applied = await f.apply(updater, p); assert.equal(await fs.readFile(f.business, 'utf8'), '{"manual":"original"}\n');
  assert.equal(await fs.readFile(path.join(applied.directory, 'invalidated-cache', f.prefix + '.dsh-mattskillsdeck-cache/snapshot.json'), 'utf8'), '{"stale":"cache"}\n');
  const rollback = await updater.planRollback(applied); assert.equal(rollback.shareStable, true); assert.deepEqual(rollback.blockers, []);
});
test('incompatible protocol and unrecognized registered state produce explicit blockers', async t => {
  const f = await fixture(t); await f.put(f.sourceData, f.prefix + 'future-business-state.json', 'must not silently discard');
  const updater = await f.make(), p = await updater.plan(); assert.ok(p.blockers.includes('unrecognized-registered-business-state'));
  const changed = { ...f.target.description, pluginProtocolVersion: 2 }, content = JSON.stringify(changed) + '\n'; await fs.writeFile(f.target.pin.manifestFile, content);
  const other = await f.make({ targetRelease: { ...f.target.pin, manifestSha256: digest(content) } }); assert.ok((await other.plan()).blockers.includes('plugin-relay-protocol-incompatible'));
});
test('default lifecycle fence really stops an exact instance and preserves actual CurrentUser DPAPI ciphertext', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t, { actualDpapi: true }); await fs.unlink(f.runtimeFile);
  let oldControl; oldControl = await createRuntimeControl(f.pairingFile, { intervalMs: 250, onStop: async () => oldControl.close() }); t.after(() => oldControl.close());
  const before = await json(f.pairingFile), updater = await f.make({ runtime: undefined, stopTimeoutMs: 2000 }), p = await updater.plan(); assert.equal(p.runtimeInstanceId, oldControl.instanceId);
  await f.apply(updater, p); const after = await loadPairing(f.pairingFile, { decrypt: true }); assert.equal(after.secretDPAPI, before.secretDPAPI); assert.ok(after.deviceToken.length >= 32);
});
