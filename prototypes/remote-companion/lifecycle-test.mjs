import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, stat, readdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { protectDeviceToken, unprotectDeviceToken, createPairing, loadPairing, pairingStatus, requestStop, revokePairing,
  createRuntimeControl, planAutostart, installAutostart, removeAutostart } from './lifecycle.mjs';

const scratch = fileURLToPath(new URL('../../.scratch/', import.meta.url));
const windows = { skip: process.platform !== 'win32' };
async function fixture() {
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(path.join(scratch, 'companion-lifecycle-'));
  const file = path.join(directory, 'pairing.json'), journalPath = path.join(directory, 'journal.sqlite');
  const deviceToken = randomBytes(32).toString('hex');
  const adapterPath = fileURLToPath(new URL('../upstream-port/sidebar-server.mjs', import.meta.url));
  const config = await createPairing({ file, relayOrigin: 'https://relay.example.invalid', adapterPath, journalPath, deviceToken });
  return { directory, file, journalPath, deviceToken, adapterPath, config };
}
async function until(predicate, limit = 4000) {
  const started = Date.now();
  while (!await predicate()) { if (Date.now() - started > limit) throw new Error('Local lifecycle condition did not complete'); await new Promise(resolve => setTimeout(resolve, 25)); }
}

test('DPAPI CurrentUser protects/retrieves token and binds ciphertext to pairing entropy', windows, async () => {
  const token = randomBytes(32).toString('hex'), id = randomUUID();
  const protectedValue = await protectDeviceToken(token, id);
  assert.equal(protectedValue.includes(token), false);
  assert.equal(await unprotectDeviceToken(protectedValue, id), token);
  await assert.rejects(unprotectDeviceToken(protectedValue, randomUUID()), /failed/);
});

test('new pairing refuses overwrite, uses no plaintext credential and rejects changed policy/version', windows, async () => {
  const f = await fixture();
  assert.equal((await loadPairing(f.file, { decrypt: true })).deviceToken, f.deviceToken);
  assert.equal((await readFile(f.file, 'utf8')).includes(f.deviceToken), false);
  assert.equal(JSON.stringify(await pairingStatus(f.file)).includes('secretDPAPI'), false);
  await assert.rejects(createPairing({ ...f, relayOrigin: 'https://relay.example.invalid' }), /already exists/);
  const original = await readFile(f.file, 'utf8');
  const config = JSON.parse(original); config.writeEnabled = true;
  await writeFile(f.file, JSON.stringify(config));
  await assert.rejects(loadPairing(f.file), /policy/);
  config.writeEnabled = false; config.protocolVersion = 2;
  await writeFile(f.file, JSON.stringify(config));
  await assert.rejects(loadPairing(f.file), /incompatible/);
  await writeFile(f.file, original);
  await assert.rejects(createPairing({ file: path.join(f.directory, 'bad.json'), relayOrigin: 'http://remote.invalid', adapterPath: f.adapterPath, journalPath: f.journalPath, deviceToken: f.deviceToken }), /HTTPS/);
});

test('runtime status and stop address exact instance without killing unrelated PIDs', windows, async t => {
  const f = await fixture(); let stopped = 0;
  const control = await createRuntimeControl(f.file, { intervalMs: 25, onStop: async () => { stopped++; } });
  t.after(() => control.close());
  await control.setState('connected');
  assert.equal((await pairingStatus(f.file)).state, 'connected');
  await assert.rejects(createRuntimeControl(f.file), /already owns/);
  assert.equal((await requestStop(f.file)).instanceId, control.instanceId);
  await until(() => stopped === 1);
  await new Promise(resolve => setTimeout(resolve, 75)); assert.equal(stopped, 1);
  await control.close();
  assert.equal((await pairingStatus(f.file)).running, false);
  // The previous stop marker cannot stop the next instance.
  const next = await createRuntimeControl(f.file, { intervalMs: 25, onStop: async () => { stopped++; } });
  await new Promise(resolve => setTimeout(resolve, 75)); assert.equal(stopped, 1); await next.close();
});

test('revocation persists in config+marker+journal and restoring config backup does not reactivate', windows, async t => {
  const f = await fixture(); let revoked = false;
  const control = await createRuntimeControl(f.file, { intervalMs: 25, onRevoke: async () => { revoked = true; } });
  t.after(() => control.close());
  const result = await revokePairing(f.file);
  assert.ok(result.backup); assert.equal((await pairingStatus(f.file)).revoked, true);
  await until(() => revoked);
  const database = new DatabaseSync(f.journalPath, { readOnly: true });
  assert.equal(database.prepare("SELECT value FROM settings WHERE key='revoked'").get().value, 'true'); database.close();
  await copyFile(result.backup, f.file);
  await assert.rejects(loadPairing(f.file, { decrypt: true }), /revoked/);
  assert.equal((await revokePairing(f.file)).revoked, true);
});

test('autostart dry-run makes no files; isolated shortcut install/removal keeps recoverable backup', windows, async () => {
  const f = await fixture(), startup = path.join(f.directory, 'isolated-startup');
  const before = await readdir(f.directory);
  const plan = await planAutostart(f.file, { startupDirectory: startup });
  assert.ok(plan.arguments.includes('Hidden')); assert.ok(plan.arguments.includes('launch.mjs'));
  assert.equal(plan.arguments.includes(f.deviceToken), false);
  assert.equal((await installAutostart(f.file, { startupDirectory: startup })).dryRun, true);
  assert.deepEqual(await readdir(f.directory), before);
  const installed = await installAutostart(f.file, { startupDirectory: startup, dryRun: false });
  assert.ok((await stat(installed.shortcut)).size > 0);
  const firstLauncher = await readFile(installed.launcher, 'utf8');
  assert.equal(firstLauncher.includes(f.deviceToken), false);
  const second = await installAutostart(f.file, { startupDirectory: startup, dryRun: false });
  assert.equal(second.backups.length, 2);
  assert.equal(await readFile(second.backups.find(p => p.includes('.ps1.backup-')), 'utf8'), firstLauncher);
  const removed = await removeAutostart(f.file, { startupDirectory: startup, dryRun: false });
  assert.equal(removed.removed, true); assert.ok((await stat(removed.backup)).size > 0);
  await assert.rejects(stat(installed.shortcut), { code: 'ENOENT' });
  await revokePairing(f.file);
  assert.equal((await removeAutostart(f.file, { startupDirectory: startup })).exists, false);
});
