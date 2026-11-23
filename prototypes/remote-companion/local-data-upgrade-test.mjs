import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, writeFile, readFile, readdir, stat, symlink, open } from 'node:fs/promises';
import { installationLocalDataRoot, legacyAdapterDataRoot, registeredProjectDataBucket, inventoryLocalData, planLocalDataUpgrade, createLocalDataSnapshot, verifyLocalDataSnapshot } from './local-data-upgrade.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture(t) {
  const base = fileURLToPath(new URL('../../.scratch/', import.meta.url)); await mkdir(base, { recursive: true });
  const directory = await realpath(await mkdtemp(path.join(base, 'local-data-upgrade-test-')));
  const project = path.join(directory, 'RegisteredProject'); await mkdir(project);
  const { bucket } = await registeredProjectDataBucket(project), prefix = 'projects/' + bucket + '/';
  t.after(async () => {
    const actual = await realpath(directory), parent = await realpath(base);
    assert.equal(path.dirname(actual).toLowerCase(), parent.toLowerCase()); assert.ok(path.basename(actual).startsWith('local-data-upgrade-test-'));
    await rm(actual, { recursive: true, maxRetries: 10, retryDelay: 100 });
  });
  const source = async (name, exists = true) => {
    const adapter = path.join(directory, name, 'prototypes/upstream-port/sidebar-server.mjs');
    await mkdir(path.dirname(adapter), { recursive: true }); await writeFile(adapter, '// isolated immutable adapter fixture\n');
    const info = await legacyAdapterDataRoot(adapter);
    if (exists) await mkdir(info.dataRoot, { recursive: true });
    return { id: name, adapterPath: adapter, info };
  };
  const put = async (root, relative, content) => {
    const file = path.join(root, ...relative.split('/')); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, content); return file;
  };
  const publicSource = source => ({ id: source.id, adapterPath: source.adapterPath });
  const target = path.join(directory, 'installation/local-state/data');
  return { directory, source, put, publicSource, target, project, bucket, prefix };
}

test('legacy adapter moves change business-data roots while installation data is version independent', async t => {
  const f = await fixture(t), main = await f.source('main'), v1 = await f.source('v1'), v2 = await f.source('v2', false);
  assert.equal(new Set([main.info.dataRoot, v1.info.dataRoot, v2.info.dataRoot]).size, 3);
  assert.equal(v1.info.key, digest(v1.info.adapterRoot.toLowerCase()).slice(0, 16));
  const stable = installationLocalDataRoot({ localAppData: f.directory });
  assert.equal(stable, path.join(f.directory, 'MattSkillsDeck/RemoteCompanion/local-state/data'));
  assert.ok(!stable.includes('v1') && !stable.includes('v2') && !stable.endsWith('write-ledger.sqlite'));
  assert.equal((await inventoryLocalData(v2.info.dataRoot)).exists, false);
});

test('upgrade is a read-only plan with explicit missing-file inheritance and no implicit merge', async t => {
  const f = await fixture(t), main = await f.source('main'), v1 = await f.source('v1');
  await f.put(main.info.dataRoot, f.prefix + 'manual-naming.json', '{"fixture":"manual"}');
  await f.put(main.info.dataRoot, f.prefix + '.dsh-mattskillsdeck-cache/log-switch.json', '{"enabled":false}');
  await f.put(v1.info.dataRoot, f.prefix + 'panel-startup-snapshot.json', '{"fixture":"cache"}');
  const sources = [f.publicSource(main), f.publicSource(v1)];
  const without = await planLocalDataUpgrade({ registeredProjectRoots: [f.project], sources, activeSourceId: 'v1', stableDataRoot: f.target });
  assert.equal(without.selectedFiles.length, 0); assert.equal(without.unselected.length, 2); assert.equal(without.status, 'review-required');
  const plan = await planLocalDataUpgrade({ registeredProjectRoots: [f.project], sources, activeSourceId: 'v1', inheritMissingFrom: ['main'], stableDataRoot: f.target });
  assert.equal(plan.selectedFiles.length, 2); assert.ok(plan.selectedFiles.every(file => file.sourceId === 'main'));
  assert.equal(plan.activationReady, false); assert.equal(plan.status, 'snapshot-required');
  assert.equal(await stat(f.target).then(() => true, () => false), false, 'a dry run never creates the stable runtime directory');
  assert.equal(await readFile(path.join(main.info.dataRoot, f.prefix, 'manual-naming.json'), 'utf8'), '{"fixture":"manual"}');
});

test('conflicting business state and audit remain separate and are reported with hashes', async t => {
  const f = await fixture(t), main = await f.source('main'), v1 = await f.source('v1');
  await f.put(main.info.dataRoot, f.prefix + '.dsh/mattskillsdeck/choices.json', '{"backend":"markdown"}');
  await f.put(v1.info.dataRoot, f.prefix + '.dsh/mattskillsdeck/choices.json', '{"backend":"github"}');
  await f.put(main.info.dataRoot, f.prefix + 'write-audit.jsonl', 'old-audit\n');
  await f.put(v1.info.dataRoot, f.prefix + 'write-audit.jsonl', 'active-audit\n');
  const plan = await planLocalDataUpgrade({ registeredProjectRoots: [f.project], sources: [f.publicSource(main), f.publicSource(v1)], activeSourceId: 'v1', inheritMissingFrom: ['main'], stableDataRoot: f.target });
  assert.equal(plan.conflicts.length, 2); assert.ok(plan.conflicts.every(conflict => conflict.selectedSourceId === 'v1'));
  assert.ok(plan.selectedFiles.every(file => file.sourceId === 'v1')); assert.equal(plan.status, 'review-required');
  assert.ok(!JSON.stringify(plan).includes('active-audit') && !JSON.stringify(plan).includes('"backend":"github"'), 'the review plan contains fingerprints, not raw file contents');
});

test('an existing stable destination is not overwritten or silently adopted', async t => {
  const f = await fixture(t), v1 = await f.source('v1');
  await mkdir(f.target, { recursive: true }); const marker = await f.put(f.target, 'user-file.txt', 'existing installation state');
  const plan = await planLocalDataUpgrade({ registeredProjectRoots: [f.project], sources: [f.publicSource(v1)], activeSourceId: 'v1', stableDataRoot: f.target });
  assert.equal(plan.status, 'destination-already-exists'); assert.equal(plan.activationReady, false);
  assert.equal(await readFile(marker, 'utf8'), 'existing installation state');
});

test('trusted registered roots filter activation candidates without trimming archival inventories', async t => {
  const f = await fixture(t), main = await f.source('main');
  const other = path.join(f.directory, 'UnregisteredProject'); await mkdir(other);
  const otherBucket = await registeredProjectDataBucket(other);
  await f.put(main.info.dataRoot, f.prefix + 'manual-naming.json', 'registered state');
  await f.put(main.info.dataRoot, 'projects/' + otherBucket.bucket + '/manual-naming.json', 'historical test state');
  const input = { sources: [f.publicSource(main)], activeSourceId: 'main', stableDataRoot: f.target };
  const missingLoader = await planLocalDataUpgrade(input);
  assert.equal(missingLoader.status, 'registered-projects-required'); assert.equal(missingLoader.selectedFiles.length, 0);
  assert.equal(missingLoader.sourceInventories[0].entries.length, 2);
  const plan = await planLocalDataUpgrade({ ...input, registeredProjectRoots: [f.project] });
  assert.equal(plan.selectedFiles.length, 1); assert.equal(plan.selectedFiles[0].path, f.prefix + 'manual-naming.json');
  assert.equal(plan.projectFilter.filteredOut.length, 1); assert.equal(plan.sourceInventories[0].entries.length, 2);
  const actual = await registeredProjectDataBucket(f.project);
  assert.equal(actual.bucket, digest(actual.projectRoot)); assert.notEqual(actual.bucket, digest(actual.projectRoot.toLowerCase()), 'retain realpath case for project bucket identity');
  if (process.platform === 'win32') assert.equal((await registeredProjectDataBucket('\\\\?\\' + f.project)).bucket, f.bucket, 'strip the same Windows namespace prefix as the worker resolver');
  await assert.rejects(planLocalDataUpgrade({ ...input, registeredProjectRoots: ['relative-project'] }), { code: 'LOCAL_PATH_REQUIRED' });
  const inventory = plan.sourceInventories[0];
  const snapshot = await createLocalDataSnapshot({ source: f.publicSource(main), directory: path.join(f.directory, 'full-source-archive'), expectedInventorySha256: inventory.inventorySha256 });
  assert.equal(snapshot.fileCount, 2, 'archive the entire source independently of runtime candidate filtering');
});

test('log-only differences select active source and preserve archive advice without business conflict', async t => {
  const f = await fixture(t), main = await f.source('main'), v1 = await f.source('v1');
  await f.put(main.info.dataRoot, f.prefix + '.dsh-mattskillsdeck-cache/logs/2026-11-24.log', 'main local log');
  await f.put(v1.info.dataRoot, f.prefix + '.dsh-mattskillsdeck-cache/logs/2026-11-24.log', 'active local log');
  const plan = await planLocalDataUpgrade({ registeredProjectRoots: [f.project], sources: [f.publicSource(main), f.publicSource(v1)],
    activeSourceId: 'v1', inheritMissingFrom: ['main'], stableDataRoot: f.target });
  assert.equal(plan.conflicts.length, 1); assert.equal(plan.conflicts[0].kind, 'log');
  assert.equal(plan.conflicts[0].recommendation, 'keep-active-and-archive-both-sources');
  assert.equal(plan.selectedFiles[0].sourceId, 'v1'); assert.equal(plan.status, 'snapshot-required'); assert.equal(plan.activationReady, false);
});

test('new-directory snapshot preserves every source byte and verifies a retained manifest hash', async t => {
  const f = await fixture(t), v1 = await f.source('v1');
  const stateFile = await f.put(v1.info.dataRoot, f.prefix + 'manual-naming.json', '{"fixture":"local state"}');
  await f.put(v1.info.dataRoot, f.prefix + '.dsh-mattskillsdeck-cache/logs/2026-11-24.log', 'local audit details\n');
  await f.put(v1.info.dataRoot, f.prefix + 'panel-startup-snapshot.json.tmp-fixture', 'temporary cache retained in archival snapshot');
  const inventory = await inventoryLocalData(v1.info.dataRoot), destination = path.join(f.directory, 'snapshot-v1');
  const snapshot = await createLocalDataSnapshot({ source: f.publicSource(v1), directory: destination, expectedInventorySha256: inventory.inventorySha256 });
  assert.equal(snapshot.fileCount, 3); assert.equal(snapshot.activationReady, false);
  assert.equal((await verifyLocalDataSnapshot({ directory: destination, expectedManifestSha256: snapshot.manifestSha256 })).verified, true);
  assert.equal(await readFile(stateFile, 'utf8'), '{"fixture":"local state"}');
  assert.equal(await readFile(path.join(destination, 'data', f.prefix, 'manual-naming.json'), 'utf8'), '{"fixture":"local state"}');
  const manifest = JSON.parse(await readFile(snapshot.manifestFile, 'utf8'));
  assert.equal(manifest.consistency, 'observed-stable-copy-without-execution-fence'); assert.equal(manifest.activationReady, false);
  assert.ok(!JSON.stringify(manifest.source).includes(v1.info.dataRoot), 'snapshot source identity is fingerprinted');
  await assert.rejects(createLocalDataSnapshot({ source: f.publicSource(v1), directory: destination, expectedInventorySha256: inventory.inventorySha256 }), { code: 'EEXIST' });
});

test('stale dry-run inventory cannot create or activate a snapshot', async t => {
  const f = await fixture(t), v1 = await f.source('v1');
  const state = await f.put(v1.info.dataRoot, f.prefix + 'manual-naming.json', 'before');
  const inventory = await inventoryLocalData(v1.info.dataRoot); await writeFile(state, 'changed after planning');
  const destination = path.join(f.directory, 'stale-snapshot');
  await assert.rejects(createLocalDataSnapshot({ source: f.publicSource(v1), directory: destination, expectedInventorySha256: inventory.inventorySha256 }), { code: 'SOURCE_CHANGED' });
  assert.equal(await stat(destination).then(() => true, () => false), false);
  assert.equal(await readFile(state, 'utf8'), 'changed after planning');
});

test('a writer racing the copy leaves an incomplete new directory and never edits the source', async t => {
  const f = await fixture(t), v1 = await f.source('v1');
  await f.put(v1.info.dataRoot, f.prefix + '.dsh/mattskillsdeck/choices.json', 'first');
  const second = await f.put(v1.info.dataRoot, f.prefix + 'manual-naming.json', 'second');
  const inventory = await inventoryLocalData(v1.info.dataRoot), destination = path.join(f.directory, 'racing-snapshot'); let changed = false;
  await assert.rejects(createLocalDataSnapshot({ source: f.publicSource(v1), directory: destination, expectedInventorySha256: inventory.inventorySha256,
    onFileCopied: async () => { if (!changed) { changed = true; await writeFile(second, 'concurrent local writer'); } } }), { code: 'SOURCE_CHANGED' });
  assert.equal(await stat(path.join(destination, 'local-data-snapshot.json')).then(() => true, () => false), false);
  assert.equal(await readFile(second, 'utf8'), 'concurrent local writer');
  assert.ok((await readdir(destination)).includes('data'), 'retain the incomplete snapshot for local inspection instead of deleting evidence');
});

test('snapshot tampering, extra files and changed contents are rejected', async t => {
  const f = await fixture(t), v1 = await f.source('v1');
  await f.put(v1.info.dataRoot, f.prefix + 'manual-naming.json', 'original'); const inventory = await inventoryLocalData(v1.info.dataRoot);
  const snapshot = await createLocalDataSnapshot({ source: f.publicSource(v1), directory: path.join(f.directory, 'snapshot'), expectedInventorySha256: inventory.inventorySha256 });
  const originalManifest = await readFile(snapshot.manifestFile);
  await writeFile(snapshot.manifestFile, Buffer.concat([originalManifest, Buffer.from(' ')]));
  await assert.rejects(verifyLocalDataSnapshot({ directory: snapshot.directory, expectedManifestSha256: snapshot.manifestSha256 }), { code: 'MANIFEST_MISMATCH' });
  await writeFile(snapshot.manifestFile, originalManifest);
  await f.put(path.join(snapshot.directory, 'data'), 'unexpected.txt', 'extra');
  await assert.rejects(verifyLocalDataSnapshot({ directory: snapshot.directory, expectedManifestSha256: snapshot.manifestSha256 }), { code: 'SNAPSHOT_CONTENT_MISMATCH' });
  await rm(path.join(snapshot.directory, 'data/unexpected.txt'));
  await writeFile(path.join(snapshot.directory, 'data', f.prefix, 'manual-naming.json'), 'tampered');
  await assert.rejects(verifyLocalDataSnapshot({ directory: snapshot.directory, expectedManifestSha256: snapshot.manifestSha256 }), { code: 'SNAPSHOT_CONTENT_MISMATCH' });
});

test('a manifest path traversal is rejected even with a matching manifest checksum', async t => {
  const f = await fixture(t), v1 = await f.source('v1'); await f.put(v1.info.dataRoot, f.prefix + 'manual-naming.json', 'state');
  const inventory = await inventoryLocalData(v1.info.dataRoot);
  const snapshot = await createLocalDataSnapshot({ source: f.publicSource(v1), directory: path.join(f.directory, 'snapshot'), expectedInventorySha256: inventory.inventorySha256 });
  const manifest = JSON.parse(await readFile(snapshot.manifestFile, 'utf8')); manifest.files[0].path = '../outside.txt';
  const bytes = Buffer.from(JSON.stringify(manifest)); await writeFile(snapshot.manifestFile, bytes);
  await assert.rejects(verifyLocalDataSnapshot({ directory: snapshot.directory, expectedManifestSha256: digest(bytes) }), { code: 'INVALID_SNAPSHOT' });
});

test('credentials and installation ledger are excluded and block a copy without changing other providers', async t => {
  const f = await fixture(t), v1 = await f.source('v1');
  const provider = await f.put(f.directory, 'separate-codex/config.toml', 'model_provider="deepseek"\n[model_providers.openai]\nkeep=true\n');
  const ledger = await f.put(f.directory, 'installation/write-ledger.sqlite', 'existing-ledger-barrier');
  const auth = await f.put(v1.info.dataRoot, 'auth.json', 'do-not-copy-private-fixture-credential');
  await f.put(v1.info.dataRoot, 'write-ledger.sqlite', 'misplaced authority');
  const inventory = await inventoryLocalData(v1.info.dataRoot);
  assert.equal(inventory.excluded.length, 2); assert.equal(inventory.entries.length, 0);
  await assert.rejects(createLocalDataSnapshot({ source: f.publicSource(v1), directory: path.join(f.directory, 'blocked-snapshot'), expectedInventorySha256: inventory.inventorySha256 }), { code: 'SECURITY_FILE_PRESENT' });
  assert.equal(await readFile(auth, 'utf8'), 'do-not-copy-private-fixture-credential');
  assert.equal(await readFile(ledger, 'utf8'), 'existing-ledger-barrier');
  assert.equal(await readFile(provider, 'utf8'), 'model_provider="deepseek"\n[model_providers.openai]\nkeep=true\n');
});

test('links and overlapping snapshot roots cannot redirect local-state copies', async t => {
  const f = await fixture(t), v1 = await f.source('v1'); await f.put(v1.info.dataRoot, f.prefix + 'manual-naming.json', 'state');
  const inventory = await inventoryLocalData(v1.info.dataRoot);
  await assert.rejects(createLocalDataSnapshot({ source: f.publicSource(v1), directory: path.join(v1.info.dataRoot, 'nested-snapshot'), expectedInventorySha256: inventory.inventorySha256 }), { code: 'OVERLAPPING_DATA_ROOTS' });
  const outside = path.join(f.directory, 'outside'); await mkdir(outside); await f.put(outside, 'private.txt', 'outside state');
  try { await symlink(outside, path.join(v1.info.dataRoot, 'redirected'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (!['EPERM', 'EACCES'].includes(error.code)) throw error; t.diagnostic('Junction creation unavailable in this sandbox; direct overlap refusal is verified'); return; }
  await assert.rejects(inventoryLocalData(v1.info.dataRoot), { code: 'REDIRECTED_DATA_PATH' });
  const alias = path.join(f.directory, 'RegisteredAlias'); await symlink(f.project, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await registeredProjectDataBucket(alias)).bucket, f.bucket, 'registered project aliases canonicalize to the actual trusted project');
});

test('snapshot pre-read rejects oversized sparse files without reading their contents', async t => {
  const f = await fixture(t), v1 = await f.source('v1'), file = path.join(v1.info.dataRoot, 'oversized-cache');
  const handle = await open(file, 'w'); try { await handle.truncate(64 * 1024 * 1024 + 1); } finally { await handle.close(); }
  await assert.rejects(inventoryLocalData(v1.info.dataRoot), { code: 'DATA_LIMIT' });
});
