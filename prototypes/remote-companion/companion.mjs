import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { VERSION, MAX_BYTES, bridgeUrl, secret, digest, requestHash, validateRequest, threadId, rpcError } from './protocol.mjs';
import { Journal } from './journal.mjs';
import { createStdioAdapter } from './stdio.mjs';

const SAFE_TOOLS = new Set(['open_deck_sidebar_probe', 'deck_context', 'deck_issue_get', 'deck_issue_list', 'deck_map_snapshot', 'deck_current_project', 'deck_rpc_manifest', 'deck_host_context_probe']);
const statusTool = { name: 'deck_remote_operation_status', description: 'Check an uncertain operation in the local execution journal. Never replays an operation.',
  inputSchema: { type: 'object', required: ['operationId'], additionalProperties: false, properties: { operationId: { type: 'string', pattern: '^[a-f0-9]{64}$' } } }, annotations: { readOnlyHint: true } };

export function createExecutor({ adapter, journal, resolveProject, isReadMethod, pairingId = 'test-pair' }) {
  return async function execute(job) {
    let entered = false;
    const request = job?.request;
    try {
      validateRequest(request);
      if (job.version !== VERSION || !/^[a-f0-9]{64}$/.test(job.operationId ?? '') || !Number.isFinite(job.expiresAt) || job.expiresAt < Date.now()) throw new Error('Expired or incompatible request');
      if (job.fingerprint !== requestHash(request)) throw new Error('Request fingerprint mismatch');
      if (journal.revoked) throw new Error('Pairing revoked locally');
      let identity = null, scope;
      if (request.method === 'tools/call') {
        identity = threadId(request);
        const project = await resolveProject(request.params._meta);
        if (!project?.projectRoot || project.associated === false || project.threadId !== identity) throw new Error('No verified local project for this host identity');
        // Use the trusted resolver's canonical local root, never a path from
        // tool arguments. Windows roots are case-insensitive.
        const projectRoot = path.resolve(project.projectRoot);
        scope = { pairingId, threadId: identity, projectRoot: process.platform === 'win32' ? projectRoot.toLowerCase() : projectRoot };
        const name = request.params.name;
        if (name === statusTool.name) {
          const operationId = request.params.arguments?.operationId;
          if (!/^[a-f0-9]{64}$/.test(operationId ?? '')) throw new Error('Invalid operation id');
          const status = journal.status(operationId, scope);
          return { jsonrpc: '2.0', id: request.id, result: { content: [{ type: 'text', text: JSON.stringify(status) }], structuredContent: status } };
        }
        if (name === 'deck_upstream_read') {
          const args = request.params.arguments;
          if (!isReadMethod(args?.method, args?.payload)) throw new Error('Write/unknown method rejected on remote read route');
          if (args?.payload?.expectedThreadId !== identity) throw new Error('Host thread changed; refresh project');
        } else if (!SAFE_TOOLS.has(name)) {
          // Production remains closed until host approvals and all existing
          // local write gates have been validated across this network boundary.
          throw new Error('Remote writes are not enabled: authorization acceptance is pending');
        }
      }
      // Validate identity before returning cached data as project ownership may
      // have changed or been revoked since the original invocation.
      // Static resources and capability discovery have no business side
      // effects. Do not persist an entire UI bundle for each page load.
      if (scope) {
        const entry = journal.begin(job.operationId, request, scope);
        if (!entry.fresh) return { ...entry.response, id: request.id };
        entered = true;
      }
      const response = await adapter.request(request);
      if (!response || response.jsonrpc !== '2.0' || (!('result' in response) && !('error' in response))) throw new Error('Invalid local adapter response');
      response.id = request.id;
      if (request.method === 'tools/list' && response.result?.tools) {
        response.result.tools.push(statusTool);
        for (const tool of response.result.tools) if (tool.annotations?.readOnlyHint !== true && !SAFE_TOOLS.has(tool.name)) {
          tool.description = 'Remote write access is pending acceptance; this route currently rejects execution. ' + tool.description;
        }
      }
      if (request.method === 'tools/call' && request.params.name === 'deck_rpc_manifest' && response.result?.structuredContent) {
        response.result.structuredContent.remote = { protocol: VERSION, writesEnabled: false };
      }
      if (entered) journal.finish(job.operationId, response);
      return response;
    } catch (error) {
      if (entered) journal.uncertain(job.operationId);
      return rpcError(request?.id, entered ? -32004 : -32005,
        entered ? 'Local execution result unknown; inspect journal before retrying' : error.message,
        { operationId: job?.operationId, state: entered ? 'unknown' : 'not-executed' });
    }
  };
}

export function startCompanion({ relayOrigin, deviceToken, execute, allowLoopback = false, concurrency = 4, retryMs = 2000, onState = () => {} }) {
  const origin = bridgeUrl(relayOrigin, allowLoopback); secret(deviceToken);
  const controller = new AbortController(); const active = new Set(); let stopped = false;
  async function post(path, body) {
    const response = await fetch(origin + path, { method: 'POST', redirect: 'error', headers: {
      authorization: `Bearer ${deviceToken}`, 'content-type': 'application/json',
    }, body: JSON.stringify(body), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) });
    if (!response.ok) throw Object.assign(new Error('Relay rejected request'), { status: response.status });
    // Responses are bounded even when the relay is misconfigured or compromised.
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if (size > MAX_BYTES) throw new Error('Relay response too large'); chunks.push(chunk); }
    return JSON.parse(Buffer.concat(chunks).toString());
  }
  const done = (async () => {
    while (!stopped) {
      try {
        if (active.size >= concurrency) await Promise.race(active);
        if (stopped) break;
        const job = await post('/bridge/poll', { version: VERSION });
        onState('connected');
        if (job.version !== VERSION) throw Object.assign(new Error('Version mismatch'), { status: 409 });
        if (job.idle) continue;
        const task = (async () => {
          const response = await execute(job);
          try { await post('/bridge/result', { version: VERSION, operationId: job.operationId,
            deliveryId: job.deliveryId, fingerprint: job.fingerprint, response }); }
          catch { onState('result-retained-locally'); } // never repeat local execution
        })().catch(() => onState('local-error'));
        active.add(task); task.finally(() => active.delete(task));
      } catch (error) {
        if (stopped) break;
        if ([401, 403, 409].includes(error.status)) { onState('authorization-or-version-rejected'); stopped = true; break; }
        onState('disconnected');
        await new Promise(resolve => {
          const wake = () => { clearTimeout(timer); resolve(); };
          const timer = setTimeout(() => { controller.signal.removeEventListener('abort', wake); resolve(); }, retryMs);
          controller.signal.addEventListener('abort', wake, { once: true });
        });
      }
    }
    await Promise.allSettled(active);
  })();
  return { done, async stop() { stopped = true; controller.abort(); await done; } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // This development entry point uses environment secrets. Installation/pairing
  // and Windows credential storage are separate, still unaccepted work.
  const adapterPath = process.env.DECK_LOCAL_ADAPTER;
  if (!adapterPath || !process.env.DECK_LOCAL_JOURNAL) throw new Error('Select a local adapter and journal explicitly');
  const { resolveSessionProject } = await import(new URL('./session-project.mjs', pathToFileURL(adapterPath)));
  const { classifyEndpoint } = await import(new URL('./rpc-endpoints.mjs', pathToFileURL(adapterPath)));
  const journal = new Journal(process.env.DECK_LOCAL_JOURNAL);
  const adapter = createStdioAdapter(adapterPath);
  const execute = createExecutor({ adapter, journal, resolveProject: resolveSessionProject, pairingId: digest(process.env.DECK_RELAY_ORIGIN + '\0' + process.env.DECK_DEVICE_TOKEN),
    isReadMethod: (method, payload) => classifyEndpoint(method, payload) === 'read' });
  const companion = startCompanion({ relayOrigin: process.env.DECK_RELAY_ORIGIN, deviceToken: process.env.DECK_DEVICE_TOKEN,
    execute, onState: state => console.log('Deck companion: ' + state) });
  const close = async () => { await companion.stop(); await adapter.close(); journal.close(); };
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void close().then(() => process.exit(0)); });
  await companion.done;
  await adapter.close(); journal.close();
}
