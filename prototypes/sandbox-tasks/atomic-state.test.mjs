import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { atomicJson } from './engine.mjs';
async function readLock(file, holdMs) {
  const ready = file + '.ready';
  const escaped = value => `'${value.replaceAll("'", "''")}'`;
  const child = spawn('powershell.exe', ['-NoProfile', '-Command', `$s=[IO.File]::Open(${escaped(file)},'Open','Read','Read');try{[IO.File]::WriteAllText(${escaped(ready)},'ready');Start-Sleep -Milliseconds ${holdMs}}finally{$s.Dispose()}`], { windowsHide: true, stdio: 'ignore' });
  let error;
  const exit = new Promise(resolve => { child.once('exit', resolve); child.once('error', e => { error = e; resolve(); }); });
  const close = async () => { if (child.exitCode === null && !error) child.kill(); await exit; };
  const deadline = Date.now() + 15000;
  while (!fs.existsSync(ready)) {
    if (error || child.exitCode !== null || Date.now() > deadline) { await close(); throw error ?? new Error('File-lock fixture did not become ready.'); }
    await new Promise(r => setTimeout(r, 5));
  }
  return { close };
}
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-state-lock-'));
  const file = path.join(root, 'state.json'); atomicJson(file, { n: 1 });
  return { root, file, clean() {
    const relative = path.relative(os.tmpdir(), fs.realpathSync(root));
    assert.ok(relative.startsWith('sandbox-state-lock-') && !relative.includes('..'));
    fs.rmSync(root, { recursive: true });
  } };
}

test('Windows transient read handle does not lose the durable replacement', { skip: process.platform !== 'win32' }, async () => {
  const { root, file, clean } = fixture(); let lock;
  try {
    lock = await readLock(file, 600);
    atomicJson(file, { n: 2 });
    assert.equal(JSON.parse(fs.readFileSync(file)).n, 2);
    assert.equal(fs.readdirSync(root).some(name => name.endsWith('.tmp')), false);
  } finally { await lock?.close(); clean(); }
});

test('Windows persistent read lock reports failure and preserves the old state without temp files', { skip: process.platform !== 'win32' }, async () => {
  const { root, file, clean } = fixture(); let lock;
  try {
    lock = await readLock(file, 10000);
    assert.throws(() => atomicJson(file, { n: 2 }), error => ['EPERM', 'EBUSY', 'EACCES'].includes(error.code));
    assert.deepEqual(JSON.parse(fs.readFileSync(file)), { n: 1 });
    assert.equal(fs.readdirSync(root).some(name => name.endsWith('.tmp')), false);
  } finally { await lock?.close(); clean(); }
});
