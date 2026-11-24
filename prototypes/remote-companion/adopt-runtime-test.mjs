import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, readdir, rm, lstat, rename, symlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { createRuntimeAdopter, readAdoptionRuntime, requestAdoptionStop } from './adopt-runtime.mjs';
import { createPairing, createRuntimeControl, revokePairing } from './lifecycle.mjs';
import { createCallerRecord, loadCallerRecord, CLIENT_LAUNCH_TEMPLATE } from './client-launch.mjs';
import { companionLaunchScript } from './build-runtime-release.mjs';
import { legacyAdapterDataRoot, registeredProjectDataBucket } from './local-data-upgrade.mjs';
import { Journal } from './journal.mjs';
import { WriteLedger } from './write-ledger.mjs';
import { OVERLAY_VERSION } from './freeze-adapter.mjs';

const run = promisify(execFile), sha = b => createHash('sha256').update(b).digest('hex');
const scratch = fileURLToPath(new URL('../../.scratch/', import.meta.url));
const win = { skip: process.platform !== 'win32' }, ps = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
async function put(root, relative, value) { const file = path.join(root, relative); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, value); return file; }
async function frozen(root, overlay = OVERLAY_VERSION) {
  await mkdir(root); const files = new Map([['prototypes/upstream-port/sidebar-server.mjs', 'export const fixture = true;\n'], ['vendor/mattskills-1.8.0-rc.7/LICENSE', 'Fixture license\n'], ['vendor/mattskills-1.8.0-rc.7/bundled-skills/LICENSE', 'Fixture license\n']]);
  for (let i = files.size; i < 450; i++) files.set('vendor/mattskills-1.8.0-rc.7/fixture-' + i + '.json', '{}\n');
  for (const [name, bytes] of files) await put(root, name, bytes);
  const manifest = Buffer.from(JSON.stringify({ schemaVersion: 1, ready: true, overlayVersion: overlay, adapterRelativePath: 'prototypes/upstream-port/sidebar-server.mjs', files: [...files].map(([name, value]) => ({ path: name, bytes: Buffer.byteLength(value), sha256: sha(value) })) }));
  await put(root, 'frozen-adapter.json', manifest); return { adapterPath: path.join(root, 'prototypes/upstream-port/sidebar-server.mjs'), pin: sha(manifest), files };
}
async function release(root, launchSource = '// fixture, never executed\n') {
  const f = await frozen(root), files = new Map(f.files);
  files.set('frozen-adapter.json', await readFile(path.join(root, 'frozen-adapter.json')));
  const runtime = { 'protocol.mjs': 'export const VERSION = 1;\n', 'freeze-adapter.mjs': "export const OVERLAY_VERSION = '" + OVERLAY_VERSION + "';\n",
    'client-launch.mjs': 'export const CLIENT_LAUNCH_TEMPLATE = String.raw`' + CLIENT_LAUNCH_TEMPLATE + '`;\n', 'launch.mjs': launchSource,
    'write-grant.mjs': "export const TRIAL_WRITE_METHODS = Object.freeze(['bind']);\n" };
  for (const [name, value] of Object.entries(runtime)) { await put(root, 'prototypes/remote-companion/' + name, value); files.set('prototypes/remote-companion/' + name, value); }
  files.set('start-companion.ps1', companionLaunchScript()); await put(root, 'start-companion.ps1', files.get('start-companion.ps1'));
  const manifest = Buffer.from(JSON.stringify({ schemaVersion: 1, kind: 'deck-client-launcher-release', releaseId: 'isolated-adoption-fixture', entrypoint: 'prototypes/remote-companion/client-launch.mjs', runtimeEntrypoint: 'prototypes/remote-companion/launch.mjs',
    sourceCommit: 'a'.repeat(40), protocolVersion: 1, overlayVersion: OVERLAY_VERSION, adapterRelativePath: 'prototypes/upstream-port/sidebar-server.mjs', adapterManifestSha256: f.pin,
    files: [...files].map(([name, bytes]) => ({ path: name, bytes: Buffer.byteLength(bytes), sha256: sha(bytes) })) }));
  await put(root, 'client-release.json', manifest); return { directory: root, expectedManifestSha256: sha(manifest), adapterPin: f.pin };
}
async function fixture(t, { stable = false, withLedger = false, launchSource } = {}) {
  await mkdir(scratch, { recursive: true }); const root = await mkdtemp(path.join(scratch, 'adopt runtime test ')); let control;
  t.after(async () => { await control?.close(); assert.equal(path.dirname(root), scratch.replace(/[\\/]$/, '')); assert.ok(path.basename(root).startsWith('adopt runtime test ')); assert.ok((await lstat(root)).isDirectory()); await rm(root, { recursive: true, force: true, maxRetries: 5 }); });
  const known = { localAppData: path.join(root, 'fake LocalAppData'), startup: path.join(root, 'temporary Startup'), desktop: path.join(root, 'temporary Desktop'), userProfile: path.join(root, 'fake profile') };
  for (const d of Object.values(known)) await mkdir(d);
  const project = path.join(root, 'registered project'); await mkdir(project); const bucket = (await registeredProjectDataBucket(project)).bucket;
  const target = await release(path.join(root, 'fixed target package'), launchSource), old = stable ? { adapterPath: path.join(target.directory, 'prototypes/upstream-port/sidebar-server.mjs'), pin: target.adapterPin } : await frozen(path.join(root, 'old remote runtime'), 'choices-data-root-v1');
  const mainAdapter = await put(root, 'main runtime/prototypes/upstream-port/sidebar-server.mjs', '// main fixture, never run\n'), main = await legacyAdapterDataRoot(mainAdapter), remote = await legacyAdapterDataRoot(old.adapterPath);
  const data = stable ? path.join(root, 'existing stable data') : main.dataRoot; await mkdir(data, { recursive: true }); await mkdir(remote.dataRoot, { recursive: true });
  const business = 'projects/' + bucket + '/.dsh/mattskillsdeck/choices.json'; await put(data, business, '{"rev":1,"fixture":"main"}\n');
  const journalFile = path.join(root, 'original journal.sqlite'), journal = new Journal(journalFile);
  journal.db.prepare("INSERT INTO operations VALUES ('retained','fingerprint','thread','completed','{\"fixture\":true}',1)").run(); journal.db.prepare("INSERT INTO settings VALUES ('fixture-marker','retained')").run(); journal.close();
  const pairingFile = path.join(root, 'canonical pairing.json'), device = randomBytes(32).toString('hex'), callerToken = randomBytes(32).toString('hex'), callerFile = path.join(root, 'original caller.json');
  await createPairing({ file: pairingFile, relayOrigin: 'https://fixture.example.invalid', adapterPath: old.adapterPath, journalPath: journalFile, deviceToken: device,
    baseline: { directory: stable ? target.directory : path.resolve(old.adapterPath, '../../..'), manifestSha256: old.pin }, ...(stable ? { localDataRoot: data } : {}) });
  const caller = await createCallerRecord({ file: callerFile, callerToken });
  const startup = path.join(known.startup, 'Deck Companion-' + JSON.parse(await readFile(pairingFile)).pairingId + '.lnk'), desktop = path.join(known.desktop, 'Deck Codex Remote-' + caller.credentialId + '.lnk');
  // Existing shortcut bytes are retained verbatim; new ones are real COM .lnk.
  await writeFile(startup, 'old startup retained'); await writeFile(desktop, 'old desktop retained');
  const ledgerFile = path.join(known.localAppData, 'MattSkillsDeck/RemoteCompanion/write-ledger.sqlite');
  if (withLedger) { await mkdir(path.dirname(ledgerFile), { recursive: true }); const db = new WriteLedger(ledgerFile); db.close(); }
  const state = { registryRevision: 1, extraRoots: [], cloudVersion: 1, codex: [], producers: [] };
  const local = { knownFolders: async () => known, registry: async () => ({ roots: [project, ...state.extraRoots], sha256: sha(String(state.registryRevision)) }), processes: async () => ({ codex: state.codex, producers: state.producers }),
    probeCloud: async () => ({ verified: state.cloudVersion !== null, protocolVersion: state.cloudVersion }) };
  const options = { mode: stable ? 'full-code-update' : 'initial-readonly-adoption', dataSchemaVersion: 1, pairingFile, callerFile, targetRelease: target,
    ...(stable ? { sourceRelease: target } : { sources: [{ id: 'main-local', adapterPath: mainAdapter }, { id: 'remote-v1', adapterPath: old.adapterPath }] }) };
  if (!stable) {
    const legacy = path.join(root, 'old fixed companion core'); await mkdir(legacy); const files = [];
    for (let i = 0; i < 18; i++) { const relative = 'prototypes/remote-companion/fixture-' + i + '.mjs', bytes = '// old inert fixed core ' + i + '\n'; await put(legacy, relative, bytes); files.push({ path: relative, bytes: Buffer.byteLength(bytes), sha256: sha(bytes) }); }
    const manifest = JSON.stringify({ sourceCommit: 'b'.repeat(40), byteExact: true, files }); await put(legacy, 'bundle-manifest.json', manifest); options.legacyRuntimePin = { directory: legacy, manifestSha256: sha(manifest) };
  }
  const startOldControl = async () => { control = await createRuntimeControl(pairingFile, { intervalMs: 25, onStop: async () => control.close() }); await control.setState('connected'); return control; };
  return { root, known, project, business, data, remote, options, local, state, pairingFile, callerFile, ledgerFile, startup, desktop, journalFile, callerToken, startOldControl };
}
async function apply(f, extra = {}) { const a = await createRuntimeAdopter(f.options, { ...f.local, ...extra }), p = await a.plan(); assert.deepEqual(p.publicPlan.blockers, []); return { a, p, result: await a.apply({ planDigest: p.planDigest, confirmation: 'APPLY ' + p.planDigest }) }; }

test('retire-start requires a preserved pre-reboot checkpoint, keeps unknown evidence and never stops the new instance', win, async t => {
  const f = await fixture(t);
  const previousUtc = new Date(Date.now() - 3600000).toISOString();
  let boot = { previousId: 90, previousUtc, currentId: 90, currentUtc: previousUtc, osBootUtc: previousUtc };
  const { a, result } = await apply(f, {
    bootHistory: async () => boot,
    startPinned: async () => { throw Object.assign(new Error('Fixture lost ownership proof'), { code: 'START_PROCESS_IDENTITY_UNAVAILABLE' }); },
  });
  await assert.rejects(a.start({ ...result, confirmation: 'START ' + result.receiptSha256 }), { startOutcome: 'unknown' });
  const marker = f.pairingFile + '.adopt-start.json', original = await readFile(marker);
  const checkpointFile = path.join(f.root, 'pre-restart.json');
  await a.checkpointStart(checkpointFile);
  const witness = JSON.parse(await readFile(checkpointFile));
  await assert.rejects(a.retirePreviousStart({ checkpointFile }), { code: 'DISTINCT_LATER_BOOT_REQUIRED' });
  const blocked = async () => (await a.planRollback(result)).blockers.includes('start-outcome-unresolved');
  assert.equal(await blocked(), true);
  const alias = path.join(f.root, 'rewritten.json');
  await writeFile(alias, JSON.stringify({ ...witness, attemptSha256: '0'.repeat(64) }));
  await assert.rejects(a.retirePreviousStart({ checkpointFile: alias }), { code: 'REBOOT_CHECKPOINT_MISMATCH' });
  const now = new Date().toISOString();
  boot = { ...boot, nextId: 100, nextUtc: now, currentId: 100, currentUtc: now, osBootUtc: now };
  await assert.rejects(a.checkpointStart(path.join(f.root, 'late.json')), { code: 'CHECKPOINT_MUST_BE_CAPTURED_IN_START_BOOT' });
  const live = await f.startOldControl(); t.after(() => live.close());
  const plan = await a.retirePreviousStart({ checkpointFile });
  assert.equal(await blocked(), true);
  await assert.rejects(a.retirePreviousStart({ checkpointFile, confirmation: 'RETIRE wrong' }), { code: 'EXPLICIT_RETIRE_REQUIRED' });
  const confirm = { checkpointFile, confirmation: 'RETIRE ' + plan.digest };
  assert.equal((await a.retirePreviousStart(confirm)).status, 'retired-after-reboot');
  assert.equal((await a.retirePreviousStart(confirm)).runtimeStopped, false);
  assert.equal(await blocked(), false);
  assert.equal((await readAdoptionRuntime(f.pairingFile)).instanceId, live.instanceId);
  assert.deepEqual(await readFile(marker), original);
  await writeFile(alias, JSON.stringify(witness));
  await assert.rejects(a.retirePreviousStart({ checkpointFile: alias }), { code: 'CHECKPOINT_NOT_PRESERVED_FROM_PRIOR_BOOT' });
  const later = new Date().toISOString();
  boot = { ...boot, currentId: 110, currentUtc: later, osBootUtc: later };
  assert.equal((await a.retirePreviousStart({ checkpointFile })).digest, plan.digest);
  await assert.rejects(a.retirePreviousStart({ checkpointFile: alias }), { code: 'CHECKPOINT_NOT_PRESERVED_FROM_PRIOR_BOOT' });
  await writeFile(checkpointFile, JSON.stringify({ ...witness, receiptSha256: '0'.repeat(64) }));
  assert.equal(await blocked(), true, 'modified witness invalidates a published retirement');
});

test('two-source readonly adoption exact-stops old runtime, snapshots both, copies DPAPI/SQLite history, switches real temporary links and safely rolls back', win, async t => {
  const f = await fixture(t); await f.startOldControl(); const originalPair = await readFile(f.pairingFile), originalCaller = await readFile(f.callerFile);
  const { a, result } = await apply(f); assert.equal(result.status, 'adopted-stopped'); const receipt = JSON.parse(await readFile(result.receiptFile)); assert.equal(receipt.snapshots.length, 2);
  const paired = JSON.parse(await readFile(f.pairingFile)); assert.equal(paired.secretDPAPI, JSON.parse(originalPair).secretDPAPI); assert.equal(paired.writeEnabled, false); assert.equal(paired.pairingId, JSON.parse(originalPair).pairingId);
  assert.equal(await lstat(f.ledgerFile).then(() => true, () => false), false, 'readonly initial adoption never creates global ledger');
  assert.equal(await readFile(path.join(paired.localDataRoot, f.business), 'utf8'), '{"rev":1,"fixture":"main"}\n'); assert.deepEqual(await readFile(path.join(receipt.operation, 'caller.json')), originalCaller);
  assert.equal((await loadCallerRecord(path.join(receipt.operation, 'caller.json'), { decrypt: true })).callerToken, f.callerToken);
  const copied = new DatabaseSync(paired.journalPath, { readOnly: true }); assert.equal(copied.prepare('SELECT count(*) n FROM operations').get().n, 1); assert.equal(copied.prepare("SELECT value FROM settings WHERE key='fixture-marker'").get().value, 'retained'); copied.close();
  const inspect = "$s=New-Object -ComObject WScript.Shell;$l=$s.CreateShortcut('" + f.startup.replace(/'/g, "''") + "');@{target=$l.TargetPath;arguments=$l.Arguments}|ConvertTo-Json -Compress";
  const link = JSON.parse((await run(ps, ['-NoProfile', '-NonInteractive', '-Command', inspect], { windowsHide: true })).stdout);
  assert.ok(link.arguments.includes(path.join(receipt.versionDirectory, 'start-companion.ps1'))); assert.ok(link.arguments.includes(receipt.releaseManifestSha256)); assert.ok(link.arguments.includes(f.pairingFile));
  assert.ok(link.arguments.includes('10c3') === false); assert.ok(link.arguments.includes('ManifestSha256')); assert.ok(!link.arguments.includes(f.callerToken));
  const latestJournal = new DatabaseSync(paired.journalPath); latestJournal.prepare("INSERT INTO operations VALUES ('new-completed','fingerprint2','thread','completed','{}',2)").run(); latestJournal.close();
  const rp = await a.planRollback(result); assert.deepEqual(rp.blockers, []); await a.rollback({ ...result, planDigest: rp.planDigest, confirmation: 'ROLLBACK ' + rp.planDigest });
  const restored = JSON.parse(await readFile(f.pairingFile)), original = JSON.parse(originalPair); assert.equal(restored.secretDPAPI, original.secretDPAPI); assert.deepEqual(restored.baseline, original.baseline); assert.equal(restored.journalPath, paired.journalPath);
  assert.deepEqual(await readFile(receipt.changes[0].backup), originalPair); assert.equal(await readFile(f.startup, 'utf8'), 'old startup retained'); assert.equal(await readFile(f.desktop, 'utf8'), 'old desktop retained');
  const retainedJournal = new DatabaseSync(restored.journalPath, { readOnly: true }); assert.equal(retainedJournal.prepare("SELECT state FROM operations WHERE id='new-completed'").get().state, 'completed'); retainedJournal.close();
  assert.ok(await lstat(paired.localDataRoot)); assert.ok(await lstat(f.data));
});

test('process, registry, source ABA and explicit confirmation gates fail closed before shortcut/config mutation', win, async t => {
  const f = await fixture(t), original = await readFile(f.pairingFile), a = await createRuntimeAdopter(f.options, f.local), p = await a.plan();
  await assert.rejects(a.apply({ planDigest: p.planDigest, confirmation: 'APPLY wrong' }), { code: 'EXPLICIT_LOCAL_APPLY_REQUIRED' });
  f.state.codex = [123]; await assert.rejects(a.apply({ planDigest: p.planDigest, confirmation: 'APPLY ' + p.planDigest }), { code: 'CODEX_AND_MAIN_PRODUCERS_MUST_EXIT_NORMALLY' }); assert.deepEqual(await readFile(f.pairingFile), original);
  f.state.codex = []; const b = await createRuntimeAdopter(f.options, f.local), q = await b.plan(); f.state.registryRevision++; await assert.rejects(b.apply({ planDigest: q.planDigest, confirmation: 'APPLY ' + q.planDigest }), { code: 'PLAN_INPUT_CHANGED' });
  const c = await createRuntimeAdopter(f.options, f.local), r = await c.plan(); const bytes = await readFile(path.join(f.data, f.business)); await writeFile(path.join(f.data, f.business), bytes); await assert.rejects(c.apply({ planDigest: r.planDigest, confirmation: 'APPLY ' + r.planDigest }), { code: 'PLAN_INPUT_CHANGED' });
});

test('unclassified registered state, business conflicts and global unknown prevent activation', win, async t => {
  const f = await fixture(t, { withLedger: true }); await put(f.data, 'projects/' + (await registeredProjectDataBucket(f.project)).bucket + '/unknown-business.json', '{}');
  let a = await createRuntimeAdopter(f.options, f.local), p = await a.plan(); assert.ok(p.publicPlan.blockers.includes('unclassified-registered-state'));
  const db = new DatabaseSync(f.ledgerFile); db.prepare("INSERT INTO write_ledger(operation_id,project_hash,owner_hash,intent_json,intent_hash,state,created_at,updated_at) VALUES ('unrelated-project','p','o','{}','h','unknown',1,1)").run(); db.close();
  a = await createRuntimeAdopter(f.options, f.local); p = await a.plan(); assert.ok(p.publicPlan.blockers.includes('global-ledger-unresolved')); await assert.rejects(a.apply({ planDigest: p.planDigest, confirmation: 'APPLY ' + p.planDigest }), { code: 'ADOPTION_PLAN_BLOCKED' });
  await put(f.remote.dataRoot, f.business, '{"rev":9}\n'); a = await createRuntimeAdopter(f.options, f.local); assert.ok((await a.plan()).publicPlan.blockers.includes('business-conflict'));
});

test('revocation during preparation never revives canonical pairing; concurrent shortcut edit is preserved and partial receipt can restore only owned config', win, async t => {
  const f = await fixture(t); const a = await createRuntimeAdopter(f.options, { ...f.local, beforeCommit: async () => revokePairing(f.pairingFile) }), p = await a.plan();
  await assert.rejects(a.apply({ planDigest: p.planDigest, confirmation: 'APPLY ' + p.planDigest }), { code: 'PAIRING_REVOKED' }); assert.ok(await lstat(f.pairingFile + '.revoked')); assert.equal(await readFile(f.startup, 'utf8'), 'old startup retained');
  const g = await fixture(t), b = await createRuntimeAdopter(g.options, { ...g.local, beforeClaim: async file => { if (file === g.startup) await writeFile(file, 'USER CONCURRENT EDIT'); } }), q = await b.plan();
  await assert.rejects(b.apply({ planDigest: q.planDigest, confirmation: 'APPLY ' + q.planDigest })); assert.equal(await readFile(g.startup, 'utf8'), 'USER CONCURRENT EDIT');
  const operation = path.join(g.known.localAppData, 'MattSkillsDeck/RemoteCompanion/generations', b.options.operationId), failure = (await readdir(operation)).find(n => n.startsWith('failure-'));
  const recovery = { receiptFile: path.join(operation, failure), receiptSha256: sha(await readFile(path.join(operation, failure))) }, rp = await b.planRollback(recovery); assert.deepEqual(rp.blockers, []);
  await b.rollback({ ...recovery, planDigest: rp.planDigest, confirmation: 'ROLLBACK ' + rp.planDigest }); assert.equal(await readFile(g.startup, 'utf8'), 'USER CONCURRENT EDIT');
});

test('saved plans are not mutable authorization; root unknown requires exact archive-only approval and cloud mismatch blocks', win, async t => {
  const f = await fixture(t), unknown = await put(f.data, 'root-unknown.json', '{"fixture":true}\n'), a = await createRuntimeAdopter(f.options, f.local), p = await a.plan();
  assert.ok(p.publicPlan.blockers.includes('unclassified-registered-state')); p.privatePlan.blockers.length = 0; p.publicPlan.blockers.length = 0;
  await assert.rejects(a.apply({ planDigest: p.planDigest, confirmation: 'APPLY ' + p.planDigest }), { code: 'ADOPTION_PLAN_BLOCKED' });
  const approved = { ...f.options, archiveOnly: [{ sourceId: 'main-local', path: 'root-unknown.json', sha256: sha(await readFile(unknown)), classification: 'diagnostic', reason: 'Owned test-only diagnostic, archive without activation' }] };
  const b = await createRuntimeAdopter(approved, f.local); assert.deepEqual((await b.plan()).publicPlan.blockers, []);
  f.state.cloudVersion = 2; assert.ok((await b.plan()).publicPlan.blockers.includes('cloud-protocol-unverified-or-incompatible')); f.state.cloudVersion = null;
  assert.ok((await b.plan()).publicPlan.blockers.includes('cloud-protocol-unverified-or-incompatible'));
});

test('post-snapshot source drift is caught before CAS; published CAS failure retains recovery proof', win, async t => {
  const f = await fixture(t), a = await createRuntimeAdopter(f.options, { ...f.local, beforeCommit: async () => writeFile(path.join(f.data, f.business), '{"rev":2}\n') }), p = await a.plan();
  await assert.rejects(a.apply({ planDigest: p.planDigest, confirmation: 'APPLY ' + p.planDigest }), { code: 'SOURCE_OR_CODE_CHANGED_DURING_PREPARATION' }); assert.equal(await readFile(f.startup, 'utf8'), 'old startup retained');
  const g = await fixture(t), b = await createRuntimeAdopter(g.options, { ...g.local, afterPublish: async file => { if (file === g.pairingFile) throw Object.assign(new Error('test after link'), { code: 'TEST_AFTER_LINK' }); } }), q = await b.plan(); let failure;
  await assert.rejects(b.apply({ planDigest: q.planDigest, confirmation: 'APPLY ' + q.planDigest }), e => { failure = e; return e.code === 'TEST_AFTER_LINK' && e.recoveryRequired; });
  const name = (await readdir(failure.operation)).find(n => n.startsWith('failure-')), receiptFile = path.join(failure.operation, name), request = { receiptFile, receiptSha256: sha(await readFile(receiptFile)) };
  const receipt = JSON.parse(await readFile(receiptFile)); assert.equal(receipt.changes.length, 1); assert.equal(receipt.changes[0].published, true); assert.ok(receipt.changes[0].preparedIdentity);
  const rp = await b.planRollback(request); assert.deepEqual(rp.blockers, []); await b.rollback({ ...request, planDigest: rp.planDigest, confirmation: 'ROLLBACK ' + rp.planDigest });
});

test('legacy rollback checks new registered buckets; full-code rollback rechecks old code and missing global ledger blocks START/rollback', win, async t => {
  const f = await fixture(t), adopted = await apply(f), paired = JSON.parse(await readFile(f.pairingFile)), project = path.join(f.root, 'new registered project'); await mkdir(project);
  f.state.extraRoots.push(project); f.state.registryRevision++; const bucket = (await registeredProjectDataBucket(project)).bucket; await put(paired.localDataRoot, 'projects/' + bucket + '/.dsh/mattskillsdeck/choices.json', '{}');
  const legacy = await adopted.a.planRollback(adopted.result); assert.ok(legacy.blockers.includes('legacy-rollback-registry-changed')); assert.ok(legacy.blockers.includes('legacy-rollback-new-business'));
  const g = await fixture(t, { stable: true, withLedger: true }); let starts = 0; const updated = await apply(g, { startPinned: async () => { starts++; throw Error('must not start'); } });
  await rename(g.ledgerFile, g.ledgerFile + '.retained'); const missing = await updated.a.planRollback(updated.result); assert.ok(missing.blockers.includes('installation-ledger-missing'));
  await assert.rejects(updated.a.start({ ...updated.result, confirmation: 'START ' + updated.result.receiptSha256 }), { code: 'START_LEDGER_NOT_SAFE' }); assert.equal(starts, 0); assert.equal(await lstat(g.ledgerFile).then(() => true, () => false), false);
  await rename(g.ledgerFile + '.retained', g.ledgerFile); await writeFile(path.join(g.options.sourceRelease.directory, 'prototypes/remote-companion/launch.mjs'), '// OLD CODE DRIFT');
  assert.ok((await updated.a.planRollback(updated.result)).blockers.includes('old-code-pin-drift'));
});

test('redirected installation ancestors are rejected before any adoption writes', win, async t => {
  const f = await fixture(t), base = path.join(f.known.localAppData, 'MattSkillsDeck/RemoteCompanion'), redirected = path.join(f.root, 'junction target'); await mkdir(base, { recursive: true }); await mkdir(redirected);
  await symlink(redirected, path.join(base, 'generations'), 'junction'); await assert.rejects(createRuntimeAdopter(f.options, f.local), { code: 'REDIRECTED_LOCAL_PATH' }); assert.deepEqual(await readdir(redirected), []);
});

test('native Windows START runs the pinned PowerShell script and verifies the Node child it launched', win, async t => {
  const launchSource = `
    import { createRuntimeControl } from ${JSON.stringify(new URL('./lifecycle.mjs', import.meta.url).href)};
    const control = await createRuntimeControl(process.argv[3], { intervalMs: 100, onStop: stop });
    const timeout = setTimeout(stop, 30000);
    async function stop() { clearTimeout(timeout); await control.close(); }
    await control.setState('connected');
  `;
  const f = await fixture(t, { launchSource });
  const { a, result } = await apply(f);
  const connected = await a.start({ ...result, confirmation: 'START ' + result.receiptSha256 });
  assert.equal(connected.status, 'connected');
  const owner = await readAdoptionRuntime(f.pairingFile);
  assert.equal(owner.instanceId, connected.instanceId);
  assert.notEqual(owner.pid, process.pid);
  const attempt = JSON.parse(await readFile(f.pairingFile + '.adopt-start.json', 'utf8'));
  assert.equal(attempt.spawnedPid, attempt.proof.pid);
  assert.equal((await requestAdoptionStop(f.pairingFile, connected.instanceId)).requested, true);
  const deadline = Date.now() + 10000;
  while (await readAdoptionRuntime(f.pairingFile)) {
    assert.ok(Date.now() < deadline, 'fixture child must release its own runtime');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
});

test('explicit START observes owned connected state; failed secondary read exact-stops owned instance and late start keeps a drainable unknown barrier', win, async t => {
  const f = await fixture(t); let live;
  t.after(async () => live?.close());
  const activated = await apply(f, { startPinned: async () => {
    live = await createRuntimeControl(f.pairingFile, { intervalMs: 25, onStop: async () => live.close() }); await live.setState('connected');
    return { owns: active => active?.instanceId === live.instanceId, ended: async () => !await lstat(f.pairingFile + '.runtime.json').then(() => true, () => false) };
  } });
  const connected = await activated.a.start({ ...activated.result, confirmation: 'START ' + activated.result.receiptSha256 }); assert.equal(connected.status, 'connected'); assert.equal(connected.realCodexStarted, false);
  const rollback = await activated.a.planRollback(activated.result); await activated.a.rollback({ ...activated.result, planDigest: rollback.planDigest, confirmation: 'ROLLBACK ' + rollback.planDigest });
  const g = await fixture(t); let late, pending, releaseLate;
  const lateGate = new Promise(resolve => { releaseLate = resolve; });
  t.after(async () => { releaseLate(); await pending; await late?.close(); });
  const delayed = await apply(g, { startTimeoutMs: 10, startPinned: async () => {
    pending = (async () => { await lateGate; late = await createRuntimeControl(g.pairingFile, { intervalMs: 25, onStop: async () => late.close() }); await late.setState('connected'); })();
    return { owns: active => late && active?.instanceId === late.instanceId, ended: async () => false };
  } }); let unknown;
  await assert.rejects(delayed.a.start({ ...delayed.result, confirmation: 'START ' + delayed.result.receiptSha256 }), e => { unknown = e; return e.startOutcome === 'unknown'; });
  assert.equal(late, undefined, 'late instance is released only after the unknown outcome was durably returned');
  releaseLate(); await pending; assert.ok((await delayed.a.planRollback(delayed.result)).blockers.includes('start-outcome-unresolved'));
  const drained = await delayed.a.drainStart({ attemptFile: unknown.startAttemptFile, attemptSha256: unknown.startAttemptSha256, confirmation: 'DRAIN ' + unknown.startAttemptSha256 }); assert.equal(drained.status, 'stopped');
  const h = await fixture(t); let failing;
  t.after(async () => failing?.close());
  const missing = await apply(h, { startPinned: async () => {
    failing = await createRuntimeControl(h.pairingFile, { intervalMs: 25, onStop: async () => failing.close() }); await failing.setState('connected'); await rename(h.journalFile, h.journalFile + '.retained');
    return { owns: active => active?.instanceId === failing.instanceId, ended: async () => false };
  } });
  await assert.rejects(missing.a.start({ ...missing.result, confirmation: 'START ' + missing.result.receiptSha256 }), e => e.startOutcome === 'stopped'); assert.equal(await lstat(h.pairingFile + '.runtime.json').then(() => true, () => false), false);
  const i = await fixture(t); let appearedInCatch, readPhase = 'inactive', catchReads = 0, exactStops = 0;
  t.after(async () => appearedInCatch?.close());
  const caught = await apply(i, { startTimeoutMs: 1, runtime: {
    async read(file) {
      if (readPhase === 'initial-no-owner') { readPhase = 'catch-owner'; await new Promise(resolve => setTimeout(resolve, 10)); return null; }
      if (readPhase === 'catch-owner') { readPhase = 'active'; catchReads++; appearedInCatch = await createRuntimeControl(file, { intervalMs: 25, onStop: async () => appearedInCatch.close() }); await appearedInCatch.setState('connected'); }
      return readAdoptionRuntime(file);
    },
    async stop(file, expectedInstanceId) { assert.equal(expectedInstanceId, appearedInCatch.instanceId); exactStops++; return requestAdoptionStop(file, expectedInstanceId); },
    claim: file => createRuntimeControl(file, { intervalMs: 25 })
  }, startPinned: async () => { readPhase = 'initial-no-owner'; return { owns: active => active?.instanceId === appearedInCatch?.instanceId, ended: async () => false }; } });
  await assert.rejects(caught.a.start({ ...caught.result, confirmation: 'START ' + caught.result.receiptSha256 }), e => e.code === 'START_NOT_CONNECTED' && e.startOutcome === 'stopped');
  assert.equal(catchReads, 1); assert.equal(exactStops, 1); assert.equal(await readAdoptionRuntime(i.pairingFile), null);
});

test('concurrent START binds its first marker observation and never overwrites another pending dispatch', win, async t => {
  const f = await fixture(t); let live, enterA, readyB, releaseA;
  t.after(async () => live?.close());
  const enteredA = new Promise(r => { enterA = r; }), bReady = new Promise(r => { readyB = r; }), aRelease = new Promise(r => { releaseA = r; });
  const adopted = await apply(f, { startPinned: async () => { enterA(); await aRelease; live = await createRuntimeControl(f.pairingFile, { intervalMs: 25, onStop: async () => live.close() }); await live.setState('connected');
    return { owns: active => active?.instanceId === live.instanceId, ended: async () => false }; } });
  let secondDispatches = 0;
  const other = await createRuntimeAdopter(adopted.a.options, { ...f.local, processes: async () => { readyB(); await enteredA; return { codex: [], producers: [] }; }, startPinned: async () => { secondDispatches++; throw Error('must not dispatch twice'); } });
  const b = other.start({ ...adopted.result, confirmation: 'START ' + adopted.result.receiptSha256 }); await bReady;
  const a = adopted.a.start({ ...adopted.result, confirmation: 'START ' + adopted.result.receiptSha256 });
  await assert.rejects(b, { code: 'CAS_IDENTITY_CHANGED' }); assert.equal(secondDispatches, 0); releaseA(); assert.equal((await a).status, 'connected');
});

test('fd-pinned reader never invents a stopped owner during high-frequency real heartbeat replacement', win, async t => {
  const f = await fixture(t); let unexpectedStop = 0;
  const control = await createRuntimeControl(f.pairingFile, { intervalMs: 1, onStop: async () => { unexpectedStop++; } });
  t.after(() => control.close()); await control.setState('connected');
  const initial = await readAdoptionRuntime(f.pairingFile); let last = initial;
  for (let i = 0; i < 300; i++) {
    const actual = await readAdoptionRuntime(f.pairingFile); assert.equal(actual?.instanceId, control.instanceId, 'a heartbeat is not an ownership release');
    last = actual;
  }
  assert.ok(last.updatedAt > initial.updatedAt, 'successful heartbeat publications must advance, rather than repeatedly reading a stale record');
  assert.equal(unexpectedStop, 0); await control.close(); assert.equal(await readAdoptionRuntime(f.pairingFile), null);
});

test('bound stop publishes only reviewed A even if B replaces ownership after the read', win, async t => {
  const f = await fixture(t); let b, stoppedB = 0;
  t.after(async () => b?.close());
  const a = await createRuntimeControl(f.pairingFile, { intervalMs: 25 }); await a.setState('connected');
  const result = await requestAdoptionStop(f.pairingFile, a.instanceId, { beforePublish: async () => {
    await a.close(); b = await createRuntimeControl(f.pairingFile, { intervalMs: 10, onStop: async () => { stoppedB++; await b.close(); } }); await b.setState('connected');
  } });
  assert.equal(result.instanceId, a.instanceId); assert.equal(JSON.parse(await readFile(f.pairingFile + '.stop.json')).instanceId, a.instanceId);
  await new Promise(resolve => setTimeout(resolve, 100)); assert.equal(stoppedB, 0); assert.equal((await readAdoptionRuntime(f.pairingFile)).instanceId, b.instanceId);
});

async function heartbeatFixture(t) {
  await mkdir(scratch, { recursive: true }); const root = await mkdtemp(path.join(scratch, 'heartbeat retry test '));
  t.after(async () => { assert.equal(path.dirname(root), scratch.replace(/[\\/]$/, '')); assert.ok(path.basename(root).startsWith('heartbeat retry test ')); await rm(root, { recursive: true, force: true, maxRetries: 5 }); });
  const file = path.join(root, 'pair.json'), adapter = await put(root, 'sidebar.mjs', '// control only, never executed\n');
  await createPairing({ file, relayOrigin: 'https://fixture.example.invalid', adapterPath: adapter, journalPath: path.join(root, 'journal.sqlite'), deviceToken: randomBytes(32).toString('hex') }); return file;
}
test('heartbeat transient native sharing failure recovers; persistent failure and foreign owner still stop conservatively', win, async t => {
  const file = await heartbeatFixture(t); let failures = 2, attempts = 0, stops = 0;
  const recovered = await createRuntimeControl(file, { intervalMs: 10000, onStop: async () => { stops++; }, heartbeatRetryDelayMs: 1, heartbeatRename: async (from, to) => {
    attempts++; if (failures-- > 0) throw Object.assign(new Error('fixture sharing conflict'), { code: 'EPERM' }); return rename(from, to);
  } }); t.after(() => recovered.close()); await recovered.setState('connected'); assert.equal(attempts, 3); assert.equal(stops, 0); assert.equal((await readAdoptionRuntime(file)).state, 'connected'); await recovered.close();
  let persistentStops = 0;
  const persistent = await createRuntimeControl(file, { intervalMs: 5, heartbeatRetries: 3, heartbeatRetryDelayMs: 1, heartbeatRename: async () => { throw Object.assign(new Error('persistent fixture'), { code: 'EACCES' }); }, onStop: async () => { persistentStops++; } });
  t.after(() => persistent.close()); await new Promise(resolve => setTimeout(resolve, 80)); assert.equal(persistentStops, 1); await persistent.close();
  let replaced = false, changedStops = 0; const foreign = '00000000-0000-4000-8000-000000000001';
  const changed = await createRuntimeControl(file, { intervalMs: 10000, heartbeatRetryDelayMs: 1, heartbeatRename: async () => {
    replaced = true; const record = JSON.parse(await readFile(file + '.runtime.json')); await writeFile(file + '.runtime.json', JSON.stringify({ ...record, instanceId: foreign })); throw Object.assign(new Error('sharing before ownership change'), { code: 'EBUSY' });
  }, onStop: async () => { changedStops++; } }); t.after(() => changed.close());
  await assert.rejects(changed.setState('connected'), /Runtime ownership changed/); assert.equal(replaced, true); assert.equal((await readAdoptionRuntime(file)).instanceId, foreign); await changed.close(); assert.equal((await readAdoptionRuntime(file)).instanceId, foreign);
  const revokedFile = await heartbeatFixture(t); let revocations = 0, revokedStops = 0;
  const revoked = await createRuntimeControl(revokedFile, { intervalMs: 5, heartbeatRetries: 2, heartbeatRetryDelayMs: 1,
    heartbeatRename: async () => { throw Object.assign(new Error('persistent revoked fixture'), { code: 'EPERM' }); },
    onRevoke: async () => { revocations++; }, onStop: async () => { revokedStops++; } });
  t.after(() => revoked.close()); await writeFile(revokedFile + '.revoked', '{"revoked":true}\n');
  await new Promise(resolve => setTimeout(resolve, 80)); assert.equal(revocations, 1, 'status retry exhaustion cannot suppress authoritative revocation'); assert.equal(revokedStops, 0); await revoked.close();
  const fatalFile = await heartbeatFixture(t); let fatalAttempts = 0;
  const fatal = await createRuntimeControl(fatalFile, { intervalMs: 10000, heartbeatRename: async () => { fatalAttempts++; throw Object.assign(new Error('non-transient fixture'), { code: 'EIO' }); } });
  t.after(() => fatal.close()); await assert.rejects(fatal.setState('connected'), { code: 'EIO' }); assert.equal(fatalAttempts, 1); await fatal.close();
});

test('closing during a heartbeat retry neither publishes late nor removes a foreign owner', win, async t => {
  const file = await heartbeatFixture(t); let closePending, instance, calls = 0;
  const foreign = '00000000-0000-4000-8000-000000000002';
  instance = await createRuntimeControl(file, { intervalMs: 10000, heartbeatRetryDelayMs: 1, heartbeatRename: async () => {
    calls++; closePending = instance.close(); const record = JSON.parse(await readFile(file + '.runtime.json')); await writeFile(file + '.runtime.json', JSON.stringify({ ...record, instanceId: foreign })); throw Object.assign(new Error('fixture close during sharing conflict'), { code: 'EPERM' });
  } }); t.after(() => instance.close()); await instance.setState('connected'); await closePending;
  assert.equal(calls, 1); assert.equal((await readAdoptionRuntime(file)).instanceId, foreign);
});

test('legacy rollback blocks new durable state; stable full-code rollback keeps latest shared business and fixed existing ledger', win, async t => {
  const f = await fixture(t);
  const projectFolder = path.posix.dirname(path.posix.dirname(path.posix.dirname(f.business)));
  const log = path.posix.join(projectFolder, '.dsh-mattskillsdeck-cache/logs/fixture.log');
  await put(f.data, log, 'baseline\n');
  const applied = await apply(f), config = JSON.parse(await readFile(f.pairingFile));
  await put(config.localDataRoot, log, 'baseline\nstable event\n');
  await put(f.data, log, 'baseline\nlegacy event\n');
  await put(f.data, f.business, '{"rev":2}\n');
  const connected = await f.startOldControl();
  const blocked = await applied.a.planRollback(applied.result);
  assert.deepEqual(blocked.blockers.sort(), ['legacy-rollback-new-business', 'legacy-source-changed']);
  await assert.rejects(applied.a.rollback({ ...applied.result, planDigest: blocked.planDigest, confirmation: 'ROLLBACK ' + blocked.planDigest }), { code: 'EXPLICIT_UNBLOCKED_ROLLBACK_REQUIRED' });
  assert.equal((await readAdoptionRuntime(f.pairingFile)).instanceId, connected.instanceId);
  assert.equal(await readFile(path.join(config.localDataRoot, log), 'utf8'), 'baseline\nstable event\n');
  assert.equal(await readFile(path.join(f.data, log), 'utf8'), 'baseline\nlegacy event\n');
  assert.deepEqual(JSON.parse(await readFile(path.join(f.data, f.business))), { rev: 2 });
  const receipt = JSON.parse(await readFile(applied.result.receiptFile)), snapshot = receipt.snapshots.find(s => s.id === 'main-local');
  assert.equal(await readFile(path.join(snapshot.directory, 'data', log), 'utf8'), 'baseline\n');
  await connected.close();
  const g = await fixture(t, { stable: true, withLedger: true }), original = JSON.parse(await readFile(g.pairingFile)), updated = await apply(g);
  await writeFile(path.join(g.data, g.business), '{"rev":3,"keepLatest":true}\n'); const rollback = await updated.a.planRollback(updated.result); assert.deepEqual(rollback.blockers, []);
  await updated.a.rollback({ ...updated.result, planDigest: rollback.planDigest, confirmation: 'ROLLBACK ' + rollback.planDigest }); assert.equal(JSON.parse(await readFile(g.pairingFile)).localDataRoot, original.localDataRoot); assert.match(await readFile(path.join(g.data, g.business), 'utf8'), /keepLatest/);
  const db = new DatabaseSync(g.ledgerFile, { readOnly: true }); assert.equal(db.prepare('SELECT count(*) n FROM write_ledger').get().n, 0); db.close();
});
