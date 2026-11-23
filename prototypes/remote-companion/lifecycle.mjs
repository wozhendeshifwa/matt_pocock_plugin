import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile, rename, unlink, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { bridgeUrl, secret, VERSION } from './protocol.mjs';
import { normalizeWriteGrant } from './write-grant.mjs';
import { resolveAdapterDataLayout } from './local-data-layout.mjs';

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const DPAPI_SCRIPT = `$ErrorActionPreference='Stop'
try {
  Add-Type -AssemblyName System.Security
  $data = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $bytes = [Convert]::FromBase64String($data.value)
  $entropy = [Text.Encoding]::UTF8.GetBytes($data.entropy)
  if ($data.operation -eq 'protect') {
    $result = [Security.Cryptography.ProtectedData]::Protect($bytes,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
  } elseif ($data.operation -eq 'unprotect') {
    $result = [Security.Cryptography.ProtectedData]::Unprotect($bytes,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
  } else { throw 'Unknown operation' }
  [Console]::Out.Write([Convert]::ToBase64String($result))
} catch { [Console]::Error.WriteLine('DPAPI operation failed'); exit 1 }`;
const SHORTCUT_SCRIPT = `$ErrorActionPreference='Stop'
try {
  $data=[Console]::In.ReadToEnd() | ConvertFrom-Json
  $shell=New-Object -ComObject WScript.Shell
  $shortcut=$shell.CreateShortcut($data.file)
  $shortcut.TargetPath=$data.target
  $shortcut.Arguments=$data.arguments
  $shortcut.WorkingDirectory=$data.workingDirectory
  $shortcut.Description='Deck local companion (manual updates; protocol 1)'
  $shortcut.WindowStyle=7
  $shortcut.Save()
  [Console]::Out.Write('saved')
} catch { [Console]::Error.WriteLine('Shortcut operation failed'); exit 1 }`;
const LAUNCH_SCRIPT = `param([Parameter(Mandatory=$true)][string]$PairingFile,[Parameter(Mandatory=$true)][string]$CompanionFile,[Parameter(Mandatory=$true)][string]$NodeExe)
$ErrorActionPreference='Stop'
& $NodeExe $CompanionFile '--pairing' $PairingFile
exit $LASTEXITCODE
`;

async function powershell(script, input) {
  if (process.platform !== 'win32') throw new Error('Windows DPAPI/lifecycle operation requires Windows');
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = []; let size = 0;
    const timer = setTimeout(() => { child.kill(); reject(new Error('Windows lifecycle operation timed out')); }, 15000);
    child.on('error', () => { clearTimeout(timer); reject(new Error('Windows lifecycle helper unavailable')); });
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > 32768) { child.kill(); return; }
      chunks.push(chunk);
    });
    child.stderr.resume(); // Do not forward exceptions that might contain data.
    child.on('exit', code => {
      clearTimeout(timer);
      if (code !== 0 || size > 32768) reject(new Error('Windows lifecycle operation failed'));
      else resolve(Buffer.concat(chunks).toString('utf8').trim());
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(input));
  });
}
export async function protectDeviceToken(deviceToken, pairingId) {
  secret(deviceToken);
  if (deviceToken.length > 4096) throw new Error('Device token is too large');
  if (!UUID.test(pairingId)) throw new Error('Invalid pairing id');
  return powershell(DPAPI_SCRIPT, { operation: 'protect', entropy: pairingId, value: Buffer.from(deviceToken).toString('base64') });
}
export async function unprotectDeviceToken(secretDPAPI, pairingId) {
  if (!UUID.test(pairingId) || typeof secretDPAPI !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(secretDPAPI) || secretDPAPI.length > 16384) throw new Error('Invalid DPAPI envelope');
  const encoded = await powershell(DPAPI_SCRIPT, { operation: 'unprotect', entropy: pairingId, value: secretDPAPI });
  return secret(Buffer.from(encoded, 'base64').toString('utf8'));
}
function absolute(file, name) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) throw new Error(`${name} must be an absolute local path`);
  return path.resolve(file);
}
async function readJson(file) {
  const info = await stat(file);
  if (!info.isFile() || info.size > 32768) throw new Error('Invalid local lifecycle file');
  return JSON.parse(await readFile(file, 'utf8'));
}
async function exists(file) { try { await stat(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
function sidecar(file, suffix) { return absolute(file, 'Pairing file') + suffix; }
export async function backupFile(file) {
  if (!await exists(file)) return null;
  const backup = `${file}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`;
  await copyFile(file, backup, 1); // COPYFILE_EXCL
  return backup;
}
async function replaceJson(file, value) {
  const backup = await backupFile(file);
  const temporary = file + '.tmp-' + randomUUID();
  try { await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); await rename(temporary, file); }
  finally { await unlink(temporary).catch(() => {}); }
  return backup;
}
function validateConfig(config) {
  if (!config || config.protocolVersion !== VERSION) throw new Error('Pairing protocol is incompatible; update manually');
  if (!UUID.test(config.pairingId ?? '') || typeof config.writeEnabled !== 'boolean' || typeof config.revoked !== 'boolean') throw new Error('Invalid local pairing policy');
  const grant = normalizeWriteGrant(config.writeGrant);
  if (config.writeEnabled && !grant) throw new Error('Invalid local pairing policy: an explicit project/method write grant is required');
  if (Object.hasOwn(config, 'writeLedgerPath') || Object.hasOwn(config, 'writeLedgerFile')) throw new Error('Invalid local pairing policy: the installation write ledger is not a pairing setting');
  bridgeUrl(config.relayOrigin);
  absolute(config.adapterPath, 'Adapter'); absolute(config.journalPath, 'Journal');
  if (config.localDataRoot !== undefined) absolute(config.localDataRoot, 'Local data root');
  if (config.baseline !== undefined && (!config.baseline || !path.isAbsolute(config.baseline.directory ?? '') || !/^[a-f0-9]{64}$/.test(config.baseline.manifestSha256 ?? ''))) throw new Error('Invalid pinned baseline');
  if (typeof config.secretDPAPI !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(config.secretDPAPI) || config.secretDPAPI.length > 16384) throw new Error('Invalid encrypted credential');
  return config;
}
function publicConfig(config) {
  const { secretDPAPI, deviceToken, ...visible } = config;
  return visible;
}
export async function createPairing({ file, relayOrigin, adapterPath, journalPath, deviceToken, baseline, localDataRoot, writeEnabled = false, writeGrant }) {
  const target = absolute(file, 'Pairing file');
  const adapter = await realpath(absolute(adapterPath, 'Adapter'));
  if (!(await stat(adapter)).isFile()) throw new Error('Adapter must be an existing file');
  const journal = absolute(journalPath, 'Journal');
  const layout = localDataRoot === undefined ? null : await resolveAdapterDataLayout({ adapterPath: adapter, localDataRoot });
  const origin = bridgeUrl(relayOrigin);
  secret(deviceToken);
  // Protect before opening the new file. Never overwrite an old pairing, even
  // if it has been revoked or the caller chose the same endpoint again.
  if (await exists(target) || await exists(sidecar(target, '.revoked'))) throw new Error('Pairing file already exists; select a new local file');
  const pairingId = randomUUID();
  const config = { protocolVersion: VERSION, pairingId, relayOrigin: origin, adapterPath: adapter, journalPath: journal,
    ...(baseline ? { baseline } : {}),
    ...(layout ? { localDataRoot: layout.root } : {}),
    secretDPAPI: await protectDeviceToken(deviceToken, pairingId), writeEnabled,
    ...(writeGrant === undefined ? {} : { writeGrant: normalizeWriteGrant(writeGrant) }), revoked: false, createdAt: new Date().toISOString() };
  validateConfig(config);
  await mkdir(path.dirname(target), { recursive: true });
  await mkdir(path.dirname(journal), { recursive: true });
  await writeFile(target, JSON.stringify(config, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return publicConfig(config);
}
export async function loadPairing(file, { decrypt = false, allowRevoked = false } = {}) {
  const target = absolute(file, 'Pairing file');
  const config = validateConfig(await readJson(target));
  if (config.localDataRoot !== undefined) await resolveAdapterDataLayout({ adapterPath: config.adapterPath, localDataRoot: config.localDataRoot });
  const revoked = config.revoked || await exists(sidecar(target, '.revoked'));
  if (revoked && !allowRevoked) throw new Error('Pairing revoked locally; create a new pairing instead of restoring it');
  if (!decrypt) return { ...config, revoked };
  if (revoked) throw new Error('Cannot decrypt a revoked pairing');
  return { ...config, deviceToken: await unprotectDeviceToken(config.secretDPAPI, config.pairingId) };
}
export async function pairingStatus(file) {
  const config = await loadPairing(file, { allowRevoked: true });
  let runtime = null;
  try { runtime = await readJson(sidecar(file, '.runtime.json')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const fresh = runtime?.pairingId === config.pairingId && UUID.test(runtime.instanceId ?? '') && Date.now() - runtime.updatedAt < 15000;
  return { ...publicConfig(config), state: config.revoked ? 'revoked' : fresh ? runtime.state : 'stopped-or-unresponsive',
    running: Boolean(fresh) && !config.revoked, ...(fresh ? { pid: runtime.pid, instanceId: runtime.instanceId, updatedAt: runtime.updatedAt } : {}) };
}
export async function requestStop(file) {
  const config = await loadPairing(file, { allowRevoked: true });
  let runtime;
  try { runtime = await readJson(sidecar(file, '.runtime.json')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!runtime || runtime.pairingId !== config.pairingId || !UUID.test(runtime.instanceId ?? '')) return { requested: false, reason: 'not-running' };
  const backup = await replaceJson(sidecar(file, '.stop.json'), { pairingId: config.pairingId, instanceId: runtime.instanceId, requestedAt: Date.now() });
  return { requested: true, instanceId: runtime.instanceId, backup };
}
export async function revokePairing(file) {
  const target = absolute(file, 'Pairing file');
  const config = await loadPairing(target, { allowRevoked: true });
  // A separate durable marker makes restoring an older config backup insufficient
  // to reactivate this pairing. Cloud restarts cannot remove this local marker.
  try { await writeFile(sidecar(target, '.revoked'), JSON.stringify({ pairingId: config.pairingId, revokedAt: Date.now() }) + '\n', { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const backup = config.revoked ? null : await replaceJson(target, { ...config, revoked: true, revokedAt: new Date().toISOString() });
  // Do not instantiate Journal: its startup crash recovery must not run against
  // a live companion when a separate management process revokes a pairing.
  const database = new DatabaseSync(config.journalPath);
  try { database.exec("PRAGMA busy_timeout=2000; CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY,value TEXT NOT NULL);");
    database.prepare("INSERT OR REPLACE INTO settings VALUES ('revoked','true')").run(); }
  finally { database.close(); }
  return { pairingId: config.pairingId, revoked: true, backup };
}

export async function createRuntimeControl(file, { onStop = async () => {}, onRevoke = async () => {}, intervalMs = 1000,
  heartbeatRename = rename, heartbeatRetries = 20, heartbeatRetryDelayMs = 10 } = {}) {
  if (typeof heartbeatRename !== 'function' || !Number.isSafeInteger(heartbeatRetries) || heartbeatRetries < 1 || heartbeatRetries > 50 ||
      !Number.isSafeInteger(heartbeatRetryDelayMs) || heartbeatRetryDelayMs < 1 || heartbeatRetryDelayMs > 50) throw new Error('Use bounded local heartbeat I/O');
  const config = await loadPairing(file);
  const runtimeFile = sidecar(file, '.runtime.json');
  const instanceId = randomUUID();
  let state = 'starting', closed = false, notified = false, busy = false, writes = Promise.resolve();
  // Existing stale status files are backed up before replacement; never use
  // their PID to kill a process. A live owner must release its own file.
  let previous = null;
  try { previous = await readJson(runtimeFile); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (previous?.pid && Number.isInteger(previous.pid)) {
    try { process.kill(previous.pid, 0); throw new Error('A companion runtime already owns this pairing'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  if (previous) { await backupFile(runtimeFile); await unlink(runtimeFile); }
  const value = () => ({ pairingId: config.pairingId, instanceId, pid: process.pid, state, updatedAt: Date.now() });
  await writeFile(runtimeFile, JSON.stringify(value()) + '\n', { flag: 'wx', mode: 0o600 });
  function publish() {
    const work = writes.then(async () => {
      if (closed) return;
      const owner = await readJson(runtimeFile);
      if (owner.instanceId !== instanceId) throw new Error('Runtime ownership changed');
      const temporary = runtimeFile + '.tmp-' + instanceId;
      try {
        await writeFile(temporary, JSON.stringify(value()) + '\n', { mode: 0o600 });
        for (let attempt = 0; ; attempt++) {
          if (closed) return;
          // Windows can briefly deny destination replacement with a native
          // sharing error. Retain the last valid owner and retry only that
          // specific native failure; never publish over another instance.
          const current = await readJson(runtimeFile);
          if (current.instanceId !== instanceId) throw new Error('Runtime ownership changed');
          try { await heartbeatRename(temporary, runtimeFile); break; }
          catch (error) {
            if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt + 1 >= heartbeatRetries) throw error;
            if (closed) return;
            await new Promise(resolve => setTimeout(resolve, heartbeatRetryDelayMs));
          }
        }
      }
      finally { await unlink(temporary).catch(() => {}); }
    });
    writes = work.catch(() => {});
    return work;
  }
  const timer = setInterval(async () => {
    if (closed || busy) return;
    busy = true;
    try {
      if (!notified && (await exists(sidecar(file, '.revoked')) || (await readJson(file)).revoked)) {
        notified = true; state = 'revoked';
        // Status is diagnostic. A failed publish must never suppress the
        // authoritative revoke callback after notified has already been set.
        try { await publish(); } finally { await onRevoke(); }
      } else if (!notified) {
        let stop = null;
        try { stop = await readJson(sidecar(file, '.stop.json')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (stop?.pairingId === config.pairingId && stop.instanceId === instanceId) {
          notified = true; state = 'stopping'; try { await publish(); } finally { await onStop(); }
        }
      }
      await publish();
    } catch { if (!notified) { notified = true; await onStop(); } }
    finally { busy = false; }
  }, intervalMs);
  timer.unref();
  return { instanceId, async setState(next) {
    if (typeof next !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(next)) throw new Error('Invalid runtime state');
    state = next; await publish();
  }, async close() {
    closed = true; clearInterval(timer);
    await writes;
    try { const owner = await readJson(runtimeFile); if (owner.instanceId === instanceId) await unlink(runtimeFile); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  } };
}

function windowsArgument(value) { return '"' + String(value).replace(/(\\*)"/g, '$1$1\\"').replace(/\\+$/, '$&$&') + '"'; }
export async function planAutostart(file, { startupDirectory } = {}) {
  const target = absolute(file, 'Pairing file');
  const config = await loadPairing(target);
  const startup = absolute(startupDirectory ?? path.join(process.env.APPDATA ?? '', 'Microsoft/Windows/Start Menu/Programs/Startup'), 'Startup directory');
  const launcher = target + '.startup.ps1';
  const companion = fileURLToPath(new URL('./launch.mjs', import.meta.url));
  const powershellExe = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  return { pairingId: config.pairingId, shortcut: path.join(startup, `Deck Companion-${config.pairingId}.lnk`), launcher,
    target: powershellExe, arguments: ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-File', launcher,
      '-PairingFile', target, '-CompanionFile', companion, '-NodeExe', process.execPath].map(windowsArgument).join(' '),
    workingDirectory: path.dirname(target), node: process.execPath, companion, script: LAUNCH_SCRIPT };
}
export async function installAutostart(file, { startupDirectory, dryRun = true } = {}) {
  const plan = await planAutostart(file, { startupDirectory });
  if (dryRun) return { ...plan, dryRun: true };
  const backups = [];
  const launcherBackup = await backupFile(plan.launcher); if (launcherBackup) backups.push(launcherBackup);
  await writeFile(plan.launcher, plan.script, { mode: 0o600 });
  await mkdir(path.dirname(plan.shortcut), { recursive: true });
  const shortcutBackup = await backupFile(plan.shortcut); if (shortcutBackup) backups.push(shortcutBackup);
  const temporary = plan.shortcut + '.tmp-' + randomUUID() + '.lnk';
  try {
    await powershell(SHORTCUT_SCRIPT, { file: temporary, target: plan.target, arguments: plan.arguments, workingDirectory: plan.workingDirectory });
    await rename(temporary, plan.shortcut);
  } finally { await unlink(temporary).catch(() => {}); }
  return { shortcut: plan.shortcut, launcher: plan.launcher, dryRun: false, backups };
}
export async function removeAutostart(file, { startupDirectory, dryRun = true } = {}) {
  // Removal remains possible after revocation. Do not decrypt any credentials.
  const config = await loadPairing(file, { allowRevoked: true });
  const startup = absolute(startupDirectory ?? path.join(process.env.APPDATA ?? '', 'Microsoft/Windows/Start Menu/Programs/Startup'), 'Startup directory');
  const shortcut = path.join(startup, `Deck Companion-${config.pairingId}.lnk`);
  if (dryRun) return { shortcut, dryRun: true, exists: await exists(shortcut) };
  const backup = await backupFile(shortcut);
  if (backup) await unlink(shortcut);
  return { shortcut, dryRun: false, removed: Boolean(backup), backup };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [command, file, ...args] = process.argv.slice(2);
    if (!file) throw new Error('Missing local configuration');
    let result;
    if (command === 'status') result = await pairingStatus(file);
    else if (command === 'stop') result = await requestStop(file);
    else if (command === 'revoke') result = await revokePairing(file);
    else if (command === 'pair') result = await createPairing({ file, relayOrigin: process.env.DECK_RELAY_ORIGIN,
      adapterPath: process.env.DECK_LOCAL_ADAPTER, journalPath: process.env.DECK_LOCAL_JOURNAL, deviceToken: process.env.DECK_DEVICE_TOKEN,
      ...(process.env.DECK_LOCAL_DATA_ROOT === undefined ? {} : { localDataRoot: process.env.DECK_LOCAL_DATA_ROOT }),
      ...(process.env.DECK_FROZEN_DIRECTORY ? { baseline: { directory: process.env.DECK_FROZEN_DIRECTORY, manifestSha256: process.env.DECK_FROZEN_MANIFEST_SHA256 } } : {}) });
    else if (command === 'autostart-plan') result = await planAutostart(file);
    else if (command === 'autostart-install') result = await installAutostart(file, { dryRun: !args.includes('--apply') });
    else if (command === 'autostart-remove') result = await removeAutostart(file, { dryRun: !args.includes('--apply') });
    else throw new Error('Unknown lifecycle command');
    console.log(JSON.stringify(result, null, 2));
  } catch {
    console.error('Lifecycle command failed. Check local paths, protocol, Windows user and pairing status; no credentials were printed.');
    process.exitCode = 1;
  }
}
