import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, realpath, readFile, readdir } from 'node:fs/promises';
import { ENABLED_WRITE_ENDPOINTS, DECK_TOOL_POLICY } from '../upstream-port/write-policy.mjs';
import { canonical, digest } from './protocol.mjs';

// This module reads local facts and describes an intended write. It neither
// grants permission nor decides whether a write succeeded. Callers must first
// resolve the host identity locally and assert the exact project/method grant.
// Dependencies are trusted local functions, never fields from MCP arguments.
export const WRITE_INTENT_METHODS = Object.freeze([...ENABLED_WRITE_ENDPOINTS,
  ...Object.entries(DECK_TOOL_POLICY).filter(([, p]) => p.category !== 'read').map(([name]) => name)]);
const methods = new Set(WRITE_INTENT_METHODS);
const gitMethods = new Set(['gitStage', 'gitUnstage', 'gitCommit', 'gitPull', 'gitFetch', 'gitPush', 'initPublish', 'retryPush']);
const HASH = /^[a-f0-9]{64}$/;
const OID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const REMOTE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const BRANCH = /^(?!-)(?!.*\.\.)(?!.*@\{)[^\s~^:?*\[\\]+$/;
const REPOSITORY = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/;
const run = promisify(execFile);
const MAX_FILE = 16 * 1024 * 1024, MAX_FILES = 2048;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const same = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
const fail = (code, message) => Object.assign(new Error(message), { code });
function required(condition, message, code = 'INVALID_WRITE_INTENT') { if (!condition) throw fail(code, message); }
function text(value, maximum = 60000, empty = false) {
  return typeof value === 'string' && (empty || value.length > 0) && value.length <= maximum && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
}
function clean(value, maximum = 1024) { return text(value, maximum) && !/[\r\n\t]/.test(value); }
function issueNumber(value) {
  const key = typeof value === 'number' ? String(value) : value;
  required(typeof key === 'string' && /^\d{1,10}$/.test(key) && Number(key) > 0, 'Use a numeric issue key');
  return Number(key);
}
function relativeFile(value) {
  return clean(value) && !path.posix.isAbsolute(value) && !path.win32.isAbsolute(value) && !value.includes(':') &&
    !value.startsWith('-') && !value.split(/[\\/]/).some(part => part === '..' || part.toLowerCase() === '.git');
}
function pathsOf(value) {
  required(Array.isArray(value) && value.length > 0 && value.length <= 128 && value.every(relativeFile), 'Use nonempty project-relative literal paths');
  return [...value];
}
function inside(root, target) { const relative = path.relative(same(root), same(target)); return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)); }
async function directory(value) {
  required(clean(value, 4096) && path.isAbsolute(value), 'Use the absolute project root from the local resolver');
  const root = await realpath(value);
  required((await lstat(root)).isDirectory(), 'The trusted local root is not a directory');
  return root;
}
function jsonValue(value, depth = 0) {
  required(depth < 14, 'Intent input is too deeply nested');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') { required(Number.isFinite(value), 'Use finite JSON numbers'); return value; }
  if (typeof value === 'string') { required(text(value, 60000, true), 'Invalid JSON text in intent'); return value; }
  if (Array.isArray(value)) { required(value.length <= 512, 'Intent input array is too large'); return value.map(item => jsonValue(item, depth + 1)); }
  required(plain(value) && Object.keys(value).length <= 64, 'Use plain JSON objects for intent input');
  return Object.fromEntries(Object.keys(value).map(key => [key, jsonValue(value[key], depth + 1)]));
}
function fingerprint(value) {
  const serialized = canonical(jsonValue(value));
  required(Buffer.byteLength(serialized) <= 1024 * 1024, 'Local intent facts exceed the size limit');
  return digest(serialized);
}
function allowedFields(parameters, list, rpc = true) {
  const fields = new Set([...list, ...(rpc ? ['cwd', 'expectedThreadId', 'sessionId'] : [])]);
  required(Object.keys(parameters).every(key => fields.has(key)), 'Unknown write parameter; local facts and authority cannot come from arguments');
}
async function dependency(deps, name, scope) {
  required(typeof deps[name] === 'function', 'A trusted local ' + name + ' reader is required', 'LOCAL_PRECONDITION_REQUIRED');
  const value = await deps[name](scope);
  required(plain(value), 'The local ' + name + ' reader did not return facts', 'LOCAL_PRECONDITION_REQUIRED');
  if (value.projectRoot !== undefined) required(same(await directory(value.projectRoot)) === same(scope.projectRoot), 'Local reader returned a different project', 'LOCAL_FACT_MISMATCH');
  jsonValue(value);
  return value;
}
async function backendOf(deps, scope, allowUnselected = false) {
  const backend = await dependency(deps, 'readBackend', scope);
  required(allowUnselected && backend.backendId === null || clean(backend.backendId, 100), 'The locally selected backend is required', 'LOCAL_PRECONDITION_REQUIRED');
  if (backend.backendId === 'github') required(REPOSITORY.test(backend.repository ?? ''), 'Read the GitHub repository from the local backend selection', 'LOCAL_PRECONDITION_REQUIRED');
  return backend;
}
const repoTarget = backend => backend.backendId === 'github' ? { repository: backend.repository } : {};

// Read through the nearest existing ancestor first. A missing file is a fact;
// an unreadable file or a symlink outside the owned root is not an empty file.
async function ownedPath(root, relative) {
  const target = path.resolve(root, relative);
  required(inside(root, target), 'Local read target leaves its owned root');
  let existing = target;
  while (true) {
    try { required(inside(root, await realpath(existing)), 'Local read target resolves outside its owned root'); break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; const parent = path.dirname(existing); if (parent === existing) throw error; existing = parent; }
  }
  return target;
}
async function fileFact(root, relative) {
  const file = await ownedPath(root, relative);
  let info;
  try { info = await lstat(file); } catch (error) { if (error.code === 'ENOENT') return { path: relative, exists: false }; throw error; }
  required(info.isFile() || info.isSymbolicLink(), 'Expected a local state file');
  required(info.size <= MAX_FILE, 'Local file exceeds the bounded pre-read limit', 'LOCAL_PRECONDITION_REQUIRED');
  const content = await readFile(file);
  required(content.length <= MAX_FILE, 'Local file grew beyond the bounded pre-read limit', 'LOCAL_PRECONDITION_REQUIRED');
  return { path: relative, exists: true, bytes: content.length, sha256: digest(content) };
}
async function treeFacts(root, relatives) {
  const files = [];
  async function visit(relative) {
    required(files.length < MAX_FILES, 'Local pre-read has too many files', 'LOCAL_PRECONDITION_REQUIRED');
    const file = await ownedPath(root, relative);
    let info;
    try { info = await lstat(file); } catch (error) { if (error.code === 'ENOENT') { files.push({ path: relative, exists: false }); return; } throw error; }
    if (info.isDirectory()) {
      const names = (await readdir(file)).sort();
      if (!names.length) files.push({ path: relative, directory: true });
      for (const name of names) if (name.toLowerCase() !== '.git') await visit(path.join(relative, name));
    } else files.push(await fileFact(root, relative));
  }
  for (const relative of relatives) await visit(relative);
  return files;
}

// Exact fixed read recipes only: no gh/auth, network Git or shell wrapper.
// Repository-configured Git behavior remains a local environment precondition;
// these snapshots do not certify hooks/filters or replace execution-time gates.
// Hashes are returned instead of a credential-bearing config dump.
export async function readLocalGitState({ projectRoot, method, paths = [], remote }) {
  const root = await directory(projectRoot);
  async function git(args, optional = false) {
    try {
      const { stdout } = await run('git', ['--no-optional-locks', '--literal-pathspecs', '-c', 'core.quotepath=false', '-c', 'color.ui=false', '-c', 'core.fsmonitor=false', '-C', root, ...args],
        { windowsHide: true, encoding: 'utf8', timeout: 15000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' } });
      return stdout;
    } catch (error) {
      if (optional && Number.isInteger(error.code) && error.code !== 0 && !error.killed &&
        (optional !== 'no-repository' || /not a git repository/i.test(String(error.stderr ?? '')))) return null;
      throw fail('LOCAL_PRECONDITION_REQUIRED', 'The bounded local Git read failed');
    }
  }
  const top = await git(['rev-parse', '--show-toplevel'], method === 'initPublish' ? 'no-repository' : false);
  if (top === null) {
    // Only a truly unversioned local directory may use the publication branch.
    // An existing .git with an unreadable repository must not become "no Git".
    const marker = await lstat(path.join(root, '.git')).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    required(!marker, 'The existing Git repository could not be read', 'LOCAL_PRECONDITION_REQUIRED');
    return { projectRoot: root, repositoryExists: false, files: await treeFacts(root, ['.']) };
  }
  required(same(await directory(top.trim())) === same(root), 'Git would target an enclosing repository', 'LOCAL_FACT_MISMATCH');
  const head = await git(['rev-parse', '--verify', 'HEAD'], true);
  const index = await git(['ls-files', '--stage', '-z']);
  const status = await git(['status', '--porcelain=v2', '-z']);
  const branch = await git(['symbolic-ref', '--quiet', '--short', 'HEAD'], true);
  const facts = { projectRoot: root, repositoryExists: true, headOid: head?.trim() ?? null,
    indexSha256: digest(index), statusSha256: digest(status), branch: branch?.trim() ?? null };
  if (paths.length) facts.files = await treeFacts(root, paths);
  if (method === 'initPublish') facts.files = await treeFacts(root, ['.']);
  if (['initPublish', 'retryPush'].includes(method)) {
    const origin = await git(['config', '--get', 'remote.origin.url'], true);
    facts.originExists = origin !== null;
    if (origin !== null) {
      facts.originUrlSha256 = digest(origin.trim());
      facts.originRepository = repositoryForUrl(origin.trim());
      const urls = await git(['config', '--get-all', 'remote.origin.pushurl'], true);
      facts.originPushUrlsSha256 = digest(urls ?? '');
    }
  }
  if (remote) {
    required(REMOTE.test(remote), 'Invalid locally resolved Git remote');
    const url = await git(['config', '--get', 'remote.' + remote + '.url']);
    const pushUrls = await git(['config', '--get-all', 'remote.' + remote + '.pushurl'], true);
    required(clean(url.trim(), 4096), 'The Git remote URL is missing', 'LOCAL_PRECONDITION_REQUIRED');
    facts.remote = remote;
    facts.remoteUrlSha256 = digest(url.trim());
    facts.pushUrlsSha256 = digest(pushUrls ?? '');
  }
  return facts;
}

// dataRootFor is injected by the local worker layout. Never infer it from the
// remote cwd, process.cwd(), a home folder, or a caller-supplied file path.
export async function readLocalWriteState(scope, { dataRootFor } = {}) {
  const { projectRoot, method, parameters } = scope;
  const local = async () => {
    required(typeof dataRootFor === 'function', 'A trusted dataRootFor mapping is required', 'LOCAL_PRECONDITION_REQUIRED');
    return directory(await dataRootFor(projectRoot));
  };
  if (method === 'handoffResolve') {
    const relative = '.scratch/handoff', folder = await ownedPath(projectRoot, relative);
    let names;
    try { names = (await readdir(folder)).filter(name => /\.md$/i.test(name)).sort(); }
    catch (error) { if (error.code !== 'ENOENT') throw error; names = []; }
    required(names.length <= MAX_FILES, 'Too many local handoff files', 'LOCAL_PRECONDITION_REQUIRED');
    const files = [];
    for (const name of names) { const file = await fileFact(projectRoot, path.join(relative, name)); const info = await lstat(path.join(folder, name)); files.push({ ...file, mtimeMs: info.mtimeMs }); }
    return { files };
  }
  if (method === 'bind') {
    const dataRoot = await local();
    return { files: [await fileFact(projectRoot, 'docs/agents/workspace.json'), await fileFact(projectRoot, 'docs/agents/label-colors.json')],
      choices: await fileFact(dataRoot, '.dsh/mattskillsdeck/choices.json') };
  }
  const dataRoot = await local();
  const file = { deck_issue_report: '.dsh-mattskillsdeck-cache/session-tickets.json', cancelNewSessionWatcher: 'manual-naming.json',
    logSetSwitch: '.dsh-mattskillsdeck-cache/log-switch.json' }[method];
  if (file) return { files: [await fileFact(dataRoot, file)] };
  required(method === 'logClear', 'No default local state reader for this method', 'LOCAL_PRECONDITION_REQUIRED');
  const relative = '.dsh-mattskillsdeck-cache/logs', folder = await ownedPath(dataRoot, relative);
  let names;
  try { names = (await readdir(folder)).filter(name => /^\d{4}-\d{2}-\d{2}\.log$/.test(name) && (parameters.date === 'all' || name === parameters.date + '.log')).sort(); }
  catch (error) { if (error.code !== 'ENOENT') throw error; names = []; }
  required(names.length <= MAX_FILES, 'Too many local log files', 'LOCAL_PRECONDITION_REQUIRED');
  return { files: await Promise.all(names.map(name => fileFact(dataRoot, path.join(relative, name)))) };
}

async function localState(deps, scope) {
  const value = typeof deps.readLocalState === 'function' ? await dependency(deps, 'readLocalState', scope) : await readLocalWriteState(scope, deps);
  return value;
}
async function ticketOf(deps, scope, op) {
  required(clean(scope.parameters.ticketId, 64) && /^[A-Za-z0-9_-]+$/.test(scope.parameters.ticketId), 'Use the existing local Git preflight ticket');
  const local = await dependency(deps, 'readGitTicket', scope);
  // Public gitWriteCheck replies intentionally omit private repo/HEAD/index
  // fields. Keep that real reply intact and bind it to the locally captured
  // project/thread; never invent an upstream ticket with guessed hidden data.
  const captured = local.check !== undefined;
  const ticket = captured ? local.check?.ticket : local;
  const repoRoot = captured ? local.projectRoot : ticket?.repoRoot;
  required(!captured || local.threadId === scope.threadId && local.check?.ok === true && ['allow', 'warn'].includes(local.check.decision?.verdict),
    'The preflight reply was not captured for this local thread', 'LOCAL_FACT_MISMATCH');
  required(ticket?.id === scope.parameters.ticketId && ticket.op === op && clean(repoRoot, 4096) &&
    same(await directory(repoRoot)) === same(scope.projectRoot) && Number.isFinite(ticket.expiresAtMs) && ticket.expiresAtMs > Date.now(),
  'The locally read Git ticket is missing, expired, or belongs to another operation', 'LOCAL_FACT_MISMATCH');
  return { source: local, ticket, plan: captured ? local.check.plan : local.target };
}
function labels(value) { return Array.isArray(value) && value.length <= 128 && value.every(name => clean(name, 100) && !name.startsWith('-')); }
function repositoryForUrl(value) {
  if (typeof value !== 'string') return null;
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:)([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(value);
  return match && REPOSITORY.test(match[1]) ? match[1] : null;
}

export async function prepareWriteIntent({ method, parameters = {}, projectRoot, threadId, operationId }, localDeps = {}) {
  required(methods.has(method), 'Write method is not in the existing enabled capability set');
  required(clean(threadId, 256), 'Use the verified local host thread identity');
  if (operationId !== undefined) required(HASH.test(operationId), 'Use the trusted local operation identifier');
  const root = await directory(projectRoot);
  const args = jsonValue(parameters);
  required(plain(args), 'Write parameters must be a plain JSON object');
  if (args.expectedThreadId !== undefined) required(args.expectedThreadId === threadId, 'Host thread changed', 'LOCAL_FACT_MISMATCH');
  if (args.sessionId !== undefined) required(args.sessionId === threadId, 'Caller session cannot substitute for the local thread', 'LOCAL_FACT_MISMATCH');
  const scope = { method, parameters: args, projectRoot: root, threadId, ...(operationId ? { operationId } : {}) };
  const facts = {};
  let target = {};
  const content = value => { target.contentSha256 = fingerprint(value); };
  const correlate = value => { target.correlationKey = fingerprint(value); };
  const before = value => { target.beforeStateSha256 = fingerprint(value); };

  if (gitMethods.has(method)) {
    const fields = { gitStage: ['paths'], gitUnstage: ['paths'], gitCommit: ['message', 'ticketId', 'requestId'],
      gitPull: ['ticketId', 'requestId'], gitFetch: ['ticketId', 'requestId'], gitPush: ['ticketId', 'requestId'],
      initPublish: ['name', 'visibility'], retryPush: ['name', 'owner', 'repoUrl'] }[method];
    allowedFields(args, fields);
    for (const key of ['ticketId', 'requestId']) if (args[key] !== undefined) required(typeof args[key] === 'string' && args[key].length <= 64 && /^[A-Za-z0-9_-]*$/.test(args[key]), 'Invalid Git ticket/request identifier');
    let ticket;
    if (['gitPull', 'gitFetch', 'gitPush'].includes(method)) {
      ticket = await ticketOf(localDeps, scope, method.slice(3).toLowerCase());
      facts.ticket = ticket;
    }
    if (['gitStage', 'gitUnstage'].includes(method)) target.paths = pathsOf(args.paths);
    if (method === 'gitCommit') {
      required(text(args.message, 5000) && args.message.trim() && args.message.split('\n')[0].length <= 200, 'Invalid Git commit message');
      required(clean(args.ticketId, 64), 'A Git commit preflight ticket is required');
    }
    let remote = ticket?.plan?.remote;
    if (method === 'gitPull') {
      const upstream = ticket.plan?.upstream;
      required(clean(upstream, 512) && upstream.includes('/'), 'The local pull ticket has no upstream target', 'LOCAL_PRECONDITION_REQUIRED');
      remote = upstream.slice(0, upstream.indexOf('/'));
      target.branch = upstream.slice(upstream.indexOf('/') + 1);
    }
    if (remote !== undefined) { required(REMOTE.test(remote), 'Invalid locally resolved remote'); target.remote = remote; }
    if (method === 'gitPush') {
      required(BRANCH.test(ticket.plan?.branch ?? '') && BRANCH.test(ticket.plan?.localBranch ?? ''), 'The local push ticket has no branch target');
      target.branch = ticket.plan.branch;
    }
    const gitScope = { ...scope, paths: target.paths ?? [], ...(remote ? { remote } : {}) };
    const git = typeof localDeps.readGitState === 'function' ? await dependency(localDeps, 'readGitState', gitScope) : await readLocalGitState(gitScope);
    facts.git = git;
    required(typeof git.repositoryExists === 'boolean', 'Local Git repository state is required', 'LOCAL_PRECONDITION_REQUIRED');
    if (method !== 'initPublish') required(git.repositoryExists && OID.test(git.headOid ?? '') || method === 'gitStage' && git.repositoryExists, 'The local Git HEAD is unavailable', 'LOCAL_PRECONDITION_REQUIRED');
    if (git.headOid != null) { required(OID.test(git.headOid), 'Invalid local Git HEAD'); target.beforeOid = git.headOid; }
    if (method !== 'initPublish' || git.repositoryExists) required(HASH.test(git.indexSha256 ?? '') && HASH.test(git.statusSha256 ?? ''), 'Local index and worktree state are required', 'LOCAL_PRECONDITION_REQUIRED');
    if (remote) required(git.remote === remote && HASH.test(git.remoteUrlSha256 ?? ''), 'The current local remote must match the ticket target', 'LOCAL_FACT_MISMATCH');
    if (ticket?.ticket.headOid !== undefined) required(ticket.ticket.headOid === git.headOid, 'The Git ticket HEAD changed', 'LOCAL_FACT_MISMATCH');
    if (method === 'gitPush') target.commitOid = git.headOid;
    if (method === 'initPublish') {
      required(clean(args.name, 100) && /^[A-Za-z0-9._-]+$/.test(args.name) && !args.name.startsWith('-') &&
        (args.visibility === undefined || ['public', 'private'].includes(args.visibility)), 'Invalid publication repository');
      const identity = await dependency(localDeps, 'readGithubIdentity', scope);
      required(/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(identity.login ?? ''), 'Read the current GitHub owner locally', 'LOCAL_PRECONDITION_REQUIRED');
      facts.identity = identity;
      target.repository = identity.login + '/' + args.name;
      correlate({ repository: target.repository, visibility: args.visibility ?? 'private' });
    }
    if (method === 'retryPush') {
      const publication = await dependency(localDeps, 'readPublicationRecord', scope);
      required(publication.halfCreated === true && REPOSITORY.test(publication.repository ?? '') && OID.test(publication.commitOid ?? '') &&
        publication.commitOid === git.headOid, 'A verified local half-created publication record is required', 'LOCAL_PRECONDITION_REQUIRED');
      required(args.repoUrl === undefined || repositoryForUrl(args.repoUrl) === publication.repository, 'Retry URL differs from the local publication record', 'LOCAL_FACT_MISMATCH');
      if (args.owner !== undefined) required(args.owner === publication.repository.split('/')[0], 'Retry owner differs from the local publication record', 'LOCAL_FACT_MISMATCH');
      if (args.name !== undefined) required(args.name === publication.repository.split('/')[1], 'Retry name differs from the local publication record', 'LOCAL_FACT_MISMATCH');
      facts.publication = publication;
      required(typeof git.originExists === 'boolean' && (!git.originExists || git.originRepository === publication.repository && HASH.test(git.originUrlSha256 ?? '')),
        'The current origin does not identify the locally recorded publication', 'LOCAL_FACT_MISMATCH');
      target.repository = publication.repository;
      target.commitOid = publication.commitOid;
      target.remote = 'origin';
    }
    before(facts);
    content({ parameters: args, ...(git.files ? { files: git.files } : {}) });
    if (args.requestId) correlate({ threadId, requestId: args.requestId, method });
  } else if (['bind', 'handoffResolve', 'cancelNewSessionWatcher', 'logSetSwitch', 'logClear'].includes(method)) {
    allowedFields(args, { bind: ['backendId', 'backend'], handoffResolve: ['name'], cancelNewSessionWatcher: ['suggestionId'],
      logSetSwitch: ['enabled', 'sampleRate'], logClear: ['date'] }[method]);
    if (method === 'bind') {
      const backend = args.backendId !== undefined ? args.backendId : args.backend ?? null;
      required(backend === null || clean(backend, 100), 'Invalid backend binding');
      facts.backend = await backendOf(localDeps, scope, true);
      required(backend === null || Array.isArray(facts.backend.registeredBackendIds) && facts.backend.registeredBackendIds.includes(backend), 'The requested backend is not locally registered', 'LOCAL_PRECONDITION_REQUIRED');
      target.localStateKey = 'binding';
      content({ backendId: backend });
    }
    if (method === 'handoffResolve') {
      required(args.name === undefined || clean(args.name, 1024) && !/[\\/]/.test(args.name), 'Invalid handoff file selection');
      target.paths = ['.scratch/handoff'];
      content({ name: args.name ?? null });
    }
    if (method === 'cancelNewSessionWatcher') {
      required(/^[a-f0-9]{24}$/.test(args.suggestionId ?? ''), 'Use the existing local naming suggestion identifier');
      target.localStateKey = 'manual-naming';
      correlate({ threadId, suggestionId: args.suggestionId });
    }
    if (method === 'logSetSwitch') {
      required(typeof args.enabled === 'boolean' && (args.sampleRate === undefined || Number.isFinite(args.sampleRate)), 'Invalid log switch values');
      target.localStateKey = 'log-switch';
      content({ enabled: args.enabled, sampleRate: args.sampleRate ?? null });
    }
    if (method === 'logClear') {
      required(args.date === 'all' || /^\d{4}-\d{2}-\d{2}$/.test(args.date ?? ''), 'Use an exact log date or all');
      target.localStateKey = 'logs';
      content({ date: args.date });
    }
    facts.local = await localState(localDeps, scope);
    before(facts);
  } else if (['openFolder', 'openPath'].includes(method)) {
    allowedFields(args, method === 'openFolder' ? ['path'] : ['path']);
    const raw = method === 'openFolder' ? args.cwd || args.path || root : args.path;
    required(clean(raw, 4096), 'Use a local file or directory path');
    let file = raw;
    if (raw.startsWith('file:')) { try { file = fileURLToPath(new URL(raw)); } catch { throw fail('INVALID_WRITE_INTENT', 'Invalid local file URL'); } }
    required(path.isAbsolute(file) && !/[&|^%!<>"]/.test(file), 'Use an absolute path accepted by the existing open gate');
    const resolved = await realpath(file);
    let owned = inside(root, resolved);
    if (!owned && typeof localDeps.dataRootFor === 'function') owned = inside(await directory(await localDeps.dataRootFor(root)), resolved);
    required(owned, 'Open target is outside this project and its local data root', 'LOCAL_FACT_MISMATCH');
    const info = await lstat(resolved);
    required(info.isFile() || info.isDirectory(), 'Open target is not a file or directory');
    if (method === 'openFolder') required(info.isDirectory(), 'Open-folder target is not a directory');
    facts.open = { pathSha256: digest(same(resolved)), kind: info.isDirectory() ? 'directory' : 'file', bytes: info.size };
    target = { localStateKey: 'open-path', correlationKey: facts.open.pathSha256, beforeStateSha256: fingerprint(facts.open) };
  } else {
    const isDeck = method.startsWith('deck_');
    const fields = { commentIssue: ['number', 'body', 'effortId'], setLabelColors: ['changes', 'backendId'],
      deck_issue_create: ['title', 'body', 'kind', 'parentKey', 'labels', 'assignees', 'idempotencyKey', 'effortId'],
      deck_map_plan_create: ['title', 'body', 'planId', 'children', 'edges', 'labels', 'effortId'],
      deck_map_link: ['key', 'parentKey', 'blockedBy', 'edges', 'effortId'],
      deck_issue_patch: ['key', 'comment', 'addLabels', 'removeLabels', 'assignees', 'title', 'body', 'progress', 'close', 'effortId'],
      deck_issue_report: ['key', 'note', 'effortId'] }[method];
    allowedFields(args, fields, !isDeck);
    facts.backend = await backendOf(localDeps, scope);
    Object.assign(target, repoTarget(facts.backend));
    if (args.effortId !== undefined) required(clean(args.effortId, 256) && !/[\\/]/.test(args.effortId) && !['.', '..'].includes(args.effortId), 'Invalid local effort identifier');
    if (method === 'commentIssue') {
      target.issueNumber = issueNumber(args.number);
      required(text(args.body) && args.body.trim(), 'Comment body is required');
    }
    if (['deck_issue_patch', 'deck_issue_report'].includes(method)) target.issueNumber = issueNumber(method === 'deck_issue_report' && typeof args.key === 'string' ? args.key.trim().replace(/^#/, '') : args.key);
    if (method === 'setLabelColors') {
      required(Array.isArray(args.changes) && args.changes.length > 0 && args.changes.length <= 128 && args.changes.every(change => plain(change) && Object.keys(change).every(key => ['name', 'color'].includes(key)) && labels([change.name]) && /^[a-f0-9]{6}$/i.test(change.color ?? '')), 'Use explicit label/color pairs');
      required(args.backendId === undefined || args.backendId === facts.backend.backendId, 'Local selected label backend differs from the requested backend', 'LOCAL_FACT_MISMATCH');
    }
    if (['deck_issue_create', 'deck_map_plan_create'].includes(method)) {
      required(text(args.title, 60000) && args.title.trim(), 'Issue title is required');
      if (args.labels !== undefined) required(labels(args.labels), 'Invalid issue labels');
      if (args.parentKey !== undefined && args.parentKey !== '') target.parentIssueNumber = issueNumber(args.parentKey);
      const key = method === 'deck_issue_create' ? args.idempotencyKey : args.planId;
      // Keep the existing optional upstream anchor semantics. This local
      // correlation is not represented as an upstream idempotency guarantee.
      if (key !== undefined) required(clean(key, 200), 'Invalid creation/plan correlation key');
      facts.creation = { explicitAnchor: key !== undefined, correlationSha256: fingerprint({ operationId: operationId ?? null, threadId, key: key ?? null, parameters: args }) };
      target.correlationKey = facts.creation.correlationSha256;
    }
    if (method === 'deck_map_plan_create') {
      required(Array.isArray(args.children) && args.children.length > 0 && args.children.length <= 128, 'A bounded nonempty child plan is required');
      const keys = new Set();
      for (const child of args.children) {
        required(plain(child) && Object.keys(child).every(key => ['key', 'title', 'body', 'kind', 'labels', 'assignees'].includes(key)) && clean(child.key, 160) && text(child.title) && child.title.trim() && !keys.has(child.key), 'Invalid or duplicate child plan key');
        keys.add(child.key);
      }
      for (const edge of args.edges ?? []) required(plain(edge) && Object.keys(edge).every(key => ['from', 'to', 'type'].includes(key)) &&
        (edge.from === '@map' || keys.has(edge.from)) && (edge.to === '@map' || keys.has(edge.to)) && ['blocked-by', 'parent'].includes(edge.type ?? 'blocked-by'), 'Plan edge references an unknown child');
    }
    if (method === 'deck_map_link') {
      required(!(args.edges?.length && args.key), 'Choose the single-edge or batch-edge form');
      const jobs = args.edges?.length ? args.edges : args.key ? [args] : [];
      required(Array.isArray(jobs) && jobs.length > 0 && jobs.length <= 128, 'A bounded edge batch is required');
      const numbers = [];
      for (const job of jobs) {
        required(plain(job), 'Invalid edge job');
        numbers.push(issueNumber(job.key));
        if (job.parentKey !== undefined && job.parentKey !== '') numbers.push(issueNumber(job.parentKey));
        if (job.blockedBy !== undefined) { required(Array.isArray(job.blockedBy) && job.blockedBy.length <= 128, 'Invalid blocked-by set'); numbers.push(...job.blockedBy.map(issueNumber)); }
      }
      target.issueNumbers = [...new Set(numbers)];
      required(target.issueNumbers.length <= 128, 'Too many edge endpoints');
      if (jobs.length === 1) {
        target.issueNumber = issueNumber(jobs[0].key);
        if (jobs[0].parentKey !== undefined) target.parentIssueNumber = jobs[0].parentKey === '' ? null : issueNumber(jobs[0].parentKey);
        if (jobs[0].blockedBy !== undefined) target.blockedByIssueNumbers = [...new Set(jobs[0].blockedBy.map(issueNumber))];
      }
    }
    if (method === 'deck_issue_patch') {
      required(['comment', 'addLabels', 'removeLabels', 'assignees', 'title', 'body', 'progress', 'close'].some(key => args[key] !== undefined), 'No issue change was requested');
      if (args.close !== undefined) required(typeof args.close === 'boolean', 'Issue close must be boolean');
      for (const key of ['addLabels', 'removeLabels']) if (args[key] !== undefined) required(labels(args[key]), 'Invalid label replacement');
    }
    facts.tracker = await dependency(localDeps, 'readTracker', { ...scope, backend: facts.backend, target: { ...target } });
    required(facts.tracker.backendId === facts.backend.backendId &&
      (facts.backend.backendId !== 'github' || facts.tracker.repository === facts.backend.repository), 'Tracker pre-read belongs to another backend or repository', 'LOCAL_FACT_MISMATCH');
    const expectedNumbers = target.issueNumbers ?? (target.issueNumber ? [target.issueNumber] : []);
    if (expectedNumbers.length) {
      required(Array.isArray(facts.tracker.issues) && expectedNumbers.every(number => facts.tracker.issues.some(issue => plain(issue) && Number(issue.key) === number)),
        'The target issues were not read locally', 'LOCAL_PRECONDITION_REQUIRED');
    }
    if (method === 'setLabelColors') required(Array.isArray(facts.tracker.labels) && facts.tracker.complete === true, 'Read the current label set locally', 'LOCAL_PRECONDITION_REQUIRED');
    if (['deck_issue_create', 'deck_map_plan_create'].includes(method)) required(facts.tracker.complete === true && Array.isArray(facts.tracker.existingMatches),
      'Read the existing creation/plan matches locally', 'LOCAL_PRECONDITION_REQUIRED');
    if (method === 'deck_issue_report') {
      target.localStateKey = 'session-tickets';
      facts.local = await localState(localDeps, scope);
      correlate({ threadId, backendId: facts.backend.backendId, repository: facts.backend.repository ?? null, effortId: args.effortId ?? '', issueNumber: target.issueNumber, action: 'report' });
    }
    before(facts);
    content(args);
  }
  const intent = { method, parametersSha256: fingerprint(args), target };
  return { intent, facts };
}

export async function buildWriteIntent(input, localDeps) { return (await prepareWriteIntent(input, localDeps)).intent; }
