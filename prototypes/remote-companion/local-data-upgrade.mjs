import path from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { lstat, realpath, readdir, open, mkdir, writeFile, utimes, readFile } from 'node:fs/promises';
import { canonical } from './protocol.mjs';

// Local planning and new-directory snapshots only. Nothing here activates an
// adapter, stops a process, edits a pairing/provider configuration, moves a
// file, changes the installation write-ledger path or uploads anything.
const sha = value => createHash('sha256').update(value).digest('hex');
const hash = value => sha(canonical(value));
const same = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const MAX_FILES = 10000, MAX_FILE_BYTES = 64 * 1024 * 1024, MAX_TOTAL_BYTES = 1024 * 1024 * 1024;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const failure = (code, message) => Object.assign(new Error(message), { code });
function requireFact(condition, code, message) { if (!condition) throw failure(code, message); }
function localAbsolute(value) {
  requireFact(typeof value === 'string' && path.isAbsolute(value) && !/^\\\\/.test(value) && !/[\u0000-\u001f\u007f]/.test(value),
    'LOCAL_PATH_REQUIRED', 'Use an absolute local filesystem path');
  return path.resolve(value);
}
function within(root, file) { const relative = path.relative(same(root), same(file)); return relative === '' || relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative); }
function relativeFile(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 2048 && !path.posix.isAbsolute(value) && !path.win32.isAbsolute(value) &&
    !/[\\:\u0000-\u001f\u007f]/.test(value) && !value.split('/').some(part => !part || part === '.' || part === '..');
}
async function existingDirectory(value) {
  const requested = localAbsolute(value), actual = await realpath(requested), info = await lstat(requested);
  requireFact(info.isDirectory() && !info.isSymbolicLink() && same(actual) === same(requested), 'REDIRECTED_DATA_PATH', 'Local data paths must not redirect through links');
  return actual;
}
async function absentOrDirectory(value) {
  try { return await existingDirectory(value); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function kindOf(relative) {
  const file = relative.toLowerCase(), base = file.split('/').at(-1);
  // Credentials and the installation authority are deliberately outside the
  // adapter business-state snapshot. Seeing one here requires local review.
  if (['auth.json', 'hosts.yml', '.git-credentials', 'credentials', 'pairing.json', 'config.toml'].includes(base) ||
      /^write-ledger\.sqlite(?:-wal|-shm)?$/.test(base) || file.split('/').some(part => ['.codex', '.ssh', '.aws', '.git'].includes(part))) return 'excluded-security';
  if (/\.tmp(?:-|\.|$)|\.lock$/.test(base)) return 'temporary';
  if (file === 'host-context-captures.json') return 'diagnostic';
  if (!/^projects\/[a-f0-9]{64}\//.test(file)) return 'unrecognized';
  const projectFile = file.slice('projects/'.length + 64 + 1);
  if (['.dsh/mattskillsdeck/choices.json', 'manual-naming.json', '.dsh-mattskillsdeck-cache/log-switch.json',
    '.dsh-mattskillsdeck-cache/session-tickets.json', '.dsh-mattskillsdeck-cache/naming-guardian.json'].includes(projectFile)) return 'business';
  if (/^write-audit(?:\.[A-Za-z0-9_-]+)?\.jsonl$/.test(projectFile) || /^git-config-backups\/.+\.config$/.test(projectFile)) return 'audit';
  if (/^\.dsh-mattskillsdeck-cache\/logs\/.+\.log$/.test(projectFile)) return 'log';
  if (projectFile.startsWith('.dsh-mattskillsdeck-cache/') || projectFile.startsWith('panel-startup-')) return 'cache';
  return 'unrecognized';
}
const entryIdentity = entry => ({ path: entry.path, kind: entry.kind, bytes: entry.bytes, sha256: entry.sha256 });
function inventoryHash(entries, excluded) { return hash({ entries: entries.map(entryIdentity), excluded }); }
async function stableBytes(root, relative) {
  requireFact(relativeFile(relative), 'INVALID_DATA_PATH', 'Invalid relative snapshot file');
  const requested = path.join(root, ...relative.split('/')), actual = await realpath(requested), link = await lstat(requested);
  requireFact(link.isFile() && !link.isSymbolicLink() && same(actual) === same(requested) && within(root, actual),
    'REDIRECTED_DATA_PATH', 'Snapshot source must be a regular file inside the owned data root');
  let handle;
  try {
    handle = await open(actual, 'r');
    const before = await handle.stat({ bigint: true });
    requireFact(before.isFile() && before.size <= BigInt(MAX_FILE_BYTES), 'DATA_LIMIT', 'Local data file exceeds its snapshot limit');
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    requireFact(BigInt(bytes.length) === before.size && after.size === before.size && after.mtimeNs === before.mtimeNs && after.ctimeNs === before.ctimeNs,
      'SOURCE_CHANGED', 'Local data changed while being read; no activation is authorized');
    requireFact(bytes.length <= MAX_FILE_BYTES, 'DATA_LIMIT', 'Local data file grew beyond its snapshot limit');
    return { bytes, size: bytes.length, sha256: sha(bytes), mtimeMs: Number(before.mtimeNs) / 1e6 };
  } finally { await handle?.close(); }
}

export function installationLocalDataRoot({ localAppData = process.env.LOCALAPPDATA || (process.platform === 'win32'
  ? path.join(homedir(), 'AppData', 'Local') : path.join(homedir(), '.local', 'share')) } = {}) {
  return path.join(localAbsolute(localAppData), 'MattSkillsDeck', 'RemoteCompanion', 'local-state', 'data');
}

// This is the legacy source formula, not a version-neutral destination. Both
// realpath and lowercase placement match the currently frozen sidebar source.
export async function legacyAdapterDataRoot(adapterPath) {
  const requested = localAbsolute(adapterPath), adapter = await realpath(requested), info = await lstat(requested);
  requireFact(info.isFile() && !info.isSymbolicLink(), 'INVALID_ADAPTER_PATH', 'Use a verified local sidebar entrypoint');
  const adapterRoot = await realpath(path.resolve(path.dirname(adapter), '../..'));
  requireFact(same(adapter) === same(path.join(adapterRoot, 'prototypes/upstream-port/sidebar-server.mjs')),
    'INVALID_ADAPTER_PATH', 'Use the local frozen sidebar entrypoint');
  const key = sha(adapterRoot.toLowerCase()).slice(0, 16);
  return { adapterPath: adapter, adapterRoot, key, dataRoot: path.join(adapterRoot, '.scratch', 'upstream-sidebar', key) };
}

export async function registeredProjectDataBucket(projectRoot) {
  requireFact(typeof projectRoot === 'string' && path.isAbsolute(projectRoot) && !/[\u0000-\u001f\u007f]/.test(projectRoot),
    'LOCAL_PATH_REQUIRED', 'Use an absolute project root from the trusted local loader');
  let root = await realpath(projectRoot);
  requireFact((await lstat(root)).isDirectory(), 'INVALID_REGISTERED_PROJECTS', 'The trusted registered project is not a directory');
  // Match session-project -> project-hosts, including the original case of
  // realpath. Lowercasing this hash would silently select another data bucket.
  if (process.platform === 'win32') {
    if (root.startsWith('\\\\?\\')) root = root.slice(4);
    if (root.startsWith('\\??\\')) root = root.slice(4);
    root = path.win32.normalize(root.replace(/\//g, '\\'));
    if (root.length > 3 && root.endsWith('\\')) root = root.slice(0, -1);
  }
  return { projectRoot: root, bucket: sha(root) };
}

export async function inventoryLocalData(dataRoot) {
  const requested = localAbsolute(dataRoot), root = await absentOrDirectory(requested);
  if (root === null) return { dataRoot: requested, exists: false, entries: [], excluded: [], totalBytes: 0, inventorySha256: inventoryHash([], []) };
  const entries = [], excluded = []; let totalBytes = 0, count = 0;
  async function walk(folder, prefix = '') {
    const names = (await readdir(folder)).sort();
    for (const name of names) {
      const relative = prefix ? prefix + '/' + name : name;
      requireFact(relativeFile(relative), 'INVALID_DATA_PATH', 'Unsupported local data filename');
      const file = path.join(folder, name), info = await lstat(file);
      requireFact(!info.isSymbolicLink() && same(await realpath(file)) === same(file) && within(root, file), 'REDIRECTED_DATA_PATH', 'Local state contains a redirected file or directory');
      if (info.isDirectory()) { await walk(file, relative); continue; }
      requireFact(info.isFile(), 'INVALID_DATA_PATH', 'Local state contains a non-regular file');
      requireFact(++count <= MAX_FILES, 'DATA_LIMIT', 'Local data contains too many snapshot files');
      const kind = kindOf(relative);
      if (kind === 'excluded-security') { excluded.push({ path: relative, reason: kind }); continue; }
      const read = await stableBytes(root, relative);
      totalBytes += read.size;
      requireFact(totalBytes <= MAX_TOTAL_BYTES, 'DATA_LIMIT', 'Local data exceeds its total snapshot limit');
      entries.push({ path: relative, kind, bytes: read.size, sha256: read.sha256, mtimeMs: read.mtimeMs });
    }
  }
  await walk(root);
  return { dataRoot: root, exists: true, entries, excluded, totalBytes, inventorySha256: inventoryHash(entries, excluded) };
}

export async function planLocalDataUpgrade({ sources, activeSourceId, stableDataRoot = installationLocalDataRoot(), inheritMissingFrom = [], registeredProjectRoots }) {
  requireFact(Array.isArray(sources) && sources.length > 0 && sources.length <= 8 && Array.isArray(inheritMissingFrom), 'INVALID_UPGRADE_PLAN', 'Select bounded explicit local source adapters');
  const ids = new Set();
  const inventories = [];
  for (const source of sources) {
    requireFact(plain(source) && Object.keys(source).every(key => ['id', 'adapterPath'].includes(key)) && ID.test(source.id ?? '') && !ids.has(source.id), 'INVALID_UPGRADE_PLAN', 'Local source IDs must be unique');
    ids.add(source.id);
    const location = await legacyAdapterDataRoot(source.adapterPath);
    const inventory = await inventoryLocalData(location.dataRoot);
    inventories.push({ id: source.id, ...location, ...inventory });
  }
  requireFact(ids.has(activeSourceId) && inheritMissingFrom.every(id => ids.has(id) && id !== activeSourceId), 'INVALID_UPGRADE_PLAN', 'Select the actual active source and explicit missing-file inheritance');
  const destination = localAbsolute(stableDataRoot);
  for (const source of inventories) requireFact(!within(source.dataRoot, destination) && !within(destination, source.dataRoot), 'OVERLAPPING_DATA_ROOTS', 'Stable data must not overlap a legacy source');
  const currentDestination = await inventoryLocalData(destination);
  // This option is injected by the trusted local Codex project-roots loader.
  // There is deliberately no MCP/remote endpoint for it, no cwd inference and
  // no fallback to every historical test bucket when the loader is absent.
  requireFact(registeredProjectRoots === undefined || Array.isArray(registeredProjectRoots) && registeredProjectRoots.length <= 512,
    'INVALID_REGISTERED_PROJECTS', 'Use the bounded project roots from the trusted local loader');
  const registered = registeredProjectRoots === undefined ? [] : await Promise.all(registeredProjectRoots.map(registeredProjectDataBucket));
  const buckets = new Set(registered.map(project => project.bucket));
  const eligible = relative => buckets.has(/^projects\/([a-f0-9]{64})\//.exec(relative)?.[1]);
  const ordered = [activeSourceId, ...new Set(inheritMissingFrom)];
  const chosen = new Map(), alternatives = new Map(), filteredOut = [];
  for (const source of inventories) for (const entry of source.entries) if (['business', 'audit', 'log'].includes(entry.kind)) {
    const candidate = { sourceId: source.id, ...entryIdentity(entry) };
    if (!eligible(entry.path)) { filteredOut.push(candidate); continue; }
    if (!alternatives.has(entry.path)) alternatives.set(entry.path, []);
    alternatives.get(entry.path).push(candidate);
  }
  for (const id of ordered) for (const entry of inventories.find(source => source.id === id).entries) if (['business', 'audit', 'log'].includes(entry.kind) && eligible(entry.path) && !chosen.has(entry.path)) chosen.set(entry.path, { sourceId: id, ...entryIdentity(entry) });
  const conflicts = [...alternatives].filter(([, candidates]) => new Set(candidates.map(file => file.sha256)).size > 1)
    .map(([relative, candidates]) => ({ path: relative, kind: candidates[0].kind, selectedSourceId: chosen.get(relative)?.sourceId ?? null, candidates,
      recommendation: candidates[0].kind === 'business' ? 'review-business-state' : 'keep-active-and-archive-both-sources' }));
  const unselected = [...alternatives].filter(([relative]) => !chosen.has(relative)).map(([relative, candidates]) => ({ path: relative, candidates }));
  const plan = { version: 1, kind: 'local-data-upgrade-dry-run', activeSourceId, stableDataRoot: destination,
    destinationExists: currentDestination.exists, sourceInventories: inventories, selectedFiles: [...chosen.values()].sort((a, b) => a.path.localeCompare(b.path)),
    conflicts, unselected, activationReady: false, projectFilter: { mode: registeredProjectRoots === undefined ? 'trusted-loader-required' : 'registered-projects-only',
      registeredProjectBuckets: [...buckets].sort(), filteredOut },
    status: currentDestination.exists ? 'destination-already-exists' : registeredProjectRoots === undefined ? 'registered-projects-required' :
      conflicts.some(conflict => conflict.kind === 'business') || unselected.length || inventories.some(source => source.excluded.length) ? 'review-required' : 'snapshot-required',
    constraints: ['no-activation', 'no-source-overwrite', 'no-automatic-merge', 'installation-write-ledger-unchanged', 'local-only', 'writers-stop-fence-required-before-cutover'] };
  return { ...plan, planSha256: hash(plan) };
}

export async function createLocalDataSnapshot({ source, directory, expectedInventorySha256, onFileCopied }) {
  requireFact(plain(source) && Object.keys(source).every(key => ['id', 'adapterPath'].includes(key)) && ID.test(source.id ?? '') && HASH.test(expectedInventorySha256 ?? ''),
    'INVALID_SNAPSHOT', 'Use an explicit local source and the reviewed inventory hash');
  const location = await legacyAdapterDataRoot(source.adapterPath), before = await inventoryLocalData(location.dataRoot);
  requireFact(before.exists && before.inventorySha256 === expectedInventorySha256, 'SOURCE_CHANGED', 'Source inventory differs from the reviewed snapshot plan');
  requireFact(before.excluded.length === 0, 'SECURITY_FILE_PRESENT', 'Unexpected credentials or installation authority in the data root require local review');
  const destination = localAbsolute(directory), parent = await existingDirectory(path.dirname(destination));
  requireFact(same(path.dirname(destination)) === same(parent) && !within(location.dataRoot, destination) && !within(destination, location.dataRoot),
    'OVERLAPPING_DATA_ROOTS', 'A snapshot must use a new separate local directory');
  // No recursive parent creation and no overwrite: a failed snapshot remains a
  // separate incomplete directory; the source and every older snapshot remain.
  await mkdir(destination);
  const data = path.join(destination, 'data'); await mkdir(data);
  for (const entry of before.entries) {
    const read = await stableBytes(before.dataRoot, entry.path);
    requireFact(read.size === entry.bytes && read.sha256 === entry.sha256, 'SOURCE_CHANGED', 'Source changed before a snapshot file could be copied');
    const file = path.join(data, ...entry.path.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    requireFact(within(data, await realpath(path.dirname(file))), 'REDIRECTED_DATA_PATH', 'Snapshot destination was redirected');
    await writeFile(file, read.bytes, { flag: 'wx' });
    await utimes(file, entry.mtimeMs / 1000, entry.mtimeMs / 1000);
    if (onFileCopied) await onFileCopied({ path: entry.path }); // trusted local test/diagnostic hook, never JSON/MCP input
  }
  const after = await inventoryLocalData(before.dataRoot);
  requireFact(after.inventorySha256 === before.inventorySha256, 'SOURCE_CHANGED', 'Source changed during snapshot; the new directory is incomplete and cannot be activated');
  const manifest = { version: 1, kind: 'deck-local-data-snapshot', createdAt: Date.now(), source: { id: source.id,
    adapterRootSha256: sha(same(location.adapterRoot)), dataRootSha256: sha(same(location.dataRoot)), inventorySha256: before.inventorySha256 },
    dataDirectory: 'data', files: before.entries, totalBytes: before.totalBytes, activationReady: false, consistency: 'observed-stable-copy-without-execution-fence' };
  const manifestFile = path.join(destination, 'local-data-snapshot.json'), bytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(manifestFile, bytes, { flag: 'wx' });
  const manifestSha256 = sha(bytes);
  await verifyLocalDataSnapshot({ directory: destination, expectedManifestSha256: manifestSha256 });
  return { directory: destination, manifestFile, manifestSha256, fileCount: manifest.files.length, totalBytes: manifest.totalBytes, activationReady: false };
}

export async function verifyLocalDataSnapshot({ directory, expectedManifestSha256 }) {
  requireFact(HASH.test(expectedManifestSha256 ?? ''), 'MANIFEST_HASH_REQUIRED', 'Use the independently retained snapshot manifest hash');
  const root = await existingDirectory(directory), file = path.join(root, 'local-data-snapshot.json');
  requireFact(canonical((await readdir(root)).sort()) === canonical(['data', 'local-data-snapshot.json']), 'INVALID_SNAPSHOT', 'Snapshot directory contains unexpected root files');
  const info = await lstat(file);
  requireFact(info.isFile() && !info.isSymbolicLink() && info.size <= 8 * 1024 * 1024, 'INVALID_SNAPSHOT', 'Invalid snapshot manifest file');
  const bytes = await readFile(file);
  requireFact(sha(bytes) === expectedManifestSha256, 'MANIFEST_MISMATCH', 'Snapshot manifest differs from the retained hash');
  const manifest = JSON.parse(bytes.toString('utf8'));
  requireFact(plain(manifest) && manifest.version === 1 && manifest.kind === 'deck-local-data-snapshot' && manifest.dataDirectory === 'data' &&
    manifest.activationReady === false && Array.isArray(manifest.files) && manifest.files.length <= MAX_FILES && plain(manifest.source) &&
    HASH.test(manifest.source.inventorySha256 ?? '') && HASH.test(manifest.source.adapterRootSha256 ?? '') && HASH.test(manifest.source.dataRootSha256 ?? '') &&
    new Set(manifest.files.map(entry => entry.path)).size === manifest.files.length && manifest.files.every(entry => plain(entry) && relativeFile(entry.path) &&
      entry.kind === kindOf(entry.path) && entry.kind !== 'excluded-security' && HASH.test(entry.sha256 ?? '') && Number.isSafeInteger(entry.bytes) && entry.bytes >= 0 && entry.bytes <= MAX_FILE_BYTES),
  'INVALID_SNAPSHOT', 'Snapshot manifest has an invalid local data shape');
  const data = await inventoryLocalData(path.join(root, 'data'));
  requireFact(data.exists && data.excluded.length === 0 && data.inventorySha256 === manifest.source.inventorySha256 &&
    hash(data.entries.map(entryIdentity)) === hash(manifest.files.map(entryIdentity)) && data.totalBytes === manifest.totalBytes,
  'SNAPSHOT_CONTENT_MISMATCH', 'Snapshot contents do not exactly match the reviewed local manifest');
  return { verified: true, directory: root, manifestSha256: expectedManifestSha256, fileCount: data.entries.length, totalBytes: data.totalBytes, activationReady: false };
}
