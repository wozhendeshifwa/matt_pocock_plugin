import { realpath } from 'node:fs/promises';
import { createGitWriteEffects } from './write-effects-git.mjs';
import { createLocalWriteEffects } from './write-effects-local.mjs';

const folded = value => process.platform === 'win32' ? value.toLowerCase() : value;
const business = response => response?.error || response?.result?.isError || response?.result?.structuredContent?.ok === false
  ? null : response?.result?.structuredContent?.value ?? response?.result?.structuredContent ?? null;

// Constructed by the local launcher with its verified frozen adapter. No MCP
// parameter can supply an executable, state directory, reader or write ticket.
export async function createWriteEffects({ adapterPath, env = process.env } = {}) {
  const [git, local] = await Promise.all([createGitWriteEffects({ env }), createLocalWriteEffects({ adapterPath })]);
  const checks = new Map();
  const checkKey = (root, thread, id) => JSON.stringify([folded(root), thread, id]);
  async function observeRead({ request, response, projectRoot, threadId }) {
    if (request.params?.name !== 'deck_upstream_read' || request.params.arguments?.method !== 'gitWriteCheck') return;
    const check = business(response);
    if (check?.ok !== true || !check.ticket?.id || !['allow', 'warn'].includes(check.decision?.verdict) || !Number.isFinite(check.ticket.expiresAtMs)) return;
    const root = await realpath(projectRoot), key = checkKey(root, threadId, check.ticket.id);
    checks.set(key, structuredClone({ projectRoot: root, threadId, check }));
    const now = Date.now();
    for (const [key, value] of checks) if (value.check.ticket.expiresAtMs <= now || checks.size > 128) checks.delete(key);
  }
  async function prepare({ method, request, projectRoot, threadId, adapter }) {
    const root = await realpath(projectRoot);
    const parameters = request.params.name === 'deck_upstream_write' ? request.params.arguments?.payload : request.params.arguments;
    if (['gitStage', 'gitUnstage', 'gitCommit', 'gitPull', 'gitFetch', 'gitPush'].includes(method)) {
      const trustedTicket = parameters?.ticketId ? checks.get(checkKey(root, threadId, parameters.ticketId)) : undefined;
      if (!['gitStage', 'gitUnstage'].includes(method)) {
        const ticket = trustedTicket?.check?.ticket, now = Date.now();
        if (!ticket || ticket.id !== parameters.ticketId || ticket.op !== method.slice(3).toLowerCase() ||
            !Number.isSafeInteger(ticket.checkedAtMs) || ticket.checkedAtMs > now || !Number.isSafeInteger(ticket.expiresAtMs) ||
            ticket.expiresAtMs <= now || ticket.expiresAtMs <= ticket.checkedAtMs) {
          throw new Error('A current matching precheck from this local project and host thread is required');
        }
      }
      return git.prepare({ method, projectRoot: root, threadId, parameters, trustedTicket });
    }
    if (method === 'deck_issue_report') {
      const contextRequest = { jsonrpc: '2.0', id: 'local-report-context', method: 'tools/call', params: {
        name: 'deck_context', arguments: {}, _meta: request.params._meta,
      } };
      const response = await adapter.request(contextRequest, { projectRoot: root, threadId });
      const context = business(response);
      if (context?.ok !== true || context.status !== 'ok' || context.tool !== 'deck_context' || typeof context.workspace?.root !== 'string' ||
          folded(await realpath(context.workspace.root)) !== folded(root) || !['github', 'gitlab', 'markdown'].includes(context.backend?.id) ||
          context.repo?.backend !== context.backend.id || typeof context.repo?.refId !== 'string' || !context.repo.refId ||
          context.data?.workspace?.sessionId !== threadId) {
        throw new Error('No trusted local tracker context for report readback');
      }
      const before = await local.captureReportBefore({ projectRoot: root, threadId });
      const startedAt = Date.now();
      return { target: { localStateKey: 'session-tickets' }, async verify(response) {
        const verified = await local.verifyReport({ projectRoot: root, threadId, request, startedAt, response,
          expectedBackendId: context.backend.id, expectedRepo: context.repo, before });
        return verified.knownSuccess ? verified.result : null;
      } };
    }
    if (typeof local.prepareLocal === 'function') return local.prepareLocal({ method, projectRoot: root, threadId, parameters,
      readBinding: () => adapter.request({ jsonrpc: '2.0', id: 'local-binding-readback', method: 'tools/call', params: {
        name: 'deck_upstream_read', arguments: { method: 'selection', payload: { expectedThreadId: threadId, sessionId: threadId } },
        _meta: request.params._meta,
      } }, { projectRoot: root, threadId }) });
    throw new Error('Independent local write readback is not implemented for this method');
  }
  return { prepare, observeRead };
}
