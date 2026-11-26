import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { atomicJson } from './engine.mjs';
test('Windows transient read handle does not lose the durable replacement', { skip: process.platform !== 'win32' }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-state-lock-'));
  const file = path.join(root, 'state.json'), ready = path.join(root, 'ready');
  atomicJson(file, { n: 1 });
  const escaped = value => `'${value.replaceAll("'", "''")}'`;
  const child = spawn('powershell.exe', ['-NoProfile', '-Command', `$s=[IO.File]::Open(${escaped(file)},'Open','Read','Read');[IO.File]::WriteAllText(${escaped(ready)},'ready');Start-Sleep -Milliseconds 80;$s.Dispose()`], { windowsHide: true, stdio: 'ignore' });
  while (!fs.existsSync(ready)) await new Promise(r => setTimeout(r, 5));
  let error;
  try { atomicJson(file, { n: 2 }); } catch (e) { error = e; }
  await new Promise(resolve => { if (child.exitCode !== null) resolve(); else child.once('exit', resolve); });
  assert.equal(error?.code, undefined, `Transient handle rejected state replacement: ${error?.code}`);
  assert.equal(JSON.parse(fs.readFileSync(file)).n, 2);
  const relative = path.relative(os.tmpdir(), root);
  assert.ok(relative.startsWith('sandbox-state-lock-') && !relative.includes('..'));
  fs.rmSync(root, { recursive: true });
});
