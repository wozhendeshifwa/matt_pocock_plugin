import express from 'express';
import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest, ListToolsRequestSchema, CallToolRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema, ListResourceTemplatesRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { projectContext } from './context.mjs';

const LOCAL_ONLY = new Set([
  'gitStatus', 'gitDiff', 'gitLog', 'gitWriteCheck', 'gitStage', 'gitUnstage', 'gitCommit', 'gitPull', 'gitFetch', 'gitPush',
  'initPublish', 'retryPush', 'openFolder', 'openPath', 'pickDirectory', 'pickFile', 'deckExec',
  'namingPlan', 'namingRegister', 'namingSignal', 'namingResult', 'registerNewSessionWatcher', 'cancelNewSessionWatcher',
  'handoffLatest', 'handoffResolve', 'updateInstall', 'bind',
]);
const READ_TOOLS = new Set(['deck_context', 'deck_issue_get', 'deck_map_snapshot', 'deck_issue_list']);
const repositoryTools = [
  { name: 'deck_repository_list', description: 'List the configured GitHub repositories and this connection\'s current selection.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true }, _meta: { ui: { visibility: ['model', 'app'] } } },
  { name: 'deck_repository_select', description: 'Select one configured GitHub repository for this connection. Other connections keep their own selection. Call before opening the board or using deck tools.', inputSchema: { type: 'object', properties: { repository: { type: 'string' } }, required: ['repository'], additionalProperties: false }, annotations: { readOnlyHint: true }, _meta: { ui: { visibility: ['model', 'app'] } } },
];
const result = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value });
const failure = message => ({ isError: true, content: [{ type: 'text', text: message }] });
const hash = value => createHash('sha256').update(value).digest();

export async function createCloudApp({ core, repositoryStore, accessToken, publicOrigin, allowWrites = false, maxSessions = 32, idleMs = 30 * 60 * 1000 }) {
  if (typeof accessToken !== 'string' || accessToken.length < 32) throw new Error('MCP_ACCESS_TOKEN must be at least 32 characters.');
  const tokenHash = hash(accessToken);
  const picker = await readFile(new URL('repo-picker.js', import.meta.url), 'utf8');
  const sessions = new Map();
  const app = express();
  app.disable('x-powered-by');
  app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
  app.get('/', (_req, res) => res.json({ service: 'MattSkillsDeck MCP', transport: 'Streamable HTTP', endpoint: '/mcp', authentication: 'Bearer token required' }));
  app.use('/mcp', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    const authorization = req.headers.authorization;
    if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ') || !timingSafeEqual(hash(authorization.slice(7)), tokenHash)) {
      return res.status(401).json({ error: 'A valid Bearer token is required.' });
    }
    // Native MCP clients normally omit Origin. Browser clients must match the
    // configured public URL; do not trust Host or X-Forwarded-Host for this check.
    if (req.headers.origin && req.headers.origin !== publicOrigin) return res.status(403).json({ error: 'Origin is not allowed.' });
    next();
  });
  app.use('/mcp', express.json({ limit: '1mb' }));

  async function forward(session, method, params = {}) {
    const project = session.project;
    if (method === 'tools/call') {
      if (params.name === 'deck_host_context_probe') return result({ stored: false, reason: 'Cloud mode does not collect desktop context.' });
      if (params.name === 'deck_repository_list') return result({ repositories: repositoryStore.list(), selected: project?.repository ?? null, githubWrites: allowWrites });
      if (params.name === 'deck_rpc_manifest') {
        const original = await core.handle({ method, params });
        const manifest = original.structuredContent;
        return result({ ...manifest, read: manifest.read.filter(name => !LOCAL_ONLY.has(name)), write: allowWrites ? manifest.write.filter(name => !LOCAL_ONLY.has(name)) : [], upstream: manifest.upstream.filter(name => !LOCAL_ONLY.has(name)), cloud: { githubWrites: allowWrites, localGit: false, desktop: false } });
      }
      if (params.name === 'deck_repository_select') {
        const args = params.arguments;
        if (!args || typeof args.repository !== 'string' || Object.keys(args).some(key => key !== 'repository')) return failure('Provide only a repository string.');
        try {
          const selection = await repositoryStore.select(args.repository);
          session.project = { ...selection, identity: randomUUID() };
          return result({ repository: selection.repository, selected: true });
        } catch (error) { return failure(error.message); }
      }
      if (params.name === 'deck_upstream_read' || params.name === 'deck_upstream_write') {
        const methodName = params.arguments?.method;
        if (LOCAL_ONLY.has(methodName)) return failure('此操作依赖本机项目或桌面，在 GitHub 云端模式中不可用。');
        if (params.name === 'deck_upstream_write' && !allowWrites) return failure('GitHub writes are disabled. Set DECK_GITHUB_WRITES=true to enable the existing write gates.');
        const payload = params.arguments?.payload ?? {};
        params = { ...params, arguments: { ...params.arguments, payload: { ...payload, expectedThreadId: payload.expectedThreadId ?? project?.identity } } };
      } else if (params.name.startsWith('deck_') && !READ_TOOLS.has(params.name) && !['deck_current_project', 'deck_rpc_manifest'].includes(params.name) && !allowWrites) {
        return failure('GitHub writes are disabled. Set DECK_GITHUB_WRITES=true to enable the existing write gates.');
      }
    }
    // Never accept a remote client's desktop thread/path identity as authority.
    const request = { method, params: { ...params, _meta: { threadId: project?.identity } } };
    const reply = await projectContext.run(project, () => core.handle(request));
    if (method === 'resources/read') {
      for (const content of reply.contents ?? []) {
        if (typeof content.text === 'string' && content.mimeType?.startsWith('text/html')) {
          content.text = content.text.replace('</body>', `<script>${picker}</script></body>`);
        }
      }
    }
    return reply;
  }

  async function newSession() {
    const session = { touched: Date.now(), project: null, active: 0, queue: Promise.resolve() };
    const server = new Server({ name: 'mattskills-cloud', version: '1.0.0' }, { capabilities: { tools: {}, resources: {} }, instructions: 'First call deck_repository_list, then deck_repository_select. Selections are connection-scoped. This service manages GitHub Issues and maps; local Git, desktop files and Codex history are unavailable.' });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID, enableJsonResponse: true, onsessioninitialized: id => { session.id = id; sessions.set(id, session); } });
    session.server = server;
    session.transport = transport;
    transport.onclose = () => sessions.delete(session.id);
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      const original = await forward(session, 'tools/list');
      if (!allowWrites) original.tools = original.tools.filter(tool => tool.name !== 'deck_upstream_write' && (!tool.name.startsWith('deck_') || READ_TOOLS.has(tool.name) || ['deck_current_project', 'deck_host_context_probe', 'deck_rpc_manifest'].includes(tool.name)));
      return { tools: [...repositoryTools, ...original.tools] };
    });
    // Serialize tools in each connection: switching repositories waits for any
    // earlier operation, and an old panel's expectedThreadId remains stale.
    server.setRequestHandler(CallToolRequestSchema, request => {
      const work = session.queue.then(() => forward(session, 'tools/call', request.params));
      session.queue = work.catch(() => {});
      return work;
    });
    server.setRequestHandler(ListResourcesRequestSchema, request => forward(session, 'resources/list', request.params));
    server.setRequestHandler(ListResourceTemplatesRequestSchema, () => ({ resourceTemplates: [] }));
    server.setRequestHandler(ReadResourceRequestSchema, request => forward(session, 'resources/read', request.params));
    await server.connect(transport);
    return session;
  }

  let opening = 0;
  app.all('/mcp', async (req, res) => {
    let session;
    try {
      const id = req.headers['mcp-session-id'];
      if (id) {
        session = sessions.get(id);
        if (!session) return res.status(404).json({ error: 'Session expired. Initialize a new MCP connection.' });
      } else if (req.method === 'POST' && isInitializeRequest(req.body)) {
        if (sessions.size + opening >= maxSessions) return res.status(503).json({ error: 'Session limit reached. Try again later.' });
        opening++;
        try { session = await newSession(); } finally { opening--; }
      } else return res.status(400).json({ error: 'Initialize an MCP session first.' });
      session.touched = Date.now();
      session.active++;
      await session.transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent) res.status(500).json({ error: 'MCP request failed.' });
    } finally {
      if (session) {
        session.active--;
        if (!session.id) await session.server.close();
      }
    }
  });
  app.use((error, _req, res, _next) => {
    res.status(error.type === 'entity.too.large' ? 413 : 400).json({ error: 'Invalid request body.' });
  });
  const cleanup = setInterval(() => {
    for (const session of sessions.values()) if (!session.active && Date.now() - session.touched > idleMs) void session.server.close();
  }, Math.min(idleMs, 60000));
  cleanup.unref();
  return { app, async close() { clearInterval(cleanup); await Promise.allSettled([...sessions.values()].map(session => session.server.close())); await core.dispose(); } };
}
