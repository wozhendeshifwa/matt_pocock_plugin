import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, rm, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { freezeAdapter, verifyFrozenAdapter, OUTPUT_BASE, OVERLAY_VERSION } from './freeze-adapter.mjs';
import { resolveExecutable } from '../upstream-port/executables.mjs';

const run = promisify(execFile);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const mainRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const port = 'prototypes/upstream-port/';
const vendor = 'vendor/mattskills-1.8.0-rc.7/';
function inside(root, file) {
  const relative = path.relative(root, file);
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}
async function fixture(t) {
  await mkdir(OUTPUT_BASE, { recursive: true });
  const directory = await mkdtemp(path.join(OUTPUT_BASE, 'freeze-test-'));
  t.after(async () => {
    const base = await realpath(OUTPUT_BASE), target = await realpath(directory);
    assert.ok(inside(base, target), 'cleanup stays inside the selected test base');
    await rm(target, { recursive: true });
  });
  const source = path.join(directory, 'source');
  const entries = [
    [port + 'sidebar-server.mjs', Buffer.from('// fixture sidebar entrypoint; never executed\n')],
    [port + 'project-worker.mjs', await readFile(path.join(mainRoot, port + 'project-worker.mjs'))],
    [port + 'snapshot-cache-identity.mjs', await readFile(path.join(mainRoot, port + 'snapshot-cache-identity.mjs'))],
    [port + 'executables.mjs', await readFile(path.join(mainRoot, port + 'executables.mjs'))],
    [vendor + 'package.json', Buffer.from('{"type":"module"}\n')],
    [vendor + 'LICENSE', Buffer.from('Fixture license is preserved verbatim.\n')],
    [vendor + 'bundled-skills/fixture/agents/openai.yaml', Buffer.from('interface:\n  display_name: Fixture\n')],
    [vendor + 'bundled-skills/fixture/template.sh', Buffer.from('#!/bin/sh\n# fixture; never executed\n')],
  ];
  for (const [relative, bytes] of entries) {
    const target = path.join(source, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  const manifest = { schemaVersion: 1, sourceCandidateOnly: true, commit: 'fixture-commit', fileCount: entries.length,
    files: entries.map(([relative, bytes]) => ({ path: relative, bytes: bytes.length, sha256: hash(bytes) })) };
  const manifestFile = path.join(directory, 'source-manifest.json');
  async function saveManifest(value = manifest) {
    const bytes = Buffer.from(JSON.stringify(value));
    await writeFile(manifestFile, bytes);
    return hash(bytes);
  }
  const expectedManifestSha256 = await saveManifest();
  const options = { sourceRoot: source, manifestFile, expectedManifestSha256, outputRoot: path.join(directory, 'candidate') };
  return { directory, source, entries, manifest, manifestFile, options, saveManifest };
}

test('freeze preserves exact static bytes, overlays only two modules and refuses overwrite', async t => {
  const f = await fixture(t);
  const result = await freezeAdapter(f.options);
  assert.equal(result.fileCount, f.entries.length);
  assert.equal(result.overlayVersion, OVERLAY_VERSION);
  assert.equal(result.userAccepted, false);
  const candidate = JSON.parse(await readFile(result.manifestPath, 'utf8'));
  assert.equal(candidate.sourceManifestSha256, f.options.expectedManifestSha256);
  assert.equal(candidate.sourceCandidateOnly, true);
  assert.equal(candidate.ready, true);
  assert.equal(candidate.files.filter(entry => entry.overlay).length, 2);
  for (const entry of candidate.files) {
    const original = await readFile(path.join(f.source, entry.path));
    const frozen = await readFile(path.join(result.directory, entry.path));
    assert.equal(entry.inputSha256, hash(original));
    assert.equal(entry.sha256, hash(frozen));
    assert.equal(entry.bytes, frozen.length);
    if (!entry.overlay) assert.deepEqual(frozen, original);
  }
  await assert.rejects(stat(path.join(result.directory, 'INCOMPLETE')), { code: 'ENOENT' });
  await assert.rejects(freezeAdapter(f.options), { code: 'EEXIST' });
  assert.equal((await readFile(path.join(result.directory, vendor + 'LICENSE'), 'utf8')), 'Fixture license is preserved verbatim.\n');
  assert.equal((await verifyFrozenAdapter({ directory: result.directory, expectedManifestSha256: result.manifestSha256 })).adapterPath, result.adapterPath);
  await writeFile(path.join(result.directory, port + 'sidebar-server.mjs'), '// changed after freeze\n');
  await assert.rejects(verifyFrozenAdapter({ directory: result.directory, expectedManifestSha256: result.manifestSha256 }), /Frozen candidate drift/);
});

test('freeze rejects drift, extra catalog entries and unpinned or unsafe manifest paths', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.source, port + 'unexpected.mjs'), 'export const unexpected = true;\n');
  await assert.rejects(freezeAdapter(f.options), /extra or missing/);
  await rm(path.join(f.source, port + 'unexpected.mjs'));
  await writeFile(path.join(f.source, port + 'executables.mjs'), '// changed source\n');
  await assert.rejects(freezeAdapter(f.options), /Source drift/);
  await writeFile(path.join(f.source, port + 'executables.mjs'), f.entries.find(([name]) => name === port + 'executables.mjs')[1]);
  await assert.rejects(freezeAdapter({ ...f.options, expectedManifestSha256: '0'.repeat(64) }), /manifest SHA-256 mismatch/);
  const unsafe = structuredClone(f.manifest);
  unsafe.files[0].path = 'prototypes/upstream-port/../../../private.json';
  await assert.rejects(freezeAdapter({ ...f.options, expectedManifestSha256: await f.saveManifest(unsafe) }), /extra or unsafe path/);
  assert.equal(await stat(f.options.outputRoot).then(() => true, () => false), false, 'no output was created for rejected input');
});

test('freeze rejects changed patch anchors and output outside the local ignored directory', async t => {
  const f = await fixture(t);
  const changed = structuredClone(f.manifest);
  const workerPath = port + 'project-worker.mjs';
  const bytes = Buffer.from((await readFile(path.join(f.source, workerPath), 'utf8')).replace('identity: createSnapshotCacheIdentity(process.argv[2]),', 'identity: anotherIdentity(),'));
  await writeFile(path.join(f.source, workerPath), bytes);
  Object.assign(changed.files.find(entry => entry.path === workerPath), { sha256: hash(bytes), bytes: bytes.length });
  await assert.rejects(freezeAdapter({ ...f.options, expectedManifestSha256: await f.saveManifest(changed) }), /anchor drift/);
  await writeFile(path.join(f.source, workerPath), f.entries.find(([name]) => name === workerPath)[1]);
  await f.saveManifest();
  await assert.rejects(freezeAdapter({ ...f.options, outputRoot: path.join(mainRoot, 'prototypes', 'forbidden-freeze-' + randomUUID()) }), /inside this worktree/);
});

const identityProbe = `
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [moduleFile, project, dataRoot, fakeHome, strict] = process.argv.slice(1);
assert.equal(path.resolve(homedir()).toLowerCase(), path.resolve(fakeHome).toLowerCase(), 'fixture home must be isolated');
const correctChoices = path.join(dataRoot, '.dsh/mattskillsdeck/choices.json');
const wrongChoices = path.join(fakeHome, '.dsh/mattskillsdeck/choices.json');
for (const file of [correctChoices, wrongChoices]) { await mkdir(path.dirname(file), { recursive:true }); await writeFile(file, '{"version":1,"fixture":"a"}'); }
const { createSnapshotCacheIdentity } = await import(pathToFileURL(moduleFile));
const identity = createSnapshotCacheIdentity(project, {dataRoot});
const before = await identity();
assert.match(before, /^[a-f0-9]{64}$/);
await writeFile(correctChoices, '{"version":1,"fixture":"b"}');
const afterCorrect = await identity();
await writeFile(wrongChoices, '{"version":1,"fixture":"c"}');
const afterWrong = await identity();
const noDataRoot = await createSnapshotCacheIdentity(project)();
const signals = { correctRootInvalidates: before !== afterCorrect, wrongRootCannotSubstitute: afterCorrect === afterWrong, missingRootFailsClosed: noDataRoot === null };
console.log(JSON.stringify(signals));
if (strict === 'assert-correct') {
  assert.equal(signals.correctRootInvalidates, true, 'choices dataRoot change must invalidate cache identity');
  assert.equal(signals.wrongRootCannotSubstitute, true, 'wrong home choices must not substitute for local dataRoot');
  assert.equal(signals.missingRootFailsClosed, true, 'missing dataRoot must fail closed');
}
`;

test('real identity seam goes red on old choices path and green on frozen dataRoot overlay', async t => {
  const f = await fixture(t);
  const frozen = await freezeAdapter(f.options);
  const project = path.join(f.directory, 'fixture-project');
  const dataRoot = path.join(f.directory, 'fixture-data');
  const fakeHome = path.join(f.directory, 'fixture-home');
  const gh = path.join(f.directory, 'fixture-gh');
  await Promise.all([project, dataRoot, fakeHome, gh].map(dir => mkdir(dir)));
  const emptyConfig = path.join(f.directory, 'empty-git-config');
  await writeFile(emptyConfig, '');
  await writeFile(path.join(gh, 'hosts.yml'), 'fixture.example.invalid: {}\n');
  await writeFile(path.join(gh, 'config.yml'), 'version: 1\n');
  const env = {};
  for (const name of ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP']) if (process.env[name]) env[name] = process.env[name];
  const git = await resolveExecutable('git', { env });
  assert.ok(git, 'fixture requires installed Git');
  Object.assign(env, { USERPROFILE: fakeHome, HOME: fakeHome, APPDATA: path.join(fakeHome, 'AppData/Roaming'),
    GH_CONFIG_DIR: gh, DECK_GIT: git, DECK_GH: 'fixture-gh', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: emptyConfig, GIT_CONFIG_SYSTEM: emptyConfig });
  await run(git, ['-C', project, 'init', '--quiet'], { env, windowsHide: true, timeout: 10000 });
  const oldModule = path.join(f.source, port + 'snapshot-cache-identity.mjs');
  const newModule = path.join(frozen.directory, port + 'snapshot-cache-identity.mjs');
  const args = moduleFile => ['--input-type=module', '--eval', identityProbe, moduleFile, project, dataRoot, fakeHome, 'assert-correct'];
  await assert.rejects(run(process.execPath, args(oldModule), { env, windowsHide: true, timeout: 10000 }), error => {
    assert.equal(error.code, 1);
    assert.match(error.stdout, /"correctRootInvalidates":false/);
    assert.match(error.stderr, /choices dataRoot change must invalidate/);
    return true;
  });
  const green = await run(process.execPath, args(newModule), { env, windowsHide: true, timeout: 10000 });
  assert.deepEqual(JSON.parse(green.stdout.trim()), { correctRootInvalidates: true, wrongRootCannotSubstitute: true, missingRootFailsClosed: true });
  assert.equal(hash(await readFile(oldModule)), f.manifest.files.find(entry => entry.path === port + 'snapshot-cache-identity.mjs').sha256, 'original candidate source was not patched');
});
