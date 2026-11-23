import path from 'node:path';
import { lstat, mkdir, open, readFile, realpath, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolveAdapterDataLayout } from './local-data-layout.mjs';
import { canonical, digest, threadId as identityOf } from './protocol.mjs';

const RELATIVE = 'docs/agents/label-colors.json', MAX_BYTES = 4 * 1024 * 1024;
const fold = value => process.platform === 'win32' ? value.toLowerCase() : value;
const key = value => fold(path.resolve(value));
const equal = (left, right) => canonical(left) === canonical(right);
const need = (condition, message) => { if (!condition) throw new Error(message); };
const business = response => response?.error || response?.result?.isError || response?.result?.structuredContent?.ok === false
  ? null : response?.result?.structuredContent?.value ?? response?.result?.structuredContent;

async function noRedirect(file) {
  let parent = path.resolve(file);
  for (;;) {
    try { need(key(await realpath(parent)) === key(parent) && !(await lstat(parent)).isSymbolicLink(), 'Local palette path was redirected'); return; }
    catch (error) { if (error.code !== 'ENOENT') throw error; const next = path.dirname(parent); need(next !== parent, 'Local palette parent is unavailable'); parent = next; }
  }
}
async function snapshot(file) {
  await noRedirect(file);
  let handle;
  try {
    handle = await open(file, 'r'); const before = await handle.stat();
    need(before.isFile() && before.size <= MAX_BYTES, 'Local palette must be a bounded regular file');
    const bytes = Buffer.alloc(MAX_BYTES + 1); let length = 0;
    while (length < bytes.length) { const result = await handle.read(bytes, length, bytes.length - length, null); if (!result.bytesRead) break; length += result.bytesRead; }
    const after = await handle.stat();
    need(length <= MAX_BYTES && length === before.size && after.size === before.size && after.mtimeMs === before.mtimeMs && after.ctimeMs === before.ctimeMs, 'Local palette changed while reading');
    const content = Buffer.from(bytes.subarray(0, length)); return { exists: true, bytes: content, sha256: digest(content) };
  } catch (error) { if (error.code === 'ENOENT') return { exists: false, bytes: null, sha256: null }; throw error; }
  finally { await handle?.close(); }
}
const stateHash = state => digest(canonical({ exists: state.exists, sha256: state.sha256 }));

// The original frozen Markdown parser and writer run only against an in-memory
// file snapshot here. This computes the exact original formatter/partial result;
// it cannot publish a business write or initialize a real palette file.
function memoryContext(projectRoot, file, before) {
  const files = new Map(before.exists ? [[key(file), before.bytes.toString('utf8')]] : []);
  const temporary = file + '.' + process.pid + '.tmp';
  const allowed = value => { need([key(file), key(temporary)].includes(key(value)), 'Original palette recipe escaped its fixed target'); return key(value); };
  const fs = {
    async readFile(value) { const item = files.get(allowed(value)); if (item === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); return item; },
    async writeFile(value, text) { files.set(allowed(value), String(text)); },
    async rename(from, to) { need(key(from) === key(temporary) && key(to) === key(file) && files.has(key(from)), 'Unexpected palette rename'); files.set(key(to), files.get(key(from))); files.delete(key(from)); },
    async mkdir(value) { need(key(value) === key(path.dirname(file)), 'Unexpected palette directory'); },
    async rm(value) { need(key(value) === key(temporary), 'Unexpected palette cleanup'); files.delete(key(value)); },
  };
  return { context: { cwd: projectRoot, platform: { os: process.platform, path, fs }, fs },
    after() { const value = files.get(key(file)); return value === undefined ? { exists: false, bytes: null, sha256: null } : { exists: true, bytes: Buffer.from(value), sha256: digest(Buffer.from(value)) }; } };
}

export async function createMarkdownWriteEffects({ adapterPath, localDataRoot } = {}) {
  const layout = await resolveAdapterDataLayout({ adapterPath, localDataRoot });
  const adapterFile = await realpath(adapterPath);
  need(key(adapterFile) === key(path.join(layout.adapterRoot, 'prototypes/upstream-port/sidebar-server.mjs')), 'Use the verified frozen sidebar entrypoint');
  const vendor = path.join(layout.adapterRoot, 'vendor/mattskills-1.8.0-rc.7');
  // index.js owns initialization of the one palette used by the real handler.
  await import(pathToFileURL(path.join(vendor, 'lib/tracker/backends/markdown/index.js')).href);
  const [palette, operations] = await Promise.all([
    import(pathToFileURL(path.join(vendor, 'lib/tracker/backends/markdown/label-colors.js')).href),
    import(pathToFileURL(path.join(vendor, 'lib/tracker/backends/markdown/label-colors-ops.js')).href),
  ]);

  async function prepare({ method, request, projectRoot, threadId, adapter }) {
    need(method === 'setLabelColors' && request?.method === 'tools/call' && request.params?.name === 'deck_upstream_write' && request.params.arguments?.method === method && identityOf(request) === threadId, 'Unsupported or unbound Markdown palette request');
    const project = await realpath(projectRoot), args = structuredClone(request.params.arguments.payload);
    need(args && typeof args === 'object' && !Array.isArray(args) && Object.keys(args).every(name => ['changes', 'backendId', 'cwd', 'expectedThreadId', 'sessionId'].includes(name)) &&
      args.expectedThreadId === threadId && (args.sessionId === undefined || args.sessionId === threadId) && (args.backendId === undefined || args.backendId === 'markdown'), 'Markdown palette parameters do not match the trusted local context');
    if (args.cwd !== undefined) need(typeof args.cwd === 'string' && path.isAbsolute(args.cwd) && key(await realpath(args.cwd)) === key(project), 'Palette cwd cannot select another project');
    need(Array.isArray(args.changes) && args.changes.length <= 512 && Buffer.byteLength(canonical(args.changes)) <= 1024 * 1024, 'Use a bounded original palette change list');
    const localContext = { projectRoot: project, threadId }; let selected, sequence = 0;
    async function context() {
      const value = business(await adapter.request({ jsonrpc: '2.0', id: 'markdown-context-' + ++sequence, method: 'tools/call', params: { name: 'deck_context', arguments: {}, _meta: request.params._meta } }, localContext));
      need(value?.ok === true && value.status === 'ok' && value.tool === 'deck_context' && value.backend?.id === 'markdown' && value.repo?.backend === 'markdown' &&
        typeof value.repo.refId === 'string' && value.repo.refId.length > 0 && value.repo.refId.length <= 4096 && typeof value.workspace?.root === 'string' &&
        key(await realpath(value.workspace.root)) === key(project) && value.data?.workspace?.sessionId === threadId, 'No trusted local Markdown tracker context');
      if (selected) need(value.repo.refId === selected.repo.refId, 'Markdown tracker changed during palette operation'); return value;
    }
    selected = await context();
    const file = path.join(project, RELATIVE), before = await snapshot(file), memory = memoryContext(project, file, before);
    const repo = { backend: 'markdown', refId: selected.repo.refId };
    const parsed = await palette.readLabelColors(memory.context, repo); need(parsed.ok === true, 'Existing Markdown palette cannot be read; it will not be overwritten');
    const expected = await operations.setLabelColors(memory.context, repo, args.changes);
    need(expected?.ok === true && Array.isArray(expected.data?.applied) && Array.isArray(expected.data?.failed), 'Original Markdown palette handler rejected this change list');
    const desired = memory.after();
    let backup = null;
    if (before.exists) {
      let cwd = project;
      if (process.platform === 'win32') { if (cwd.startsWith('\\\\?\\')) cwd = cwd.slice(4); if (cwd.startsWith('\\??\\')) cwd = cwd.slice(4); cwd = path.win32.normalize(cwd.replace(/\//g, '\\')); if (cwd.length > 3 && cwd.endsWith('\\')) cwd = cwd.slice(0, -1); }
      const worker = path.join(layout.projectBase, digest(cwd)), folder = path.join(worker, 'write-backups', 'label-colors');
      await noRedirect(folder); await mkdir(folder, { recursive: true, mode: 0o700 }); await noRedirect(folder);
      const copy = path.join(folder, Date.now() + '-' + randomUUID() + '.json');
      await writeFile(copy, before.bytes, { flag: 'wx', mode: 0o600 });
      need(digest(await readFile(copy)) === before.sha256 && stateHash(await snapshot(file)) === stateHash(before), 'Palette backup or source readback changed');
      backup = { file: copy, sha256: before.sha256 };
    }
    await context();
    const target = { paths: [RELATIVE], beforeStateSha256: stateHash(before), contentSha256: digest(canonical(args.changes)) };
    const partition = data => ({ applied: data.applied?.map(item => ({ name: item.name, color: item.color })), failed: data.failed?.map(item => ({ name: item.name, kind: item.reason?.kind })) });
    return { target, backup, dispatchContext: { tracker: { backendId: 'markdown', repository: selected.repo.refId } }, async verify(response) {
      try {
        need(response?.id === request.id, 'Markdown palette response identity changed'); await context();
        const value = business(response); need(value?.ok === true && value.backendId === 'markdown' && Array.isArray(value.applied) && Array.isArray(value.failed) && equal(partition(value), partition(expected.data)), 'Original palette result omitted or changed a terminal item outcome');
        const after = await snapshot(file);
        need(stateHash(after) === stateHash(desired) && (!after.exists || after.bytes.equals(desired.bytes)), 'Independent palette bytes do not match the original exact formatter result');
        const checked = await palette.readLabelColors(memoryContext(project, file, after).context, repo); need(checked.ok === true, 'Published palette does not parse with the frozen original parser');
        await context(); const result = { target: { ...target, expectedStateSha256: stateHash(after) }, resultSha256: after.sha256 ?? stateHash(after) };
        return expected.data.failed.length ? { outcome: 'failed', result: { ...result, errorKind: 'partial' } } : result;
      } catch { return null; }
    } };
  }
  return { prepare };
}
