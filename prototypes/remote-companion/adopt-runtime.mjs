import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync, backup as sqliteBackup } from 'node:sqlite';
import { mkdir, lstat, realpath, readFile, writeFile, readdir, rename, link, unlink, copyFile, utimes, open } from 'node:fs/promises';
import { canonical, bridgeUrl } from './protocol.mjs';
import { verifyRuntimeRelease } from './build-runtime-release.mjs';
import { verifyFrozenAdapter } from './freeze-adapter.mjs';
import { loadPairing, createRuntimeControl, backupFile } from './lifecycle.mjs';
import { loadCallerRecord, planClientShortcut } from './client-launch.mjs';
import { inventoryLocalData, planLocalDataUpgrade, registeredProjectDataBucket, createLocalDataSnapshot, verifyLocalDataSnapshot } from './local-data-upgrade.mjs';
import { normalizeWriteGrant } from './write-grant.mjs';

const run = promisify(execFile), hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonical(value)).digest('hex');
const fold = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
const inside = (root, file) => { const r = path.relative(fold(root), fold(file)); return r === '' || r !== '..' && !r.startsWith('..' + path.sep) && !path.isAbsolute(r); };
const need = (value, code) => { if (!value) throw Object.assign(new Error(code), { code }); };
const exists = file => lstat(file).then(() => true, e => { if (e.code === 'ENOENT') return false; throw e; });
const psExe = () => path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
async function ps(script, input = {}) {
  const pending = run(psExe(), ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 20000, maxBuffer: 4 * 1024 * 1024 });
  pending.child.stdin.end(JSON.stringify(input)); try { return (await pending).stdout.trim(); } catch { throw Object.assign(new Error('WINDOWS_LOCAL_HELPER_FAILED'), { code: 'WINDOWS_LOCAL_HELPER_FAILED' }); }
}
async function safe(file, directory = false, absent = false) {
  need(typeof file === 'string' && path.isAbsolute(file) && !/^\\\\/.test(file) && !/[\u0000-\u001f\u007f]/.test(file), 'LOCAL_ABSOLUTE_PATH_REQUIRED');
  let cursor = path.resolve(file);
  while (!await exists(cursor)) { const parent = path.dirname(cursor); need(parent !== cursor, 'LOCAL_PATH_UNAVAILABLE'); cursor = parent; }
  for (let item = cursor; ;) { const s = await lstat(item); need(!s.isSymbolicLink() && fold(await realpath(item)) === fold(item), 'REDIRECTED_LOCAL_PATH'); const parent = path.dirname(item); if (parent === item) break; item = parent; }
  if (!await exists(file)) { need(absent, 'LOCAL_FILE_MISSING'); return path.resolve(file); }
  const s = await lstat(file); need(directory ? s.isDirectory() : s.isFile(), 'LOCAL_PATH_KIND'); return await realpath(file);
}
async function identity(file, optional = false) {
  await safe(file, false, optional); if (!await exists(file)) return null;
  const before = await lstat(file, { bigint: true }); need(before.size <= 1024n * 1024n * 1024n, 'LOCAL_FILE_TOO_LARGE');
  const bytes = await readFile(file), after = await lstat(file, { bigint: true });
  const id = s => ({ dev: String(s.dev), ino: String(s.ino), size: String(s.size), mtimeNs: String(s.mtimeNs), ctimeNs: String(s.ctimeNs) });
  need(canonical(id(before)) === canonical(id(after)), 'LOCAL_FILE_CHANGED_DURING_READ'); return { ...id(after), sha256: hash(bytes) };
}
const same = (a, b) => canonical(a) === canonical(b);
const json = async file => JSON.parse(await readFile(await safe(file), 'utf8'));
async function writeJson(file, value) { await writeFile(file, canonical(value) + '\n', { flag: 'wx', mode: 0o600 }); }
async function folders() {
  need(process.platform === 'win32', 'WINDOWS_REQUIRED');
  return JSON.parse(await ps("@{localAppData=[Environment]::GetFolderPath('LocalApplicationData');startup=[Environment]::GetFolderPath('Startup');desktop=[Environment]::GetFolderPath('DesktopDirectory');userProfile=[Environment]::GetFolderPath('UserProfile')}|ConvertTo-Json -Compress"));
}
async function registry(known) {
  const file = path.join(known.userProfile, '.codex', 'state_5.sqlite'); await safe(file);
  const database = new DatabaseSync(pathToFileURL(file).href + '?mode=ro', { readOnly: true }); let rows;
  try { database.exec('BEGIN'); rows = database.prepare('SELECT project_id,position,path FROM project_roots ORDER BY project_id,position,path').all(); } finally { database.close(); }
  need(rows.length > 0 && rows.length <= 512, 'TRUSTED_PROJECT_REGISTRY_REQUIRED');
  const projects = []; for (const row of rows) projects.push(await registeredProjectDataBucket(row.path));
  return { roots: [...new Set(projects.map(p => p.projectRoot))], sha256: hash({ rows, projects }) };
}
async function processes(sourcePaths) {
  const raw = await ps("Import-Module (Join-Path $PSHOME 'Modules\\CimCmdlets\\CimCmdlets.psd1');$rows=@(Get-CimInstance Win32_Process|Where-Object {$_.Name -in @('ChatGPT.exe','Codex.exe','node.exe')}|ForEach-Object {@{pid=$_.ProcessId;name=$_.Name;command=$_.CommandLine}});ConvertTo-Json -InputObject $rows -Compress");
  const rows = JSON.parse(raw); need(Array.isArray(rows) && rows.every(r => typeof r.command === 'string'), 'PROCESS_INSPECTION_INCOMPLETE');
  return { codex: rows.filter(r => ['chatgpt.exe', 'codex.exe'].includes(r.name.toLowerCase())).map(r => r.pid),
    producers: rows.filter(r => r.name.toLowerCase() === 'node.exe' && sourcePaths.some(p => r.command.toLowerCase().includes(path.dirname(p).toLowerCase()))).map(r => r.pid) };
}
export async function readAdoptionRuntime(file) {
  const runtimeFile = file + '.runtime.json', parent = await safe(path.dirname(runtimeFile), true), temporaryPrefix = path.basename(runtimeFile) + '.tmp-';
  let absent = 0;
  for (let attempt = 0; attempt < 32; attempt++) {
    let handle;
    try {
      const named = await lstat(runtimeFile, { bigint: true }); need(named.isFile() && !named.isSymbolicLink() && named.size <= 32768n, 'RUNTIME_RECORD_NOT_REGULAR');
      handle = await open(runtimeFile, 'r'); const before = await handle.stat({ bigint: true });
      if (before.dev !== named.dev || before.ino !== named.ino) { absent = 0; continue; }
      need(before.isFile() && before.size <= 32768n, 'RUNTIME_RECORD_NOT_BOUNDED');
      const bytes = await handle.readFile(), after = await handle.stat({ bigint: true });
      need(after.size === before.size && after.mtimeNs === before.mtimeNs && BigInt(bytes.length) === before.size, 'RUNTIME_RECORD_CHANGED_IN_PLACE');
      const value = JSON.parse(bytes); need(/^[a-f0-9-]{36}$/.test(value.instanceId ?? '') && /^[a-f0-9-]{36}$/.test(value.pairingId ?? ''), 'RUNTIME_IDENTITY_REQUIRED'); return value;
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      // A heartbeat replaces the path. Do not turn a short lookup window or
      // an in-flight staged heartbeat into a claim that the owner released.
      const pending = (await readdir(parent)).some(name => name.startsWith(temporaryPrefix));
      absent = pending ? 0 : absent + 1; if (absent >= 3) return null;
    } finally { await handle?.close(); }
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  throw Object.assign(new Error('RUNTIME_RECORD_CHANGING'), { code: 'RUNTIME_RECORD_CHANGING' });
}
export async function requestAdoptionStop(file, expectedInstanceId, { beforePublish } = {}) {
  need(/^[a-f0-9-]{36}$/.test(expectedInstanceId ?? ''), 'EXACT_STOP_INSTANCE_REQUIRED');
  const config = await loadPairing(file, { allowRevoked: true }), observed = await readAdoptionRuntime(file);
  if (!observed) return { requested: false, reason: 'not-running' };
  if (observed.pairingId !== config.pairingId || observed.instanceId !== expectedInstanceId) return { requested: false, reason: 'instance-changed' };
  const stopFile = file + '.stop.json', expectedStopFile = await identity(stopFile, true); await beforePublish?.();
  await cas(stopFile, expectedStopFile, Buffer.from(canonical({ pairingId: config.pairingId, instanceId: expectedInstanceId, requestedAt: Date.now() }) + '\n'));
  return { requested: true, instanceId: expectedInstanceId };
}
const runtime = { read: readAdoptionRuntime, stop: requestAdoptionStop, claim: file => createRuntimeControl(file, { intervalMs: 50 }) };
async function processRecord(pid) {
  need(Number.isInteger(pid) && pid > 0, 'PROCESS_ID_REQUIRED');
  const raw = await ps("Import-Module (Join-Path $PSHOME 'Modules\\CimCmdlets\\CimCmdlets.psd1');$d=[Console]::In.ReadToEnd()|ConvertFrom-Json;$p=Get-CimInstance Win32_Process -Filter ('ProcessId='+[int]$d.pid);if($p){@{pid=$p.ProcessId;parent=$p.ParentProcessId;created=$p.CreationDate.ToUniversalTime().ToString('o');command=$p.CommandLine}|ConvertTo-Json -Compress}else{'null'}", { pid });
  return JSON.parse(raw);
}
async function cloudProtocol(origin) {
  try {
    const url = new URL('/healthz', bridgeUrl(origin));
    const response = await fetch(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(5000), headers: { accept: 'application/json' } });
    if (!response.ok || !response.body) return { verified: false, protocolVersion: null };
    const reader = response.body.getReader(), chunks = []; let size = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 16384) { await reader.cancel(); return { verified: false, protocolVersion: null }; } chunks.push(value); }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')); return { verified: Number.isSafeInteger(body.version), protocolVersion: Number.isSafeInteger(body.version) ? body.version : null };
  } catch { return { verified: false, protocolVersion: null }; }
}
async function shortcut(spec) {
  await ps("$ErrorActionPreference='Stop';$d=[Console]::In.ReadToEnd()|ConvertFrom-Json;$s=New-Object -ComObject WScript.Shell;$l=$s.CreateShortcut($d.file);$l.TargetPath=$d.target;$l.Arguments=$d.arguments;$l.WorkingDirectory=$d.workingDirectory;$l.WindowStyle=7;$l.Description='Deck pinned runtime (manual local adoption)';$l.Save()", spec);
  await safe(spec.file); return identity(spec.file);
}
function ledger(file, { lock = false, allowMissing = false } = {}) {
  let database;
  try { database = new DatabaseSync(pathToFileURL(file).href + '?mode=' + (lock ? 'rw' : 'ro'), { readOnly: !lock }); }
  catch (e) { if (allowMissing) return { missing: true, rowsSha256: null, rowCount: 0, unresolved: [], close() {} }; throw e; }
  try {
    database.exec('PRAGMA busy_timeout=2000;' + (lock ? 'BEGIN IMMEDIATE' : 'BEGIN'));
    const rows = database.prepare('SELECT * FROM write_ledger ORDER BY operation_id').all();
    const result = { missing: false, rowsSha256: hash(rows), rowCount: rows.length, unresolved: rows.filter(r => ['running', 'unknown'].includes(r.state)).map(r => r.operation_id) };
    if (lock) return { ...result, close() { database.exec('ROLLBACK'); database.close(); } };
    database.close(); return { ...result, close() {} };
  } catch (e) { database.close(); throw e; }
}
async function journalState(file) {
  await safe(file); const db = new DatabaseSync(pathToFileURL(file).href + '?mode=ro', { readOnly: true });
  try {
    db.exec('BEGIN'); const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r => r.name);
    need(same(tables, ['operations', 'settings']), 'JOURNAL_SCHEMA_UNSUPPORTED');
    const settings = db.prepare('SELECT * FROM settings ORDER BY key').all(), operations = db.prepare('SELECT * FROM operations ORDER BY id').all();
    need(!settings.some(r => r.key === 'revoked' && r.value === 'true'), 'PAIRING_REVOKED');
    need(!operations.some(r => ['running', 'unknown'].includes(r.state)), 'JOURNAL_UNRESOLVED');
    return { sha256: hash({ settings, operations }), operations: operations.length };
  } finally { db.close(); }
}
async function copyJournal(source, destination, expected) {
  need(!await exists(destination), 'JOURNAL_DESTINATION_EXISTS'); need(same(await journalState(source), expected), 'JOURNAL_CHANGED');
  const db = new DatabaseSync(pathToFileURL(source).href + '?mode=ro', { readOnly: true });
  try { await sqliteBackup(db, destination); } finally { db.close(); }
  need(same(await journalState(source), expected) && same(await journalState(destination), expected), 'JOURNAL_BACKUP_MISMATCH');
}
function durable(inventory, buckets) {
  return inventory.entries.filter(e => ['business', 'audit', 'log'].includes(e.kind) && buckets.has(/^projects\/([a-f0-9]{64})\//.exec(e.path)?.[1]));
}
async function inventoryIds(inventory) { const rows = []; for (const e of inventory.entries) rows.push({ path: e.path, identity: await identity(path.join(inventory.dataRoot, e.path)) }); return hash(rows); }
async function archiveStable(source, directory, inventory) {
  await mkdir(directory); const data = path.join(directory, 'data'); await mkdir(data);
  for (const entry of inventory.entries) { const from = path.join(inventory.dataRoot, entry.path), to = path.join(data, entry.path); need((await identity(from)).sha256 === entry.sha256, 'SOURCE_CHANGED'); await mkdir(path.dirname(to), { recursive: true }); await copyFile(from, to, 1); await utimes(to, entry.mtimeMs / 1000, entry.mtimeMs / 1000); }
  need((await inventoryLocalData(inventory.dataRoot)).inventorySha256 === inventory.inventorySha256, 'SOURCE_CHANGED');
  const manifest = { version: 1, kind: 'deck-local-data-snapshot', source: { id: source.id, adapterRootSha256: hash(fold(path.resolve(source.adapterPath, '../../..'))), dataRootSha256: hash(fold(inventory.dataRoot)), inventorySha256: inventory.inventorySha256 },
    dataDirectory: 'data', files: inventory.entries, totalBytes: inventory.totalBytes, activationReady: false };
  const file = path.join(directory, 'local-data-snapshot.json'); await writeJson(file, manifest); const pin = hash(await readFile(file)); await verifyLocalDataSnapshot({ directory, expectedManifestSha256: pin }); return { directory, manifestSha256: pin };
}
async function copyRelease(source, pin, destination) {
  await verifyRuntimeRelease({ directory: source, expectedManifestSha256: pin }); need(!await exists(destination), 'VERSION_DIRECTORY_EXISTS'); await mkdir(destination); await writeFile(path.join(destination, 'INCOMPLETE'), 'Copy verification pending\n', { flag: 'wx' });
  try {
    const manifest = await json(path.join(source, 'client-release.json'));
    for (const entry of [...manifest.files, { path: 'client-release.json', sha256: pin }]) { const from = path.join(source, entry.path), to = path.join(destination, entry.path); await safe(from); need(hash(await readFile(from)) === entry.sha256, 'RELEASE_SOURCE_CHANGED'); await mkdir(path.dirname(to), { recursive: true }); await copyFile(from, to, 1); }
    await verifyRuntimeRelease({ directory: source, expectedManifestSha256: pin }); await unlink(path.join(destination, 'INCOMPLETE')); return await verifyRuntimeRelease({ directory: destination, expectedManifestSha256: pin });
  } catch (e) { if (!await exists(path.join(destination, 'INCOMPLETE'))) await writeFile(path.join(destination, 'INCOMPLETE'), 'Copy failed\n', { flag: 'wx' }); throw e; }
}
async function verifyLegacyCore(pin) {
  need(pin && typeof pin.directory === 'string' && /^[a-f0-9]{64}$/.test(pin.manifestSha256 ?? ''), 'LEGACY_RUNTIME_PIN_REQUIRED');
  const directory = await safe(pin.directory, true), file = path.join(directory, 'bundle-manifest.json');
  const bytes = await readFile(await safe(file)); need(bytes.length <= 2 * 1024 * 1024 && hash(bytes) === pin.manifestSha256, 'LEGACY_RUNTIME_MANIFEST_CHANGED');
  const manifest = JSON.parse(bytes); need(/^[a-f0-9]{40}$/.test(manifest.sourceCommit ?? '') && manifest.byteExact === true && Array.isArray(manifest.files) && manifest.files.length === 18, 'LEGACY_RUNTIME_CATALOG_INVALID');
  const seen = new Set(); let total = 0;
  for (const entry of manifest.files) {
    need(/^prototypes\/remote-companion\/[A-Za-z0-9._-]+$/.test(entry.path ?? '') && !['.', '..', '.env', 'pairing.json', 'auth.json', 'credentials.json'].includes(path.posix.basename(entry.path)) &&
      !seen.has(entry.path.toLowerCase()) && /^[a-f0-9]{64}$/.test(entry.sha256 ?? '') && Number.isSafeInteger(entry.bytes) && entry.bytes >= 0 && entry.bytes <= 32 * 1024 * 1024, 'LEGACY_RUNTIME_CATALOG_INVALID');
    seen.add(entry.path.toLowerCase()); total += entry.bytes; need(total <= 64 * 1024 * 1024, 'LEGACY_RUNTIME_CATALOG_LIMIT');
    const content = await readFile(await safe(path.join(directory, entry.path))); need(content.length === entry.bytes && hash(content) === entry.sha256, 'LEGACY_RUNTIME_CODE_CHANGED');
  }
  return { sourceCommit: manifest.sourceCommit, manifestSha256: pin.manifestSha256, fileCount: 18 };
}
// File CAS preserves every claimed old version. It never overwrites an
// occupied path: hard-link publication is CREATE_NEW even on rollback.
async function cas(file, expected, content, hooks = {}) {
  await safe(path.dirname(file), true); need(same(await identity(file, true), expected), 'CAS_IDENTITY_CHANGED');
  const suffix = randomUUID(), staged = file + '.adopt-stage-' + suffix, claimed = file + '.adopt-claimed-' + suffix;
  await writeFile(staged, content, { flag: 'wx', mode: 0o600 }); const preparedIdentity = await identity(staged); let backup = null, moved = false, published = false;
  try {
    if (expected) { backup = await backupFile(file); need(same(await identity(file), expected) && hash(await readFile(backup)) === expected.sha256, 'CAS_BACKUP_CHANGED'); }
    const change = { file, expected, preparedIdentity, staged, backup, claimed: expected ? claimed : null, published: false };
    await hooks.prepared?.(change); await hooks.beforeClaim?.(file);
    if (expected) { await rename(file, claimed); moved = true; const got = await identity(claimed); need(got.dev === expected.dev && got.ino === expected.ino && got.sha256 === expected.sha256 && got.mtimeNs === expected.mtimeNs, 'CAS_CLAIM_CHANGED'); }
    await link(staged, file); published = true; change.published = true; hooks.published?.(change);
    await hooks.afterPublish?.(file); await unlink(staged); const installed = await identity(file); need(installed.sha256 === hash(content), 'CAS_PUBLICATION_CHANGED'); change.installed = installed; return change;
  } catch (e) { if (moved && !await exists(file)) await link(claimed, file).catch(() => {}); throw e; }
  finally { if (!published) await unlink(staged).catch(() => {}); }
}
async function realizedChanges(changes) {
  const out = [];
  for (const original of changes) {
    const c = structuredClone(original);
    if (!c.installed && c.published && c.preparedIdentity) {
      const now = await identity(c.file, true), proof = c.preparedIdentity;
      need(now && now.dev === proof.dev && now.ino === proof.ino && now.sha256 === proof.sha256 && now.mtimeNs === proof.mtimeNs, 'PUBLISHED_CAS_PROOF_CHANGED'); c.installed = now;
    }
    need(c.installed, 'PUBLISHED_CAS_PROOF_REQUIRED'); out.push(c);
  }
  return out;
}
async function restore(change) {
  need(same(await identity(change.file, true), change.installed), 'ROLLBACK_USER_FILE_CHANGED');
  if (change.expected) { need(change.backup && hash(await readFile(await safe(change.backup))) === change.expected.sha256, 'ROLLBACK_BACKUP_CHANGED'); return cas(change.file, change.installed, await readFile(change.backup)); }
  const claimed = change.file + '.adopt-removed-' + randomUUID(); await rename(change.file, claimed); const got = await identity(claimed);
  if (got.ino !== change.installed.ino || got.sha256 !== change.installed.sha256) { if (!await exists(change.file)) await link(claimed, change.file); throw Object.assign(new Error('ROLLBACK_USER_FILE_CHANGED'), { code: 'ROLLBACK_USER_FILE_CHANGED' }); }
  return { removedOwnFile: true, retained: claimed };
}
function quote(value) { return '"' + String(value).replace(/(\\*)"/g, '$1$1\\"').replace(/\\+$/, '$&$&') + '"'; }

export async function createRuntimeAdopter(input, local = {}) {
  need(input && ['initial-readonly-adoption', 'full-code-update'].includes(input.mode), 'ADOPTION_MODE_REQUIRED');
  const known = await (local.knownFolders ?? folders)();
  for (const key of ['localAppData', 'startup', 'desktop', 'userProfile']) await safe(known[key], true);
  const o = { ...structuredClone(input), operationId: input.operationId ?? randomUUID() };
  need(/^[a-f0-9-]{36}$/.test(o.operationId) && o.dataSchemaVersion === 1, 'SCHEMA_1_AND_OPERATION_ID_REQUIRED');
  const base = path.join(known.localAppData, 'MattSkillsDeck', 'RemoteCompanion'), operation = path.join(base, 'generations', o.operationId), version = path.join(base, 'versions', o.operationId);
  const ledgerFile = path.join(base, 'write-ledger.sqlite'), dataRoot = o.mode === 'initial-readonly-adoption' ? path.join(operation, 'data') : undefined;
  for (const value of [base, path.dirname(operation), operation, path.dirname(version), version]) await safe(value, true, true);
  await safe(ledgerFile, false, true);
  const controls = local.runtime ?? runtime, inspect = local.processes ?? processes, loadRegistry = local.registry ?? (() => registry(known));
  need(['read', 'stop', 'claim'].every(k => typeof controls[k] === 'function'), 'LOCAL_RUNTIME_SEAM_REQUIRED');
  const plans = new Map(), startOwners = new Map(), markerIds = new Map(), startMarker = o.pairingFile + '.adopt-start.json';
  const startRecord = async () => await exists(startMarker) ? json(startMarker) : null;
  async function markerChange(value) {
    const expected = markerIds.has(value.attemptId) ? markerIds.get(value.attemptId) : await identity(startMarker, true);
    const changed = await cas(startMarker, expected, Buffer.from(canonical(value) + '\n')); markerIds.set(value.attemptId, changed.installed); return changed;
  }
  async function cloud(origin) { const value = await (local.probeCloud ?? cloudProtocol)(origin); return { verified: value?.verified === true, protocolVersion: Number.isSafeInteger(value?.protocolVersion) ? value.protocolVersion : null }; }
  async function config() {
    const id = await identity(o.pairingFile); const publicConfig = await loadPairing(o.pairingFile); const value = await json(o.pairingFile);
    need(!publicConfig.revoked && !await exists(o.pairingFile + '.revoked'), 'PAIRING_REVOKED'); await journalState(value.journalPath);
    need(value.protocolVersion === 1 && value.baseline, 'PAIRING_BASELINE_REQUIRED'); await verifyFrozenAdapter({ directory: value.baseline.directory, expectedManifestSha256: value.baseline.manifestSha256 });
    need(fold(value.adapterPath) === fold(path.join(value.baseline.directory, 'prototypes/upstream-port/sidebar-server.mjs')), 'PAIRING_ADAPTER_MISMATCH');
    return { id, value };
  }
  async function checkRevoked() { const c = await json(o.pairingFile); need(!c.revoked && !await exists(o.pairingFile + '.revoked'), 'PAIRING_REVOKED'); await journalState(c.journalPath); }
  async function scope() { const r = await loadRegistry(); need(Array.isArray(r.roots) && r.roots.length && typeof r.sha256 === 'string', 'TRUSTED_REGISTRY_REQUIRED'); const projects = await Promise.all(r.roots.map(registeredProjectDataBucket)); return { ...r, buckets: [...new Set(projects.map(p => p.bucket))].sort() }; }
  async function state() {
    const current = await config(), registered = await scope(), target = await verifyRuntimeRelease(o.targetRelease), targetManifest = await json(path.join(target.directory, 'client-release.json'));
    const legacyCore = o.mode === 'initial-readonly-adoption' ? await verifyLegacyCore(o.legacyRuntimePin) : null;
    const cloudState = await cloud(current.value.relayOrigin), blockers = [];
    if (!cloudState.verified || cloudState.protocolVersion !== target.protocolVersion) blockers.push('cloud-protocol-unverified-or-incompatible');
    if (['dispatching', 'unknown', 'draining'].includes((await startRecord())?.status)) blockers.push('start-outcome-unresolved'); let upgrade, inventories;
    if (o.mode === 'initial-readonly-adoption') {
      need(current.value.writeEnabled === false && Array.isArray(o.sources) && o.sources.length === 2 && o.sources[0].id === 'main-local' && o.sources[1].id === 'remote-v1' && fold(o.sources[1].adapterPath) === fold(current.value.adapterPath), 'READONLY_TWO_SOURCES_MAIN_FIRST_REQUIRED');
      upgrade = await planLocalDataUpgrade({ sources: o.sources, activeSourceId: 'main-local', inheritMissingFrom: ['remote-v1'], registeredProjectRoots: registered.roots, stableDataRoot: dataRoot }); inventories = upgrade.sourceInventories;
      if (upgrade.destinationExists) blockers.push('destination-exists'); if (upgrade.conflicts.some(c => c.kind === 'business') || upgrade.unselected.length) blockers.push('business-conflict');
    } else {
      need(current.value.localDataRoot && o.sourceRelease, 'STABLE_SOURCE_RELEASE_REQUIRED'); const old = await verifyRuntimeRelease(o.sourceRelease);
      need(fold(old.directory) === fold(current.value.baseline.directory) && old.protocolVersion === 1, 'OLD_CODE_STABLE_COMPATIBILITY_REQUIRED');
      inventories = [{ id: 'stable', adapterPath: current.value.adapterPath, ...await inventoryLocalData(current.value.localDataRoot) }];
    }
    const buckets = new Set(registered.buckets);
    const archiveOnly = o.archiveOnly ?? [];
    need(Array.isArray(archiveOnly) && archiveOnly.length <= 128 && archiveOnly.every(a => a && ['log', 'cache', 'diagnostic'].includes(a.classification) && typeof a.sourceId === 'string' && typeof a.path === 'string' && /^[a-f0-9]{64}$/.test(a.sha256) && typeof a.reason === 'string' && a.reason.trim()), 'EXPLICIT_ARCHIVE_ONLY_LIST_INVALID');
    const seenArchive = new Set();
    for (const inv of inventories) { if (inv.excluded.length) blockers.push('security-file-in-business-root'); if (inv.entries.some(e => {
      if (e.kind !== 'unrecognized') return false;
      const approved = archiveOnly.find(a => a.sourceId === inv.id && a.path === e.path && a.sha256 === e.sha256); if (approved) { seenArchive.add(approved); return false; }
      const bucket = /^projects\/([a-f0-9]{64})\//.exec(e.path)?.[1]; return !bucket || buckets.has(bucket);
    })) blockers.push('unclassified-registered-state'); }
    if (archiveOnly.some(a => !seenArchive.has(a))) blockers.push('archive-only-file-changed-or-not-found');
    const grant = normalizeWriteGrant(current.value.writeGrant);
    if (current.value.writeEnabled) { const source = await readFile(path.join(target.directory, 'prototypes/remote-companion/write-grant.mjs'), 'utf8'); const declared = /export const TRIAL_WRITE_METHODS = Object\.freeze\(\[([\s\S]*?)\]\)/.exec(source); need(grant && declared && grant.methods.every(m => declared[1].includes("'" + m + "'") || declared[1].includes('"' + m + '"')), 'TARGET_WRITE_GRANT_UNSUPPORTED'); }
    const missing = !await exists(ledgerFile); if (missing && (o.mode !== 'initial-readonly-adoption' || current.value.writeEnabled)) blockers.push('installation-ledger-missing');
    const authority = missing ? { missing: true, rowsSha256: null, rowCount: 0, unresolved: [] } : ledger(ledgerFile); if (authority.unresolved.length) blockers.push('global-ledger-unresolved');
    const caller = await loadCallerRecord(o.callerFile), callerId = await identity(o.callerFile);
    const startup = path.join(known.startup, 'Deck Companion-' + current.value.pairingId + '.lnk'), desktop = path.join(known.desktop, 'Deck Codex Remote-' + caller.credentialId + '.lnk');
    const sourceIds = []; for (const inv of inventories) sourceIds.push({ id: inv.id, inventorySha256: inv.inventorySha256, filesIdentitySha256: await inventoryIds(inv), adapterIdentity: await identity(inv.adapterPath ?? current.value.adapterPath) });
    return { current, registered, target, targetManifest, inventories, upgrade, callerId, authority: { missing: authority.missing, rowsSha256: authority.rowsSha256, rowCount: authority.rowCount },
      sourceIds, cloudState, legacyCore, startup, desktop, shortcuts: { startup: await identity(startup, true), desktop: await identity(desktop, true) }, blockers: [...new Set(blockers)] };
  }
  async function plan() {
    const s = await state(), active = await controls.read(o.pairingFile);
    if (active) need(active.pairingId === s.current.value.pairingId, 'RUNTIME_PAIRING_CHANGED');
    const privatePlan = { version: 1, kind: 'manual-complete-runtime-adoption', options: o, mode: o.mode, operation, versionDirectory: version,
      pairingIdentity: s.current.id, callerIdentity: s.callerId, sourceIds: s.sourceIds, registeredSha256: s.registered.sha256, registeredBuckets: s.registered.buckets,
      ledger: s.authority, cloud: s.cloudState, legacyCore: s.legacyCore, shortcuts: s.shortcuts, runtimeInstanceId: active?.instanceId ?? null, targetManifestSha256: o.targetRelease.expectedManifestSha256,
      blockers: s.blockers, selectedCounts: s.upgrade ? { selected: s.upgrade.selectedFiles.length, filtered: s.upgrade.projectFilter.filteredOut.length } : { selected: durable(s.inventories[0], new Set(s.registered.buckets)).length },
      protocolVersion: 1, localDataSchemaVersion: 1, runtimeWillStart: false, activationReady: false };
    const digest = hash(privatePlan); plans.set(digest, { privatePlan: structuredClone(privatePlan), state: s });
    return { planDigest: digest, publicPlan: { mode: o.mode, protocolVersion: 1, sourceCommit: s.target.sourceCommit, targetManifestSha256: privatePlan.targetManifestSha256,
      sourceCount: s.inventories.length, cloud: s.cloudState, counts: structuredClone(privatePlan.selectedCounts), blockers: [...s.blockers], archiveOnlyCount: (o.archiveOnly ?? []).length, ledgerMissing: s.authority.missing, activationReady: false, confirmation: 'APPLY ' + digest }, privatePlan: structuredClone(privatePlan) };
  }
  async function fence(expectedInstanceId, sourcePaths) {
    const activeAdapter = (await json(o.pairingFile)).adapterPath;
    const before = await inspect(sourcePaths.filter(p => fold(p) !== fold(activeAdapter)));
    need(before.codex.length === 0 && before.producers.length === 0, 'CODEX_AND_MAIN_PRODUCERS_MUST_EXIT_NORMALLY');
    const current = await controls.read(o.pairingFile); need((current?.instanceId ?? null) === expectedInstanceId, 'RUNTIME_INSTANCE_CHANGED');
    if (current) { const stopped = await controls.stop(o.pairingFile, current.instanceId); need(stopped.requested && stopped.instanceId === current.instanceId, 'EXACT_STOP_FAILED'); const end = Date.now() + 10000;
      for (;;) { const now = await controls.read(o.pairingFile); if (!now) break; need(now.instanceId === current.instanceId && Date.now() < end, 'RUNTIME_DID_NOT_RELEASE_OR_ABA'); await new Promise(r => setTimeout(r, 25)); } }
    const idle = await inspect(sourcePaths); need(!idle.codex.length && !idle.producers.length, 'SOURCE_PRODUCERS_STILL_RUNNING');
    return controls.claim(o.pairingFile);
  }
  async function apply({ planDigest, confirmation, start = false } = {}) {
    const saved = plans.get(planDigest); need(saved && confirmation === 'APPLY ' + planDigest, 'EXPLICIT_LOCAL_APPLY_REQUIRED'); plans.delete(planDigest);
    need(saved.privatePlan.blockers.length === 0, 'ADOPTION_PLAN_BLOCKED'); need(start === false, 'START_REQUIRES_SEPARATE_EXPLICIT_CONNECTED_ACCEPTANCE');
    const p = saved.privatePlan, currentPlan = await plan(); need(currentPlan.planDigest === planDigest, 'PLAN_INPUT_CHANGED'); plans.delete(planDigest);
    let lease, lock; const changes = [], receipt = { version: 1, kind: 'complete-runtime-adoption-receipt', operation, options: o, planDigest, mode: o.mode, changes, registeredBuckets: p.registeredBuckets,
      priorConfigurationSha256: p.pairingIdentity.sha256, ledgerBefore: p.ledger, oldDataStable: o.mode === 'full-code-update', sourceIds: p.sourceIds, status: 'preparing', runtimeStarted: false };
    try {
      lease = await fence(p.runtimeInstanceId, saved.state.inventories.map(i => i.adapterPath ?? saved.state.current.value.adapterPath));
      let lockedAuthority;
      const checkFence = async () => {
        need((await controls.read(o.pairingFile))?.instanceId === lease.instanceId, 'ADOPTION_FENCE_REPLACED'); await checkRevoked(); await journalState(saved.state.current.value.journalPath);
        if (p.ledger.missing) need(!await exists(ledgerFile), 'MISSING_LEDGER_AUTHORITY_APPEARED'); else if (lockedAuthority) need(same(await identity(ledgerFile), lockedAuthority), 'LEDGER_FILE_AUTHORITY_REPLACED');
        need(same(await identity(o.callerFile), p.callerIdentity), 'CALLER_CHANGED');
        const idle = await inspect(saved.state.inventories.map(i => i.adapterPath ?? saved.state.current.value.adapterPath)); need(!idle.codex.length && !idle.producers.length, 'PRODUCER_RESTARTED');
        for (const inv of saved.state.inventories) { const expected = p.sourceIds.find(s => s.id === inv.id), now = await inventoryLocalData(inv.dataRoot);
          need(now.inventorySha256 === expected.inventorySha256 && await inventoryIds(now) === expected.filesIdentitySha256 && same(await identity(inv.adapterPath ?? saved.state.current.value.adapterPath), expected.adapterIdentity), 'SOURCE_OR_CODE_CHANGED_DURING_PREPARATION'); }
        need((await scope()).sha256 === p.registeredSha256, 'TRUSTED_REGISTRY_CHANGED');
        const remote = await cloud(saved.state.current.value.relayOrigin); need(remote.verified && remote.protocolVersion === 1, 'CLOUD_PROTOCOL_NOT_VERIFIED_BEFORE_SWITCH');
        if (o.mode === 'initial-readonly-adoption') await verifyLegacyCore(o.legacyRuntimePin);
      };
      await checkFence(); lock = p.ledger.missing ? { close() {}, ...p.ledger } : ledger(ledgerFile, { lock: true });
      need(!lock.unresolved?.length && same({ missing: lock.missing, rowsSha256: lock.rowsSha256, rowCount: lock.rowCount }, p.ledger), 'LEDGER_CHANGED');
      if (!p.ledger.missing) lockedAuthority = await identity(ledgerFile);
      need(same((await scope()).buckets, p.registeredBuckets) && (await scope()).sha256 === p.registeredSha256, 'TRUSTED_REGISTRY_CHANGED');
      for (const inv of saved.state.inventories) { const live = await inventoryLocalData(inv.dataRoot); const expected = p.sourceIds.find(i => i.id === inv.id); need(live.inventorySha256 === expected.inventorySha256 && await inventoryIds(live) === expected.filesIdentitySha256, 'SOURCE_CHANGED_AFTER_STOP_REPLAN_REQUIRED'); }
      await safe(path.dirname(operation), true, true); await mkdir(path.dirname(operation), { recursive: true }); await safe(path.dirname(operation), true); need(!await exists(operation), 'ADOPTION_GENERATION_EXISTS'); await mkdir(operation); await safe(operation, true); await mkdir(path.join(operation, 'snapshots'));
      const snapshots = [];
      for (const inv of saved.state.inventories) {
        const snapshot = o.mode === 'initial-readonly-adoption' ? await createLocalDataSnapshot({ source: { id: inv.id, adapterPath: inv.adapterPath }, directory: path.join(operation, 'snapshots', inv.id), expectedInventorySha256: inv.inventorySha256 })
          : await archiveStable({ id: inv.id, adapterPath: saved.state.current.value.adapterPath }, path.join(operation, 'snapshots', inv.id), inv);
        snapshots.push({ id: inv.id, ...snapshot });
      }
      receipt.snapshots = snapshots; const stable = dataRoot ?? saved.state.current.value.localDataRoot;
      if (dataRoot) { await mkdir(dataRoot); for (const entry of saved.state.upgrade.selectedFiles) { const snap = snapshots.find(s => s.id === entry.sourceId); const from = path.join(snap.directory, 'data', entry.path), to = path.join(dataRoot, entry.path); need(hash(await readFile(from)) === entry.sha256, 'SNAPSHOT_SELECTED_FILE_CHANGED'); await mkdir(path.dirname(to), { recursive: true }); await copyFile(from, to, 1); } }
      receipt.stableDataRoot = stable; receipt.stableDurableSha256 = hash((await inventoryLocalData(stable)).entries.filter(e => ['business', 'audit', 'log'].includes(e.kind))); receipt.registeredSha256 = p.registeredSha256;
      await safe(path.dirname(version), true, true); await mkdir(path.dirname(version), { recursive: true }); await safe(path.dirname(version), true); const copied = await copyRelease(o.targetRelease.directory, o.targetRelease.expectedManifestSha256, version);
      await checkFence(); const journalBefore = await journalState(saved.state.current.value.journalPath), journalPath = path.join(operation, 'journal.sqlite'); await copyJournal(saved.state.current.value.journalPath, journalPath, journalBefore);
      const callerPath = path.join(operation, 'caller.json'); need(same(await identity(o.callerFile), p.callerIdentity), 'CALLER_CHANGED'); await copyFile(o.callerFile, callerPath, 1); await loadCallerRecord(callerPath);
      const desktopPlan = await planClientShortcut({ callerFile: callerPath, releaseDirectory: version, expectedManifestSha256: copied.manifestSha256 }, { shortcutDirectory: known.desktop });
      await writeFile(desktopPlan.launcher, desktopPlan.script, { flag: 'wx', mode: 0o600 });
      const desktopStage = path.join(operation, 'desktop-prepared.lnk'), startupStage = path.join(operation, 'startup-prepared.lnk');
      await (local.shortcut ?? shortcut)({ ...desktopPlan, file: desktopStage });
      const startupSpec = { file: startupStage, target: psExe(), workingDirectory: operation, arguments: ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-File', path.join(version, 'start-companion.ps1'), '-PairingFile', o.pairingFile, '-ReleaseDirectory', version, '-ManifestSha256', copied.manifestSha256, '-NodeExe', process.execPath].map(quote).join(' ') };
      await (local.shortcut ?? shortcut)(startupSpec);
      receipt.sourceJournal = saved.state.current.value.journalPath; receipt.journalPath = journalPath; receipt.journalSha256 = journalBefore.sha256; receipt.versionDirectory = version; receipt.releaseManifestSha256 = copied.manifestSha256;
      const next = { ...saved.state.current.value, adapterPath: path.join(version, 'prototypes/upstream-port/sidebar-server.mjs'), baseline: { directory: version, manifestSha256: copied.adapterManifestSha256 }, localDataRoot: stable, journalPath };
      need(next.secretDPAPI === saved.state.current.value.secretDPAPI && next.pairingId === saved.state.current.value.pairingId && same(next.writeGrant, saved.state.current.value.writeGrant), 'PAIRING_POLICY_OR_CIPHERTEXT_CHANGED');
      receipt.configPreparedSha256 = hash(Buffer.from(JSON.stringify(next, null, 2) + '\n')); await writeJson(path.join(operation, 'prepared.json'), { ...receipt, changes: [] });
      await checkFence(); await local.beforeCommit?.(); await checkFence(); need(same(await identity(o.pairingFile), p.pairingIdentity), 'PAIRING_CHANGED');
      const publish = (file, expected, bytes) => cas(file, expected, bytes, { beforeClaim: local.beforeClaim, afterPublish: local.afterPublish,
        prepared: change => writeJson(path.join(operation, 'cas-intent-' + randomUUID() + '.json'), change), published: change => changes.push(change) });
      await publish(o.pairingFile, p.pairingIdentity, Buffer.from(JSON.stringify(next, null, 2) + '\n')); await checkRevoked();
      await publish(saved.state.startup, p.shortcuts.startup, await readFile(startupStage)); await checkRevoked();
      await publish(saved.state.desktop, p.shortcuts.desktop, await readFile(desktopStage)); await checkRevoked();
      await checkFence(); receipt.status = 'adopted-stopped'; await writeJson(path.join(operation, 'receipt.json'), receipt);
      return { status: receipt.status, receiptFile: path.join(operation, 'receipt.json'), receiptSha256: hash(await readFile(path.join(operation, 'receipt.json'))), runtimeStarted: false, snapshotsRetained: snapshots.length };
    } catch (e) {
      receipt.status = 'blocked-or-failed-preserved'; receipt.errorCode = e.code ?? 'ADOPTION_FAILED'; if (await exists(operation)) await writeJson(path.join(operation, 'failure-' + randomUUID() + '.json'), receipt).catch(() => {});
      // No blanket restoration: canonical config/revocation, state and exact
      // owned shortcut identities must pass rollback's complete gates first.
      throw Object.assign(e, { operation, recoveryRequired: changes.length > 0 });
    } finally { lock?.close(); await lease?.close(); }
  }
  async function planRollback({ receiptFile, receiptSha256 }) {
    need((await identity(receiptFile)).sha256 === receiptSha256, 'RECEIPT_CHANGED'); const r = await json(receiptFile); need(r.kind === 'complete-runtime-adoption-receipt' && ['adopted-stopped', 'blocked-or-failed-preserved'].includes(r.status) && r.changes.length > 0 && same(r.options, o), 'ROLLBACK_RECEIPT_NOT_THIS_CONTROLLER');
    await journalState(r.sourceJournal);
    await checkRevoked(); await safe(ledgerFile, false, true); const authority = await exists(ledgerFile) ? ledger(ledgerFile) : { missing: true, rowsSha256: null, rowCount: 0, unresolved: [] }, blockers = [];
    if (['dispatching', 'unknown', 'draining'].includes((await startRecord())?.status)) blockers.push('start-outcome-unresolved');
    if (authority.missing && (o.mode !== 'initial-readonly-adoption' || (await json(o.pairingFile)).writeEnabled !== false)) blockers.push('installation-ledger-missing');
    const priorChange = r.changes.find(c => fold(c.file) === fold(o.pairingFile)); need(priorChange?.backup && hash(await readFile(await safe(priorChange.backup))) === priorChange.expected.sha256, 'ROLLBACK_CONFIGURATION_BACKUP_CHANGED');
    const priorConfig = await json(priorChange.backup);
    try { if (r.oldDataStable) await verifyRuntimeRelease(o.sourceRelease); else { await verifyLegacyCore(o.legacyRuntimePin); await verifyFrozenAdapter({ directory: priorConfig.baseline.directory, expectedManifestSha256: priorConfig.baseline.manifestSha256 }); } } catch { blockers.push('old-code-pin-drift'); }
    if (authority.unresolved.length) blockers.push('global-ledger-unresolved'); for (const c of await realizedChanges(r.changes)) if (!same(await identity(c.file, true), c.installed)) blockers.push('user-file-or-config-changed');
    if (!r.oldDataStable) { if (!same({ missing: authority.missing, rowsSha256: authority.rowsSha256, rowCount: authority.rowCount }, r.ledgerBefore)) blockers.push('legacy-rollback-ledger-changed');
      const currentScope = await scope(); if (currentScope.sha256 !== r.registeredSha256 || !same(currentScope.buckets, r.registeredBuckets)) blockers.push('legacy-rollback-registry-changed');
      const stable = await inventoryLocalData(r.stableDataRoot); if (hash(stable.entries.filter(e => ['business', 'audit', 'log'].includes(e.kind))) !== r.stableDurableSha256 || stable.entries.some(e => e.kind === 'unrecognized') || stable.excluded.length) blockers.push('legacy-rollback-new-business');
      for (const id of r.sourceIds) { const snap = r.snapshots.find(s => s.id === id.id); await verifyLocalDataSnapshot({ directory: snap.directory, expectedManifestSha256: snap.manifestSha256 }); const source = o.sources.find(s => s.id === id.id); const locations = await planLocalDataUpgrade({ sources: [source], activeSourceId: source.id, stableDataRoot: path.join(operation, 'rollback-never-created'), registeredProjectRoots: currentScope.roots }); const inv = locations.sourceInventories[0]; if (inv.inventorySha256 !== id.inventorySha256 || await inventoryIds(inv) !== id.filesIdentitySha256 || !same(await identity(source.adapterPath), id.adapterIdentity)) blockers.push('legacy-source-changed'); }
    }
    const active = await controls.read(o.pairingFile), value = { version: 1, receiptFile, receiptSha256, blockers: [...new Set(blockers)], runtimeInstanceId: active?.instanceId ?? null, ledger: { missing: authority.missing, rowsSha256: authority.rowsSha256, rowCount: authority.rowCount }, dataRestoredFromSnapshot: false };
    return { ...value, planDigest: hash(value) };
  }
  async function rollback({ receiptFile, receiptSha256, planDigest, confirmation }) {
    const p = await planRollback({ receiptFile, receiptSha256 }); need(p.planDigest === planDigest && confirmation === 'ROLLBACK ' + planDigest && !p.blockers.length, 'EXPLICIT_UNBLOCKED_ROLLBACK_REQUIRED');
    const r = await json(receiptFile); let lease, lock;
    try { lease = await fence(p.runtimeInstanceId, [path.join(r.versionDirectory, 'prototypes/upstream-port/sidebar-server.mjs')]); lock = p.ledger.missing ? { close() {} } : ledger(ledgerFile, { lock: true });
      need(!lock.unresolved?.length, 'ROLLBACK_LEDGER_UNRESOLVED'); const authorityIdentity = p.ledger.missing ? null : await identity(ledgerFile);
      const rollbackFence = async () => { need((await controls.read(o.pairingFile))?.instanceId === lease.instanceId, 'ROLLBACK_FENCE_REPLACED'); await checkRevoked(); await journalState(r.sourceJournal); if (authorityIdentity) need(same(await identity(ledgerFile), authorityIdentity), 'ROLLBACK_LEDGER_AUTHORITY_REPLACED'); else need(!await exists(ledgerFile), 'ROLLBACK_MISSING_LEDGER_APPEARED'); };
      const again = await planRollback({ receiptFile, receiptSha256 }); need(!again.blockers.length && same(again.ledger, p.ledger), 'ROLLBACK_STATE_CHANGED'); await rollbackFence();
      for (const change of (await realizedChanges(r.changes)).reverse()) { await rollbackFence();
        if (fold(change.file) === fold(o.pairingFile)) {
          need(hash(await readFile(await safe(change.backup))) === change.expected.sha256, 'ROLLBACK_BACKUP_CHANGED');
          const prior = await json(change.backup); await journalState(r.journalPath); await journalState(r.sourceJournal);
          // Schema-1 tombstones/revocation are never rolled back. Both old
          // journal and raw original config remain archived, but active old
          // code keeps the newest journal authority to prevent replay.
          await cas(change.file, change.installed, Buffer.from(JSON.stringify({ ...prior, journalPath: r.journalPath }, null, 2) + '\n'));
        } else await restore(change);
        await rollbackFence();
      }
      return { status: 'rolled-back-stopped', sharedLatestData: r.oldDataStable, latestJournalRetained: true, dataRestoredFromSnapshot: false, allSnapshotsRetained: true };
    } finally { lock?.close(); await lease?.close(); }
  }
  async function start({ receiptFile, receiptSha256, confirmation } = {}) {
    need(confirmation === 'START ' + receiptSha256 && (await identity(receiptFile)).sha256 === receiptSha256, 'EXPLICIT_LOCAL_START_REQUIRED');
    const initialMarkerIdentity = await identity(startMarker, true), initialMarker = initialMarkerIdentity ? await json(startMarker) : null;
    need(!['dispatching', 'unknown', 'draining'].includes(initialMarker?.status), 'START_OUTCOME_UNRESOLVED');
    const r = await json(receiptFile); need(r.status === 'adopted-stopped' && same(r.options, o), 'START_RECEIPT_MISMATCH'); await checkRevoked(); await journalState(r.sourceJournal);
    for (const c of r.changes) need(same(await identity(c.file, true), c.installed), 'START_CONFIGURATION_OR_SHORTCUT_CHANGED');
    const checked = await verifyRuntimeRelease({ directory: r.versionDirectory, expectedManifestSha256: r.releaseManifestSha256 });
    const current = await config(); need(fold(current.value.adapterPath) === fold(path.join(r.versionDirectory, 'prototypes/upstream-port/sidebar-server.mjs')) && current.value.localDataRoot === r.stableDataRoot && current.value.journalPath === r.journalPath, 'START_PAIRING_NOT_ADOPTED');
    await safe(ledgerFile, false, true); const authority = await exists(ledgerFile) ? ledger(ledgerFile) : { missing: true, unresolved: [] }; need(!authority.unresolved.length && (!authority.missing || o.mode === 'initial-readonly-adoption' && current.value.writeEnabled === false), 'START_LEDGER_NOT_SAFE');
    need(!await controls.read(o.pairingFile), 'START_RUNTIME_ALREADY_EXISTS'); const idle = await inspect([current.value.adapterPath, ...(o.sources ?? []).map(s => s.adapterPath)]); need(!idle.codex.length && !idle.producers.length, 'START_PRODUCERS_MUST_BE_STOPPED');
    const attempt = { version: 1, attemptId: randomUUID(), operationId: o.operationId, options: o, receiptFile, receiptSha256, releaseDirectory: r.versionDirectory, status: 'dispatching', startedAt: Date.now(), proof: null };
    markerIds.set(attempt.attemptId, initialMarkerIdentity); await markerChange(attempt); let child, owned;
    try {
      if (local.startPinned) child = await local.startPinned({ pairingFile: o.pairingFile, releaseDirectory: r.versionDirectory, manifestSha256: checked.manifestSha256 });
      else {
      const spawned = spawn(psExe(), ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-File', path.join(r.versionDirectory, 'start-companion.ps1'), '-PairingFile', o.pairingFile, '-ReleaseDirectory', r.versionDirectory,
        '-ManifestSha256', checked.manifestSha256, '-NodeExe', process.execPath], { env: { ...process.env, LOCALAPPDATA: known.localAppData }, windowsHide: true, detached: true, stdio: 'ignore' });
      let exited = false; spawned.once('exit', () => { exited = true; }); await new Promise((resolve, reject) => { spawned.once('spawn', resolve); spawned.once('error', reject); }); spawned.unref();
      const parent = await processRecord(spawned.pid); need(parent && typeof parent.command === 'string', 'START_PROCESS_IDENTITY_UNAVAILABLE');
      child = proofOwner({ pid: spawned.pid, created: parent.created, commandSha256: hash(parent.command) }, r.versionDirectory); child.ended = async () => exited && await child.noPendingNode();
      }
      need(child && typeof child.owns === 'function', 'START_OWNERSHIP_PROOF_REQUIRED'); startOwners.set(attempt.attemptId, child); attempt.proof = child.proof ?? { kind: 'trusted-local-seam-in-memory-only' }; await markerChange(attempt);
      const timeout = local.startTimeoutMs ?? 15000; need(Number.isSafeInteger(timeout) && timeout > 0 && timeout <= 60000, 'BOUNDED_START_TIMEOUT_REQUIRED'); const end = Date.now() + timeout;
      for (;;) { const active = await controls.read(o.pairingFile);
        // Capture ownership before any secondary journal/config read can fail.
        if (active) { need(active.pairingId === current.value.pairingId && await child.owns(active), 'START_UNOWNED_RUNTIME_APPEARED'); owned = active; attempt.instanceId = active.instanceId; }
        await checkRevoked(); await journalState(r.sourceJournal);
        if (owned?.state === 'connected') { attempt.status = 'connected'; await markerChange(attempt); const file = path.join(operation, 'connected-' + randomUUID() + '.json'); await writeJson(file, { receiptSha256, instanceId: owned.instanceId, connectedAt: Date.now(), realCodexStarted: false }); return { status: 'connected', instanceId: owned.instanceId, acceptanceRecord: file, realCodexStarted: false, hitlVerified: false }; }
        need(Date.now() < end, 'START_NOT_CONNECTED'); await new Promise(resolve => setTimeout(resolve, 50)); }
    } catch (e) {
      attempt.status = 'unknown'; attempt.errorCode = e.code ?? 'START_FAILED';
      try {
        const active = await controls.read(o.pairingFile);
        if (!owned && active && child && await child.owns(active)) owned = active;
        if (owned) { need(active?.instanceId === owned.instanceId && await child.owns(active), 'FAILED_START_OWNER_CHANGED'); const stopped = await controls.stop(o.pairingFile, owned.instanceId); need(stopped.requested && stopped.instanceId === owned.instanceId, 'FAILED_START_EXACT_STOP_FAILED');
          const drain = Date.now() + 10000; while (await controls.read(o.pairingFile)) { need(Date.now() < drain, 'FAILED_START_NOT_DRAINED'); await new Promise(resolve => setTimeout(resolve, 50)); } attempt.status = 'stopped';
        } else if (child?.ended && await child.ended()) attempt.status = 'stopped';
      } finally { await markerChange(attempt); }
      throw Object.assign(e, { startAttemptFile: startMarker, startAttemptSha256: (await identity(startMarker)).sha256, startOutcome: attempt.status });
    }
  }
  function proofOwner(proof, releaseDirectory) {
    const launch = path.join(releaseDirectory, 'prototypes/remote-companion/launch.mjs').toLowerCase();
    return { proof, async owns(active) {
      if (!Number.isInteger(proof.pid) || !Number.isInteger(active?.pid)) return false;
      const parent = await processRecord(proof.pid), node = await processRecord(active.pid);
      return parent && parent.created === proof.created && typeof parent.command === 'string' && hash(parent.command) === proof.commandSha256 && Number(node?.parent) === proof.pid && typeof node.command === 'string' && node.command.toLowerCase().includes(launch);
    }, async noPendingNode() {
      const raw = await ps("Import-Module (Join-Path $PSHOME 'Modules\\CimCmdlets\\CimCmdlets.psd1');$d=[Console]::In.ReadToEnd()|ConvertFrom-Json;$rows=@(Get-CimInstance Win32_Process -Filter ('ParentProcessId='+[int]$d.pid)|Where-Object {$_.Name -eq 'node.exe'});[Console]::Out.Write($rows.Count)", { pid: proof.pid }); return raw === '0';
    }, async ended() { return !await processRecord(proof.pid) && await this.noPendingNode(); } };
  }
  async function drainStart({ attemptFile = startMarker, attemptSha256, confirmation } = {}) {
    need(fold(attemptFile) === fold(startMarker) && confirmation === 'DRAIN ' + attemptSha256 && (await identity(attemptFile)).sha256 === attemptSha256, 'EXPLICIT_DRAIN_REQUIRED');
    const attempt = await json(attemptFile); need(attempt.operationId === o.operationId && ['dispatching', 'unknown', 'draining'].includes(attempt.status), 'NO_UNRESOLVED_START_ATTEMPT');
    markerIds.set(attempt.attemptId, await identity(attemptFile));
    const child = startOwners.get(attempt.attemptId) ?? (attempt.proof?.pid ? proofOwner(attempt.proof, attempt.releaseDirectory) : null); need(child, 'START_PROOF_UNAVAILABLE_RETAIN_DIAGNOSTICS');
    const active = await controls.read(o.pairingFile);
    if (active) { need(await child.owns(active), 'DRAIN_UNOWNED_RUNTIME'); attempt.status = 'draining'; await markerChange(attempt);
      const stopped = await controls.stop(o.pairingFile, active.instanceId); need(stopped.requested && stopped.instanceId === active.instanceId, 'DRAIN_EXACT_STOP_FAILED'); const end = Date.now() + 10000;
      while (await controls.read(o.pairingFile)) { need(Date.now() < end, 'DRAIN_RUNTIME_NOT_RELEASED'); await new Promise(resolve => setTimeout(resolve, 50)); }
    } else need(child.ended && await child.ended(), 'START_STILL_PENDING_RETAIN_BARRIER');
    attempt.status = 'stopped'; await markerChange(attempt); return { status: 'stopped', exactRuntimeOnly: true, arbitraryPidKilled: false };
  }
  return { plan, apply, planRollback, rollback, start, drainStart, options: structuredClone(o) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { const [command, file, confirmation] = process.argv.slice(2);
    if (command === 'plan') { const a = await createRuntimeAdopter(await json(path.resolve(file))), p = await a.plan(), output = path.resolve(file) + '.plan-' + p.planDigest + '.json'; await writeJson(output, p); console.log(JSON.stringify({ ...p.publicPlan, privatePlanFile: output })); }
    else if (command === 'apply') { const saved = await json(path.resolve(file)), a = await createRuntimeAdopter(saved.privatePlan.options), p = await a.plan(); need(p.planDigest === saved.planDigest, 'SAVED_PLAN_CHANGED'); console.log(JSON.stringify(await a.apply({ planDigest: p.planDigest, confirmation }))); }
    else if (command === 'drain-start') { const attemptFile = path.resolve(file), record = await json(attemptFile), a = await createRuntimeAdopter(record.options); console.log(JSON.stringify(await a.drainStart({ attemptFile, attemptSha256: (await identity(attemptFile)).sha256, confirmation }))); }
    else if (['rollback-plan', 'rollback', 'start'].includes(command)) {
      const receiptFile = path.resolve(file), receiptSha256 = (await identity(receiptFile)).sha256, receipt = await json(receiptFile), a = await createRuntimeAdopter(receipt.options);
      if (command === 'rollback-plan') { const p = await a.planRollback({ receiptFile, receiptSha256 }); console.log(JSON.stringify({ ...p, confirmation: 'ROLLBACK ' + p.planDigest })); }
      else if (command === 'rollback') { const p = await a.planRollback({ receiptFile, receiptSha256 }); console.log(JSON.stringify(await a.rollback({ receiptFile, receiptSha256, planDigest: p.planDigest, confirmation }))); }
      else console.log(JSON.stringify(await a.start({ receiptFile, receiptSha256, confirmation })));
    } else throw Object.assign(new Error('Usage: adopt-runtime.mjs plan <private-options.json>; apply <private-plan.json> "APPLY <digest>"; rollback-plan|rollback|start <receipt> [confirmation]'), { code: 'USAGE' });
  } catch (e) { console.error(JSON.stringify({ code: e.code ?? 'ADOPTION_FAILED', recoveryRequired: e.recoveryRequired === true, startAttemptFile: e.startAttemptFile, startAttemptSha256: e.startAttemptSha256, startOutcome: e.startOutcome, noSecretsPrinted: true })); process.exitCode = 1; }
}
