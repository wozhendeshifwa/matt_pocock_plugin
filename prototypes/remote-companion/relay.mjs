import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { VERSION, MAX_BYTES, secret, equal, mac, requestHash, validateRequest, rpcError, readJson } from './protocol.mjs';

// Only bounded, in-memory requests. No disk, database, request-body logging or
// GitHub/local-machine credentials are used in this process.
export async function createRelay({ callerToken, deviceToken, sessionSecret, origin, host = '127.0.0.1', port = 0,
  requestTimeout = 55000, pollTimeout = 20000, capacity = 32, sessionLifetime = 86400000 } = {}) {
  [callerToken, deviceToken, sessionSecret].forEach(secret);
  if (new Set([callerToken, deviceToken, sessionSecret]).size !== 3) throw new Error('Credentials must be distinct');
  const jobs = new Map();
  let poll = null, closed = false, onlineUntil = 0;
  function signSession() {
    const value = `${VERSION}.${Date.now()}.${randomUUID()}`;
    return value + '.' + mac(sessionSecret, value);
  }
  function validSession(id) {
    if (typeof id !== 'string') return false;
    const [version, created, nonce, signature, ...extra] = id.split('.');
    const elapsed = Date.now() - Number(created);
    return extra.length === 0 && version === String(VERSION) && /^[a-f0-9-]{36}$/.test(nonce ?? '') &&
      Number.isFinite(elapsed) && elapsed >= 0 && elapsed < sessionLifetime && equal(signature, mac(sessionSecret, `${version}.${created}.${nonce}`));
  }
  function reply(res, status, value, headers = {}) {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers });
    res.end(value === undefined ? undefined : JSON.stringify(value));
  }
  function nextJob() {
    for (const job of jobs.values()) if (!job.delivered) {
      job.delivered = true;
      return { version: VERSION, operationId: job.operationId, deliveryId: job.deliveryId,
        fingerprint: job.fingerprint, request: job.request, expiresAt: job.expiresAt };
    }
    return null;
  }
  function wake() {
    if (!poll) return;
    const job = nextJob();
    if (job) { const waiting = poll; poll = null; clearTimeout(waiting.timer); reply(waiting.res, 200, job); }
  }
  const http = createServer(async (req, res) => {
    res.setHeader('cache-control', 'no-store');
    try {
      const path = new URL(req.url, 'http://relay.invalid').pathname;
      if (path === '/healthz' && req.method === 'GET') return reply(res, 200, { status: 'ready', version: VERSION });
      if (!['/mcp', '/bridge/poll', '/bridge/result'].includes(path)) return reply(res, 404, { status: 'not-found' });
      const token = path === '/mcp' ? callerToken : deviceToken;
      if (!equal(req.headers.authorization, `Bearer ${token}`)) return reply(res, 401, { status: 'unauthorized' });
      if (req.headers.origin && req.headers.origin !== origin) return reply(res, 403, { status: 'origin-rejected' });
      if (req.method !== 'POST') return reply(res, 405, { status: 'method-not-allowed' }, { allow: 'POST' });
      const body = await readJson(req);
      if (path === '/bridge/poll') {
        if (body?.version !== VERSION) return reply(res, 409, { status: 'version-mismatch' });
        if (poll) return reply(res, 409, { status: 'device-already-polling' });
        onlineUntil = Date.now() + pollTimeout + 5000;
        const job = nextJob();
        if (job) return reply(res, 200, job);
        const waiting = { res, timer: null };
        waiting.timer = setTimeout(() => { if (poll === waiting) poll = null; reply(res, 200, { version: VERSION, idle: true }); }, pollTimeout);
        poll = waiting;
        res.on('close', () => { clearTimeout(waiting.timer); if (poll === waiting) poll = null; });
        return;
      }
      if (path === '/bridge/result') {
        if (body?.version !== VERSION) return reply(res, 409, { status: 'version-mismatch' });
        const job = jobs.get(body.operationId);
        if (!job || !job.delivered || body.deliveryId !== job.deliveryId || body.fingerprint !== job.fingerprint) {
          return reply(res, 410, { status: 'delivery-no-longer-waiting' });
        }
        const response = body.response;
        if (!response || response.jsonrpc !== '2.0' || (!('result' in response) && !('error' in response)) ||
            ('result' in response && 'error' in response) || Buffer.byteLength(JSON.stringify(response)) > MAX_BYTES) {
          return reply(res, 400, { status: 'invalid-result' });
        }
        job.finish({ ...response, id: job.request.id });
        return reply(res, 200, { status: 'accepted' });
      }
      // Notifications do not execute local business. No raw notification is forwarded.
      if (body?.jsonrpc === '2.0' && body.id === undefined && body.method === 'notifications/initialized') {
        if (!validSession(req.headers['mcp-session-id'])) return reply(res, 404, { status: 'session-expired' });
        return reply(res, 202);
      }
      validateRequest(body);
      let sessionId = req.headers['mcp-session-id'];
      if (body.method === 'initialize') {
        if (sessionId) return reply(res, 400, rpcError(body.id, -32600, 'Initialize without a previous session'));
        sessionId = signSession();
      } else if (!validSession(sessionId)) return reply(res, 404, { status: 'session-expired' });
      if (closed || Date.now() > onlineUntil) return reply(res, 503, rpcError(body.id, -32001, 'Local companion is offline; no operation was dispatched'));
      if (jobs.size >= capacity) return reply(res, 503, rpcError(body.id, -32002, 'Relay is busy; no operation was dispatched'));
      // Same MCP session + request id is stable even after a cloud restart.
      // A changed payload under this id is rejected by the durable local journal.
      const operationId = mac(sessionSecret, sessionId + '\0' + JSON.stringify(body.id));
      if (jobs.has(operationId)) return reply(res, 409, rpcError(body.id, -32003, 'Request already in flight', { operationId }));
      const response = await new Promise(resolve => {
        const job = { operationId, deliveryId: randomUUID(), fingerprint: requestHash(body), request: body, delivered: false, expiresAt: Date.now() + requestTimeout, timer: null,
          finish(response) { clearTimeout(job.timer); jobs.delete(operationId); resolve(response); } };
        job.timer = setTimeout(() => job.finish(rpcError(body.id, -32004,
          job.delivered ? 'Operation result unknown; inspect local journal before retrying' : 'Operation not dispatched',
          { operationId, state: job.delivered ? 'unknown' : 'not-executed' })), requestTimeout);
        jobs.set(operationId, job); wake();
      });
      reply(res, 200, response, { 'mcp-session-id': sessionId });
    } catch (error) {
      reply(res, error.status ?? 400, { status: error.status === 413 ? 'too-large' : 'invalid-request' });
    }
  });
  http.requestTimeout = 30000;
  http.headersTimeout = 10000;
  await new Promise((resolve, reject) => { http.once('error', reject); http.listen(port, host, resolve); });
  return { port: http.address().port, async close() {
    closed = true;
    if (poll) { clearTimeout(poll.timer); reply(poll.res, 503, { status: 'stopping' }); poll = null; }
    for (const job of jobs.values()) job.finish(rpcError(job.request.id, -32004, 'Relay stopped; inspect local journal', { operationId: job.operationId, state: job.delivered ? 'unknown' : 'not-executed' }));
    http.closeAllConnections(); await new Promise(resolve => http.close(resolve));
  } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const relay = await createRelay({ callerToken: process.env.DECK_CALLER_TOKEN, deviceToken: process.env.DECK_DEVICE_TOKEN,
    sessionSecret: process.env.DECK_SESSION_SECRET, origin: process.env.RENDER_EXTERNAL_URL,
    host: process.env.RENDER ? '0.0.0.0' : '127.0.0.1', port: Number(process.env.PORT ?? 10044) });
  console.log('Deck relay ready (protocol 1)');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void relay.close().then(() => process.exit(0)); });
}
