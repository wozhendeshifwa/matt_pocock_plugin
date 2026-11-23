import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRelay } from './relay.mjs';
import { createExecutor, startCompanion } from './companion.mjs';
import { Journal } from './journal.mjs';
import { createStdioAdapter } from './stdio.mjs';
import { bridgeUrl, digest, requestHash } from './protocol.mjs';
import { createSessionProjectResolver } from '../upstream-port/session-project.mjs';
import { classifyEndpoint } from '../upstream-port/rpc-endpoints.mjs';

const A = '01a1b180-89f8-7291-beb2-43f569f3709c';
const B = '01a1b180-89f8-7291-beb2-43f569f3709d';
const token = () => randomBytes(32).toString('hex');
const request = (id = 1, name = 'deck_current_project', args = {}, thread = A) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args, _meta: { threadId: thread } } });
const job = req => ({ version: 1, operationId: digest(JSON.stringify(req)), deliveryId: randomUUID(), fingerprint: requestHash(req), expiresAt: Date.now() + 5000, request: req });
const response = req => ({ jsonrpc: '2.0', id: req.id, result: { content: [{ type: 'text', text: 'ok' }] } });
const cleanupTasks = new WeakMap();
function cleanup(t, action) {
  let tasks = cleanupTasks.get(t);
  if (!tasks) {
    tasks = []; cleanupTasks.set(t, tasks);
    t.after(async () => {
      const failures = [];
      for (const task of tasks.reverse()) { try { await task(); } catch (error) { failures.push(error); } }
      if (failures.length) throw new AggregateError(failures, 'Test cleanup failed');
    });
  }
  tasks.push(action);
}
async function tempDirectory(t, prefix) {
  const parent = await realpath(tmpdir());
  const directory = await realpath(await mkdtemp(path.join(parent, prefix)));
  cleanup(t, async () => {
    const actual = await realpath(directory);
    assert.equal(actual, directory, 'cleanup target must not be replaced');
    assert.equal(path.dirname(actual), parent, 'cleanup stays in the intended temp parent');
    assert.ok(path.basename(actual).startsWith(prefix));
    await rm(actual, { recursive: true, maxRetries: 3, retryDelay: 100 });
  });
  return directory;
}
async function localJournal(t) {
  const directory = await tempDirectory(t, 'deck-relay-test-');
  const file = path.join(directory, 'journal.sqlite');
  const journal = new Journal(file);
  cleanup(t, () => journal.close());
  return { journal, file, directory };
}
function executor(journal, adapter, resolveProject = async meta => ({ threadId: meta.threadId, projectRoot: 'C:\\fixture\\project', associated: true }), pairingId = 'test-pair') {
  return createExecutor({ journal, adapter, resolveProject, pairingId, isReadMethod: (method, payload) => classifyEndpoint(method, payload) === 'read' });
}
async function running(t, options = {}) {
  const credentials = { callerToken: options.callerToken ?? token(), deviceToken: options.deviceToken ?? token(), sessionSecret: options.sessionSecret ?? token() };
  const relay = await createRelay({ requestTimeout: 1000, pollTimeout: 100, ...options, ...credentials });
  const originalClose = relay.close; let closed = false;
  relay.close = async () => { if (!closed) { closed = true; await originalClose(); } };
  const origin = `http://127.0.0.1:${relay.port}`;
  cleanup(t, () => relay.close());
  const post = async (pathname, body, bearer = credentials.callerToken, sessionId, headers = {}) => {
    const res = await fetch(origin + pathname, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}`,
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}), ...headers }, body: JSON.stringify(body) });
    return { status: res.status, sessionId: res.headers.get('mcp-session-id'), body: res.status === 202 ? null : await res.json() };
  };
  return { credentials, relay, origin, post };
}
async function connected(t, setup = {}) {
  const runningRelay = await running(t, setup.relay);
  const { journal } = await localJournal(t);
  let calls = 0, online;
  const ready = new Promise(resolve => online = resolve);
  const adapter = { async request(req) { calls++; return setup.adapter ? setup.adapter(req) : response(req); } };
  const execute = executor(journal, adapter, setup.resolveProject);
  const companion = startCompanion({ relayOrigin: runningRelay.origin, deviceToken: runningRelay.credentials.deviceToken,
    execute, allowLoopback: true, retryMs: 1, onState: state => { if (state === 'connected') online(); } });
  cleanup(t, () => companion.stop());
  await Promise.race([ready, new Promise((_, reject) => setTimeout(() => reject(new Error('Companion connection did not become ready')), 5000).unref())]);
  return { ...runningRelay, journal, companion, calls: () => calls };
}

test('canonical fingerprints ignore key ordering and HTTPS origin policy rejects redirects/credentials', () => {
  assert.equal(requestHash({ method: 'ping', params: { z: 1, a: 2 } }), requestHash({ params: { a: 2, z: 1 }, method: 'ping' }));
  for (const bad of ['http://example.com', 'https://user:secret@example.com', 'https://example.com/path', 'https://example.com/?key=secret']) assert.throws(() => bridgeUrl(bad));
  assert.equal(bridgeUrl('http://127.0.0.1:1234', true), 'http://127.0.0.1:1234');
});

test('authentication separates caller/device and rejects browser origin, offline requests and forged sessions', async t => {
  const { post, credentials } = await running(t);
  const initialize = { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} };
  assert.equal((await post('/mcp', initialize, 'wrong')).status, 401);
  assert.equal((await post('/mcp', initialize, credentials.deviceToken)).status, 401);
  assert.equal((await post('/bridge/poll', { version: 1 })).status, 401);
  assert.equal((await post('/mcp', initialize, credentials.callerToken, null, { origin: 'https://evil.invalid' })).status, 403);
  assert.equal((await post('/mcp', initialize)).status, 503);
  assert.equal((await post('/mcp', request(), credentials.callerToken, 'forged')).status, 404);
});

test('MCP over HTTP + outbound companion preserves metadata and reuses results without replay', async t => {
  let seen;
  const c = await connected(t, { adapter: req => { seen = req; return response(req); } });
  const init = await c.post('/mcp', { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  assert.equal(init.status, 200); assert.ok(init.sessionId);
  assert.equal((await c.post('/mcp', { jsonrpc: '2.0', method: 'notifications/initialized' }, c.credentials.callerToken, init.sessionId)).status, 202);
  const r = request(2);
  const first = await c.post('/mcp', r, c.credentials.callerToken, init.sessionId);
  assert.equal(first.body.result.content[0].text, 'ok'); assert.equal(seen.params._meta.threadId, A);
  const before = c.calls();
  assert.equal((await c.post('/mcp', r, c.credentials.callerToken, init.sessionId)).body.result.content[0].text, 'ok');
  assert.equal(c.calls(), before);
  const conflict = await c.post('/mcp', request(2, 'deck_rpc_manifest'), c.credentials.callerToken, init.sessionId);
  assert.match(conflict.body.error.message, /reused/);
});

test('local identity is rechecked before cached results; missing, conflicting and projectless identity fails closed', async t => {
  const { journal } = await localJournal(t); let associated = true, calls = 0;
  const execute = executor(journal, { async request(req) { calls++; return response(req); } }, async meta => ({ threadId: meta.threadId, projectRoot: associated ? 'local' : null, associated }));
  const j = job(request()); assert.ok((await execute(j)).result); associated = false;
  assert.match((await execute(j)).error.message, /No verified/); assert.equal(calls, 1);
  const noIdentity = request(2); delete noIdentity.params._meta;
  assert.match((await execute(job(noIdentity))).error.message, /Missing host/);
  const conflict = request(3); conflict.params._meta.thread_id = B;
  assert.match((await execute(job(conflict))).error.message, /Conflicting/);
});

test('remote write and conditional write routing cannot bypass local gate; stale reads rejected', async t => {
  const { journal } = await localJournal(t); let calls = 0;
  const execute = executor(journal, { async request(req) { calls++; return response(req); } });
  for (const [name, args] of [
    ['deck_issue_create', { title: 'must not be created' }], ['deck_upstream_write', { method: 'gitCommit' }],
    ['deck_upstream_read', { method: 'gitCommit', payload: { expectedThreadId: A } }],
    ['deck_upstream_read', { method: 'setupLayout', payload: { expectedThreadId: A, layout: 'any' } }],
    ['deck_upstream_read', { method: 'gitStatus', payload: { expectedThreadId: B } }],
  ]) assert.ok((await execute(job(request(token(), name, args)))).error);
  assert.equal(calls, 0);
  assert.ok((await execute(job(request(3, 'deck_upstream_read', { method: 'gitStatus', payload: { expectedThreadId: A } })))).result);
});

test('moving a thread or changing pairing cannot return cached data from its previous project', async t => {
  const { journal } = await localJournal(t); let projectRoot = 'C:\\fixture\\project-a', calls = 0;
  const adapter = { async request(req) { calls++; return { jsonrpc: '2.0', id: req.id, result: { projectRoot } }; } };
  const resolve = async meta => ({ threadId: meta.threadId, projectRoot, associated: true });
  const execute = executor(journal, adapter, resolve);
  const j = job(request());
  assert.equal((await execute(j)).result.projectRoot, projectRoot);
  projectRoot = 'C:\\fixture\\project-b';
  assert.ok((await execute(j)).error, 'cached project-a result must be rejected after moving the same thread');
  const movedStatus = await execute(job(request(2, 'deck_remote_operation_status', { operationId: j.operationId })));
  assert.equal(movedStatus.result.structuredContent.state, 'not-found', 'status lookup must have the same project boundary');
  assert.equal(calls, 1);
  projectRoot = 'C:\\fixture\\project-a';
  assert.ok((await executor(journal, adapter, resolve, 'different-pair')(j)).error, 'cached result belongs to its pairing');
  assert.equal(calls, 1);
});

test('a late result cannot satisfy a newer delivery that reused the MCP request id', async t => {
  const c = await running(t, { requestTimeout: 300, pollTimeout: 30 });
  const devicePost = (pathname, body) => c.post(pathname, body, c.credentials.deviceToken);
  await devicePost('/bridge/poll', { version: 1 });
  const initPending = c.post('/mcp', { jsonrpc: '2.0', id: 1, method: 'initialize' });
  const initJob = (await devicePost('/bridge/poll', { version: 1 })).body;
  const send = (j, value) => devicePost('/bridge/result', { version: 1, operationId: j.operationId, deliveryId: j.deliveryId,
    fingerprint: j.fingerprint, response: { jsonrpc: '2.0', id: j.request.id, result: { value } } });
  assert.equal((await send(initJob, 'initialized')).status, 200);
  const init = await initPending;
  const firstPending = c.post('/mcp', request(2), c.credentials.callerToken, init.sessionId);
  const oldJob = (await devicePost('/bridge/poll', { version: 1 })).body;
  assert.equal((await firstPending).body.error.data.state, 'unknown');
  const newPending = c.post('/mcp', request(2, 'deck_current_project', {}, B), c.credentials.callerToken, init.sessionId);
  const newJob = (await devicePost('/bridge/poll', { version: 1 })).body;
  assert.equal(newJob.operationId, oldJob.operationId);
  assert.notEqual(newJob.deliveryId, oldJob.deliveryId);
  assert.notEqual(newJob.fingerprint, oldJob.fingerprint);
  const stale = await send(oldJob, 'private-project-a-result');
  assert.ok([409, 410].includes(stale.status), 'old delivery must be rejected before touching the new waiter');
  assert.equal((await send(newJob, 'project-b-result')).status, 200);
  assert.equal((await newPending).body.result.value, 'project-b-result');
});

test('lost HTTP result stays in local journal and same request is never executed twice', async t => {
  const c = await connected(t, { relay: { requestTimeout: 40 }, adapter: async req => {
    if (req.method === 'tools/call') await new Promise(resolve => setTimeout(resolve, 100));
    return response(req);
  } });
  const init = await c.post('/mcp', { jsonrpc: '2.0', id: 1, method: 'initialize' });
  const req = request(2);
  const result = await c.post('/mcp', req, c.credentials.callerToken, init.sessionId);
  assert.equal(result.body.error.data.state, 'unknown');
  await new Promise(resolve => setTimeout(resolve, 120));
  const before = c.calls();
  const recovered = await c.post('/mcp', req, c.credentials.callerToken, init.sessionId);
  assert.ok(recovered.body.result); assert.equal(c.calls(), before);
  const status = await c.post('/mcp', request(3, 'deck_remote_operation_status', { operationId: result.body.error.data.operationId }), c.credentials.callerToken, init.sessionId);
  assert.equal(status.body.result.structuredContent.state, 'completed');
  const foreign = await c.post('/mcp', request(4, 'deck_remote_operation_status', { operationId: result.body.error.data.operationId }, B), c.credentials.callerToken, init.sessionId);
  assert.equal(foreign.body.result.structuredContent.state, 'not-found');
});

test('process restart makes running requests unknown and local revocation survives reopening', async t => {
  const dir = await tempDirectory(t, 'deck-journal-restart-');
  const file = path.join(dir, 'journal.sqlite');
  const req = request(); const j = job(req); let journal = new Journal(file);
  cleanup(t, () => journal.close());
  journal.begin(j.operationId, req, A); journal.close(); journal = new Journal(file);
  const entry = journal.begin(j.operationId, req, A);
  assert.equal(entry.fresh, false); assert.equal(entry.response.error.data.state, 'unknown');
  journal.revoke(); journal.close(); journal = new Journal(file);
  assert.equal(journal.revoked, true); assert.throws(() => journal.begin(job(request(2)).operationId, request(2), A), /revoked/);
});

test('cloud session signatures survive process restart; wrong keys and expired jobs fail closed', async t => {
  const { journal } = await localJournal(t); let calls = 0;
  const execute = executor(journal, { async request(req) { calls++; return response(req); } });
  assert.ok((await execute({ ...job(request()), expiresAt: Date.now() - 1 })).error);
  assert.ok((await execute({ ...job(request()), version: 2 })).error); assert.equal(calls, 0);
  const credentials = { callerToken: token(), deviceToken: token(), sessionSecret: token() };
  const c = await connected(t, { relay: credentials });
  const init = await c.post('/mcp', { jsonrpc: '2.0', id: 1, method: 'initialize' });
  await c.companion.stop(); await c.relay.close();
  const second = await running(t, credentials);
  const online = startCompanion({ relayOrigin: second.origin, deviceToken: credentials.deviceToken,
    execute: executor(journal, { async request(req) { calls++; return response(req); } }), allowLoopback: true, retryMs: 1 });
  cleanup(t, () => online.stop());
  await new Promise(resolve => setTimeout(resolve, 120));
  const r = await second.post('/mcp', request(4), credentials.callerToken, init.sessionId);
  assert.ok(r.body.result);
});

test('full local stdio adapter serves original tools/UI and checks fixture projects over the new HTTP boundary', async t => {
  const directory = await tempDirectory(t, 'deck-real-adapter-');
  // realpath normalizes the Windows temp directory spelling before test fixtures
  // are written, avoiding the existing strict path-case fixture problem.
  const base = await realpath(directory);
  const projectA = path.join(base, 'a'), projectB = path.join(base, 'b'), projectless = path.join(base, 'outside');
  await Promise.all([projectA, projectB, projectless].map(p => mkdir(p)));
  const P = '01a1b180-89f8-7291-beb2-43f569f3709e';
  const home = path.join(base, 'codex-home'); await mkdir(home);
  const db = new DatabaseSync(path.join(home, 'state_5.sqlite'));
  try {
    db.exec('CREATE TABLE threads (id TEXT PRIMARY KEY,cwd TEXT,rollout_path TEXT); CREATE TABLE project_roots (project_id TEXT,position INTEGER,path TEXT);');
    const insert = db.prepare('INSERT INTO threads VALUES (?,?,NULL)');
    for (const [id, cwd] of [[A, projectA], [B, projectB], [P, projectless]]) insert.run(id, cwd);
    const roots = db.prepare('INSERT INTO project_roots VALUES (?,0,?)'); roots.run('a', projectA); roots.run('b', projectB);
  } finally { db.close(); }
  const adapter = createStdioAdapter(fileURLToPath(new URL('../upstream-port/sidebar-server.mjs', import.meta.url)), { env: { ...process.env, CODEX_HOME: home } });
  cleanup(t, () => adapter.close());
  const c = await connected(t, { adapter: req => adapter.request(req), resolveProject: createSessionProjectResolver({ codexHome: home }) });
  const init = await c.post('/mcp', { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
  assert.equal(init.body.result.serverInfo.name, 'deck-sidebar-probe');
  const rpc = async req => (await c.post('/mcp', req, c.credentials.callerToken, init.sessionId)).body;
  const tools = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.ok(tools.result.tools.some(tool => tool.name === 'deck_remote_operation_status'));
  assert.ok(tools.result.tools.some(tool => tool.name === 'open_deck_sidebar_probe'));
  const ui = await rpc({ jsonrpc: '2.0', id: 3, method: 'resources/read', params: { uri: 'ui://deck-sidebar/board.html' } });
  assert.match(ui.result.contents[0].text, /MattSkillsDeck/);
  const a = await rpc(request(4)); assert.equal(a.result.structuredContent.projectRoot.toLowerCase(), projectA.toLowerCase());
  const b = await rpc(request(5, 'deck_current_project', {}, B)); assert.equal(b.result.structuredContent.projectRoot.toLowerCase(), projectB.toLowerCase());
  assert.match((await rpc(request(6, 'deck_current_project', {}, P))).error.message, /No verified/);
  assert.match((await rpc(request(7, 'deck_upstream_read', { method: 'gitStatus', payload: { expectedThreadId: B } }))).error.message, /thread changed/);
});

async function installedSdk() {
  // Only the test harness reuses this fixed SDK; deployed code stays dependency-free.
  for (const location of ['../remote-compat-probe/package.json', '../../../wayfinder-render-43/prototypes/remote-compat-probe/package.json']) {
    const require = createRequire(new URL(location, import.meta.url));
    let clientPath, transportPath;
    try {
      clientPath = require.resolve('@modelcontextprotocol/sdk/client/index.js');
      transportPath = require.resolve('@modelcontextprotocol/sdk/client/streamableHttp.js');
    } catch { continue; }
    const [{ Client }, { StreamableHTTPClientTransport }] = await Promise.all([import(pathToFileURL(clientPath).href), import(pathToFileURL(transportPath).href)]);
    return { Client, StreamableHTTPClientTransport };
  }
  throw new Error('Install the locked remote-compat-probe SDK before running HTTP conformance tests');
}

test('official SDK completes handshake/tools/UI and reconnects after the relay restarts', async t => {
  const { Client, StreamableHTTPClientTransport } = await installedSdk();
  const base = await tempDirectory(t, 'deck-sdk-adapter-');
  const projectA = path.join(base, 'a'), projectB = path.join(base, 'b'), home = path.join(base, 'codex-home');
  await Promise.all([projectA, projectB, home].map(p => mkdir(p)));
  const db = new DatabaseSync(path.join(home, 'state_5.sqlite'));
  try {
    db.exec('CREATE TABLE threads (id TEXT PRIMARY KEY,cwd TEXT,rollout_path TEXT); CREATE TABLE project_roots (project_id TEXT,position INTEGER,path TEXT);');
    db.prepare('INSERT INTO threads VALUES (?,?,NULL)').run(A, projectA); db.prepare('INSERT INTO threads VALUES (?,?,NULL)').run(B, projectB);
    db.prepare('INSERT INTO project_roots VALUES (?,0,?)').run('a', projectA); db.prepare('INSERT INTO project_roots VALUES (?,0,?)').run('b', projectB);
  } finally { db.close(); }
  const adapter = createStdioAdapter(fileURLToPath(new URL('../upstream-port/sidebar-server.mjs', import.meta.url)), { env: { ...process.env, CODEX_HOME: home } });
  cleanup(t, () => adapter.close());
  const c = await connected(t, { adapter: req => adapter.request(req), resolveProject: createSessionProjectResolver({ codexHome: home }) });
  async function openClient() {
    const client = new Client({ name: 'deck-companion-acceptance', version: '1.0.0' }, { capabilities: {} });
    const transport = new StreamableHTTPClientTransport(new URL(c.origin + '/mcp'), { requestInit: { headers: { authorization: `Bearer ${c.credentials.callerToken}` } } });
    cleanup(t, () => client.close());
    await client.connect(transport);
    return { client, transport };
  }
  const first = await openClient();
  assert.ok((await first.client.listTools()).tools.some(tool => tool.name === 'deck_current_project'));
  assert.ok((await first.client.listResources()).resources.some(resource => resource.uri === 'ui://deck-sidebar/board.html'));
  const ui = await first.client.readResource({ uri: 'ui://deck-sidebar/board.html' });
  assert.equal(ui.contents[0].mimeType, 'text/html;profile=mcp-app'); assert.match(ui.contents[0].text, /MattSkillsDeck/);
  const identity = await first.client.callTool({ name: 'deck_current_project', arguments: {}, _meta: { threadId: A } });
  assert.equal(identity.structuredContent.projectRoot.toLowerCase(), projectA.toLowerCase());
  const sessionId = first.transport.sessionId; assert.ok(sessionId);
  await first.client.close(); await c.companion.stop(); await c.relay.close();
  const replacement = await running(t, { ...c.credentials, port: c.relay.port });
  const states = [];
  const companion = startCompanion({ relayOrigin: replacement.origin, deviceToken: c.credentials.deviceToken,
    execute: executor(c.journal, adapter, createSessionProjectResolver({ codexHome: home })), allowLoopback: true, retryMs: 1, onState: state => states.push(state) });
  cleanup(t, () => companion.stop());
  const deadline = Date.now() + 5000;
  while (!states.includes('connected')) { assert.ok(Date.now() < deadline, 'replacement companion becomes ready'); await new Promise(resolve => setTimeout(resolve, 10)); }
  const second = await openClient();
  assert.notEqual(second.transport.sessionId, sessionId, 'new SDK connection reinitializes after disconnect');
  assert.ok((await second.client.listTools()).tools.some(tool => tool.name === 'deck_remote_operation_status'));
  const after = await second.client.callTool({ name: 'deck_current_project', arguments: {}, _meta: { threadId: B } });
  assert.equal(after.structuredContent.projectRoot.toLowerCase(), projectB.toLowerCase());
  assert.equal(replacement.origin, c.origin);
});
