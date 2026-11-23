import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { lstat, realpath, readFile, writeFile, mkdir, readdir, rename, link, unlink, open } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { VERSION, canonical, digest } from './protocol.mjs';
import { loadPairing, requestStop, createRuntimeControl, backupFile } from './lifecycle.mjs';
import { verifyFrozenAdapter, OVERLAY_VERSION, LOCAL_DATA_OVERLAY_VERSIONS } from './freeze-adapter.mjs';
import { resolveAdapterDataLayout } from './local-data-layout.mjs';
import { installationWriteLedgerFile } from './write-grant.mjs';
import { inventoryLocalData, registeredProjectDataBucket, installationLocalDataRoot, createLocalDataSnapshot, verifyLocalDataSnapshot } from './local-data-upgrade.mjs';

const HASH = /^[a-f0-9]{64}$/, UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const fold = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
const equal = (a, b) => canonical(a) === canonical(b), hash = value => digest(canonical(value));
const need = (condition, message) => { if (!condition) throw new Error(message); };
const within = (root, file) => { const relative = path.relative(fold(root), fold(file)); return relative === '' || relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative); };
const exists = async file => lstat(file).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
const identity = entry => ({ path: entry.path, kind: entry.kind, bytes: entry.bytes, sha256: entry.sha256 });
async function noRedirect(file) {
  let item = path.resolve(file);
  for (;;) {
    try { const info = await lstat(item); need(!info.isSymbolicLink() && fold(await realpath(item)) === fold(item), 'Update path was redirected'); return; }
    catch (error) { if (error.code !== 'ENOENT') throw error; const next = path.dirname(item); need(next !== item, 'Update path unavailable'); item = next; }
  }
}
async function bytes(file, maximum = 1024 * 1024) {
  await noRedirect(file); const before = await lstat(file); need(before.isFile() && before.size <= maximum, 'Update input must be a bounded regular file');
  const content = await readFile(file), after = await lstat(file);
  need(content.length === before.size && after.size === before.size && after.mtimeMs === before.mtimeMs && after.ctimeMs === before.ctimeMs, 'Update input changed while reading'); return content;
}
const readJson = async file => JSON.parse((await bytes(file)).toString('utf8'));
async function release(pin) {
  need(pin && typeof pin.manifestFile === 'string' && path.isAbsolute(pin.manifestFile) && HASH.test(pin.manifestSha256 ?? ''), 'Pin an existing local release manifest and digest');
  const content = await bytes(pin.manifestFile); need(digest(content) === pin.manifestSha256, 'Release manifest changed'); const value = JSON.parse(content);
  need(value.schemaVersion === 1 && typeof value.version === 'string' && value.version.length > 0 && value.version.length <= 100 &&
    Number.isSafeInteger(value.pluginProtocolVersion) && Number.isSafeInteger(value.relayProtocolVersion) && Number.isSafeInteger(value.localDataSchemaVersion) &&
    value.baseline && path.isAbsolute(value.baseline.directory ?? '') && HASH.test(value.baseline.manifestSha256 ?? ''), 'Invalid pinned local release description');
  const frozen = await verifyFrozenAdapter({ directory: value.baseline.directory, expectedManifestSha256: value.baseline.manifestSha256 });
  return { version: value.version, pluginProtocolVersion: value.pluginProtocolVersion, relayProtocolVersion: value.relayProtocolVersion,
    localDataSchemaVersion: value.localDataSchemaVersion, baseline: value.baseline, adapterPath: frozen.adapterPath, overlayVersion: frozen.overlayVersion,
    stableDataCompatible: LOCAL_DATA_OVERLAY_VERSIONS.includes(frozen.overlayVersion), manifestSha256: pin.manifestSha256 };
}
function supplementalKind(entry) {
  const file = entry.path.replace(/^projects\/[a-f0-9]{64}\//, '');
  if (file === 'publication/half-created.json') return 'business';
  if (/^write-backups\/label-colors\/[^/]+\.json$/.test(file)) return 'audit';
  if (/^open-receipts\/[a-f0-9]{64}\.json$/.test(file)) return 'audit';
  return entry.kind;
}
function selection(inventory, buckets) {
  const selected = [], invalidate = [], filtered = [], unknown = [];
  for (const entry of inventory.entries) {
    const bucket = /^projects\/([a-f0-9]{64})\//.exec(entry.path)?.[1];
    if (['cache', 'temporary', 'diagnostic'].includes(entry.kind)) { invalidate.push(identity(entry)); continue; }
    if (!buckets.includes(bucket)) { filtered.push(identity(entry)); continue; }
    const kind = supplementalKind(entry), item = { ...identity(entry), kind };
    if (['business', 'audit', 'log'].includes(kind)) selected.push(item);
    else if (['cache', 'temporary', 'diagnostic'].includes(kind)) invalidate.push(item);
    else unknown.push(item);
  }
  return { selected, invalidate, filtered, unknown };
}
function ledgerRead(file, { lock = false } = {}) {
  // URI mode=rw opens an existing authority without SQLITE_OPEN_CREATE. A
  // concurrent move must not leave an empty replacement ledger after failure.
  const database = new DatabaseSync(pathToFileURL(file).href + '?mode=' + (lock ? 'rw' : 'ro'), { readOnly: !lock });
  try {
    database.exec('PRAGMA busy_timeout=2000;' + (lock ? 'BEGIN IMMEDIATE;' : 'BEGIN;'));
    const rows = database.prepare('SELECT operation_id,state,outcome,intent_hash,result_json,evidence_json,created_at,updated_at FROM write_ledger ORDER BY operation_id').all();
    const state = { unresolved: rows.filter(row => ['running', 'unknown'].includes(row.state)).map(row => ({ operationId: row.operation_id, state: row.state })),
      rowsSha256: hash(rows), rowCount: rows.length };
    if (lock) return { ...state, close() { database.exec('ROLLBACK;'); database.close(); } };
    database.exec('ROLLBACK;'); database.close(); return state;
  } catch (error) { database.close(); throw error; }
}
async function runtimeRecord(file) {
  let handle;
  try {
    const runtimeFile = file + '.runtime.json'; await noRedirect(runtimeFile); handle = await open(runtimeFile, 'r');
    const before = await handle.stat(); need(before.isFile() && before.size <= 32768, 'Runtime record is not bounded');
    // Heartbeats replace the path atomically. Pin the opened file, so a normal
    // heartbeat does not look like a new instance or an unstable JSON read.
    const content = await handle.readFile(), after = await handle.stat();
    need(content.length === before.size && after.size === before.size && after.mtimeMs === before.mtimeMs, 'Runtime record changed in place');
    const value = JSON.parse(content); need(UUID.test(value.instanceId ?? '') && UUID.test(value.pairingId ?? ''), 'Runtime record has no exact instance identity'); return value;
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  finally { await handle?.close(); }
}
const defaultRuntime = {
  read: runtimeRecord, stop: requestStop,
  async claim(file) {
    const control = await createRuntimeControl(file);
    try { await control.setState('updating'); return control; }
    catch (error) { await control.close().catch(() => {}); throw error; }
  },
};

// All paths, release pins, registry/runtime seams and confirmations belong to a
// local operator. This factory is deliberately not exposed as an MCP tool.
export async function createLocalUpdater({ pairingFile, sourceRelease, targetRelease, snapshotParent, stableDataRoot = installationLocalDataRoot(),
  registeredProjectRoots, writeLedgerFile = installationWriteLedgerFile(), runtime = defaultRuntime, stopTimeoutMs = 10000, testHooks = {} } = {}) {
  for (const value of [pairingFile, snapshotParent, stableDataRoot, writeLedgerFile]) need(typeof value === 'string' && path.isAbsolute(value), 'Use fixed absolute local update paths');
  need(typeof registeredProjectRoots === 'function', 'A trusted local registered-project loader is required');
  need(runtime && ['read', 'stop', 'claim'].every(name => typeof runtime[name] === 'function'), 'Use fixed local runtime control');
  need(Number.isSafeInteger(stopTimeoutMs) && stopTimeoutMs > 0 && stopTimeoutMs <= 60000, 'Use a bounded local runtime stop timeout');
  sourceRelease = structuredClone(sourceRelease); targetRelease = structuredClone(targetRelease);
  await noRedirect(pairingFile); await noRedirect(snapshotParent); need((await lstat(snapshotParent)).isDirectory(), 'Create the independent snapshot parent locally before planning');
  const plans = new Map(), rollbackPlans = new Map();
  async function revoked() { return await exists(pairingFile + '.revoked') || (await readJson(pairingFile)).revoked === true; }
  async function configState() {
    const content = await bytes(pairingFile, 32768), snapshot = JSON.parse(content);
    await testHooks.afterPairingSnapshot?.();
    const config = await loadPairing(pairingFile, { allowRevoked: true });
    await testHooks.afterPairingValidation?.();
    // A second file read may observe B during an A→B→A replacement. Equal
    // before/after hashes alone cannot bind that validation to these bytes.
    const expected = { ...snapshot, revoked: snapshot.revoked || await exists(pairingFile + '.revoked') };
    need(equal(config, expected), 'Pairing validation does not match the same reviewed byte snapshot');
    return { content, config, sha256: digest(content) };
  }
  async function validateReleases() {
    const source = await release(sourceRelease), target = await release(targetRelease);
    return { source, target };
  }
  async function projectBuckets() {
    const projects = await registeredProjectRoots(); need(Array.isArray(projects) && projects.length <= 512, 'Registered projects loader returned an invalid list');
    return [...new Set((await Promise.all(projects.map(registeredProjectDataBucket))).map(project => project.bucket))].sort();
  }
  async function plan() {
    const { source, target } = await validateReleases(), current = await configState();
    need(fold(current.config.adapterPath) === fold(source.adapterPath) && equal(current.config.baseline, source.baseline), 'Configured source differs from the pinned source release');
    const layout = await resolveAdapterDataLayout({ adapterPath: source.adapterPath, localDataRoot: current.config.localDataRoot });
    const buckets = await projectBuckets();
    const inventory = await inventoryLocalData(layout.root), files = selection(inventory, buckets), mode = current.config.localDataRoot === undefined ? 'migrate-legacy' : 'shared-stable';
    const destination = path.resolve(stableDataRoot); await noRedirect(destination);
    need(!within(layout.root, snapshotParent) && !within(snapshotParent, layout.root) && !within(destination, snapshotParent) && !within(snapshotParent, destination), 'Snapshot parent must be independent from source and stable data');
    if (mode === 'migrate-legacy') need(!within(layout.root, destination) && !within(destination, layout.root), 'Stable data root overlaps the legacy source');
    const ledgerExists = await exists(writeLedgerFile), ledger = ledgerExists ? ledgerRead(writeLedgerFile) : null;
    const active = await runtime.read(pairingFile); if (active) need(active.pairingId === current.config.pairingId, 'Runtime belongs to another pairing');
    const blockers = [];
    const archiveDevice = (await lstat(snapshotParent)).dev;
    if ((await lstat(pairingFile)).dev !== archiveDevice) blockers.push('configuration-archive-cross-volume');
    if (mode === 'shared-stable' && (await lstat(layout.root)).dev !== archiveDevice) blockers.push('cache-archive-cross-volume');
    if (current.config.revoked || await revoked()) blockers.push('pairing-revoked');
    if (current.config.protocolVersion !== VERSION || source.pluginProtocolVersion !== VERSION || source.relayProtocolVersion !== VERSION || target.pluginProtocolVersion !== VERSION || target.relayProtocolVersion !== VERSION) blockers.push('plugin-relay-protocol-incompatible');
    if (source.localDataSchemaVersion !== 1 || target.localDataSchemaVersion !== 1 || !target.stableDataCompatible) blockers.push('local-data-schema-or-overlay-incompatible');
    if (!inventory.exists || inventory.excluded.length) blockers.push('missing-source-or-security-state-in-business-root');
    if (files.unknown.length) blockers.push('unrecognized-registered-business-state');
    if (!ledger || ledger.unresolved.length) blockers.push('missing-installation-ledger-or-unresolved-write');
    if (mode === 'migrate-legacy' && await exists(destination)) blockers.push('stable-destination-already-exists');
    if (mode === 'shared-stable' && fold(layout.root) !== fold(destination)) blockers.push('configured-stable-root-differs');
    if (mode === 'shared-stable' && files.filtered.length) blockers.push('unregistered-or-unrecognized-state-in-existing-stable-root');
    const value = { version: 1, kind: 'manual-local-update-plan', source, target, pairingId: current.config.pairingId, pairingSha256: current.sha256,
      sourceDataRoot: layout.root, stableDataRoot: destination, mode, inventorySha256: inventory.inventorySha256, files, registeredProjectBuckets: buckets,
      ledger, runtimeInstanceId: active?.instanceId ?? null, blockers, activationReady: false, automaticDownload: false, runtimeWillStart: false };
    const output = { ...value, planSha256: hash(value) };
    plans.set(output.planSha256, { output: structuredClone(output), current, inventory: structuredClone(inventory), source: structuredClone(source), target: structuredClone(target) }); return output;
  }
  async function fence(expectedInstanceId) {
    need(!await revoked(), 'Pairing was revoked; update cannot reactivate it');
    const original = await runtime.read(pairingFile);
    need((original?.instanceId ?? null) === expectedInstanceId, 'Runtime instance changed after planning');
    if (original) {
      const stopped = await runtime.stop(pairingFile); need(stopped.requested === true && stopped.instanceId === original.instanceId, 'Stop did not target the exact planned instance');
      const end = Date.now() + stopTimeoutMs;
      for (;;) {
        const observed = await runtime.read(pairingFile);
        if (!observed) break;
        need(observed.instanceId === original.instanceId, 'Another runtime appeared during stop');
        need(Date.now() < end, 'Exact runtime did not release its ownership; PID status is insufficient');
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    }
    need(!await runtime.read(pairingFile), 'A runtime appeared before the update fence');
    const lease = await runtime.claim(pairingFile);
    async function assert() {
      need(!await revoked(), 'Pairing was revoked while the update fence was held');
      const observed = await runtime.read(pairingFile); need(observed?.instanceId === lease.instanceId && observed.pairingId === (await readJson(pairingFile)).pairingId, 'Update runtime fence was replaced');
    }
    try {
      need(UUID.test(lease.instanceId ?? ''), 'Update fence has no exact instance identity');
      await assert(); return { instanceId: lease.instanceId, assert, close: () => lease.close() };
    } catch (error) { await lease?.close?.().catch(() => {}); throw error; }
  }
  async function archive(source, inventory, directory) {
    if (source.mode === 'migrate-legacy') return createLocalDataSnapshot({ source: { id: 'active', adapterPath: source.adapterPath }, directory, expectedInventorySha256: inventory.inventorySha256 });
    await mkdir(directory); const data = path.join(directory, 'data'); await mkdir(data);
    for (const entry of inventory.entries) {
      const content = await bytes(path.join(inventory.dataRoot, entry.path), 64 * 1024 * 1024); need(digest(content) === entry.sha256 && content.length === entry.bytes, 'Stable source changed during snapshot');
      const target = path.join(data, entry.path); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, content, { flag: 'wx' });
    }
    const after = await inventoryLocalData(inventory.dataRoot); need(after.inventorySha256 === inventory.inventorySha256, 'Stable source changed during snapshot');
    const manifest = { version: 1, kind: 'deck-local-data-snapshot', createdAt: Date.now(), source: { id: 'active', adapterRootSha256: digest(fold(path.resolve(source.adapterPath, '../../..'))), dataRootSha256: digest(fold(inventory.dataRoot)), inventorySha256: inventory.inventorySha256 },
      dataDirectory: 'data', files: inventory.entries, totalBytes: inventory.totalBytes, activationReady: false, consistency: 'observed-stable-copy-with-local-runtime-and-ledger-fence' };
    const content = Buffer.from(JSON.stringify(manifest, null, 2) + '\n'), manifestFile = path.join(directory, 'local-data-snapshot.json'); await writeFile(manifestFile, content, { flag: 'wx' });
    const manifestSha256 = digest(content); await verifyLocalDataSnapshot({ directory, expectedManifestSha256: manifestSha256 }); return { directory, manifestFile, manifestSha256, activationReady: false };
  }
  // Move-claim then exclusive publication is a local CAS: concurrent path
  // replacement never gets overwritten. Every claimed original remains recoverable.
  async function cas(expectedSha256, next, backupDirectory, onPrepared) {
    const before = await bytes(pairingFile, 32768); need(digest(before) === expectedSha256, 'Pairing configuration changed before CAS'); need(!await revoked(), 'Revoked pairing cannot be changed');
    // Refuse an unsupported filesystem/sandbox before moving the live config.
    const probe = pairingFile + '.cas-probe-' + randomUUID(), probeLink = probe + '.link';
    try { await writeFile(probe, 'local-cas-probe\n', { flag: 'wx' }); await link(probe, probeLink); }
    finally { await unlink(probeLink).catch(() => {}); await unlink(probe).catch(() => {}); }
    const backup = await backupFile(pairingFile); need(backup && digest(await bytes(backup, 32768)) === expectedSha256, 'Configuration backup does not match the reviewed state');
    await testHooks.beforeConfigurationClaim?.();
    const claimed = path.join(backupDirectory, 'pairing-claimed-' + randomUUID() + '.json');
    const content = Buffer.from(JSON.stringify(next, null, 2) + '\n');
    if (onPrepared) await onPrepared({ sha256: digest(content), backup, claimed });
    await rename(pairingFile, claimed);
    const restoreAbsent = async () => { try { await link(claimed, pairingFile); } catch (error) { if (error.code !== 'EEXIST') throw error; } };
    let temporary;
    try {
      need(digest(await bytes(claimed, 32768)) === expectedSha256, 'Concurrent configuration change was archived; CAS refused');
      need(!await exists(pairingFile + '.revoked'), 'Revocation appeared during configuration CAS');
      await testHooks.afterConfigurationClaim?.();
      need(!await exists(pairingFile + '.revoked'), 'Revocation appeared during configuration CAS');
      temporary = pairingFile + '.update-' + randomUUID();
      const handle = await open(temporary, 'wx', 0o600); try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
      await link(temporary, pairingFile); // EEXIST preserves a concurrent new config.
      need(digest(await bytes(claimed, 32768)) === expectedSha256, 'Concurrent writer changed the archived configuration');
      return { sha256: digest(content), backup, claimed };
    } catch (error) { await restoreAbsent(); throw error; }
    finally { if (temporary) await unlink(temporary).catch(() => {}); }
  }
  async function apply({ planSha256, confirmation } = {}) {
    const saved = plans.get(planSha256); need(saved && confirmation === 'APPLY ' + planSha256, 'Explicit local APPLY and the reviewed plan digest are required'); plans.delete(planSha256);
    const p = saved.output; need(p.blockers.length === 0, 'Update plan has unresolved blockers');
    need(equal(await projectBuckets(), p.registeredProjectBuckets), 'Registered project scope changed after planning');
    need((await configState()).sha256 === p.pairingSha256, 'Pairing configuration changed after planning');
    const releases = await validateReleases(); need(equal(releases, { source: saved.source, target: saved.target }), 'Pinned releases changed');
    let lease, ledger; const directory = path.join(snapshotParent, 'update-' + randomUUID());
    try {
      lease = await fence(p.runtimeInstanceId); ledger = ledgerRead(writeLedgerFile, { lock: true }); need(ledger.unresolved.length === 0 && ledger.rowsSha256 === p.ledger.rowsSha256, 'Installation ledger changed or has an unresolved write');
      need((await inventoryLocalData(p.sourceDataRoot)).inventorySha256 === p.inventorySha256, 'Business state changed after planning');
      await mkdir(directory); const snapshot = await archive({ mode: p.mode, adapterPath: saved.source.adapterPath }, saved.inventory, path.join(directory, 'snapshot'));
      await lease.assert(); await testHooks.afterSnapshot?.({ directory, snapshot });
      need((await inventoryLocalData(p.sourceDataRoot)).inventorySha256 === p.inventorySha256, 'Source changed after snapshot');
      await verifyLocalDataSnapshot({ directory: snapshot.directory, expectedManifestSha256: snapshot.manifestSha256 });
      if (p.mode === 'migrate-legacy') {
        await noRedirect(p.stableDataRoot); need(!await exists(p.stableDataRoot), 'Stable destination appeared after planning');
        await mkdir(path.dirname(p.stableDataRoot), { recursive: true }); await noRedirect(path.dirname(p.stableDataRoot)); await mkdir(p.stableDataRoot);
        for (const entry of p.files.selected) {
          await lease.assert(); const content = await bytes(path.join(snapshot.directory, 'data', entry.path), 64 * 1024 * 1024); need(digest(content) === entry.sha256, 'Snapshot changed before seeding');
          const target = path.join(p.stableDataRoot, entry.path); await mkdir(path.dirname(target), { recursive: true }); await noRedirect(target); await writeFile(target, content, { flag: 'wx' });
        }
      } else {
        for (const entry of p.files.invalidate) {
          const source = path.join(p.stableDataRoot, entry.path), target = path.join(directory, 'invalidated-cache', entry.path);
          need(digest(await bytes(source, 64 * 1024 * 1024)) === entry.sha256, 'Cache changed before invalidation');
          await lease.assert(); await mkdir(path.dirname(target), { recursive: true }); need(within(p.stableDataRoot, source) && within(directory, target), 'Invalidation paths escaped the update'); await rename(source, target);
        }
      }
      const seeded = await inventoryLocalData(p.stableDataRoot); need(seeded.excluded.length === 0, 'Unexpected security state in seeded data');
      const actual = selection(seeded, p.registeredProjectBuckets); need(equal(actual.selected, p.files.selected) && actual.invalidate.length === 0 && actual.unknown.length === 0, 'Seeded business state does not match the reviewed selection');
      if (p.mode === 'migrate-legacy') need((await inventoryLocalData(p.sourceDataRoot)).inventorySha256 === p.inventorySha256, 'Legacy source changed while the stable root was seeded');
      need(equal(await projectBuckets(), p.registeredProjectBuckets), 'Registered project scope changed before cutover');
      await lease.assert(); const original = JSON.parse(saved.current.content), next = { ...original, adapterPath: saved.target.adapterPath, baseline: saved.target.baseline, localDataRoot: p.stableDataRoot };
      let receiptSha256; const receiptFile = path.join(directory, 'update-receipt.json');
      await cas(p.pairingSha256, next, directory, async changed => {
        const receipt = { version: 1, kind: 'manual-local-update-receipt', pairingId: p.pairingId, source: saved.source, target: saved.target, originalConfiguration: changed.backup, originalConfigurationSha256: p.pairingSha256,
          claimedConfiguration: changed.claimed, appliedConfigurationSha256: changed.sha256, sourceDataRoot: p.sourceDataRoot, stableDataRoot: p.stableDataRoot,
          stableInventorySha256: seeded.inventorySha256, ledgerRowsSha256: ledger.rowsSha256, registeredProjectBuckets: p.registeredProjectBuckets, snapshot,
          mode: p.mode, sourceInventorySha256: p.inventorySha256, fenceInstanceId: lease.instanceId, activationReady: false, runtimeStarted: false };
        const content = Buffer.from(JSON.stringify(receipt, null, 2) + '\n'); await writeFile(receiptFile, content, { flag: 'wx' }); receiptSha256 = digest(content);
      });
      await lease.assert();
      return { status: 'configured-stopped-awaiting-launch-acceptance', directory, receiptFile, receiptSha256, activationReady: false, runtimeStarted: false };
    } catch (error) {
      error.updateDirectory = directory;
      const receiptFile = path.join(directory, 'update-receipt.json');
      if (await exists(receiptFile)) { error.receiptFile = receiptFile; error.receiptSha256 = digest(await bytes(receiptFile)); }
      throw error;
    } finally { ledger?.close(); await lease?.close(); }
  }
  async function planRollback({ directory, receiptSha256 } = {}) {
    need(typeof directory === 'string' && path.isAbsolute(directory) && path.dirname(fold(directory)) === fold(snapshotParent) && /^update-[0-9a-f-]+$/.test(path.basename(directory)) && HASH.test(receiptSha256 ?? ''), 'Select the retained local receipt and digest');
    const content = await bytes(path.join(directory, 'update-receipt.json')); need(digest(content) === receiptSha256, 'Rollback receipt changed'); const receipt = JSON.parse(content);
    need(receipt.kind === 'manual-local-update-receipt' && receipt.version === 1, 'Invalid local rollback receipt');
    const releases = await validateReleases(); need(equal(receipt.source, releases.source) && equal(receipt.target, releases.target), 'Rollback releases differ from fixed local pins');
    const current = await configState(); need(current.sha256 === receipt.appliedConfigurationSha256 && current.config.pairingId === receipt.pairingId, 'Current configuration differs from the applied update');
    await verifyLocalDataSnapshot({ directory: receipt.snapshot.directory, expectedManifestSha256: receipt.snapshot.manifestSha256 });
    const ledger = ledgerRead(writeLedgerFile), stable = await inventoryLocalData(receipt.stableDataRoot), originalBytes = await bytes(receipt.originalConfiguration, 32768);
    need(digest(originalBytes) === receipt.originalConfigurationSha256, 'Original configuration backup changed'); const original = JSON.parse(originalBytes);
    need(original.pairingId === receipt.pairingId && fold(original.adapterPath) === fold(releases.source.adapterPath), 'Original configuration backup does not identify this update');
    const active = await runtime.read(pairingFile), blockers = [];
    if (await revoked()) blockers.push('pairing-revoked');
    if (ledger.unresolved.length) blockers.push('installation-write-unresolved');
    const shareStable = releases.source.stableDataCompatible && releases.source.localDataSchemaVersion === releases.target.localDataSchemaVersion;
    if (!shareStable && (ledger.rowsSha256 !== receipt.ledgerRowsSha256 || stable.inventorySha256 !== receipt.stableInventorySha256)) blockers.push('new-writes-cannot-be-restored-into-incompatible-old-state');
    if (!shareStable && (await inventoryLocalData(receipt.sourceDataRoot)).inventorySha256 !== receipt.sourceInventorySha256) blockers.push('original-legacy-source-changed');
    const value = { version: 1, kind: 'manual-local-rollback-plan', directory, receiptSha256, pairingSha256: current.sha256, pairingId: receipt.pairingId,
      runtimeInstanceId: active?.instanceId ?? null, stableInventorySha256: stable.inventorySha256, ledgerRowsSha256: ledger.rowsSha256, shareStable,
      status: shareStable ? 'old-code-with-current-shared-state' : 'old-code-with-unchanged-original-state', blockers, activationReady: false, runtimeWillStart: false };
    const output = { ...value, planSha256: hash(value) }; rollbackPlans.set(output.planSha256, { output: structuredClone(output), receipt, original }); return output;
  }
  async function rollback({ planSha256, confirmation } = {}) {
    const saved = rollbackPlans.get(planSha256); need(saved && confirmation === 'ROLLBACK ' + planSha256, 'Explicit local ROLLBACK and reviewed digest are required'); rollbackPlans.delete(planSha256);
    const p = saved.output; need(p.blockers.length === 0, 'Rollback plan has unresolved blockers'); let lease, ledger;
    try {
      await validateReleases(); need((await configState()).sha256 === p.pairingSha256, 'Configuration changed after rollback planning');
      lease = await fence(p.runtimeInstanceId); ledger = ledgerRead(writeLedgerFile, { lock: true }); need(!ledger.unresolved.length && ledger.rowsSha256 === p.ledgerRowsSha256, 'Ledger changed after rollback planning');
      need((await inventoryLocalData(saved.receipt.stableDataRoot)).inventorySha256 === p.stableInventorySha256, 'Business state changed after rollback planning');
      if (!p.shareStable) need((await inventoryLocalData(saved.receipt.sourceDataRoot)).inventorySha256 === saved.receipt.sourceInventorySha256, 'Original legacy source changed after rollback planning');
      await lease.assert(); const next = { ...saved.original, ...(p.shareStable ? { localDataRoot: saved.receipt.stableDataRoot } : {}) };
      const changed = await cas(p.pairingSha256, next, p.directory); await lease.assert();
      return { status: p.status, configurationBackup: changed.backup, activationReady: false, runtimeStarted: false, dataRestoredFromOldSnapshot: false };
    } finally { ledger?.close(); await lease?.close(); }
  }
  return { plan, apply, planRollback, rollback };
}
