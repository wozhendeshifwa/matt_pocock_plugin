import { pathToFileURL } from 'node:url';
import { realpath } from 'node:fs/promises';
import { VERSION, MAX_BYTES, bridgeUrl, secret, digest, requestHash, validateRequest, threadId, rpcError } from './protocol.mjs';
import { Journal } from './journal.mjs';
import { createStdioAdapter, normalizeLocalTracker, normalizeLocalPublication, normalizeLocalOpen } from './stdio.mjs';
import { normalizeWriteGrant, assertWriteGranted } from './write-grant.mjs';

const SAFE_TOOLS = new Set(['open_deck_sidebar_probe', 'deck_context', 'deck_issue_get', 'deck_issue_list', 'deck_map_snapshot', 'deck_current_project', 'deck_rpc_manifest', 'deck_host_context_probe']);
const statusTool = { name: 'deck_remote_operation_status', description: 'Check an uncertain operation in the local execution journal. Never replays an operation.',
  inputSchema: { type: 'object', required: ['operationId'], additionalProperties: false, properties: { operationId: { type: 'string', pattern: '^[a-f0-9]{64}$' } } }, annotations: { readOnlyHint: true } };

export function createExecutor({ adapter, journal, resolveProject, isReadMethod, pairingId = 'test-pair', writeGrant, writeLedger, prepareWrite, observeRead }) {
  const grant = normalizeWriteGrant(writeGrant);
  if (grant && !writeLedger) throw new Error('An installation-level write ledger is required before enabling a local write grant');
  const background = new Set();
  function keep(promise) { background.add(promise); void promise.finally(() => background.delete(promise)).catch(() => {}); return promise; }
  function writeUnknown(record, reason) {
    try { writeLedger.markUnknown({ ...record, reason }); } catch { /* Keep the durable running barrier if storage fails. */ }
    try { journal.uncertain(record.operationId); } catch {}
  }
  async function execute(job) {
    let entered = false, writeRecord = null, adapterStarted = false;
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
        const projectRoot = await realpath(project.projectRoot);
        scope = { pairingId, threadId: identity, projectRoot: process.platform === 'win32' ? projectRoot.toLowerCase() : projectRoot };
        const projectKey = scope.projectRoot;
        const name = request.params.name;
        if (name === statusTool.name) {
          const operationId = request.params.arguments?.operationId;
          if (!/^[a-f0-9]{64}$/.test(operationId ?? '')) throw new Error('Invalid operation id');
          const writeStatus = writeLedger?.inspect({ operationId, projectKey, ownerScope: scope });
          const status = writeStatus?.state !== 'not-found' && writeStatus ? writeStatus : journal.status(operationId, scope);
          return { jsonrpc: '2.0', id: request.id, result: { content: [{ type: 'text', text: JSON.stringify(status) }], structuredContent: status } };
        }
        if (name === 'deck_upstream_read') {
          const args = request.params.arguments;
          if (!isReadMethod(args?.method, args?.payload)) throw new Error('Write/unknown method rejected on remote read route');
          if (args?.payload?.expectedThreadId !== identity) throw new Error('Host thread changed; refresh project');
        } else if (!SAFE_TOOLS.has(name)) {
          if (!grant) throw new Error('Remote writes are not enabled: authorization acceptance is pending');
          let method;
          if (name === 'deck_upstream_write') {
            const args = request.params.arguments;
            if (isReadMethod(args?.method, args?.payload)) throw new Error('Read method must use the remote read route');
            if (args?.payload?.expectedThreadId !== identity) throw new Error('Host thread changed; refresh project');
            method = args?.method;
          } else method = name;
          await assertWriteGranted(grant, projectRoot, method);
          const record = { operationId: job.operationId, projectKey, ownerScope: scope };
          const previous = writeLedger.inspect(record);
          if (previous.state !== 'not-found') {
            if (previous.intent.method !== method || previous.intent.parametersSha256 !== requestHash(request)) throw new Error('Operation identifier was reused with a different write intent');
            return rpcError(request.id, -32006, 'Write already recorded; inspect its local status instead of executing it again', {
              operationId: job.operationId, state: previous.state, reason: 'already-recorded',
            });
          }
          writeLedger.assertAvailable({ projectKey });
          // Hold the project barrier during potentially slow, read-only local
          // preparation too. A timed-out caller/new session cannot overtake it.
          const intent = { method, parametersSha256: requestHash(request), target: { correlationKey: job.operationId } };
          const reservation = writeLedger.reserve({ ...record, intent });
          if (!reservation.reserved) return rpcError(request.id, -32006, 'Write already recorded; inspect its local status instead of executing it again', {
            operationId: job.operationId, state: reservation.state, reason: reservation.reason,
          });
          writeRecord = { ...record, intent, method };
          const prepared = await prepareWrite?.({ method, request, projectRoot, threadId: identity, adapter, operationId: job.operationId });
          if (method !== 'deck_issue_report' && typeof prepared?.verify !== 'function') throw new Error('Independent local write readback is unavailable');
          if (prepared?.dispatchContext !== undefined && (!prepared.dispatchContext || typeof prepared.dispatchContext !== 'object' ||
              Array.isArray(prepared.dispatchContext) || Object.keys(prepared.dispatchContext).some(key => !['tracker', 'publication', 'open'].includes(key)))) {
            throw new Error('Invalid trusted write dispatch context');
          }
          writeRecord.tracker = normalizeLocalTracker(prepared?.dispatchContext?.tracker);
          writeRecord.publication = normalizeLocalPublication(prepared?.dispatchContext?.publication);
          writeRecord.open = normalizeLocalOpen(prepared?.dispatchContext?.open);
          if (writeRecord.open && (!['openFolder', 'openPath'].includes(method) || writeRecord.open.operationId !== job.operationId) ||
              writeRecord.publication && !['initPublish', 'retryPush'].includes(method)) throw new Error('Local write context does not match this operation');
          writeRecord.intent = writeLedger.refineIntent({ ...record, intent: { ...intent,
            target: { ...intent.target, ...(prepared?.target ?? { localStateKey: 'session-tickets' }) } } });
          writeRecord.verify = prepared?.verify;
          if (journal.revoked) throw new Error('Pairing revoked before local write dispatch');
          if (job.expiresAt <= Date.now()) throw new Error('Request expired before local write dispatch');
        }
      }
      // Validate identity before returning cached data as project ownership may
      // have changed or been revoked since the original invocation.
      // Static resources and capability discovery have no business side
      // effects. Do not persist an entire UI bundle for each page load.
      if (scope) {
        const entry = journal.begin(job.operationId, request, scope);
        if (!entry.fresh) {
          const cached = { ...entry.response, id: request.id };
          if (writeRecord) writeUnknown(writeRecord, 'operator-uncertain');
          return cached;
        }
        entered = true;
      }
      if (writeRecord) {
        if (journal.revoked) throw new Error('Pairing revoked before local write dispatch');
        if (job.expiresAt <= Date.now()) throw new Error('Request expired before local write dispatch');
        adapterStarted = true;
        const localContext = { projectRoot: scope.projectRoot, threadId: identity,
          ...(writeRecord.tracker ? { tracker: writeRecord.tracker } : {}),
          ...(writeRecord.publication ? { publication: writeRecord.publication } : {}),
          ...(writeRecord.open ? { open: writeRecord.open } : {}) };
        const call = typeof adapter.beginRequest === 'function' ? adapter.beginRequest(request, localContext) : (() => {
          const completion = adapter.request(request, localContext); return { response: completion, completion };
        })();
        const final = keep(Promise.resolve(call.completion).then(async response => {
          if (!response || response.jsonrpc !== '2.0' || (!('result' in response) && !('error' in response))) throw new Error('Invalid local write response');
          response.id = request.id;
          const effect = !response.error && !response.result?.isError && await writeRecord.verify?.(response);
          if (!effect) {
            // A returned error can follow partial side effects. Do not infer
            // non-execution merely from isError/ok:false or a protocol failure.
            writeUnknown(writeRecord, 'partial-result');
            return rpcError(request.id, -32004, 'Local write outcome is uncertain; inspect local evidence before any retry', { operationId: job.operationId, state: 'unknown' });
          }
          const outcome = effect.outcome ?? 'succeeded', result = effect.result ?? effect;
          writeLedger.complete({ ...writeRecord, outcome, result: { ...result,
            target: { ...writeRecord.intent.target, ...result.target } } });
          try { journal.finish(job.operationId, response); } catch { /* Known effect remains recorded in the installation ledger. */ }
          return response;
        }).catch(() => {
          writeUnknown(writeRecord, 'adapter-timeout');
          return rpcError(request.id, -32004, 'Local write result remains unknown; do not replay', { operationId: job.operationId, state: 'unknown' });
        }));
        try { await call.response; return await final; }
        catch {
          // The independent completion channel stays registered. It may still
          // release this barrier with a known late result, including after the
          // relay/client has stopped waiting. No local write is retried.
          writeUnknown(writeRecord, 'adapter-timeout');
          return rpcError(request.id, -32004, 'Local write result unknown; completion is still tracked locally', { operationId: job.operationId, state: 'unknown' });
        }
      }
      const response = await adapter.request(request, scope ? { projectRoot: scope.projectRoot, threadId: identity } : undefined);
      if (!response || response.jsonrpc !== '2.0' || (!('result' in response) && !('error' in response))) throw new Error('Invalid local adapter response');
      response.id = request.id;
      if (scope && observeRead) await observeRead({ request, response, projectRoot: scope.projectRoot, threadId: identity });
      if (request.method === 'tools/list' && response.result?.tools) {
        response.result.tools.push(statusTool);
        for (const tool of response.result.tools) if (tool.annotations?.readOnlyHint !== true && !SAFE_TOOLS.has(tool.name)) {
          const allowed = grant && (grant.methods.includes(tool.name) || (tool.name === 'deck_upstream_write' && grant.methods.some(method => !method.startsWith('deck_'))));
          tool.description = (allowed ? 'Local trial write grant required for the exact project/method. ' : 'Remote write access is pending acceptance; this route currently rejects execution. ') + tool.description;
        }
      }
      if (request.method === 'tools/call' && request.params.name === 'deck_rpc_manifest' && response.result?.structuredContent) {
        response.result.structuredContent.remote = { protocol: VERSION, writesEnabled: Boolean(grant), allowedWriteMethods: grant?.methods ?? [] };
      }
      if (entered) journal.finish(job.operationId, response);
      return response;
    } catch (error) {
      if (writeRecord) {
        if (adapterStarted) writeUnknown(writeRecord, 'operator-uncertain');
        else {
          // Reservation/preparation failed before adapter dispatch. This is a
          // known rejection, unlike an error returned after execution started.
          try { writeLedger.complete({ ...writeRecord, outcome: 'failed', result: { errorKind: 'rejected' } }); } catch {}
        }
      }
      if (entered) journal.uncertain(job.operationId);
      const uncertain = adapterStarted || (entered && !writeRecord);
      return rpcError(request?.id, uncertain ? -32004 : -32005,
        uncertain ? 'Local execution result unknown; inspect journal before retrying' : error.message,
        { operationId: job?.operationId, state: uncertain ? 'unknown' : 'not-executed',
          ...(error.code ? { reason: error.code } : {}),
          ...(error.blockingOperationId ? { blockingOperationId: error.blockingOperationId, blockingState: error.state } : {}) });
    }
  }
  execute.drain = async () => { while (background.size) await Promise.allSettled([...background]); };
  return execute;
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
    await execute.drain?.();
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
