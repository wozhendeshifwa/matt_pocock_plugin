import * as fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { resolveAdapterDataLayout } from './local-data-layout.mjs';

// This factory is serialized into the frozen host, so every dependency and
// helper belongs to its arguments/body. No remote executable or fs seam exists.
export function createHostOpenRuntime({ fs, path, createHash, workspaceRoot, dataRoot }) {
  const HASH = /^[a-f0-9]{64}$/;
  const requests = new WeakMap(), spent = new Set();
  const digest = value => createHash('sha256').update(value).digest('hex');
  const key = value => {
    let resolved = path.resolve(value);
    if (process.platform === 'win32') resolved = resolved.replace(/^\\\\\?\\/, '').toLowerCase();
    return resolved;
  };
  const same = (left, right) => key(left) === key(right);
  const inside = (root, file) => { const relative = path.relative(key(root), key(file)); return relative === '' || relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative); };
  function checked(file) {
    if (typeof file !== 'string' || !path.isAbsolute(file) || /^\\\\(?!\?\\)/.test(file) || /[\u0000-\u001f\u007f&|^%!<>"]/.test(file)) throw new Error('Open target is not an accepted absolute local path');
    const requested = path.resolve(file), actual = fs.realpathSync(requested), info = fs.lstatSync(requested);
    if (!same(requested, actual) || info.isSymbolicLink() || !(info.isFile() || info.isDirectory())) throw new Error('Open target changed or redirects through a link');
    return { file: actual, info };
  }
  const identity = value => digest(JSON.stringify([key(value.file), value.info.isDirectory() ? 'directory' : 'file',
    String(value.info.dev), String(value.info.ino), value.info.birthtimeMs]));
  function roots() {
    const project = checked(workspaceRoot), data = checked(dataRoot);
    if (!project.info.isDirectory() || !data.info.isDirectory()) throw new Error('Open roots are not directories');
    return [project.file, data.file];
  }
  function inspect({ method, parameters = {} }) {
    if (!['openFolder', 'openPath'].includes(method)) throw new Error('Unsupported local open method');
    let raw = method === 'openFolder' ? parameters.cwd || parameters.path || workspaceRoot : parameters.path;
    if (typeof raw !== 'string' || raw.length > 4096) throw new Error('Use the original local open target');
    if (method === 'openPath') {
      raw = raw.trim();
      // Deliberately match pickerShell's existing file-URL conversion.
      if (/^file:\/\//i.test(raw)) {
        try { raw = decodeURI(raw.replace(/^file:\/\/\//i, '').replace(/^file:\/\//i, '')); } catch {}
        if (/^\/[A-Za-z]:\//.test(raw)) raw = raw.slice(1);
      }
    }
    const owned = roots(), target = checked(raw);
    if (!owned.some(root => inside(root, target.file))) throw new Error('Open target is outside this project and worker data root');
    const base = path.basename(path.normalize(raw));
    const kind = method === 'openFolder' || !base || !base.includes('.') ? 'folder' : 'file';
    // A folder recipe must never become cmd-start execution of a local binary.
    if (kind === 'folder' && !target.info.isDirectory()) throw new Error('The original folder recipe requires a directory');
    const fallback = process.platform === 'win32' && kind === 'file' && !/^[A-Za-z0-9._-]+$/.test(base);
    const command = fallback ? checked(path.dirname(target.file)) : target;
    const commandKind = fallback ? 'folder' : kind;
    return { kind, commandKind, targetSha256: identity(target), commandTargetSha256: identity(command), commandPath: command.file };
  }
  function valid(context) {
    return context && typeof context === 'object' && !Array.isArray(context) &&
      Object.keys(context).sort().join(',') === 'commandTargetSha256,kind,operationId,targetSha256' &&
      HASH.test(context.operationId ?? '') && HASH.test(context.targetSha256 ?? '') && HASH.test(context.commandTargetSha256 ?? '') && ['file', 'folder'].includes(context.kind);
  }
  function matches(context, actual) {
    return valid(context) && context.kind === actual.kind && context.targetSha256 === actual.targetSha256 && context.commandTargetSha256 === actual.commandTargetSha256;
  }
  function remember(context, request) {
    if (!matches(context, inspect(request))) throw new Error('Local open target no longer matches its preparation');
    requests.set(context, { method: request.method, parameters: structuredClone(request.parameters) });
  }
  function receiptPath(operationId, create = false) {
    if (!HASH.test(operationId ?? '')) throw new Error('Invalid local open operation');
    roots();
    const folder = path.join(dataRoot, 'open-receipts');
    if (create && !fs.existsSync(folder)) fs.mkdirSync(folder, { mode: 0o700 });
    const checkedFolder = checked(folder);
    if (!checkedFolder.info.isDirectory() || !inside(dataRoot, checkedFolder.file)) throw new Error('Open receipt directory redirected');
    return path.join(checkedFolder.file, operationId + '.json');
  }
  function claim(active, opened) {
    if (!valid(active?.localOpen) || !['openFolder', 'openPath'].includes(active?.method)) throw new Error('Missing verified local open context');
    const context = active.localOpen, request = requests.get(context);
    if (!request || request.method !== active.method || spent.has(context.operationId)) throw new Error('Local open operation was already dispatched or is unbound');
    const actual = inspect(request);
    if (!matches(context, actual) || !opened || actual.commandKind !== opened.kind || !same(actual.commandPath, opened.target) ||
        identity(checked(opened.target)) !== context.commandTargetSha256) throw new Error('Open command or target changed before dispatch');
    const file = receiptPath(context.operationId, true);
    // wx fences replay even after a host restart. This private file is never a
    // remote tool argument or an approval statement.
    const fd = fs.openSync(file, 'wx', 0o600);
    const record = { operationId: context.operationId, method: active.method, targetSha256: context.targetSha256,
      commandTargetSha256: context.commandTargetSha256, status: 'reserved' };
    const write = () => { const bytes = Buffer.from(JSON.stringify(record) + '\n'); fs.writeSync(fd, bytes, 0, bytes.length, 0); fs.ftruncateSync(fd, bytes.length); fs.fsyncSync(fd); };
    try { write(); } catch (error) { fs.closeSync(fd); throw error; }
    spent.add(context.operationId);
    let finalized = false, spawned = false;
    const finish = status => {
      if (finalized) return; finalized = true; record.status = status;
      try { write(); } catch { /* Missing/incomplete receipt remains unknown. */ } finally { fs.closeSync(fd); }
    };
    return { fail: () => finish('spawn-error'), observe(child) {
      child.once('spawn', () => { spawned = true; });
      child.once('error', () => finish(spawned ? 'exit-error' : 'spawn-error'));
      child.once('close', code => finish(spawned && code === 0 ? 'exit-zero' : 'exit-error'));
    } };
  }
  return { inspect, remember, claim, receiptPath };
}

// Local constructor authority, never an MCP path selection. Preparation reads
// only; a worker creates its private receipt immediately before the real spawn.
export async function createHostOpenEffects({ adapterPath, localDataRoot, receiptWaitMs = 2000 } = {}) {
  const layout = await resolveAdapterDataLayout({ adapterPath, localDataRoot });
  if (!Number.isInteger(receiptWaitMs) || receiptWaitMs < 0 || receiptWaitMs > 10000) throw new Error('Invalid local opener receipt wait');
  async function prepare({ method, parameters, request, projectRoot, operationId }) {
    if (!/^[a-f0-9]{64}$/.test(operationId ?? '')) throw new Error('The local job operation id is required');
    let root = await fs.promises.realpath(projectRoot);
    if (process.platform === 'win32') root = path.win32.normalize(root.replace(/^\\\\\?\\/, '').replace(/\//g, '\\')).replace(/(?<!:)\\$/, '');
    const dataRoot = path.join(layout.projectBase, createHash('sha256').update(root).digest('hex'));
    const runtime = createHostOpenRuntime({ fs, path, createHash, workspaceRoot: root, dataRoot });
    parameters ??= request?.params?.arguments?.payload;
    const actual = runtime.inspect({ method, parameters });
    const context = { operationId, targetSha256: actual.targetSha256, commandTargetSha256: actual.commandTargetSha256, kind: actual.kind };
    const file = path.join(dataRoot, 'open-receipts', operationId + '.json');
    try { await fs.promises.lstat(file); throw new Error('Local opener operation already has a receipt; do not repeat it'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const target = { localStateKey: 'open-path', expectedStateSha256: actual.commandTargetSha256 };
    const deadlineFor = () => Date.now() + receiptWaitMs;
    return { target, dispatchContext: { open: context }, async verify() {
      const deadline = deadlineFor();
      do {
        try {
          const checked = runtime.receiptPath(operationId), info = await fs.promises.lstat(checked);
          if (!info.isFile() || info.isSymbolicLink() || info.size > 2048 || path.resolve(await fs.promises.realpath(checked)).toLowerCase() !== path.resolve(checked).toLowerCase()) return null;
          const bytes = await fs.promises.readFile(checked), receipt = JSON.parse(bytes);
          if (Object.keys(receipt).sort().join(',') !== 'commandTargetSha256,method,operationId,status,targetSha256' ||
              receipt.operationId !== operationId || receipt.method !== method || receipt.targetSha256 !== context.targetSha256 || receipt.commandTargetSha256 !== context.commandTargetSha256) return null;
          if (receipt.status === 'exit-zero') return { target, resultSha256: createHash('sha256').update(bytes).digest('hex') };
          if (receipt.status === 'spawn-error') return { outcome: 'failed', result: { target, resultSha256: createHash('sha256').update(bytes).digest('hex'), errorKind: 'backend' } };
          if (receipt.status !== 'reserved') return null;
        } catch (error) { if (error.code !== 'ENOENT') return null; }
        if (Date.now() >= deadline) break;
        await new Promise(resolve => setTimeout(resolve, Math.min(25, deadline - Date.now())));
      } while (Date.now() <= deadline);
      return null;
    } };
  }
  return { prepare };
}
