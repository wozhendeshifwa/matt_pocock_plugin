import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, lstat, stat, realpath, readdir, readFile, writeFile, rename, unlink, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { protectDeviceToken, unprotectDeviceToken, backupFile } from './lifecycle.mjs';

export const CALLER_ENVIRONMENT_VARIABLE = 'DECK_COMPANION_CALLER_TOKEN';
export const CLIENT_RELEASE_MANIFEST = 'client-release.json';
export const CLIENT_RELEASE_ENTRY = 'prototypes/remote-companion/client-launch.mjs';
const APP_ID = 'OpenAI.Codex';
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const folded = value => process.platform === 'win32' ? path.resolve(value).replace(/^\\\\\?\\/, '').toLowerCase() : path.resolve(value);
const fail = (code, message) => Object.assign(new Error(message), { code });
const systemPowerShell = () => path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
function absolute(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || /^\\\\(?!\?\\)/.test(value) || /[\u0000-\u001f\u007f]/.test(value)) throw fail('CLIENT_PATH', 'Use an absolute local path');
  return path.resolve(value);
}
function outside(root, file) {
  const relative = path.relative(folded(root), folded(file));
  return relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative);
}
async function ordinary(file, kind) {
  const requested = absolute(file), actual = await realpath(requested), info = await lstat(requested);
  if (info.isSymbolicLink() || folded(requested) !== folded(actual) || !(kind === 'directory' ? info.isDirectory() : info.isFile())) throw fail('CLIENT_PATH', 'Local client files cannot redirect through links');
  return { file: actual, info };
}
async function smallJson(file) {
  try {
    const checked = await ordinary(file, 'file');
    if (checked.info.size > 2 * 1024 * 1024) throw new Error();
    return JSON.parse(await readFile(checked.file, 'utf8'));
  } catch { throw fail('CLIENT_RECORD', 'The local client record is unavailable or invalid'); }
}
function token(value) {
  if (typeof value !== 'string' || !/^[\x21-\x7e]{32,4096}$/.test(value)) throw fail('CLIENT_CREDENTIAL', 'Use the local caller credential');
  return value;
}
function validateRecord(value) {
  if (!plain(value) || Object.keys(value).some(key => !['schemaVersion', 'kind', 'credentialId', 'appId', 'environmentVariable', 'callerDPAPI', 'createdAt'].includes(key)) ||
      value.schemaVersion !== 1 || value.kind !== 'deck-caller-credential' || !UUID.test(value.credentialId ?? '') || value.appId !== APP_ID ||
      value.environmentVariable !== CALLER_ENVIRONMENT_VARIABLE || typeof value.callerDPAPI !== 'string' ||
      !/^[A-Za-z0-9+/=]+$/.test(value.callerDPAPI) || value.callerDPAPI.length > 16384) throw fail('CLIENT_RECORD', 'The local caller credential record is invalid');
  return value;
}
const publicRecord = ({ callerDPAPI, ...record }) => record;

export async function createCallerRecord({ file, callerToken }) {
  const target = absolute(file); token(callerToken);
  if (await stat(target).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; })) throw fail('CLIENT_EXISTS', 'Caller record already exists; select a new local file');
  const credentialId = randomUUID();
  const record = { schemaVersion: 1, kind: 'deck-caller-credential', credentialId, appId: APP_ID,
    environmentVariable: CALLER_ENVIRONMENT_VARIABLE, callerDPAPI: await protectDeviceToken(callerToken, credentialId), createdAt: new Date().toISOString() };
  await mkdir(path.dirname(target), { recursive: true }); await ordinary(path.dirname(target), 'directory');
  await writeFile(target, JSON.stringify(record, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return { file: target, ...publicRecord(record) };
}
export async function loadCallerRecord(file, { decrypt = false } = {}) {
  const record = validateRecord(await smallJson(absolute(file)));
  if (!decrypt) return publicRecord(record);
  try { return { ...publicRecord(record), callerToken: token(await unprotectDeviceToken(record.callerDPAPI, record.credentialId)) }; }
  catch { throw fail('CLIENT_CREDENTIAL', 'Caller credential cannot be opened by this Windows user'); }
}

export async function verifyClientRelease({ directory, expectedManifestSha256 }) {
  if (!HASH.test(expectedManifestSha256 ?? '')) throw fail('CLIENT_RELEASE', 'Pin the approved client release manifest digest');
  const root = (await ordinary(directory, 'directory')).file, manifestFile = path.join(root, CLIENT_RELEASE_MANIFEST);
  const manifestStat = await ordinary(manifestFile, 'file');
  if (manifestStat.info.size > 2 * 1024 * 1024) throw fail('CLIENT_RELEASE', 'Client release manifest is too large');
  const bytes = await readFile(manifestStat.file);
  if (bytes.length > 2 * 1024 * 1024 || digest(bytes) !== expectedManifestSha256) throw fail('CLIENT_RELEASE', 'Client release manifest digest mismatch');
  let manifest;
  try { manifest = JSON.parse(bytes.toString('utf8')); } catch { throw fail('CLIENT_RELEASE', 'Invalid client release manifest'); }
  if (!plain(manifest) || manifest.schemaVersion !== 1 || manifest.kind !== 'deck-client-launcher-release' || typeof manifest.releaseId !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(manifest.releaseId) || manifest.entrypoint !== CLIENT_RELEASE_ENTRY ||
      !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > 2000) throw fail('CLIENT_RELEASE', 'Invalid client release declaration');
  const expected = new Set(); let total = 0;
  for (const entry of manifest.files) {
    if (!plain(entry) || typeof entry.path !== 'string' || entry.path.length > 2048 || /[\\:\u0000-\u001f\u007f]/.test(entry.path) ||
        entry.path.split('/').some(part => !part || part === '.' || part === '..' || part === '.git' || part === 'node_modules') ||
        !HASH.test(entry.sha256 ?? '') || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || entry.bytes > 32 * 1024 * 1024 ||
        entry.path === CLIENT_RELEASE_MANIFEST || expected.has(entry.path.toLowerCase())) throw fail('CLIENT_RELEASE', 'Invalid client release file');
    expected.add(entry.path.toLowerCase()); total += entry.bytes;
    if (total > 64 * 1024 * 1024) throw fail('CLIENT_RELEASE', 'Client release exceeds its local integrity limit');
    const checked = await ordinary(path.join(root, ...entry.path.split('/')), 'file');
    if (outside(root, checked.file) || checked.info.size !== entry.bytes || digest(await readFile(checked.file)) !== entry.sha256) throw fail('CLIENT_RELEASE', 'Client release file drift');
  }
  if (!expected.has(CLIENT_RELEASE_ENTRY)) throw fail('CLIENT_RELEASE', 'Client release entrypoint is missing');
  let count = 0;
  async function catalog(folder, prefix = '', depth = 0) {
    if (depth > 32) throw fail('CLIENT_RELEASE', 'Client release directory is too deep');
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const relative = prefix + entry.name, target = path.join(folder, entry.name);
      if (entry.isSymbolicLink()) throw fail('CLIENT_RELEASE', 'Client release links are not accepted');
      if (entry.isDirectory()) await catalog(target, relative + '/', depth + 1);
      else if (entry.isFile() && relative === CLIENT_RELEASE_MANIFEST) continue;
      else if (!entry.isFile() || !expected.has(relative.toLowerCase())) throw fail('CLIENT_RELEASE', 'Client release contains an unlisted file');
      else count++;
    }
  }
  await catalog(root);
  if (count !== expected.size) throw fail('CLIENT_RELEASE', 'Client release catalog changed');
  return { directory: root, manifestSha256: expectedManifestSha256, releaseId: manifest.releaseId,
    entrypoint: path.join(root, ...CLIENT_RELEASE_ENTRY.split('/')), fileCount: count };
}

async function windowsHelper(script, input) {
  if (process.platform !== 'win32') throw fail('CLIENT_WINDOWS', 'Client installation helpers require Windows');
  return new Promise((resolve, reject) => {
    const child = spawn(systemPowerShell(), ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = []; let size = 0;
    const timeout = setTimeout(() => { child.kill(); reject(fail('CLIENT_HELPER', 'Windows client helper timed out')); }, 15000);
    child.on('error', () => { clearTimeout(timeout); reject(fail('CLIENT_HELPER', 'Windows client helper unavailable')); });
    child.stdout.on('data', bytes => { size += bytes.length; if (size > 65536) child.kill(); else chunks.push(bytes); });
    child.stderr.resume(); child.stdin.on('error', () => {}); child.stdin.end(JSON.stringify(input ?? {}));
    child.on('close', code => { clearTimeout(timeout); if (code || size > 65536) reject(fail('CLIENT_HELPER', 'Windows client helper failed')); else resolve(Buffer.concat(chunks).toString('utf8').trim()); });
  });
}
export async function findInstalledCodex() {
  const raw = await windowsHelper(String.raw`$ErrorActionPreference='Stop'
try { Import-Module (Join-Path $PSHOME 'Modules\Appx\Appx.psd1')
  $package=Get-AppxPackage -Name 'OpenAI.Codex' | Sort-Object Version -Descending | Select-Object -First 1
  if(-not $package){throw 'not installed'}
  $exe=Join-Path $package.InstallLocation 'app\ChatGPT.exe'
  if(-not(Test-Path -LiteralPath $exe -PathType Leaf)){throw 'missing executable'}
  @{appId='OpenAI.Codex';executable=(Get-Item -LiteralPath $exe).FullName;packageFullName=$package.PackageFullName} | ConvertTo-Json -Compress
} catch { [Console]::Error.WriteLine('Installed Codex package unavailable');exit 1 }`);
  try { const installed = JSON.parse(raw); if (installed.appId !== APP_ID) throw new Error(); installed.executable = (await ordinary(installed.executable, 'file')).file; return installed; }
  catch { throw fail('CLIENT_INSTALLATION', 'Installed Codex package unavailable'); }
}
export async function findRunningCodex({ executable }) {
  const raw = await windowsHelper(String.raw`$ErrorActionPreference='Stop'
try { $data=[Console]::In.ReadToEnd() | ConvertFrom-Json
  Import-Module (Join-Path $PSHOME 'Modules\CimCmdlets\CimCmdlets.psd1')
  $rows=@(Get-CimInstance Win32_Process -Filter "Name = 'ChatGPT.exe'" | Where-Object {
    (-not $_.ExecutablePath) -or [string]::Equals($_.ExecutablePath,$data.executable,[StringComparison]::OrdinalIgnoreCase)
  } | ForEach-Object { @{pid=[int]$_.ProcessId;pathKnown=[bool]$_.ExecutablePath} })
  ConvertTo-Json -InputObject $rows -Compress
} catch { [Console]::Error.WriteLine('Codex process inspection failed');exit 1 }`, { executable: absolute(executable) });
  try { const rows = JSON.parse(raw); if (!Array.isArray(rows) || rows.some(row => !Number.isSafeInteger(row.pid) || row.pid <= 0)) throw new Error(); return rows; }
  catch { throw fail('CLIENT_PROCESS', 'Codex process inspection was inconclusive'); }
}

export async function launchClient({ callerFile, releaseDirectory, expectedManifestSha256 }, {
  locateClient = findInstalledCodex, runningClients = findRunningCodex, spawnClient = spawn, env = process.env,
} = {}) {
  const recordFile = (await ordinary(callerFile, 'file')).file;
  const release = await verifyClientRelease({ directory: releaseDirectory, expectedManifestSha256 });
  if (!outside(release.directory, recordFile)) throw fail('CLIENT_RECORD', 'Keep caller credentials outside the immutable release');
  await loadCallerRecord(recordFile); // Validate without decrypting before the running-app check.
  let client;
  try { client = await locateClient(); client.executable = (await ordinary(client.executable, 'file')).file; }
  catch { throw fail('CLIENT_INSTALLATION', 'Installed Codex package unavailable'); }
  const check = async () => {
    let rows; try { rows = await runningClients({ executable: client.executable }); } catch { throw fail('CLIENT_PROCESS', 'Codex process inspection was inconclusive'); }
    if (!Array.isArray(rows)) throw fail('CLIENT_PROCESS', 'Codex process inspection was inconclusive');
    if (rows.length) throw fail('CLIENT_ALREADY_RUNNING', 'Codex is already running; quit it normally before using the remote client launcher');
  };
  await check();
  let callerToken, childEnv;
  try {
    ({ callerToken } = await loadCallerRecord(recordFile, { decrypt: true }));
    await check();
    const args = client.args ?? [];
    if (!Array.isArray(args) || args.some(arg => typeof arg !== 'string' || arg.includes(callerToken)) || client.executable.includes(callerToken)) throw new Error();
    childEnv = { ...env, [CALLER_ENVIRONMENT_VARIABLE]: callerToken };
    const child = spawnClient(client.executable, args, { env: childEnv, windowsHide: true, detached: true, stdio: 'ignore' });
    await new Promise((resolve, reject) => { child.once('error', () => reject(new Error())); child.once('spawn', resolve); });
    if (!Number.isSafeInteger(child.pid) || child.pid <= 0) throw new Error();
    child.unref();
    return { started: true, pid: child.pid, appId: APP_ID, releaseId: release.releaseId, manifestSha256: release.manifestSha256 };
  } catch (error) {
    if (error.code === 'CLIENT_ALREADY_RUNNING' || error.code === 'CLIENT_PROCESS' || error.code === 'CLIENT_CREDENTIAL') throw error;
    throw fail('CLIENT_START', 'Client launch failed; no credentials were printed');
  } finally { if (childEnv) delete childEnv[CALLER_ENVIRONMENT_VARIABLE]; callerToken = undefined; }
}

// The PowerShell bootstrap checks every pinned file before loading the Node
// entrypoint. It never decrypts or stores the caller token itself.
export const CLIENT_LAUNCH_TEMPLATE = String.raw`# Generated Deck client launcher v1. No credentials belong in this script.
param([Parameter(Mandatory=$true)][string]$CallerFile,[Parameter(Mandatory=$true)][string]$ReleaseDirectory,[Parameter(Mandatory=$true)][string]$ManifestSha256,[Parameter(Mandatory=$true)][string]$NodeExe)
$ErrorActionPreference='Stop'
$stage='manifest'
function Get-LocalSha256([string]$file){
  $sha=[Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($file))).Replace('-','').ToLowerInvariant() } finally {$sha.Dispose()}
}
try {
  if($ManifestSha256 -notmatch '^[a-f0-9]{64}$'){throw 'missing release digest'}
  $root=(Resolve-Path -LiteralPath $ReleaseDirectory).ProviderPath
  if((Get-Item -LiteralPath $root -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'release link'}
  $manifestFile=Join-Path $root 'client-release.json'
  if((Get-Item -LiteralPath $manifestFile -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'manifest link'}
  if((Get-LocalSha256 $manifestFile) -cne $ManifestSha256){throw 'manifest drift'}
  $manifest=Get-Content -LiteralPath $manifestFile -Raw | ConvertFrom-Json
  if($manifest.schemaVersion -ne 1 -or $manifest.kind -cne 'deck-client-launcher-release' -or $manifest.entrypoint -cne 'prototypes/remote-companion/client-launch.mjs' -or -not $manifest.files -or @($manifest.files).Count -gt 2000){throw 'release declaration'}
  $expected=@{}
  $stage='files'
  foreach($entry in $manifest.files){
    $relative=[string]$entry.path
    if($relative -match '[\\:\x00-\x1f\x7f]' -or $relative.StartsWith('/') -or @($relative.Split('/') | Where-Object {$_ -eq '' -or $_ -eq '.' -or $_ -eq '..' -or $_ -eq '.git' -or $_ -eq 'node_modules'}).Count){throw 'release path'}
    $file=Join-Path $root $relative.Replace('/','\')
    $item=Get-Item -LiteralPath $file -Force
    if($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $item.Length -ne $entry.bytes -or (Get-LocalSha256 $file) -cne $entry.sha256){throw 'release file drift'}
    $key=$item.FullName.ToLowerInvariant();if($expected.ContainsKey($key)){throw 'duplicate release file'};$expected[$key]=$true
  }
  function Test-ReleaseCatalog([string]$folder){
    foreach($item in Get-ChildItem -LiteralPath $folder -Force){
      if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'release link'}
      if($item.PSIsContainer){Test-ReleaseCatalog $item.FullName}
      elseif($item.FullName -ine $manifestFile -and -not $expected.ContainsKey($item.FullName.ToLowerInvariant())){throw 'extra release file'}
    }
  }
  Test-ReleaseCatalog $root
  $stage='entrypoint'
  $entrypoint=Join-Path $root 'prototypes\remote-companion\client-launch.mjs'
  if(-not $expected.ContainsKey($entrypoint.ToLowerInvariant())){throw 'missing release entrypoint'}
  & $NodeExe $entrypoint 'start' $CallerFile '--release-dir' $root '--manifest-sha256' $ManifestSha256
  exit $LASTEXITCODE
} catch { [Console]::Error.WriteLine('Deck client launcher failed at '+$stage+'. Check the local release and credential record.');exit 1 }
`;
function windowsArgument(value) { return '"' + String(value).replace(/(\\*)"/g, '$1$1\\"').replace(/\\+$/, '$&$&') + '"'; }
export async function planClientShortcut({ callerFile, releaseDirectory, expectedManifestSha256 }, { shortcutDirectory, nodeExecutable = process.execPath } = {}) {
  const recordFile = (await ordinary(callerFile, 'file')).file, record = await loadCallerRecord(recordFile);
  const release = await verifyClientRelease({ directory: releaseDirectory, expectedManifestSha256 });
  if (!outside(release.directory, recordFile)) throw fail('CLIENT_RECORD', 'Keep caller credentials outside the immutable release');
  const folder = shortcutDirectory === undefined ? await windowsHelper("[Console]::Out.Write([Environment]::GetFolderPath('DesktopDirectory'))") : shortcutDirectory;
  const directory = absolute(folder), node = (await ordinary(nodeExecutable, 'file')).file;
  const launcher = recordFile + '.client-launch.ps1', shortcut = path.join(directory, `Deck Codex Remote-${record.credentialId}.lnk`);
  return { credentialId: record.credentialId, callerFile: recordFile, releaseDirectory: release.directory, expectedManifestSha256,
    launcher, shortcut, target: systemPowerShell(), nodeExecutable: node, workingDirectory: path.dirname(recordFile), script: CLIENT_LAUNCH_TEMPLATE,
    arguments: ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', launcher, '-CallerFile', recordFile,
      '-ReleaseDirectory', release.directory, '-ManifestSha256', expectedManifestSha256, '-NodeExe', node].map(windowsArgument).join(' ') };
}
export async function writeClientShortcut(options, { shortcutDirectory, nodeExecutable, dryRun = true } = {}) {
  const plan = await planClientShortcut(options, { shortcutDirectory, nodeExecutable });
  if (dryRun) return { ...plan, dryRun: true, backups: [] };
  const backups = [];
  for (const target of [plan.launcher, plan.shortcut]) {
    const backup = await backupFile(target);
    if (backup) backups.push({ target, backup, sha256: digest(await readFile(backup)) });
  }
  await mkdir(path.dirname(plan.shortcut), { recursive: true }); await ordinary(path.dirname(plan.shortcut), 'directory');
  const temporaryScript = plan.launcher + '.tmp-' + randomUUID(), temporaryShortcut = plan.shortcut + '.tmp-' + randomUUID() + '.lnk';
  try {
    await writeFile(temporaryScript, plan.script, { flag: 'wx', mode: 0o600 });
    await windowsHelper(String.raw`$ErrorActionPreference='Stop'
try { $data=[Console]::In.ReadToEnd() | ConvertFrom-Json;$shell=New-Object -ComObject WScript.Shell;$link=$shell.CreateShortcut($data.file)
  $link.TargetPath=$data.target;$link.Arguments=$data.arguments;$link.WorkingDirectory=$data.workingDirectory
  $link.Description='Deck remote caller launcher (manual pinned release)';$link.WindowStyle=7;$link.Save();[Console]::Out.Write('saved')
} catch { [Console]::Error.WriteLine('Client shortcut creation failed');exit 1 }`, { file: temporaryShortcut, target: plan.target, arguments: plan.arguments, workingDirectory: plan.workingDirectory });
    await rename(temporaryScript, plan.launcher); await rename(temporaryShortcut, plan.shortcut);
  } finally { await unlink(temporaryScript).catch(() => {}); await unlink(temporaryShortcut).catch(() => {}); }
  return { ...plan, dryRun: false, backups };
}
export async function restoreClientShortcutBackups(installation, { dryRun = true } = {}) {
  const allowed = new Set([absolute(installation.launcher), absolute(installation.shortcut)]), entries = installation.backups;
  if (!Array.isArray(entries) || entries.some(entry => !plain(entry) || typeof entry.target !== 'string' || !allowed.has(absolute(entry.target)) ||
      typeof entry.backup !== 'string' || !entry.backup.startsWith(entry.target + '.backup-') || !HASH.test(entry.sha256 ?? ''))) throw fail('CLIENT_BACKUP', 'Use the retained local shortcut backup record');
  for (const entry of entries) if (digest(await readFile((await ordinary(entry.backup, 'file')).file)) !== entry.sha256) throw fail('CLIENT_BACKUP', 'Client shortcut backup changed');
  if (dryRun) return { dryRun: true, count: entries.length };
  const displaced = [];
  for (const entry of entries) { const backup = await backupFile(entry.target); if (backup) displaced.push(backup); await copyFile(entry.backup, entry.target); }
  return { dryRun: false, restored: entries.length, displaced };
}

async function credentialInput() {
  if (process.env[CALLER_ENVIRONMENT_VARIABLE]) return token(process.env[CALLER_ENVIRONMENT_VARIABLE]);
  if (process.stdin.isTTY) throw fail('CLIENT_CREDENTIAL', 'Supply the caller credential through local environment or secure stdin');
  const chunks = []; let size = 0;
  for await (const bytes of process.stdin) { size += bytes.length; if (size > 4098) throw fail('CLIENT_CREDENTIAL', 'Caller input is too large'); chunks.push(bytes); }
  return token(Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, ''));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [command, callerFile, ...args] = process.argv.slice(2);
    if (!callerFile) throw fail('CLIENT_ARGUMENTS', 'Choose a local caller record');
    let result;
    if (command === 'pair' && args.length === 0) result = await createCallerRecord({ file: callerFile, callerToken: await credentialInput() });
    else {
      if (args.length !== 4 || args[0] !== '--release-dir' || args[2] !== '--manifest-sha256') throw fail('CLIENT_ARGUMENTS', 'Choose the fixed client release and manifest digest');
      const options = { callerFile, releaseDirectory: args[1], expectedManifestSha256: args[3] };
      if (command === 'start') result = await launchClient(options);
      else if (command === 'shortcut-plan') result = { ...await planClientShortcut(options), dryRun: true };
      else throw fail('CLIENT_ARGUMENTS', 'Unknown local client command');
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    const code = /^CLIENT_[A-Z_]+$/.test(error.code ?? '') ? error.code : 'CLIENT_FAILURE';
    console.error(`Client launcher failed (${code}). Check the approved release, local caller record, and whether Codex is already running; quit it normally before retrying.`);
    process.exitCode = 1;
  }
}
