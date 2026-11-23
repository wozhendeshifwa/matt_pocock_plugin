import { createServer } from 'node:http';
import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const uri = 'ui://deck-remote-compat/probe.html';
const digest = value => createHash('sha256').update(value).digest();
export function summarizeMetadata(meta = {}) {
  const thread = meta.threadId ?? meta.thread_id;
  return { keys: Object.keys(meta).slice(0, 40), hasThreadId: typeof thread === 'string', threadFingerprint: typeof thread === 'string' ? digest(thread).toString('hex').slice(0, 16) : null, hasCwd: typeof meta.cwd === 'string' };
}
export async function createProbe({ token, origin, host = '127.0.0.1', port = 0 } = {}) {
  if (typeof token !== 'string' || token.length < 32) throw new Error('Provide a probe token of at least 32 characters');
  const tokenHash = digest(token);
  const sessions = new Map();
  const html = await readFile(new URL('probe.html', import.meta.url), 'utf8');
  let opening = 0;
  function makeSession() {
    const session = { touched: Date.now() };
    const server = new Server({ name: 'deck-remote-compat-probe', version: '0.1.0' }, { capabilities: { tools: {}, resources: {} } });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID, enableJsonResponse: true, onsessioninitialized: id => { session.id = id; sessions.set(id, session); } });
    Object.assign(session, { server, transport });
    transport.onclose = () => sessions.delete(session.id);
    server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [
      { name: 'open_remote_compat_probe', description: 'Open an isolated read-only compatibility probe. No project files or GitHub data are accessed.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true }, _meta: { ui: { resourceUri: uri }, 'openai/ui': { entrypoints: [{ type: 'thread' }] } } },
      { name: 'remote_compat_identity', description: 'Return only host metadata key names and a thread fingerprint; no raw conversation or file data.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true }, _meta: { ui: { visibility: ['model', 'app'] } } }
    ] }));
    server.setRequestHandler(CallToolRequestSchema, request => {
      if (!['open_remote_compat_probe', 'remote_compat_identity'].includes(request.params.name)) throw new Error('Unknown probe tool');
      if (Object.keys(request.params.arguments ?? {}).length) throw new Error('Probe accepts no arguments');
      const data = { probe: true, ...summarizeMetadata(request.params._meta) };
      return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
    });
    server.setRequestHandler(ListResourcesRequestSchema, () => ({ resources: [{ uri, name: 'Remote compatibility probe', mimeType: 'text/html;profile=mcp-app' }] }));
    server.setRequestHandler(ReadResourceRequestSchema, request => {
      if (request.params.uri !== uri) throw new Error('Unknown probe resource');
      return { contents: [{ uri, mimeType: 'text/html;profile=mcp-app', text: html }] };
    });
    return server.connect(transport).then(() => session);
  }
  const http = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const reply = (status, text) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ status: text })); };
    try {
      const pathname = new URL(req.url, 'http://probe.local').pathname;
      if (pathname === '/healthz' && req.method === 'GET') return reply(200, 'probe-ready');
      if (pathname !== '/mcp') return reply(404, 'not-found');
      const auth = req.headers.authorization;
      if (typeof auth !== 'string' || !auth.startsWith('Bearer ') || !timingSafeEqual(digest(auth.slice(7)), tokenHash)) return reply(401, 'unauthorized');
      if (req.headers.origin && req.headers.origin !== origin) return reply(403, 'origin-rejected');
      let body;
      if (req.method === 'POST') {
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 8192) return reply(413, 'too-large'); chunks.push(chunk); }
        try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { return reply(400, 'invalid-json'); }
      }
      let session;
      const id = req.headers['mcp-session-id'];
      if (id) { session = sessions.get(id); if (!session) return reply(404, 'session-expired'); }
      else if (req.method === 'POST' && body?.method === 'initialize' && body?.id !== undefined) {
        if (sessions.size + opening >= 16) return reply(503, 'session-limit');
        opening++; try { session = await makeSession(); } finally { opening--; }
      } else return reply(400, 'initialize-first');
      session.touched = Date.now();
      await session.transport.handleRequest(req, res, body);
    } catch { if (!res.headersSent) reply(500, 'probe-error'); else res.end(); }
  });
  const cleanup = setInterval(() => {
    for (const session of sessions.values()) if (Date.now() - session.touched > 10 * 60 * 1000) { sessions.delete(session.id); void session.server.close(); }
  }, 60000);
  cleanup.unref();
  await new Promise((resolve, reject) => { http.once('error', reject); http.listen(port, host, resolve); });
  return { port: http.address().port, close: async () => { clearInterval(cleanup); await Promise.allSettled([...sessions.values()].map(s => s.server.close())); http.closeAllConnections(); await new Promise(resolve => http.close(resolve)); } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = await createProbe({ token: process.env.MCP_ACCESS_TOKEN, origin: process.env.RENDER_EXTERNAL_URL, host: process.env.RENDER ? '0.0.0.0' : '127.0.0.1', port: Number(process.env.PORT ?? 10043) });
  console.log('Read-only compatibility probe listening');
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void app.close().then(() => process.exit(0)); });
}
