import { createHash } from 'node:crypto';
import { lstat, open, realpath, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonical, threadId as requestThreadId } from './protocol.mjs';
import { readLocalWriteState } from './write-intents.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const folded = value => process.platform === 'win32' ? value.toLowerCase() : value;
const samePath = (left, right) => folded(path.resolve(left)) === folded(path.resolve(right));
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const unknown = reason => ({ knownSuccess: false, reason });
const MAX_CHAIN_BYTES = 4 * 1024 * 1024;
const fingerprint = value => hash(canonical(value));
const business = response => response?.error || response?.result?.isError || response?.result?.structuredContent?.ok === false
  ? null : response?.result?.structuredContent?.value ?? response?.result?.structuredContent ?? null;

// This factory is local authority. adapterPath must be the exact frozen path
// already verified by launch, never a tool argument or a per-request choice.
// It reads existing files only: no worker, command, credentials or network.
export async function createLocalWriteEffects({ adapterPath } = {}) {
  if (typeof adapterPath !== 'string' || !path.isAbsolute(adapterPath)) throw new Error('A trusted absolute frozen adapter path is required');
  const adapterFile = await realpath(adapterPath);
  const adapterRoot = await realpath(path.resolve(path.dirname(adapterFile), '../..'));
  if (!samePath(adapterFile, path.join(adapterRoot, 'prototypes/upstream-port/sidebar-server.mjs'))) {
    throw new Error('Local effects require the verified frozen sidebar entrypoint');
  }
  const vendor = path.join(adapterRoot, 'vendor/mattskills-1.8.0-rc.7');
  const [chain, workspace, tickets] = await Promise.all([
    import(pathToFileURL(path.join(vendor, 'shared/refresh/chain.js')).href),
    import(pathToFileURL(path.join(vendor, 'lib/workspaceKey.js')).href),
    import(pathToFileURL(path.join(vendor, 'lib/refresh/sessionTickets.js')).href),
  ]);
  const sidebarKey = hash(adapterRoot.toLowerCase()).slice(0, 16);
  const projectBase = path.join(adapterRoot, '.scratch/upstream-sidebar', sidebarKey, 'projects');
  const canonicalKey = root => workspace.canonicalWorkspaceKey(root, {
    getPlatform: () => ({ os: process.platform, path }),
    // Same metadata probe and platform path rules used by node-host/repoKeys.
    getFs: () => ({ lstat }),
    getDefaultCwd: () => root,
  });
  const baselines = new WeakMap();

  async function projectLocation(projectRoot) {
    if (typeof projectRoot !== 'string' || !path.isAbsolute(projectRoot)) throw new Error('Use a resolved local project root');
    let cwd = await realpath(projectRoot);
    // session-project removes Windows namespace prefixes before project-hosts
    // hashes its cwd. Do not lowercase this directory hash: only repoKeys does
    // case folding for the separate chain root identity.
    if (process.platform === 'win32') {
      if (cwd.startsWith('\\\\?\\')) cwd = cwd.slice(4);
      if (cwd.startsWith('\\??\\')) cwd = cwd.slice(4);
      cwd = path.win32.normalize(cwd.replace(/\//g, '\\'));
      if (cwd.length > 3 && cwd.endsWith('\\')) cwd = cwd.slice(0, -1);
    }
    return { cwd, dataRoot: path.join(projectBase, hash(cwd)) };
  }
  async function dataRootFor(projectRoot) { return (await projectLocation(projectRoot)).dataRoot; }
  async function locateReportChain(projectRoot) {
    const location = await projectLocation(projectRoot);
    const rootKey = await canonicalKey(location.cwd);
    if (!rootKey) throw new Error('The frozen adapter could not canonicalize the local project');
    return { ...location, rootKey, rootHash: chain.chainRootHash(rootKey),
      file: path.join(location.dataRoot, '.dsh-mattskillsdeck-cache', tickets.SESSION_TICKETS_FILE) };
  }
  async function readChain(location) {
    let handle;
    try {
      // A redirected cache must not become a readback for a different project.
      const actual = await realpath(location.file);
      if (!samePath(actual, location.file)) return { ok: false, reason: 'chain-path-redirected' };
      handle = await open(actual, 'r');
      const before = await handle.stat();
      if (!before.isFile() || before.size > MAX_CHAIN_BYTES) return { ok: false, reason: 'chain-file-size' };
      const buffer = Buffer.alloc(MAX_CHAIN_BYTES + 1);
      let size = 0;
      while (size < buffer.length) {
        const read = await handle.read(buffer, size, buffer.length - size, null);
        if (read.bytesRead === 0) break;
        size += read.bytesRead;
      }
      const after = await handle.stat();
      if (size > MAX_CHAIN_BYTES || size !== before.size || after.size !== before.size ||
          after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) return { ok: false, reason: 'chain-file-changing' };
      const bytes = buffer.subarray(0, size);
      const payload = JSON.parse(bytes.toString('utf8'));
      if (chain.chainPrivacyViolations(payload).length) return { ok: false, reason: 'chain-file-private-shape' };
      const decoded = chain.chainFromDisk(payload);
      if (decoded.reason !== 'chain.disk-ok' && decoded.reason !== 'chain.disk-empty') return { ok: false, reason: 'chain-file-shape' };
      return { ok: true, state: decoded.state, sha256: hash(bytes) };
    } catch (error) {
      return { ok: false, missing: error.code === 'ENOENT', reason: error.code === 'ENOENT' ? 'chain-file-missing' : 'chain-file-unreadable' };
    } finally { await handle?.close(); }
  }

  // Optional local-only baseline permits a new record in the reservation's
  // exact millisecond. Tokens cannot be constructed by an MCP caller. Without
  // a baseline, equality is uncertain because this file has no operation IDs.
  async function captureReportBefore({ projectRoot, threadId }) {
    const location = await locateReportChain(projectRoot);
    const disk = await readChain(location);
    const token = Object.freeze({});
    baselines.set(token, { cwd: location.cwd, threadId, disk });
    return token;
  }

  async function verifyReport({ projectRoot, threadId, request, startedAt, response,
    expectedBackendId, expectedRepo, expectedEffortId, before } = {}) {
    try {
      if (request?.method !== 'tools/call' || request.params?.name !== 'deck_issue_report' ||
          typeof threadId !== 'string' || !threadId.trim() ||
          requestThreadId(request) !== threadId ||
          !Number.isSafeInteger(startedAt) || startedAt <= 0 || startedAt > Date.now()) return unknown('report-input-unbound');
      if (response?.id !== request.id || response.error || response.result?.isError) return unknown('report-response-unsuccessful');
      const value = response.result?.structuredContent;
      const backend = chain.chainBackendId(expectedBackendId);
      const args = request.params.arguments;
      const key = chain.chainTicketKey(args?.key);
      if (!backend || !key || !plain(expectedRepo) || expectedRepo.backend !== backend ||
          typeof expectedRepo.refId !== 'string' || !expectedRepo.refId) return unknown('report-context-unbound');
      if (value?.ok !== true || value.status !== 'ok' || value.tool !== 'deck_issue_report' ||
          value.data?.chain?.recorded !== true || value.data.key !== key || value.backend?.id !== backend ||
          value.data.backendId !== backend || value.repo?.backend !== backend) return unknown('report-response-unbound');
      for (const field of ['backend', 'refId', 'name', 'url']) {
        if (expectedRepo[field] !== undefined && value.repo?.[field] !== expectedRepo[field]) return unknown('report-repository-changed');
      }
      const effort = value.data.effortId;
      if (typeof effort !== 'string' || effort.length > 256 || chain.chainEffortId(effort) !== effort) return unknown('report-effort-invalid');
      const requestedEffort = args?.effortId == null ? '' : chain.chainEffortId(args.effortId);
      if ((args?.effortId != null && String(args.effortId).trim() && !requestedEffort) ||
          (requestedEffort && requestedEffort !== effort) ||
          (expectedEffortId !== undefined && chain.chainEffortId(expectedEffortId) !== effort)) return unknown('report-effort-changed');
      const location = await locateReportChain(projectRoot);
      // The tool uses canonicalWorkspaceKey, which may anchor a selected
      // subdirectory to its repository root. Compare to that exact frozen rule.
      if (value.workspace?.root !== location.rootKey) return unknown('report-workspace-changed');
      const disk = await readChain(location);
      if (!disk.ok) return unknown(disk.reason);
      const shardId = chain.chainSessionShardId(threadId);
      const shard = disk.state.shards[shardId];
      if (!shard || shard.rootHash !== location.rootHash || shard.backend !== backend) return unknown('report-chain-scope-mismatch');
      const observedAt = Date.now();
      const entry = shard.entries.find(item => item.ticketKey === key && item.effortId === effort && item.action === 'report' &&
        item.at >= startedAt && item.at <= observedAt);
      if (!entry) return unknown('report-chain-entry-missing');
      if (entry.at === startedAt) {
        const baseline = baselines.get(before);
        if (!baseline || !samePath(baseline.cwd, location.cwd) || baseline.threadId !== threadId ||
            (!baseline.disk.ok && !baseline.disk.missing)) return unknown('report-chain-time-ambiguous');
        const previous = baseline.disk.state?.shards[shardId];
        if (previous?.rootHash === location.rootHash && previous.backend === backend && previous.entries.some(item =>
          item.ticketKey === key && item.effortId === effort && item.action === 'report' && item.at === entry.at)) return unknown('report-chain-entry-unchanged');
      }
      const proof = { rootHash: location.rootHash, shardId, backend, effortId: effort, ticketKey: key,
        action: 'report', at: entry.at, fileSha256: disk.sha256 };
      return { knownSuccess: true, reason: 'report-durable-local-readback',
        evidence: { kind: 'local-state-readback', verdict: 'completed', observedAt,
          verificationSha256: hash(JSON.stringify(proof)), target: { localStateKey: 'session-tickets' } },
        result: { target: { localStateKey: 'session-tickets' }, resultSha256: disk.sha256 } };
    } catch { return unknown('report-local-readback-unavailable'); }
  }

  async function readObject(root, relative, expected) {
    if (expected?.exists === false) return null;
    const file = path.join(root, relative), actual = await realpath(file);
    if (!samePath(file, actual)) throw new Error('Local state path was redirected');
    const handle = await open(actual, 'r');
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > MAX_CHAIN_BYTES) throw new Error('Local state exceeds its readback limit');
      const buffer = Buffer.alloc(MAX_CHAIN_BYTES + 1);
      let length = 0;
      while (length < buffer.length) {
        const read = await handle.read(buffer, length, buffer.length - length, null);
        if (!read.bytesRead) break;
        length += read.bytesRead;
      }
      const content = buffer.subarray(0, length), after = await handle.stat();
      if (length > MAX_CHAIN_BYTES || length !== info.size || after.size !== info.size ||
          after.mtimeMs !== info.mtimeMs || after.ctimeMs !== info.ctimeMs ||
          expected?.sha256 && hash(content) !== expected.sha256) throw new Error('Local state changed while reading');
      const value = JSON.parse(content.toString('utf8').replace(/^\uFEFF/, ''));
      if (!plain(value)) throw new Error('Local state must be an object');
      return value;
    } finally { await handle.close(); }
  }
  const fileOf = (facts, relative) => facts.files.find(file => file.path.split(path.sep).join('/') === relative);
  const retained = (before, after) => before?.exists === after?.exists && (!before?.exists || before.sha256 === after.sha256);

  // Returns the same prepare/verify seam as the Git verifier. All preconditions
  // come from trusted local roots and fixed file recipes. verify returns a
  // typed ledger result or null (unknown), never retries or modifies a file.
  async function prepareLocal({ method, projectRoot, threadId, parameters = {}, readBinding } = {}) {
    if (!['bind', 'logSetSwitch', 'logClear', 'cancelNewSessionWatcher', 'handoffResolve'].includes(method)) {
      throw new Error('Local effect verifier is not implemented for this method');
    }
    if (typeof threadId !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(threadId) || !plain(parameters)) {
      throw new Error('Use the locally verified project and thread');
    }
    const args = structuredClone(parameters), location = await projectLocation(projectRoot);
    if (args.expectedThreadId !== undefined && args.expectedThreadId !== threadId || args.sessionId !== undefined && args.sessionId !== threadId) {
      throw new Error('Local operation belongs to another thread');
    }
    const rootKey = await canonicalKey(location.cwd);
    const scope = { method, projectRoot: location.cwd, threadId, parameters: args };
    async function currentFacts() {
      if (method !== 'handoffResolve' && !samePath(await realpath(location.dataRoot), location.dataRoot)) {
        throw new Error('Local worker data root was redirected');
      }
      return readLocalWriteState(scope, { dataRootFor });
    }
    const facts = await currentFacts();
    const beforeStateSha256 = fingerprint(facts), preparedAt = Date.now();
    const localStateKey = { bind: 'binding', logSetSwitch: 'log-switch', logClear: 'logs',
      cancelNewSessionWatcher: 'manual-naming' }[method];
    const target = { ...(localStateKey ? { localStateKey } : { paths: ['.scratch/handoff'] }), beforeStateSha256,
      contentSha256: fingerprint(args) };
    let check, terminalProof, terminalErrorKind = 'partial';
    if (method === 'logSetSwitch') {
      if (typeof args.enabled !== 'boolean' || args.sampleRate !== undefined && !Number.isFinite(args.sampleRate)) throw new Error('Invalid log switch target');
      const relative = '.dsh-mattskillsdeck-cache/log-switch.json';
      const previous = await readObject(location.dataRoot, relative, fileOf(facts, relative));
      if (previous && (typeof previous.enabled !== 'boolean' || !Number.isFinite(previous.sampleRate))) throw new Error('The existing log switch is unreadable');
      const rate = args.sampleRate ?? previous?.sampleRate ?? 1;
      check = async (value, after) => {
        if (value.enabled !== args.enabled) return false;
        const saved = await readObject(location.dataRoot, relative, fileOf(after, relative));
        return saved?.enabled === args.enabled && saved.sampleRate === rate;
      };
    } else if (method === 'logClear') {
      if (args.date !== 'all' && !/^\d{4}-\d{2}-\d{2}$/.test(args.date ?? '')) throw new Error('Use an exact local log date or all');
      const count = facts.files.filter(file => file.exists).length;
      check = async (value, after) => Number.isSafeInteger(value.removed) && value.removed === count &&
        after.files.every(file => !file.exists || file.bytes === 0);
    } else if (method === 'cancelNewSessionWatcher') {
      if (!/^[a-f0-9]{24}$/.test(args.suggestionId ?? '')) throw new Error('Use an existing local manual suggestion');
      const previous = await readObject(location.dataRoot, 'manual-naming.json', fileOf(facts, 'manual-naming.json')) ?? {};
      const wanted = { ...previous, [threadId]: { ...(previous[threadId] ?? {}), cancelled: args.suggestionId } };
      check = async (value, after) => {
        // The pinned original cancel() returns false before update() when its
        // current plan has no matching suggestion. This specific terminal
        // no-op is not an ambiguous exception or failed persistence attempt.
        if (value.cancelled === false && fingerprint(after) === beforeStateSha256) {
          terminalProof = { cancelled: false, reason: 'no-current-matching-suggestion' };
          terminalErrorKind = 'rejected'; return true;
        }
        return value.cancelled === true && canonical(await readObject(location.dataRoot,
          'manual-naming.json', fileOf(after, 'manual-naming.json'))) === canonical(wanted);
      };
    } else if (method === 'handoffResolve') {
      if (args.name !== undefined && (typeof args.name !== 'string' || !args.name || /[\\/\u0000-\u001f]/.test(args.name))) throw new Error('Invalid handoff file selection');
      if (!samePath(rootKey, location.cwd)) throw new Error('Handoff readback for an enclosing project is not implemented');
      const { createHandoffClaim } = await import(pathToFileURL(path.join(vendor, 'lib/handoffClaim.js')).href);
      const fs = {
        resolve: async (name, options = {}) => path.resolve(options.cwd ?? rootKey, name),
        listDir: async folder => (await readdir(folder, { withFileTypes: true })).map(entry => ({ name: entry.name })),
        stat: file => stat(file),
      };
      // This original handler is a disk selector only. No claim/open method is
      // called and no result is presented as proof that a native window opened.
      const selector = createHandoffClaim({ fs, DEFAULT_CWD: rootKey, normCwd: canonicalKey });
      const expected = await selector.handleHandoffResolve({ ...args, cwd: rootKey });
      check = async (value, after) => {
        if (fingerprint(after) !== beforeStateSha256) return false;
        const now = await selector.handleHandoffResolve({ ...args, cwd: rootKey });
        return expected.ok === true && now.ok === true && value.file === expected.file && now.file === expected.file;
      };
    } else if (method === 'bind' && (args.backendId !== undefined ? args.backendId : args.backend ?? null) === null) {
      // Baseline explicit-none is a real in-memory bind, while its choice store
      // rejects null persistence. Keep it executable and preserve that response.
      // A same-worker, locally bound read can prove its known partial terminal
      // state; unchanged files alone cannot prove that the bind happened.
      check = async (value, after) => {
        if (value.cwd !== rootKey || value.backendId !== null || value.persisted !== false || value.rev !== 0 ||
            value.workspaceFile?.ok !== true || value.workspaceFile.skipped !== 'explicit-none' ||
            value.labelColorsFile?.ok !== true || value.labelColorsFile.skipped !== 'not-markdown' ||
            fingerprint(after) !== beforeStateSha256 || typeof readBinding !== 'function') return false;
        const response = await readBinding(scope);
        const live = response?.result ? business(response) : response;
        if (live?.ok !== true || live.selection?.backendId !== null || live.selection.source !== 'explicit' || live.selection.pending === true ||
            live.projectRoot !== undefined && !samePath(await realpath(live.projectRoot), location.cwd) ||
            live.threadId !== undefined && live.threadId !== threadId) return false;
        if (fingerprint(await currentFacts()) !== beforeStateSha256) return false;
        terminalProof = { selection: { backendId: null, source: 'explicit' }, persisted: false };
        return true;
      };
    } else {
      const backend = args.backendId !== undefined ? args.backendId : args.backend ?? null;
      if (!['github', 'gitlab', 'markdown'].includes(backend)) throw new Error('Durable binding readback is not implemented for this backend');
      if (!samePath(rootKey, location.cwd)) throw new Error('Binding readback for an enclosing project is not implemented');
      const [choices, workspaceFile] = await Promise.all([
        import(pathToFileURL(path.join(vendor, 'lib/choiceStore.js')).href),
        import(pathToFileURL(path.join(vendor, 'shared/deck-tools/workspace-file.js')).href),
      ]);
      const choicesBefore = await readObject(location.dataRoot, '.dsh/mattskillsdeck/choices.json', facts.choices);
      const cleaned = choicesBefore ? choices.cleanChoices(choicesBefore) : { ok: true, data: choices.emptyChoices() };
      if (!cleaned.ok) throw new Error('The existing binding memory is unreadable');
      const choiceKey = choices.hashWorkspaceKey(rootKey), rev = (cleaned.data.workspaces[choiceKey]?.rev ?? 0) + 1;
      const workspaceRelative = 'docs/agents/workspace.json', colorsRelative = 'docs/agents/label-colors.json';
      const workspaceBefore = fileOf(facts, workspaceRelative), colorsBefore = fileOf(facts, colorsRelative);
      // Reuse the frozen parser for the existing-file branch. Invalid JSON is
      // an upstream replace branch, so parse the original text independently.
      let oldWorkspace = null;
      if (workspaceBefore.exists) {
        try { oldWorkspace = await readObject(location.cwd, workspaceRelative, workspaceBefore); }
        catch (error) { if (!(error instanceof SyntaxError)) throw error; /* Original parser treats invalid JSON as absent. */ }
      }
      const preserveWorkspace = oldWorkspace && workspaceFile.parseWorkspaceFile(JSON.stringify(oldWorkspace));
      let defaultColorsSha256;
      if (backend === 'markdown' && !colorsBefore.exists) {
        // The worker registers the Markdown module before binding. Its entry
        // initializes the shared default palette; importing only the leaf
        // writer would otherwise compare the real colors to an empty object.
        await import(pathToFileURL(path.join(vendor, 'lib/tracker/backends/markdown/index.js')).href);
        const colors = await import(pathToFileURL(path.join(vendor, 'lib/tracker/backends/markdown/label-colors.js')).href);
        defaultColorsSha256 = hash(colors.defaultLabelColorsText());
      }
      check = async (value, after) => {
        if (value.cwd !== rootKey || value.backendId !== backend || value.persisted !== true || value.rev !== rev ||
            value.workspaceFile?.ok !== true || value.labelColorsFile?.ok !== true) return false;
        const disk = await readObject(location.dataRoot, '.dsh/mattskillsdeck/choices.json', after.choices);
        const normalized = choices.cleanChoices(disk), entry = normalized.data.workspaces[choiceKey];
        if (!normalized.ok || entry?.backendId !== backend || entry.rev !== rev || entry.pickedAt < preparedAt || entry.pickedAt > Date.now()) return false;
        const workspaceAfter = fileOf(after, workspaceRelative), colorsAfter = fileOf(after, colorsRelative);
        if (preserveWorkspace) {
          if (value.workspaceFile.placed !== false || value.workspaceFile.reason !== 'exists' || !retained(workspaceBefore, workspaceAfter)) return false;
        } else {
          if (value.workspaceFile.placed !== true || value.workspaceFile.reason !== 'created') return false;
          const parsed = workspaceFile.parseWorkspaceFile(JSON.stringify(await readObject(location.cwd, workspaceRelative, workspaceAfter)));
          if (parsed?.backendId !== backend || parsed.source !== 'user' || parsed.pickedAt < preparedAt || parsed.pickedAt > Date.now()) return false;
        }
        if (backend !== 'markdown') return value.labelColorsFile.skipped === 'not-markdown' && retained(colorsBefore, colorsAfter);
        if (colorsBefore.exists) return value.labelColorsFile.placed === false && value.labelColorsFile.reason === 'exists' && retained(colorsBefore, colorsAfter);
        return value.labelColorsFile.placed === true && value.labelColorsFile.reason === 'created' && colorsAfter.exists && colorsAfter.sha256 === defaultColorsSha256;
      };
    }
    return { target, async verify(response) {
      try {
        const value = business(response);
        if (value?.ok !== true) return null;
        const after = await currentFacts();
        if (!await check(value, after)) return null;
        if (terminalProof) return { outcome: 'failed', result: { target,
          resultSha256: fingerprint({ after, terminalProof }), errorKind: terminalErrorKind } };
        return { target, resultSha256: fingerprint(after) };
      } catch { return null; }
    } };
  }
  // Paths and baseline tokens stay inside the local companion. Expose only the
  // small verification result through the durable ledger, never these helpers.
  return Object.freeze({ dataRootFor, locateProjectData: projectLocation, locateReportChain, captureReportBefore, verifyReport, prepareLocal });
}
