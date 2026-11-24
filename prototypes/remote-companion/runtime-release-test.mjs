import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, writeFile, readFile, readdir, rm, lstat } from 'node:fs/promises';
import { buildRuntimeRelease, verifyRuntimeRelease } from './build-runtime-release.mjs';
import { CLIENT_LAUNCH_TEMPLATE, CLIENT_RELEASE_MANIFEST, verifyClientRelease } from './client-launch.mjs';
import { OVERLAY_VERSION } from './freeze-adapter.mjs';

const run = promisify(execFile), sha = bytes => createHash('sha256').update(bytes).digest('hex');
const scratch = fileURLToPath(new URL('../../.scratch/', import.meta.url));
const powershell = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
async function fixture(t, { missing = false, protocol = 1, overlay = OVERLAY_VERSION } = {}) {
  await mkdir(scratch, { recursive: true }); const directory = await mkdtemp(path.join(scratch, 'runtime release test '));
  t.after(async () => { const actual = await lstat(directory); assert.ok(actual.isDirectory() && !actual.isSymbolicLink()); assert.equal(path.dirname(directory), scratch.replace(/[\\/]$/, '')); assert.ok(path.basename(directory).startsWith('runtime release test ')); await rm(directory, { recursive: true, force: true, maxRetries: 5 }); });
  const repo = path.join(directory, 'fixed local git with spaces'), frozen = path.join(directory, 'frozen with spaces'), hooks = path.join(directory, 'empty hooks'), home = path.join(directory, 'empty home');
  for (const folder of [repo, frozen, hooks, home]) await mkdir(folder);
  const empty = path.join(directory, 'empty config'); await writeFile(empty, '');
  const env = { ...process.env, HOME: home, USERPROFILE: home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: empty, GIT_CONFIG_SYSTEM: empty, GIT_CEILING_DIRECTORIES: directory,
    GIT_AUTHOR_NAME: 'Release Fixture', GIT_AUTHOR_EMAIL: 'release@example.invalid', GIT_COMMITTER_NAME: 'Release Fixture', GIT_COMMITTER_EMAIL: 'release@example.invalid',
    GIT_CONFIG_COUNT: '3', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: hooks, GIT_CONFIG_KEY_1: 'commit.gpgsign', GIT_CONFIG_VALUE_1: 'false', GIT_CONFIG_KEY_2: 'core.autocrlf', GIT_CONFIG_VALUE_2: 'false' };
  const git = async args => (await run('git', ['-C', repo, ...args], { env, windowsHide: true, timeout: 15000 })).stdout.trim();
  const put = async (root, relative, bytes) => { const file = path.join(root, relative); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, bytes); };
  const evaluated = path.join(directory, 'UNTRUSTED-SOURCE-WAS-EVALUATED');
  const source = { 'protocol.mjs': 'export const VERSION = ' + protocol + ';\n', 'freeze-adapter.mjs': "export const OVERLAY_VERSION = '" + overlay + "';\n",
    'client-launch.mjs': 'export const CLIENT_LAUNCH_TEMPLATE = String.raw`' + CLIENT_LAUNCH_TEMPLATE + '`;\n',
    'launch.mjs': "import './protocol.mjs'; import './" + (missing ? 'absent.mjs' : 'helper.mjs') + "'; import {writeFileSync} from 'node:fs'; writeFileSync(" + JSON.stringify(evaluated) + ",'must never run');\n",
    'helper.mjs': 'export const fixed = 1;\n', 'test.mjs': 'TEST MUST NOT SHIP', 'other-test.mjs': 'TEST MUST NOT SHIP', 'measure-size.mjs': 'BENCH MUST NOT SHIP', 'credentials.mjs': 'CREDENTIAL MUST NOT SHIP', 'private.json': 'STATE MUST NOT SHIP' };
  source['remote-cloud.png'] = await readFile(new URL('./remote-cloud.png', import.meta.url));
  for (const [name, bytes] of Object.entries(source)) await put(repo, 'prototypes/remote-companion/' + name, bytes);
  await git(['init', '--quiet']); await git(['add', '.']); await git(['commit', '--quiet', '-m', 'Fixed release fixture']); const commit = await git(['rev-parse', 'HEAD']);
  assert.equal(await git(['remote']), '', 'fixtures have no network remote');
  const candidate = new Map([
    ['prototypes/upstream-port/sidebar-server.mjs', "import '../../vendor/mattskills-1.8.0-rc.7/lib/thing.js';\n"],
    ['vendor/mattskills-1.8.0-rc.7/lib/thing.js', 'export const vendor = true;\n'],
    ['vendor/mattskills-1.8.0-rc.7/LICENSE', 'Fixture upstream license\n'],
    ['vendor/mattskills-1.8.0-rc.7/bundled-skills/LICENSE', 'Fixture bundled skills license\n'],
  ]);
  for (let i = candidate.size; i < 450; i++) candidate.set('vendor/mattskills-1.8.0-rc.7/fixture-' + String(i).padStart(3, '0') + '.json', '{}\n');
  for (const [name, bytes] of candidate) await put(frozen, name, bytes);
  const manifest = Buffer.from(JSON.stringify({ schemaVersion: 1, ready: true, overlayVersion: OVERLAY_VERSION, adapterRelativePath: 'prototypes/upstream-port/sidebar-server.mjs',
    files: [...candidate].map(([name, value]) => ({ path: name, bytes: Buffer.byteLength(value), sha256: sha(value) })) }, null, 2) + '\n');
  await put(frozen, 'frozen-adapter.json', manifest);
  return { directory, repo, frozen, commit, evaluated, put, source, options: output => ({ repository: repo, sourceCommit: commit, adapterDirectory: frozen, adapterManifestSha256: sha(manifest), outputDirectory: path.join(directory, output) }) };
}

test('fixed Git objects ignore dirty/untracked source; complete output is reproducible and arbitrary Git code never executes', async t => {
  const f = await fixture(t); await f.put(f.repo, 'prototypes/remote-companion/helper.mjs', "throw Error('WIP');\n"); await f.put(f.repo, 'prototypes/remote-companion/untracked.mjs', 'UNTRACKED SECRET');
  const first = await buildRuntimeRelease(f.options('release with spaces')), second = await buildRuntimeRelease(f.options('second immutable release'));
  assert.equal(first.manifestSha256, second.manifestSha256); assert.equal(first.installed, false); assert.equal(first.sourceCommit, f.commit);
  assert.equal((await readFile(path.join(first.directory, 'prototypes/remote-companion/helper.mjs'), 'utf8')), f.source['helper.mjs']);
  assert.deepEqual(await readFile(path.join(first.directory, 'prototypes/remote-companion/remote-cloud.png')), f.source['remote-cloud.png']);
  assert.equal(await lstat(f.evaluated).then(() => true, () => false), false);
  const names = JSON.parse(await readFile(path.join(first.directory, CLIENT_RELEASE_MANIFEST))).files.map(row => row.path);
  assert.equal(names.some(name => /(?:test|measure-|credentials|private\.json|untracked)/.test(name)), false);
  assert.equal((await verifyClientRelease({ directory: first.directory, expectedManifestSha256: first.manifestSha256 })).fileCount, first.fileCount);
  assert.equal((await verifyRuntimeRelease({ directory: first.directory, expectedManifestSha256: first.manifestSha256 })).protocolVersion, 1);
});

test('symbolic ref, incompatible protocol/overlay and missing relative closure are rejected without creating output', async t => {
  const f = await fixture(t); await assert.rejects(buildRuntimeRelease({ ...f.options('bad head'), sourceCommit: 'HEAD' }), { code: 'RUNTIME_COMMIT' });
  for (const [options, code] of [[{ protocol: 2 }, 'RUNTIME_PROTOCOL'], [{ overlay: 'unreviewed-overlay' }, 'RUNTIME_OVERLAY'], [{ missing: true }, 'RUNTIME_IMPORTS']]) {
    const g = await fixture(t, options); await assert.rejects(buildRuntimeRelease(g.options('must not exist')), { code }); assert.equal(await lstat(g.options('must not exist').outputDirectory).then(() => true, () => false), false);
  }
});

test('existing output and adapter drift are rejected; release hashes/catalog reject added files, tamper and INCOMPLETE', async t => {
  const f = await fixture(t), built = await buildRuntimeRelease(f.options('complete'));
  await assert.rejects(buildRuntimeRelease(f.options('complete')), { code: 'RUNTIME_EXISTS' });
  await writeFile(path.join(built.directory, 'extra.txt'), 'extra'); await assert.rejects(verifyRuntimeRelease({ directory: built.directory, expectedManifestSha256: built.manifestSha256 }), { code: 'CLIENT_RELEASE' }); await rm(path.join(built.directory, 'extra.txt'));
  await writeFile(path.join(built.directory, 'INCOMPLETE'), 'hold'); await assert.rejects(verifyRuntimeRelease({ directory: built.directory, expectedManifestSha256: built.manifestSha256 }), { code: 'RUNTIME_INCOMPLETE' }); await rm(path.join(built.directory, 'INCOMPLETE'));
  await writeFile(path.join(built.directory, 'prototypes/remote-companion/launch.mjs'), 'TAMPER'); await assert.rejects(verifyRuntimeRelease({ directory: built.directory, expectedManifestSha256: built.manifestSha256 }), { code: 'CLIENT_RELEASE' });
  await writeFile(path.join(f.frozen, 'vendor/mattskills-1.8.0-rc.7/LICENSE'), 'TAMPER'); await assert.rejects(buildRuntimeRelease(f.options('bad adapter')));
});

test('source drift after capture leaves an INCOMPLETE output and never publishes a ready package', async t => {
  const f = await fixture(t), options = f.options('interrupted capture'); let changed = false, changing = false;
  const timer = setInterval(async () => {
    if (changing || changed || !await lstat(path.join(options.outputDirectory, 'INCOMPLETE')).then(() => true, () => false)) return;
    changing = true; await writeFile(path.join(f.frozen, 'vendor/mattskills-1.8.0-rc.7/LICENSE'), 'CHANGED AFTER CAPTURE'); changed = true;
  }, 5);
  try { await assert.rejects(buildRuntimeRelease(options)); assert.equal(changed, true); assert.equal(await lstat(path.join(options.outputDirectory, 'INCOMPLETE')).then(() => true, () => false), true); }
  finally { clearInterval(timer); }
});

test('PowerShell bootstrap preserves catalog checks and validates external pinned state before executing a harmless stub', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t), built = await buildRuntimeRelease(f.options('fixed package with spaces')), script = path.join(built.directory, 'start-companion.ps1');
  const parse = "$fixtureTokens=$null;$fixtureErrors=$null;[Management.Automation.Language.Parser]::ParseFile('" + script.replace(/'/g, "''") + "',[ref]$fixtureTokens,[ref]$fixtureErrors)|Out-Null;if($fixtureErrors.Count){exit 1}";
  await run(powershell, ['-NoProfile', '-NonInteractive', '-Command', parse], { windowsHide: true });
  const state = path.join(f.directory, 'external state with spaces'), localData = path.join(state, 'data'), localAppData = path.join(state, 'local app data'), marker = path.join(state, 'stub arguments.json');
  await mkdir(localData, { recursive: true }); await mkdir(localAppData); const pairingFile = path.join(state, 'pairing.json'), stub = path.join(state, 'fake node.ps1');
  await writeFile(stub, "param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Values)\n[IO.File]::WriteAllText('" + marker.replace(/'/g, "''") + "',($Values|ConvertTo-Json -Compress))\nexit 0\n");
  const config = { protocolVersion: 1, adapterPath: path.join(built.directory, 'prototypes/upstream-port/sidebar-server.mjs'), baseline: { directory: built.directory, manifestSha256: f.options('').adapterManifestSha256 },
    localDataRoot: localData, journalPath: path.join(state, 'journal.sqlite'), secretDPAPI: 'DUMMY-NEVER-DECRYPTED' };
  await writeFile(pairingFile, JSON.stringify(config));
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-PairingFile', pairingFile, '-ReleaseDirectory', built.directory, '-ManifestSha256', built.manifestSha256, '-NodeExe', stub];
  await run(powershell, args, { env: { ...process.env, LOCALAPPDATA: localAppData }, windowsHide: true });
  assert.deepEqual(JSON.parse(await readFile(marker, 'utf8')), [path.join(built.directory, 'prototypes/remote-companion/launch.mjs'), '--pairing', pairingFile]); await rm(marker);
  for (const bad of [{ ...config, localDataRoot: built.directory }, { ...config, localDataRoot: f.directory }, { ...config, journalPath: path.join(built.directory, 'journal.sqlite') },
    { ...config, adapterPath: path.join(built.directory, 'prototypes/remote-companion/client-launch.mjs') }, { ...config, baseline: { ...config.baseline, manifestSha256: '0'.repeat(64) } }, { ...config, localDataRoot: undefined }]) {
    await writeFile(pairingFile, JSON.stringify(bad)); await assert.rejects(run(powershell, args, { env: { ...process.env, LOCALAPPDATA: localAppData }, windowsHide: true })); assert.equal(await lstat(marker).then(() => true, () => false), false);
  }
  await writeFile(pairingFile, JSON.stringify(config)); await assert.rejects(run(powershell, args, { env: { ...process.env, LOCALAPPDATA: built.directory }, windowsHide: true }));
  assert.equal(await lstat(marker).then(() => true, () => false), false);
  await writeFile(pairingFile, JSON.stringify(config)); await writeFile(path.join(built.directory, 'prototypes/remote-companion/protocol.mjs'), 'tampered');
  await assert.rejects(run(powershell, args, { env: { ...process.env, LOCALAPPDATA: localAppData }, windowsHide: true })); assert.equal(await lstat(marker).then(() => true, () => false), false);
});
