import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRelay } from './relay.mjs';
import { MAX_BYTES } from './protocol.mjs';

async function fixture(t, options = {}) {
  const callerToken = randomBytes(32).toString('hex'), deviceToken = randomBytes(32).toString('hex'), sessionSecret = randomBytes(32).toString('hex');
  const relay = await createRelay({ callerToken, deviceToken, sessionSecret, pollTimeout: 1000, requestTimeout: 3000, ...options });
  t.after(() => relay.close());
  const origin = `http://127.0.0.1:${relay.port}`;
  const post = async (route, value) => {
    const response = await fetch(origin + route, { method: 'POST', headers: { authorization: 'Bearer ' + (route === '/mcp' ? callerToken : deviceToken), 'content-type': 'application/json' }, body: JSON.stringify(value) });
    return { status: response.status, body: await response.json() };
  };
  const poll = () => post('/bridge/poll', { version: 1 });
  const init = (id, blob) => post('/mcp', { jsonrpc: '2.0', id, method: 'initialize', params: { protocolVersion: '2025-03-26', ...(blob === undefined ? {} : { blob }) } });
  const result = job => post('/bridge/result', { version: 1, operationId: job.operationId, deliveryId: job.deliveryId,
    fingerprint: job.fingerprint, response: { jsonrpc: '2.0', id: job.request.id, result: { protocolVersion: '2025-03-26' } } });
  return { origin, callerToken, deviceToken, post, poll, init, result };
}

test('aggregate queued request budget rejects before dispatch and releases after completion', async t => {
  const f = await fixture(t, { maxRetainedBytes: 8000 });
  const waiting = f.poll(); await new Promise(resolve => setTimeout(resolve, 30));
  const first = f.init(1, 'x'.repeat(2000)), delivered = (await waiting).body;
  assert.equal(delivered.request.id, 1);
  const blocked = await f.init(2, 'x'.repeat(2000));
  assert.equal(blocked.status, 503); assert.equal(blocked.body.error.data.state, 'not-executed');
  assert.equal((await f.result(delivered)).status, 200); assert.equal((await first).status, 200);
  const nextPoll = f.poll(); await new Promise(resolve => setTimeout(resolve, 20));
  const next = f.init(3, 'x'.repeat(2000)), nextJob = (await nextPoll).body;
  assert.equal(nextJob.request.id, 3); assert.equal((await f.result(nextJob)).status, 200); assert.equal((await next).status, 200);
});

test('timed-out requests return their aggregate budget without replaying delivery', async t => {
  const f = await fixture(t, { maxRetainedBytes: 8000, requestTimeout: 100 });
  const waiting = f.poll(); await new Promise(resolve => setTimeout(resolve, 20));
  const first = f.init(1, 'x'.repeat(2000)); await waiting;
  assert.equal((await first).body.error.data.state, 'unknown');
  const nextPoll = f.poll(); await new Promise(resolve => setTimeout(resolve, 20));
  const second = f.init(2, 'x'.repeat(2000)), secondJob = (await nextPoll).body;
  assert.equal(secondJob.request.id, 2); await f.result(secondJob); assert.equal((await second).status, 200);
});

test('JSON expansion and nesting limits reject complex bodies while a normal call still succeeds', async t => {
  const f = await fixture(t, { maxValueNodes: 100 });
  const expanded = await f.init(1, Array.from({ length: 200 }, () => ({})));
  assert.equal(expanded.status, 413);
  let nested = 'leaf'; for (let i = 0; i < 130; i++) nested = { nested };
  assert.equal((await f.init(2, nested)).status, 413);
  const waiting = f.poll(); await new Promise(resolve => setTimeout(resolve, 20));
  const normal = f.init(3), delivered = (await waiting).body;
  assert.equal(delivered.request.id, 3); await f.result(delivered); assert.equal((await normal).status, 200);
});

test('JSON preflight preserves escaped strings and Unicode without counting quoted structure', async t => {
  const f = await fixture(t, { maxValueNodes: 100 });
  const text = '[]{}:,"\\\n\t\\u0022\\u007b 你好 😀'.repeat(10000);
  const waiting = f.poll(); await new Promise(resolve => setTimeout(resolve, 20));
  const normal = f.init(1, { ['escaped"key\\']: text }), delivered = (await waiting).body;
  assert.equal(delivered.request.params.blob['escaped"key\\'], text);
  await f.result(delivered); assert.equal((await normal).status, 200);
});

test('a seven MiB object array is rejected before parsing in a 64 MiB heap child', { timeout: 10000 }, async t => {
  const moduleUrl = new URL('./relay.mjs', import.meta.url).href;
  const script = `import {createRelay} from ${JSON.stringify(moduleUrl)};
const relay=await createRelay({callerToken:'c'.repeat(40),deviceToken:'d'.repeat(40),sessionSecret:'s'.repeat(40)});
process.on('message',async value=>{if(value==='sample')process.send({maxRSS:process.resourceUsage().maxRSS*1024});if(value==='close'){await relay.close();process.exit(0);}});
process.send({port:relay.port});`;
  const child = spawn(process.execPath, ['--max-old-space-size=64', '--input-type=module', '--eval', script],
    { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let stderr = ''; child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-4096); });
  const waitMessage = predicate => new Promise((resolve, reject) => {
    const timer = setTimeout(() => fail(new Error('Budget child timed out: ' + stderr)), 5000);
    const cleanup = () => { clearTimeout(timer); child.off('message', message); child.off('exit', exit); child.off('error', fail); };
    const fail = error => { cleanup(); reject(error); };
    const exit = code => fail(new Error('Budget child exited ' + code + ': ' + stderr));
    const message = value => { if (predicate(value)) { cleanup(); resolve(value); } };
    child.on('message', message); child.once('exit', exit); child.once('error', fail);
  });
  t.after(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    if (child.connected) child.send('close');
    await new Promise(resolve => { const timer = setTimeout(() => child.kill(), 1000); child.once('exit', () => { clearTimeout(timer); resolve(); }); });
  });
  const { port } = await waitMessage(value => value.port);
  const array = '[' + '{},'.repeat(Math.floor(7 * 1024 * 1024 / 3) - 1) + '{}]';
  const body = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"blob":' + array + '}}';
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST', headers: {
    authorization: 'Bearer ' + 'c'.repeat(40), 'content-type': 'application/json' }, body });
  assert.equal(response.status, 413); await response.arrayBuffer();
  const sample = waitMessage(value => typeof value.maxRSS === 'number'); child.send('sample');
  assert.ok((await sample).maxRSS < 192 * 1024 * 1024, 'OS peak remains below the bounded parser fixture limit');
});

test('an unfinished maximum-size body consumes the read budget, which is released on disconnect', async t => {
  const f = await fixture(t);
  const held = httpRequest(f.origin + '/mcp', { method: 'POST', headers: { authorization: 'Bearer ' + f.callerToken,
    'content-type': 'application/json', 'content-length': MAX_BYTES } });
  held.on('error', () => {}); t.after(() => held.destroy());
  held.write('{'); await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal((await f.init(1)).status, 503);
  assert.equal((await fetch(f.origin + '/healthz')).status, 200);
  held.destroy(); await new Promise(resolve => setTimeout(resolve, 40));
  const waiting = f.poll(); await new Promise(resolve => setTimeout(resolve, 20));
  const normal = f.init(2), delivered = (await waiting).body;
  assert.equal(delivered.request.id, 2); await f.result(delivered); assert.equal((await normal).status, 200);
});

test('a completed result that exceeds the output budget reports unknown with its operation id', async t => {
  const f = await fixture(t, { maxBufferedReplyBytes: 4096 });
  const waiting = f.poll(); await new Promise(resolve => setTimeout(resolve, 20));
  const caller = f.init(1), delivered = (await waiting).body;
  const accepted = await f.post('/bridge/result', { version: 1, operationId: delivered.operationId, deliveryId: delivered.deliveryId,
    fingerprint: delivered.fingerprint, response: { jsonrpc: '2.0', id: 1, result: { blob: 'x'.repeat(5000) } } });
  assert.equal(accepted.status, 200);
  const unknown = await caller;
  assert.equal(unknown.status, 503); assert.equal(unknown.body.error.data.state, 'unknown');
  assert.equal(unknown.body.error.data.operationId, delivered.operationId);
});
