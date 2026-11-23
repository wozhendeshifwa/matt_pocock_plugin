import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';

// Values here are supplied by local preparation, never by an MCP argument.
export function normalizeLocalTracker(value) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !['backendId', 'repository'].includes(key)) ||
      !['github', 'gitlab', 'markdown'].includes(value.backendId) ||
      typeof value.repository !== 'string' || !value.repository || value.repository.length > 4096 ||
      /[\u0000-\u001f\u007f]/.test(value.repository) ||
      value.backendId === 'github' && !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(value.repository)) {
    throw new Error('Invalid trusted local tracker context');
  }
  return Object.freeze({ backendId: value.backendId, repository: value.repository });
}

// A fixed, locally selected adapter. Neither its path, argv nor environment can
// be supplied by an MCP request. Stdout is protocol-only, stderr stays local.
export function createStdioAdapter(file, { env = process.env, timeout = 45000, completionTimeout = 300000 } = {}) {
  if (!Number.isFinite(timeout) || timeout <= 0 || !Number.isFinite(completionTimeout) || completionTimeout < timeout || completionTimeout > 300000) throw new Error('Invalid bounded adapter timeout');
  const child = spawn(process.execPath, [file], { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map(); let sequence = 0, stopped = false;
  const failAll = () => {
    stopped = true;
    for (const item of pending.values()) {
      clearTimeout(item.timer); clearTimeout(item.completionTimer);
      const error = new Error('Local adapter stopped; result may be unknown');
      item.reject(error); item.rejectCompletion(error);
    }
    pending.clear();
  };
  child.once('error', failAll); child.once('exit', failAll);
  child.stderr.on('data', chunk => process.stderr.write(chunk));
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    let message; try { message = JSON.parse(line); } catch { return; }
    const item = pending.get(message.id); if (!item) return;
    pending.delete(message.id); clearTimeout(item.timer); clearTimeout(item.completionTimer);
    item.resolve(message); item.resolveCompletion(message);
  });
  function beginRequest(request, localContext) {
    // This is an in-process capability, not a remote argument. Strip any
    // caller-supplied field before adding the independently resolved context.
    const { _deckLocalDispatch: ignored, ...remoteRequest } = request;
    let dispatch;
    if (localContext !== undefined) {
      if (!localContext || typeof localContext.projectRoot !== 'string' || !path.isAbsolute(localContext.projectRoot) ||
          typeof localContext.threadId !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(localContext.threadId)) {
        throw new Error('Invalid trusted local dispatch context');
      }
      dispatch = { projectRoot: localContext.projectRoot, threadId: localContext.threadId };
      const tracker = normalizeLocalTracker(localContext.tracker);
      if (tracker) dispatch.tracker = tracker;
    }
    let resolveCompletion, rejectCompletion;
    const completion = new Promise((resolve, reject) => { resolveCompletion = resolve; rejectCompletion = reject; });
    const response = new Promise((resolve, reject) => {
        if (stopped || pending.size >= 32) {
          const error = new Error(stopped ? 'Local adapter is unavailable' : 'Local adapter is busy');
          reject(error); rejectCompletion(error); return;
        }
        const id = ++sequence;
        // The foreground may time out without ending local execution. Keep its
        // completion channel until the bounded Git execution horizon so a late
        // known result can be durably recorded instead of silently discarded.
        const timer = setTimeout(() => reject(Object.assign(new Error('Local adapter result unknown; completion remains pending'), { code: 'ADAPTER_RESPONSE_TIMEOUT' })), timeout);
        const completionTimer = setTimeout(() => {
          pending.delete(id); clearTimeout(timer);
          const error = Object.assign(new Error('Local adapter completion remains unknown'), { code: 'ADAPTER_COMPLETION_UNKNOWN' });
          reject(error); rejectCompletion(error);
        }, completionTimeout);
        pending.set(id, { resolve, reject, resolveCompletion, rejectCompletion, timer, completionTimer });
        child.stdin.write(JSON.stringify({ ...remoteRequest, id, ...(dispatch ? { _deckLocalDispatch: dispatch } : {}) }) + '\n', error => {
          if (error) {
            pending.delete(id); clearTimeout(timer); clearTimeout(completionTimer);
            const failure = new Error('Local adapter input failed'); reject(failure); rejectCompletion(failure);
          }
        });
    });
    // request() callers only consume response. The independent late channel
    // must not create unhandled rejections when such a legacy caller stops.
    void response.catch(() => {}); void completion.catch(() => {});
    return { response, completion };
  }
  return {
    beginRequest,
    request(request, localContext) { return beginRequest(request, localContext).response; },
    async close() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      failAll(); lines.close(); child.stdin.end();
      await new Promise(resolve => {
        const timer = setTimeout(() => { child.kill(); }, 1000);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
      });
    },
  };
}
