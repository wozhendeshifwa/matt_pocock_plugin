import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, writeFile, readdir, stat, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CALLER_ENVIRONMENT_VARIABLE as ENV, CLIENT_RELEASE_MANIFEST, CLIENT_RELEASE_ENTRY, CLIENT_LAUNCH_TEMPLATE,
  createCallerRecord, loadCallerRecord, verifyClientRelease, launchClient, planClientShortcut, writeClientShortcut,
  restoreClientShortcutBackups } from './client-launch.mjs';

const scratch = fileURLToPath(new URL('../../.scratch/', import.meta.url));
const entrypoint = fileURLToPath(new URL('./client-launch.mjs', import.meta.url));
const windows = { skip: process.platform !== 'win32' };
const hash = value => createHash('sha256').update(value).digest('hex');
const powershell = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
async function run(executable, args, { input, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [], err = [];
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Isolated child timed out')); }, 20000);
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.stdout.on('data', chunk => out.push(chunk)); child.stderr.on('data', chunk => err.push(chunk));
    child.stdin.on('error', () => {}); child.stdin.end(input);
    child.on('close', code => { clearTimeout(timeout); resolve({ code, stdout: Buffer.concat(out).toString(), stderr: Buffer.concat(err).toString() }); });
  });
}
async function fixture(t) {
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(path.join(scratch, 'client-launch-test-'));
  t.after(async () => {
    // Never recursively remove a computed path outside this task's scratch root.
    assert.equal(path.dirname(root), scratch.replace(/[\\/]$/, ''));
    assert.ok(path.basename(root).startsWith('client-launch-test-'));
    await rm(root, { recursive: true, force: true });
  });
  const directory = path.join(root, 'fixed release with spaces'), file = path.join(root, 'private state with spaces', 'caller.json');
  await mkdir(directory, { recursive: true }); await mkdir(path.dirname(file), { recursive: true });
  return { root, directory, file, callerToken: randomBytes(32).toString('hex') };
}
async function release(directory, contents = '// Fixed test release; never launches Codex.\n', other = {}) {
  const files = { [CLIENT_RELEASE_ENTRY]: contents, ...other }, catalog = [];
  for (const [relative, value] of Object.entries(files)) {
    const file = path.join(directory, ...relative.split('/')); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, value);
    catalog.push({ path: relative, bytes: Buffer.byteLength(value), sha256: hash(value) });
  }
  const manifest = { schemaVersion: 1, kind: 'deck-client-launcher-release', releaseId: 'isolated-test-v1', entrypoint: CLIENT_RELEASE_ENTRY, files: catalog };
  const bytes = JSON.stringify(manifest, null, 2) + '\n'; await writeFile(path.join(directory, CLIENT_RELEASE_MANIFEST), bytes);
  return hash(bytes);
}
const options = (f, expectedManifestSha256) => ({ callerFile: f.file, releaseDirectory: f.directory, expectedManifestSha256 });
async function diskContents(folder) {
  const result = [];
  for (const item of await readdir(folder, { withFileTypes: true })) {
    const file = path.join(folder, item.name);
    if (item.isDirectory()) result.push(...await diskContents(file)); else result.push(await readFile(file));
  }
  return result;
}
async function until(predicate) {
  const start = Date.now();
  while (!await predicate()) { if (Date.now() - start > 10000) throw new Error('Fake child result did not arrive'); await new Promise(resolve => setTimeout(resolve, 25)); }
}

test('caller record uses real CurrentUser DPAPI, redacts by default and rejects wrong entropy', windows, async t => {
  const f = await fixture(t), result = await createCallerRecord({ file: f.file, callerToken: f.callerToken });
  assert.equal(result.environmentVariable, ENV); assert.equal(result.appId, 'OpenAI.Codex');
  assert.equal(JSON.stringify(result).includes('callerDPAPI'), false);
  assert.equal((await loadCallerRecord(f.file, { decrypt: true })).callerToken, f.callerToken);
  assert.equal((await readFile(f.file, 'utf8')).includes(f.callerToken), false);
  const record = JSON.parse(await readFile(f.file, 'utf8')); record.credentialId = randomUUID(); await writeFile(f.file, JSON.stringify(record));
  await assert.rejects(loadCallerRecord(f.file, { decrypt: true }), { code: 'CLIENT_CREDENTIAL' });
});

test('caller pairing refuses overwrite and never stores other credentials', windows, async t => {
  const f = await fixture(t); await createCallerRecord({ file: f.file, callerToken: f.callerToken });
  const original = await readFile(f.file);
  await assert.rejects(createCallerRecord({ file: f.file, callerToken: randomBytes(32).toString('hex') }), { code: 'CLIENT_EXISTS' });
  assert.deepEqual(await readFile(f.file), original);
  assert.deepEqual(Object.keys(JSON.parse(original)).sort(), ['schemaVersion', 'kind', 'credentialId', 'appId', 'environmentVariable', 'callerDPAPI', 'createdAt'].sort());
});

test('pinned release verifies file hashes and rejects drift, extra files, missing pin and traversal', async t => {
  const f = await fixture(t), pin = await release(f.directory);
  assert.equal((await verifyClientRelease({ directory: f.directory, expectedManifestSha256: pin })).fileCount, 1);
  await assert.rejects(verifyClientRelease({ directory: f.directory, expectedManifestSha256: '0'.repeat(64) }), { code: 'CLIENT_RELEASE' });
  await writeFile(path.join(f.directory, 'unexpected.txt'), 'extra');
  await assert.rejects(verifyClientRelease({ directory: f.directory, expectedManifestSha256: pin }), { code: 'CLIENT_RELEASE' });
  await rm(path.join(f.directory, 'unexpected.txt')); await writeFile(path.join(f.directory, CLIENT_RELEASE_ENTRY), 'changed');
  await assert.rejects(verifyClientRelease({ directory: f.directory, expectedManifestSha256: pin }), { code: 'CLIENT_RELEASE' });
  const manifest = { schemaVersion: 1, kind: 'deck-client-launcher-release', releaseId: 'bad', entrypoint: CLIENT_RELEASE_ENTRY,
    files: [{ path: '../outside.mjs', bytes: 0, sha256: hash('') }] };
  const bytes = JSON.stringify(manifest); await writeFile(path.join(f.directory, CLIENT_RELEASE_MANIFEST), bytes);
  await assert.rejects(verifyClientRelease({ directory: f.directory, expectedManifestSha256: hash(bytes) }), { code: 'CLIENT_RELEASE' });
});

test('fake child inherits caller only through env while parent env and provider bytes remain unchanged', windows, async t => {
  const f = await fixture(t), pin = await release(f.directory); await createCallerRecord({ file: f.file, callerToken: f.callerToken });
  const sentinel = path.join(f.root, 'provider-config.toml'), sentinelBytes = Buffer.from('model_provider="deepseek"\n[model_providers.openai]\n[model_providers.deepseek]\n');
  await writeFile(sentinel, sentinelBytes);
  const resultFile = path.join(f.root, 'fake child result.json'), program = path.join(f.root, 'fake client with spaces.mjs');
  await writeFile(program, `import {writeFileSync} from 'node:fs';import {createHash} from 'node:crypto';
const value=process.env.DECK_COMPANION_CALLER_TOKEN;writeFileSync(process.argv[2],JSON.stringify({present:!!value,sha256:createHash('sha256').update(value??'').digest('hex'),argvHasSecret:process.argv.some(arg=>arg.includes(value??'missing-secret'))}));\n`);
  const before = process.env[ENV], childEnv = { ...process.env, [ENV]: 'old caller value', FIXTURE_PROVIDER: 'deepseek' };
  let spawned, child;
  const result = await launchClient(options(f, pin), { locateClient: async () => ({ executable: process.execPath, args: [program, resultFile] }),
    runningClients: async () => [], env: childEnv, spawnClient: (exe, args, opts) => {
      spawned = { exe, args: [...args], hadCaller: opts.env[ENV] === f.callerToken, detached: opts.detached };
      child = spawn(exe, args, opts); return child;
    } });
  assert.equal(result.started, true); assert.equal(spawned.hadCaller, true); assert.equal(spawned.detached, true);
  assert.equal(JSON.stringify(spawned.args).includes(f.callerToken), false);
  await until(() => stat(resultFile).then(() => true, () => false));
  assert.deepEqual(JSON.parse(await readFile(resultFile)), { present: true, sha256: hash(f.callerToken), argvHasSecret: false });
  assert.equal(process.env[ENV], before); assert.equal(childEnv[ENV], 'old caller value');
  assert.deepEqual(await readFile(sentinel), sentinelBytes); assert.equal(JSON.stringify(result).includes(f.callerToken), false);
  for (const bytes of await diskContents(f.root)) assert.equal(bytes.includes(f.callerToken), false);
  if (child.exitCode === null) await new Promise(resolve => child.once('exit', resolve));
});

test('already running app rejects before decrypting and never spawns or changes disk', windows, async t => {
  const f = await fixture(t), pin = await release(f.directory); await createCallerRecord({ file: f.file, callerToken: f.callerToken });
  const record = JSON.parse(await readFile(f.file)); record.credentialId = randomUUID(); await writeFile(f.file, JSON.stringify(record));
  const before = (await diskContents(f.root)).map(hash); let spawned = false;
  await assert.rejects(launchClient(options(f, pin), { locateClient: async () => ({ executable: process.execPath }),
    runningClients: async () => [{ pid: 123 }], spawnClient: () => { spawned = true; } }), { code: 'CLIENT_ALREADY_RUNNING' });
  assert.equal(spawned, false); assert.deepEqual((await diskContents(f.root)).map(hash), before);
});

test('second process check closes the ordinary decrypt gap and process failures reject', windows, async t => {
  const f = await fixture(t), pin = await release(f.directory); await createCallerRecord({ file: f.file, callerToken: f.callerToken });
  let checks = 0, spawned = false;
  const seams = { locateClient: async () => ({ executable: process.execPath }), runningClients: async () => ++checks === 1 ? [] : [{ pid: 1 }], spawnClient: () => { spawned = true; } };
  await assert.rejects(launchClient(options(f, pin), seams), { code: 'CLIENT_ALREADY_RUNNING' });
  assert.equal(checks, 2); assert.equal(spawned, false);
  await assert.rejects(launchClient(options(f, pin), { ...seams, runningClients: async () => { throw new Error(f.callerToken); } }), error => error.code === 'CLIENT_PROCESS' && !error.message.includes(f.callerToken));
});

test('child launch errors cannot print credential-bearing exec objects', windows, async t => {
  const f = await fixture(t), pin = await release(f.directory); await createCallerRecord({ file: f.file, callerToken: f.callerToken });
  const before = process.env[ENV]; let inherited;
  await assert.rejects(launchClient(options(f, pin), { locateClient: async () => ({ executable: process.execPath }), runningClients: async () => [],
    spawnClient: (_exe, _args, opts) => { inherited = opts.env; const child = new EventEmitter(); queueMicrotask(() => child.emit('error', new Error(f.callerToken))); return child; } }),
  error => error.code === 'CLIENT_START' && !error.message.includes(f.callerToken) && !JSON.stringify(error).includes(f.callerToken));
  assert.equal(process.env[ENV], before); assert.equal(ENV in inherited, false);
});

test('shortcut plan and default write are read-only, private caller remains outside fixed release', windows, async t => {
  const f = await fixture(t), pin = await release(f.directory); await createCallerRecord({ file: f.file, callerToken: f.callerToken });
  const shortcutDirectory = path.join(f.root, 'fake Desktop with spaces'), before = (await diskContents(f.root)).map(hash);
  const plan = await planClientShortcut(options(f, pin), { shortcutDirectory });
  assert.ok(plan.shortcut.startsWith(shortcutDirectory)); assert.ok(plan.shortcut.endsWith('.lnk')); assert.ok(plan.arguments.includes(pin));
  assert.equal(JSON.stringify(plan).includes(f.callerToken), false); assert.equal(JSON.stringify(plan).includes('callerDPAPI'), false);
  assert.equal((await writeClientShortcut(options(f, pin), { shortcutDirectory })).dryRun, true);
  assert.deepEqual((await diskContents(f.root)).map(hash), before);
  await assert.rejects(stat(shortcutDirectory), { code: 'ENOENT' });
});

test('PowerShell template parses and runs pinned fake entry with spaces; tampered bundle never executes', windows, async t => {
  const f = await fixture(t), output = path.join(f.root, 'template arguments.json');
  const content = `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(output)},JSON.stringify({args:process.argv.slice(2),hasCaller:!!process.env.DECK_COMPANION_CALLER_TOKEN}));\n`;
  const pin = await release(f.directory, content), script = path.join(f.root, 'generated launcher with spaces.ps1'); await writeFile(script, CLIENT_LAUNCH_TEMPLATE);
  const parser = await run(powershell, ['-NoProfile', '-NonInteractive', '-Command', "$x=[Console]::In.ReadToEnd()|ConvertFrom-Json;$tokens=$null;$errors=$null;[void][System.Management.Automation.Language.Parser]::ParseFile($x.file,[ref]$tokens,[ref]$errors);if($errors.Count){[Console]::Error.WriteLine('parse failed');exit 1};[Console]::Out.Write('parsed')"], { input: JSON.stringify({ file: script }) });
  assert.equal(parser.code, 0, parser.stderr); assert.equal(parser.stdout, 'parsed');
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-CallerFile', f.file, '-ReleaseDirectory', f.directory, '-ManifestSha256', pin, '-NodeExe', process.execPath];
  const cleanEnv = { ...process.env }; delete cleanEnv[ENV];
  const result = await run(powershell, args, { env: cleanEnv }); assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(await readFile(output)), { args: ['start', f.file, '--release-dir', f.directory, '--manifest-sha256', pin], hasCaller: false });
  await rm(output); await writeFile(path.join(f.directory, CLIENT_RELEASE_ENTRY), content + '// drift\n');
  const rejected = await run(powershell, args, { env: cleanEnv }); assert.notEqual(rejected.code, 0);
  assert.equal(rejected.stderr.includes(f.callerToken), false); await assert.rejects(stat(output), { code: 'ENOENT' });
});

test('temporary .lnk round-trip uses only paths/hash and generated files have recoverable backups', windows, async t => {
  const f = await fixture(t), pin = await release(f.directory); await createCallerRecord({ file: f.file, callerToken: f.callerToken });
  const settings = { shortcutDirectory: path.join(f.root, 'temporary Desktop with spaces'), dryRun: false };
  const first = await writeClientShortcut(options(f, pin), settings); assert.equal(first.backups.length, 0);
  const decoded = await run(powershell, ['-NoProfile', '-NonInteractive', '-Command', "$x=[Console]::In.ReadToEnd()|ConvertFrom-Json;$l=(New-Object -ComObject WScript.Shell).CreateShortcut($x.file);@{target=$l.TargetPath;arguments=$l.Arguments;workingDirectory=$l.WorkingDirectory}|ConvertTo-Json -Compress"], { input: JSON.stringify({ file: first.shortcut }) });
  assert.equal(decoded.code, 0, decoded.stderr); const link = JSON.parse(decoded.stdout);
  assert.equal(link.target.toLowerCase(), powershell.toLowerCase()); assert.equal(link.arguments, first.arguments); assert.equal(link.workingDirectory, path.dirname(f.file));
  assert.equal(decoded.stdout.includes(f.callerToken), false); assert.ok(link.arguments.includes(pin));
  const originalScript = Buffer.from('# Generated sentinel with spaces\r\n'), originalLink = await readFile(first.shortcut);
  await writeFile(first.launcher, originalScript);
  const second = await writeClientShortcut(options(f, pin), settings); assert.equal(second.backups.length, 2);
  assert.deepEqual(await readFile(second.backups.find(item => item.target === first.launcher).backup), originalScript);
  assert.equal((await restoreClientShortcutBackups(second)).dryRun, true);
  assert.equal(await readFile(second.launcher, 'utf8'), CLIENT_LAUNCH_TEMPLATE);
  const restored = await restoreClientShortcutBackups(second, { dryRun: false }); assert.equal(restored.restored, 2); assert.equal(restored.displaced.length, 2);
  assert.deepEqual(await readFile(first.launcher), originalScript); assert.deepEqual(await readFile(first.shortcut), originalLink);
  for (const bytes of await diskContents(f.root)) assert.equal(bytes.includes(f.callerToken), false);
});

test('local CLI pairs from secure stdin without secret in argv, stdout, stderr or generated files', windows, async t => {
  const f = await fixture(t), env = { ...process.env }; delete env[ENV];
  const args = [entrypoint, 'pair', f.file]; assert.equal(JSON.stringify(args).includes(f.callerToken), false);
  const result = await run(process.execPath, args, { env, input: f.callerToken + '\r\n' });
  assert.equal(result.code, 0, result.stderr); assert.equal(result.stdout.includes(f.callerToken), false); assert.equal(result.stderr.includes(f.callerToken), false);
  assert.equal(JSON.stringify(JSON.parse(result.stdout)).includes('callerDPAPI'), false);
  assert.equal((await loadCallerRecord(f.file, { decrypt: true })).callerToken, f.callerToken);
  const again = await run(process.execPath, args, { env: { ...env, [ENV]: f.callerToken } });
  assert.notEqual(again.code, 0); assert.equal(again.stderr.includes(f.callerToken), false);
  for (const bytes of await diskContents(f.root)) assert.equal(bytes.includes(f.callerToken), false);
});
