import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, mkdir, open, readFile, readdir, readlink, realpath, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolveExecutable } from '../upstream-port/executables.mjs';
import { resolveAdapterDataLayout } from './local-data-layout.mjs';
import { prepareWriteIntent } from './write-intents.mjs';
import { canonical, digest, threadId as identityOf } from './protocol.mjs';
import { gitReadEnvironment } from './write-effects-git.mjs';
import { localGithubHost } from './github-host.mjs';

const run = promisify(execFile), OID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const fold = value => process.platform === 'win32' ? value.toLowerCase() : value;
const same = (a, b) => canonical(a) === canonical(b);
const need = (condition, text) => { if (!condition) throw new Error(text); };
const hash = value => digest(canonical(value));
const business = response => response?.error || response?.result?.isError ? null : response?.result?.structuredContent?.value ?? response?.result?.structuredContent;
const repositoryForUrl = value => {
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9_.-]{1,100}?)(?:\.git)?$/.exec(value);
  return match ? match[1] + '/' + match[2] : null;
};
function endpoint({ repository, resource, page = 1 }) {
  if (resource === 'viewer') return 'user';
  need(/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(repository), 'Invalid locally selected publication repository');
  if (resource === 'repository') return 'repos/' + repository;
  need(['branches', 'tags'].includes(resource) && Number.isSafeInteger(page) && page > 0 && page <= 100, 'Publication readback is not allowlisted');
  return 'repos/' + repository + '/' + resource + '?per_page=100&page=' + page;
}
async function fixedReader(env) {
  const gh = await resolveExecutable('gh', { env }); need(gh, 'Local GitHub CLI is unavailable');
  return async scope => {
    let output;
    try { output = (await run(gh, ['api', '--hostname', 'github.com', '--include', '--method', 'GET', '-H', 'Accept: application/vnd.github+json', '-H', 'X-GitHub-Api-Version: 2026-03-10', endpoint(scope)],
      { cwd: scope.projectRoot, env, windowsHide: true, timeout: 20000, maxBuffer: 16 * 1024 * 1024 })).stdout; }
    catch (error) { output = error.stdout; }
    const header = typeof output === 'string' && /^HTTP\/[\d.]+\s+(\d{3})[^\r\n]*\r?\n[\s\S]*?\r?\n\r?\n/.exec(output);
    need(header, 'Independent publication readback failed');
    return { status: Number(header[1]), body: JSON.parse(output.slice(header[0].length)) };
  };
}
async function noRedirect(file) {
  let current = path.resolve(file);
  for (;;) {
    try { need(fold(await realpath(current)) === fold(current) && !(await lstat(current)).isSymbolicLink(), 'Publication record path was redirected'); return; }
    catch (error) { if (error.code !== 'ENOENT') throw error; const next = path.dirname(current); need(next !== current, 'Publication record path unavailable'); current = next; }
  }
}

// The optional reader/origin resolver are trusted local fixture seams. Neither
// can be selected by MCP arguments. Production accepts exact GitHub origins.
export async function createPublicationWriteEffects({ adapterPath, localDataRoot, env = process.env, readGithub, resolveOriginRepository, onMismatch } = {}) {
  const layout = await resolveAdapterDataLayout({ adapterPath, localDataRoot });
  const git = await resolveExecutable('git', { env }); need(git, 'Local Git is unavailable');
  const reader = readGithub ?? await fixedReader(env), readEnv = gitReadEnvironment(env, { hasConfiguredSshCommand: true });
  const originOf = async (projectRoot, url) => repositoryForUrl(url) ?? (resolveOriginRepository ? await resolveOriginRepository({ projectRoot, url }) : null);
  async function read(root, args, optional = false) {
    try { return (await run(git, ['--no-optional-locks', '--literal-pathspecs', '-c', 'credential.interactive=false', '-c', 'core.fsmonitor=false', '-C', root, ...args],
      { env: readEnv, windowsHide: true, timeout: 15000, maxBuffer: 16 * 1024 * 1024 })).stdout; }
    catch (error) {
      if (optional && [1, 128].includes(error.code) && typeof error.stdout === 'string' && !error.killed &&
          (optional !== 'no-repository' || /not a git repository/i.test(String(error.stderr ?? '')))) return null;
      throw new Error('Independent publication Git read failed');
    }
  }
  async function filesOf(root) {
    const rows = []; let total = 0;
    async function visit(folder, prefix = '') {
      const entries = await readdir(folder, { withFileTypes: true });
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (!prefix && entry.name === '.git') continue;
        const file = path.join(folder, entry.name), relative = prefix + entry.name;
        // Worker-owned generated evidence is not part of the publication source.
        if (fold(file) === fold(layout.root)) continue;
        need(rows.length < 2048, 'Publication source exceeds its bounded file snapshot');
        const info = await lstat(file);
        if (info.isSymbolicLink()) { rows.push({ path: relative, link: await readlink(file) }); continue; }
        need(fold(await realpath(file)) === fold(file), 'Publication source was redirected');
        if (info.isDirectory()) { rows.push({ path: relative, directory: true }); await visit(file, relative + '/'); continue; }
        need(info.isFile() && info.size <= 16 * 1024 * 1024 && (total += info.size) <= 64 * 1024 * 1024, 'Publication source exceeds its bounded byte snapshot');
        const content = await readFile(file), after = await lstat(file);
        need(after.size === info.size && after.mtimeMs === info.mtimeMs && after.ctimeMs === info.ctimeMs && content.length === info.size, 'Publication source changed while reading');
        rows.push({ path: relative, sha256: digest(content), executable: Boolean(info.mode & 0o111) });
      }
    }
    await visit(root); return rows;
  }
  async function snapshot(root) {
    const top = await read(root, ['rev-parse', '--show-toplevel'], 'no-repository');
    if (top === null) {
      need(!await lstat(path.join(root, '.git')).catch(error => { if (error.code === 'ENOENT') return null; throw error; }), 'Existing Git metadata is unreadable');
      return { repositoryExists: false, headOid: null, branch: null, originUrls: [], originPushUrls: [], files: await filesOf(root) };
    }
    need(fold(await realpath(top.trim())) === fold(root), 'Publication cannot target an enclosing repository');
    const head = (await read(root, ['rev-parse', '--verify', 'HEAD'], true))?.trim() ?? null;
    need(head === null || OID.test(head), 'Invalid publication HEAD');
    const branch = (await read(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'], true))?.trim() ?? null;
    const values = async key => (await read(root, ['config', '--get-all', key], true) ?? '').split(/\r?\n/).filter(Boolean);
    return { repositoryExists: true, headOid: head, branch,
      originUrls: await values('remote.origin.url'), originPushUrls: await values('remote.origin.pushurl'),
      indexSha256: digest(await read(root, ['ls-files', '--stage', '-z'])), statusSha256: digest(await read(root, ['status', '--porcelain=v2', '-z'])), files: await filesOf(root) };
  }
  async function prepare({ method, request, projectRoot, threadId }) {
    // Original publication constructs github.com remote URLs. Do not combine
    // those with an enterprise CLI authority or mutate Git before detecting it.
    need(localGithubHost(env) === 'github.com', 'Original publication URLs require github.com; enterprise publication has not been verified');
    need(['initPublish', 'retryPush'].includes(method) && request?.method === 'tools/call' && request.params?.name === 'deck_upstream_write' && request.params.arguments?.method === method && identityOf(request) === threadId, 'Unsupported or unbound publication request');
    const root = await realpath(projectRoot), args = structuredClone(request.params.arguments.payload);
    need(args?.expectedThreadId === threadId && (args.sessionId === undefined || args.sessionId === threadId), 'Publication belongs to another local host thread');
    if (args.cwd !== undefined) need(typeof args.cwd === 'string' && path.isAbsolute(args.cwd) && fold(await realpath(args.cwd)) === fold(root), 'Publication cwd cannot select another project');
    const recordFile = path.join(layout.projectBase, digest(root), 'publication', 'half-created.json');
    await noRedirect(recordFile);
    const before = await snapshot(root);
    need(before.originPushUrls.length === 0 && before.originUrls.length <= 1, 'Publication cannot use multiple origins or push URLs');
    const scope = { projectRoot: root }; let repository;
    async function readApi(resource, page) {
      const selected = { ...scope, repository, resource, ...(page === undefined ? {} : { page }) }; endpoint(selected);
      const response = await reader(selected); need(response && Number.isInteger(response.status), 'Publication readback omitted HTTP status'); return response;
    }
    const viewer = await readApi('viewer');
    need(viewer.status === 200 && /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(viewer.body?.login ?? ''), 'Read the current GitHub account locally');
    const owner = viewer.body.login; let record = null;
    if (method === 'initPublish') {
      need(typeof args.name === 'string' && /^[A-Za-z0-9._-]{1,100}$/.test(args.name) && !args.name.startsWith('-'), 'Invalid publication name');
      repository = owner + '/' + args.name;
    } else {
      const info = await lstat(recordFile); need(info.isFile() && !info.isSymbolicLink() && info.size <= 65536, 'No bounded local half-created publication record');
      record = JSON.parse(await readFile(recordFile, 'utf8'));
      need(record.version === 1 && record.projectRoot === root && record.halfCreated === true && record.repository?.split('/')[0] === owner && Number.isSafeInteger(record.repositoryId) && record.repositoryId > 0 && OID.test(record.commitOid ?? '') &&
        record.commitOid === before.headOid && record.branch === before.branch && ['private', 'public'].includes(record.visibility), 'Local publication record no longer matches the current owner, HEAD or branch');
      repository = record.repository;
    }
    const visibility = method === 'initPublish' ? args.visibility ?? 'private' : record.visibility;
    need(['private', 'public'].includes(visibility), 'Invalid publication visibility');
    const originRepo = before.originUrls.length ? await originOf(root, before.originUrls[0]) : null;
    need(!before.originUrls.length || originRepo, 'Existing publication origin is not an exact supported repository URL');
    if (method === 'retryPush') need(!before.originUrls.length || originRepo === repository, 'Retry origin differs from the verified publication record');
    const metadata = await readApi('repository');
    const validateRepo = response => response.status === 200 && Number.isSafeInteger(response.body?.id) && response.body.id > 0 && response.body.full_name === repository && response.body.owner?.login === owner && response.body.private === (visibility === 'private');
    if (method === 'initPublish') need(metadata.status === 404, 'Publication repository already exists or its absence could not be confirmed');
    else need(validateRepo(metadata) && metadata.body.id === record.repositoryId, 'Retry remote identity or visibility changed');
    async function refs() {
      const result = { branches: {}, tags: {} }; let bytes = 0;
      for (const resource of ['branches', 'tags']) {
        let complete = false;
        for (let page = 1; page <= 100; page++) {
          const reply = await readApi(resource, page); need(reply.status === 200 && Array.isArray(reply.body) && reply.body.length <= 100, 'Publication remote refs read is incomplete');
          bytes += Buffer.byteLength(canonical(reply.body)); need(bytes <= 32 * 1024 * 1024, 'Publication remote refs exceeded the complete-snapshot byte budget');
          for (const entry of reply.body) {
            need(typeof entry.name === 'string' && entry.name.length > 0 && entry.name.length <= 1024 && OID.test(entry.commit?.sha ?? '') && !Object.hasOwn(result[resource], entry.name), 'Publication remote refs are ambiguous');
            Object.defineProperty(result[resource], entry.name, { value: entry.commit.sha, enumerable: true });
          }
          if (reply.body.length < 100) { complete = true; break; }
        }
        need(complete, 'Publication remote refs pagination reached its bound');
      }
      return result;
    }
    const beforeRefs = method === 'retryPush' ? await refs() : { branches: {}, tags: {} };
    if (record) need(same(beforeRefs, record.refs), 'Remote publication refs changed since the verified partial result');
    const gitState = { ...before, originExists: before.originUrls.length > 0, originRepository: originRepo,
      ...(before.originUrls.length ? { originUrlSha256: digest(before.originUrls[0]) } : {}) };
    const intent = await prepareWriteIntent({ method, parameters: args, projectRoot: root, threadId }, {
      readGitState: async () => gitState, readGithubIdentity: async () => ({ login: owner }), readPublicationRecord: async () => record,
    });
    const { correlationKey: ignored, ...target } = intent.intent.target;
    const precondition = { repositoryExists: before.repositoryExists, headOid: before.headOid, branch: before.branch, originUrls: before.originUrls, originPushUrls: before.originPushUrls };
    const dispatchContext = { publication: { repository, visibility, before: precondition,
      ...(record ? { retry: { repositoryId: record.repositoryId, commitOid: record.commitOid, branch: record.branch } } : {}) } };
    async function store(value) {
      await noRedirect(recordFile); await mkdir(path.dirname(recordFile), { recursive: true }); await noRedirect(recordFile);
      const temporary = recordFile + '.' + randomUUID() + '.tmp'; let handle;
      try { handle = await open(temporary, 'wx', 0o600); await handle.writeFile(canonical(value) + '\n'); await handle.sync(); }
      finally { await handle?.close(); }
      await rename(temporary, recordFile);
      need(same(JSON.parse(await readFile(recordFile, 'utf8')), value), 'Publication evidence did not persist');
    }
    return { target, dispatchContext, async verify(response) {
      try {
        const reply = business(response); need(reply && typeof reply.ok === 'boolean', 'No original publication business result');
        if (reply.repo?.owner) need(reply.repo.owner === owner && reply.repo.name === repository.split('/')[1], 'Publication result names another repository');
        if (reply.repoUrl) need(repositoryForUrl(reply.repoUrl) === repository, 'Publication result URL names another repository');
        const account = await readApi('viewer'); need(account.status === 200 && account.body?.login === owner, 'GitHub account changed during publication');
        const after = await snapshot(root);
        need(after.repositoryExists && OID.test(after.headOid ?? '') && after.branch && same(after.files, before.files) && after.originUrls.length === 1 && !after.originPushUrls.length, 'Publication local state changed unexpectedly');
        const afterOrigin = await originOf(root, after.originUrls[0]);
        need(afterOrigin === repository, 'Publication did not bind its exact intended origin');
        if (method === 'initPublish') {
          if (before.branch) need(after.branch === before.branch, 'Publication changed the local branch');
          const text = await read(root, ['cat-file', 'commit', after.headOid]), split = text.indexOf('\n\n'); need(split > 0, 'Publication commit is unreadable');
          const parents = text.slice(0, split).split('\n').filter(line => line.startsWith('parent ')).map(line => line.slice(7));
          need(same(parents, before.headOid ? [before.headOid] : []) && text.slice(split + 2) === 'initial commit\n', 'Publication did not create exactly its original initial commit');
          need((await read(root, ['status', '--porcelain=v2', '-z'])) === '', 'Publication commit does not contain all intended source changes');
        } else need(after.headOid === before.headOid && after.branch === before.branch && after.indexSha256 === before.indexSha256 && after.statusSha256 === before.statusSha256, 'Retry changed local source, index or commit');
        const remote = await readApi('repository'); need(validateRepo(remote) && (!record || remote.body.id === record.repositoryId), 'Publication remote identity or visibility could not be proved');
        const actualRefs = await refs(), expectedRefs = structuredClone(beforeRefs); Object.defineProperty(expectedRefs.branches, after.branch, { value: after.headOid, enumerable: true, configurable: true });
        const resultTarget = { ...target, commitOid: after.headOid, expectedAfterOid: after.headOid, expectedStateSha256: hash({ repositoryId: remote.body.id, refs: actualRefs }) };
        const evidence = { version: 1, projectRoot: root, repository, repositoryId: remote.body.id, visibility, commitOid: after.headOid, branch: after.branch, refs: actualRefs, halfCreated: !same(actualRefs, expectedRefs) };
        if (same(actualRefs, expectedRefs)) {
          await store({ ...evidence, halfCreated: false });
          return { target: resultTarget, resultSha256: hash({ reply, evidence }) };
        }
        // Only an unchanged remote ref set proves this specific push stopped
        // after creating/binding the exact repo and commit. Anything else is unknown.
        need(reply.ok === false && same(actualRefs, beforeRefs), 'Publication remote changes are not a known terminal partial');
        await store(evidence);
        return { outcome: 'failed', result: { target: resultTarget, resultSha256: hash({ reply, evidence }), errorKind: 'partial' } };
      } catch (error) { onMismatch?.(error); return null; }
    } };
  }
  return { prepare };
}
