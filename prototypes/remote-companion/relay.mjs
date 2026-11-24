import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { VERSION, MAX_BYTES, secret, equal, mac, requestHash, validateRequest, rpcError, readJson } from './protocol.mjs';

// Thread navigation uses the MCP tool's title and icons, independently of the plugin manifest.
const sidebarIcon = {
  src: 'data:image/png;base64,' + readFileSync(new URL('./remote-cloud.png', import.meta.url)).toString('base64'),
  mimeType: 'image/png',
  sizes: ['64x64'],
};

function remoteSidebarMetadata(method, response) {
  if (method !== 'tools/list' || !Array.isArray(response.result?.tools)) return response;
  const tools = response.result.tools.map(tool => tool?.name === 'open_deck_sidebar_probe' ? {
    ...tool,
    title: '远程版 · MattSkillsDeck',
    description: 'Open the remote MattSkillsDeck sidebar through Deck Remote Companion.',
    icons: [sidebarIcon],
  } : tool);
  return { ...response, result: { ...response.result, tools } };
}

// Only bounded, in-memory requests. No disk, database, request-body logging or
// GitHub/local-machine credentials are used in this process.
export async function createRelay({ callerToken, deviceToken, sessionSecret, origin, host = '127.0.0.1', port = 0,
  requestTimeout = 55000, pollTimeout = 20000, capacity = 32, sessionLifetime = 86400000,
  maxRetainedBytes = 32 * 1024 * 1024, maxBufferedReplyBytes = 16 * 1024 * 1024,
  maxBodyReaders = 4, maxValueNodes = 100000 } = {}) {
  [callerToken, deviceToken, sessionSecret].forEach(secret);
  if (new Set([callerToken, deviceToken, sessionSecret]).size !== 3) throw new Error('Credentials must be distinct');
  if (![capacity, maxRetainedBytes, maxBufferedReplyBytes, maxBodyReaders, maxValueNodes].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('Invalid relay resource budget');
  const jobs = new Map();
  let poll = null, closed = false, onlineUntil = 0, bodyReaders = 0, readingBytes = 0, retainedBytes = 0, bufferedReplyBytes = 0;
  // Wire bytes alone are not a memory bound: a short JSON array can expand to
  // hundreds of thousands of objects. Charge a conservative structural budget
  // before retaining it or building canonical fingerprints. The reader count
  // also bounds the temporary JSON.parse expansion before this check runs.
  function inspectJsonText(text) {
    let quoted = false, escaped = false, scalar = false, depth = 0, containers = 0, tokens = 0;
    for (let index = 0; index < text.length; index++) {
      const char = text.charCodeAt(index);
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === 92) escaped = true;
        else if (char === 34) quoted = false;
        continue;
      }
      if (char === 34) { quoted = true; scalar = false; tokens++; }
      else if (char === 123 || char === 91) { depth++; containers++; tokens++; scalar = false; }
      else if (char === 125 || char === 93) { depth--; scalar = false; }
      else if (char === 44 || char === 58 || char === 32 || char === 9 || char === 10 || char === 13) scalar = false;
      else if (!scalar) { tokens++; scalar = true; }
      // Keys are tokens too, so twice the post-parse value limit preserves
      // every valid shape within that limit. This is a linear admission scan,
      // not a second JSON parser; JSON.parse still rejects invalid syntax.
      if (containers > maxValueNodes || tokens > maxValueNodes * 2 || depth > 129) throw Object.assign(new Error('JSON structure exceeds relay budget'), { status: 413 });
    }
  }
  function retainedWeight(value) {
    let nodes = 0, bytes = 0;
    function visit(item, depth) {
      if (++nodes > maxValueNodes || depth > 128) throw Object.assign(new Error('JSON structure exceeds relay budget'), { status: 413 });
      bytes += typeof item === 'string' ? 32 + item.length * 2 : item && typeof item === 'object' ? 64 : 16;
      if (bytes > maxRetainedBytes) throw Object.assign(new Error('JSON value exceeds relay budget'), { status: 413 });
      if (Array.isArray(item)) {
        bytes += item.length * 8;
        if (bytes > maxRetainedBytes) throw Object.assign(new Error('JSON array exceeds relay budget'), { status: 413 });
        for (const child of item) visit(child, depth + 1);
      } else if (item && typeof item === 'object') {
        for (const key of Object.keys(item)) {
          bytes += 24 + key.length * 2; visit(item[key], depth + 1);
        }
      }
    }
    visit(value, 0); return bytes;
  }
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
  function reply(res, status, value, headers = {}, budgetFallback) {
    if (res.destroyed || res.writableEnded) return false;
    let serialized = value === undefined ? undefined : JSON.stringify(value);
    let bytes = serialized === undefined ? 0 : Buffer.byteLength(serialized), accepted = true;
    if (bytes > 1024 && bufferedReplyBytes + bytes > maxBufferedReplyBytes) {
      status = 503; accepted = false;
      serialized = JSON.stringify(budgetFallback ?? { status: 'relay-output-busy' });
      bytes = Buffer.byteLength(serialized);
    }
    bufferedReplyBytes += bytes;
    let released = false;
    const release = () => { if (!released) { released = true; bufferedReplyBytes -= bytes; } };
    res.once('finish', release); res.once('close', release);
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers });
    res.end(serialized); return accepted;
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
    if (job) { const waiting = poll; poll = null; clearTimeout(waiting.timer); if (!reply(waiting.res, 200, job)) jobs.get(job.operationId).delivered = false; }
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
      const declared = req.headers['content-length'];
      const bodyReservation = typeof declared === 'string' && /^\d+$/.test(declared) ? Number(declared) : MAX_BYTES;
      if (!Number.isSafeInteger(bodyReservation) || bodyReservation > MAX_BYTES) return reply(res, 413, { status: 'too-large' });
      if (bodyReaders >= maxBodyReaders || readingBytes + bodyReservation > MAX_BYTES) return reply(res, 503, { status: 'relay-input-busy' });
      let body;
      bodyReaders++; readingBytes += bodyReservation;
      try { body = await readJson(req, bodyReservation, inspectJsonText); } finally { bodyReaders--; readingBytes -= bodyReservation; }
      const bodyWeight = retainedWeight(body);
      if (path === '/bridge/poll') {
        if (body?.version !== VERSION) return reply(res, 409, { status: 'version-mismatch' });
        if (poll) return reply(res, 409, { status: 'device-already-polling' });
        onlineUntil = Date.now() + pollTimeout + 5000;
        const job = nextJob();
        if (job) { if (!reply(res, 200, job)) jobs.get(job.operationId).delivered = false; return; }
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
      if (retainedBytes + bodyWeight > maxRetainedBytes) return reply(res, 503, rpcError(body.id, -32002, 'Relay memory budget is busy; no operation was dispatched', { state: 'not-executed' }));
      // Same MCP session + request id is stable even after a cloud restart.
      // A changed payload under this id is rejected by the durable local journal.
      const operationId = mac(sessionSecret, sessionId + '\0' + JSON.stringify(body.id));
      if (jobs.has(operationId)) return reply(res, 409, rpcError(body.id, -32003, 'Request already in flight', { operationId }));
      const response = await new Promise(resolve => {
        const job = { operationId, deliveryId: randomUUID(), fingerprint: requestHash(body), request: body, delivered: false, expiresAt: Date.now() + requestTimeout, timer: null,
          finish(response) { if (!jobs.has(operationId)) return; clearTimeout(job.timer); jobs.delete(operationId); retainedBytes -= bodyWeight; resolve(response); } };
        job.timer = setTimeout(() => job.finish(rpcError(body.id, -32004,
          job.delivered ? 'Operation result unknown; inspect local journal before retrying' : 'Operation not dispatched',
          { operationId, state: job.delivered ? 'unknown' : 'not-executed' })), requestTimeout);
        retainedBytes += bodyWeight; jobs.set(operationId, job); wake();
      });
      reply(res, 200, remoteSidebarMetadata(body.method, response), { 'mcp-session-id': sessionId }, rpcError(body.id, -32004,
        'Relay response budget is busy; inspect local journal before retrying', { operationId, state: 'unknown' }));
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
