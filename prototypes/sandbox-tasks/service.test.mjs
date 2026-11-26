import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { serve, callService } from './service.mjs';

test('real private IPC authenticates, scopes projects, and refuses a second scheduler', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-ipc-'));
  const config = { directory: path.join(directory, 'data'), token: randomBytes(32).toString('hex') };
  const file = path.join(directory, 'config.json');
  fs.writeFileSync(file, JSON.stringify(config));
  const app = await serve(config);
  try {
    assert.equal((await callService(directory, 'list', {}, file)).limit, 2);
    await assert.rejects(() => serve(config), error => error.code === 'EADDRINUSE');
    const badFile = path.join(directory, 'bad-config.json');
    fs.writeFileSync(badFile, JSON.stringify({ ...config, token: randomBytes(32).toString('hex') }));
    await assert.rejects(() => callService(directory, 'list', {}, badFile), /授权失败/);
    const projectB = path.join(directory, 'other-project'); fs.mkdirSync(projectB);
    app.manager.save({ id: 'private-a', project: fs.realpathSync(directory), status: 'completed' });
    assert.equal((await callService(projectB, 'list', {}, file)).tasks.length, 0);
    await assert.rejects(() => callService(projectB, 'detail', { id: 'private-a' }, file), /不属于/);
    assert.equal((await callService(directory, 'list', {}, file)).tasks.length, 1);
  } finally {
    await app.close();
    assert.ok(path.relative(os.tmpdir(), fs.realpathSync(directory)).startsWith('sandbox-ipc-'));
    fs.rmSync(directory, { recursive: true });
  }
});
