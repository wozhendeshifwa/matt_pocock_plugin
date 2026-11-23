import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createPublishFlow } from '../../vendor/mattskills-1.8.0-rc.7/lib/publishFlow.js';
import { classifyGitWriteCommand } from '../upstream-port/git-write-gate.mjs';
import { classifyReadCommand } from '../upstream-port/read-command.mjs';
import { resolveExecutable } from '../upstream-port/executables.mjs';
import { createPublicationWriteEffects } from './write-effects-publication.mjs';
import { digest } from './protocol.mjs';

const run = promisify(execFile), threadId = '01a1b180-89f8-7291-beb2-43f569f3709c';
const request = (method = 'initPublish', payload = {}) => ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
  name: 'deck_upstream_write', arguments: { method, payload: { ...(method === 'initPublish' ? { name: 'fixture-publication', visibility: 'private' } :
    { owner: 'fixture-owner', name: 'fixture-publication', repoUrl: 'https://github.com/fixture-owner/fixture-publication' }), ...payload, expectedThreadId: threadId } }, _meta: { threadId },
} });
const wrap = value => ({ jsonrpc: '2.0', id: 1, result: { structuredContent: { ok: true, value } } });

async function fixture(t, { existing = false, origin = false } = {}) {
  const base = fileURLToPath(new URL('../../.scratch/', import.meta.url)); await fs.mkdir(base, { recursive: true });
  const directory = await fs.realpath(await fs.mkdtemp(path.join(base, 'publication-effects-test-')));
  t.after(async () => { const actual = await fs.realpath(directory); assert.equal(path.dirname(actual).toLowerCase(), (await fs.realpath(base)).toLowerCase()); assert.ok(path.basename(actual).startsWith('publication-effects-test-')); await fs.rm(actual, { recursive: true, maxRetries: 10, retryDelay: 100 }); });
  const project = path.join(directory, 'project'), data = path.join(directory, 'private-data'), home = path.join(directory, 'home'), hooks = path.join(directory, 'hooks'), remote = path.join(directory, 'remote.git');
  await Promise.all([project, data, home, hooks].map(value => fs.mkdir(value)));
  const empty = path.join(directory, 'empty-config'), provider = path.join(home, 'config.toml'); await fs.writeFile(empty, ''); await fs.writeFile(provider, '[model_providers.deepseek]\nname="retained fixture"\n');
  const env = {}; for (const key of ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP']) if (process.env[key]) env[key] = process.env[key];
  Object.assign(env, { HOME: home, USERPROFILE: home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: empty, GIT_CONFIG_SYSTEM: empty,
    GIT_CEILING_DIRECTORIES: directory, GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'Publication Fixture', GIT_AUTHOR_EMAIL: 'publication@example.invalid', GIT_COMMITTER_NAME: 'Publication Fixture', GIT_COMMITTER_EMAIL: 'publication@example.invalid' });
  const binary = await resolveExecutable('git', { env }); assert.ok(binary);
  const git = async (args, cwd = project) => (await run(binary, ['-c', 'core.hooksPath=' + hooks, '-c', 'commit.gpgsign=false', '-c', 'push.followTags=false', '-c', 'remote.origin.mirror=false', '-C', cwd, ...args], { env, windowsHide: true, timeout: 15000 })).stdout;
  await git(['init', '--bare', remote], directory);
  await fs.writeFile(path.join(project, 'README.md'), 'source content\n'); await fs.writeFile(path.join(project, 'binary.bin'), Buffer.from([0, 255, 11]));
  if (existing) { await git(['init']); await git(['add', '.']); await git(['commit', '-m', 'existing parent']); await fs.writeFile(path.join(project, 'README.md'), 'source changed\n'); }
  if (origin) await git(['remote', 'add', 'origin', 'https://github.com/old-owner/old-repo.git']);
  const adapterPath = path.join(directory, 'runtime/prototypes/upstream-port/sidebar-server.mjs'); await fs.mkdir(path.dirname(adapterPath), { recursive: true }); await fs.writeFile(adapterPath, '// fixture marker, not executed\n');
  const state = { exists: false, owner: 'fixture-owner', id: 456, visibility: 'private', pushFails: false, readFails: false, creates: 0, pushes: 0, calls: [], method: 'initPublish' };
  const repository = 'fixture-owner/fixture-publication';
  const reader = async ({ resource, repository: selected, page }) => {
    state.calls.push({ resource, repository: selected, page });
    if (state.readFails) throw new Error('injected unknown remote');
    if (resource === 'viewer') return { status: 200, body: { login: state.owner } };
    assert.equal(selected, repository);
    if (!state.exists) return { status: 404, body: { message: 'Not Found' } };
    if (resource === 'repository') return { status: 200, body: { id: state.id, full_name: repository, owner: { login: 'fixture-owner' }, private: state.visibility === 'private' } };
    assert.ok(['branches', 'tags'].includes(resource)); assert.ok(page >= 1 && page <= 100);
    const prefix = resource === 'branches' ? 'refs/heads/' : 'refs/tags/';
    const lines = (await git(['--git-dir', remote, 'for-each-ref', '--format=%(refname)%00%(objectname)', prefix], directory)).trim().split('\n').filter(Boolean);
    const rows = lines.map(line => { const [ref, sha] = line.split('\0'); return { name: ref.slice(prefix.length), commit: { sha } }; });
    return { status: 200, body: rows.slice((page - 1) * 100, page * 100) };
  };
  const factory = () => createPublicationWriteEffects({ adapterPath, localDataRoot: data, env, readGithub: reader,
    resolveOriginRepository: async ({ url }) => url === remote ? repository : null });
  const flow = createPublishFlow({ DEFAULT_CWD: project, resolveGit: async () => binary, resolveGh: async () => 'gh', getGhLastError: () => '',
    async execProc(argv, cwd) {
      assert.equal(cwd, project); const write = classifyGitWriteCommand(argv, { method: state.method, cwd, workspaceRoot: project });
      assert.ok(write || classifyReadCommand(argv), 'unexpected original publication command ' + argv.join(' '));
      let args = argv.slice(1); if (args[0] === '-C') { assert.equal(args[1], project); args = args.slice(2); }
      if (args[0] === 'remote' && ['set-url', 'add'].includes(args[1]) && args.length === 4) { assert.equal(args[3], 'https://github.com/' + repository + '.git'); args = [...args.slice(0, 3), remote]; }
      if (args[0] === 'push') { assert.equal((await git(['remote', 'get-url', '--push', 'origin'])).trim(), remote, 'fixture must never execute a network push'); state.pushes++; if (state.pushFails) return { ok: false, error: 'fatal: connection refused' }; }
      try { return { ok: true, text: (await git(args)).trim() }; } catch (error) { return { ok: false, error: String(error.stderr || error.message) }; }
    },
    async runGh(args, cwd) {
      if (args[0] === 'auth') return { ok: true, text: 'isolated fixture' };
      if (args[0] === 'api') return { ok: true, text: state.owner };
      assert.ok(classifyGitWriteCommand(['gh', ...args], { method: state.method, cwd, workspaceRoot: project })); assert.equal(args[2], 'fixture-publication'); assert.equal(args[3], '--private', 'fixtures cannot create a public repository');
      state.creates++; state.exists = true;
      if (args.includes('--source=.')) {
        await git(['remote', 'add', 'origin', remote]); state.pushes++;
        if (state.pushFails) return { ok: false, text: 'https://github.com/' + repository, error: 'network connection refused', kind: 'network' };
        await git(['push', '-u', 'origin', 'HEAD']);
      }
      return { ok: true, text: 'https://github.com/' + repository };
    }, canonicalKey: async cwd => cwd, getRepoKey: async () => ({ owner: 'fixture-owner', name: 'fixture-publication' }), repoKeys: {}, repoRoots: {}, setCache() {},
  });
  const prepare = async value => (await factory()).prepare({ method: value.params.arguments.method, request: value, projectRoot: project, threadId });
  const call = async value => { state.method = value.params.arguments.method; return wrap(await (state.method === 'initPublish' ? flow.handleInitPublish : flow.handleRetryPush)(value.params.arguments.payload)); };
  const recordFile = path.join(data, 'projects', digest(project), 'publication/half-created.json');
  return { directory, project, data, env, provider, remote, state, git, prepare, call, factory, recordFile, reader };
}

test('preparation is read-only and pins local account, original visibility and Git preconditions', async t => {
  const f = await fixture(t), before = await fs.readdir(f.data), p = await f.prepare(request());
  assert.deepEqual(await fs.readdir(f.data), before); await assert.rejects(fs.stat(path.join(f.project, '.git')), { code: 'ENOENT' });
  assert.deepEqual(p.dispatchContext.publication, { repository: 'fixture-owner/fixture-publication', visibility: 'private', before: { repositoryExists: false, headOid: null, branch: null, originUrls: [], originPushUrls: [] } });
  assert.equal(f.state.creates, 0); assert.equal(f.state.pushes, 0);
});
test('enterprise publication rejects before any local Git mutation or remote creation for both original publication methods', async t => {
  for (const existing of [false, true]) {
    const f = await fixture(t, { existing }); f.env.GH_HOST = 'ghe.example.invalid';
    const beforeFiles = await fs.readdir(f.project), beforeSource = await fs.readFile(path.join(f.project, 'README.md'));
    const beforeGit = existing ? { head: await f.git(['rev-parse', 'HEAD']), index: await f.git(['ls-files', '--stage', '-z']), status: await f.git(['status', '--porcelain=v2', '-z']), config: await fs.readFile(path.join(f.project, '.git/config')) } : null;
    for (const method of ['initPublish', 'retryPush']) await assert.rejects(f.prepare(request(method)), /publication URLs require github.com; enterprise publication has not been verified/);
    assert.deepEqual(await fs.readdir(f.project), beforeFiles); assert.deepEqual(await fs.readFile(path.join(f.project, 'README.md')), beforeSource);
    if (existing) {
      assert.equal(await f.git(['rev-parse', 'HEAD']), beforeGit.head); assert.equal(await f.git(['ls-files', '--stage', '-z']), beforeGit.index); assert.equal(await f.git(['status', '--porcelain=v2', '-z']), beforeGit.status); assert.deepEqual(await fs.readFile(path.join(f.project, '.git/config')), beforeGit.config);
    } else await assert.rejects(fs.stat(path.join(f.project, '.git')), { code: 'ENOENT' });
    assert.equal(f.state.creates, 0); assert.equal(f.state.pushes, 0); assert.equal(f.state.calls.length, 0); assert.deepEqual(await fs.readdir(f.data), []);
  }
});
test('invalid or Windows-ambiguous publication hosts reject without reading Github or changing source state', async t => {
  const f = await fixture(t), original = await fs.readFile(path.join(f.project, 'README.md'));
  for (const values of [{ GH_HOST: 'https://github.com' }, { GH_HOST: 'user@ghe.example.invalid' }, { GH_HOST: 'github.com/path' },
    { GH_HOST: 'ghe.example.invalid:0' }, { GH_HOST: 'github.com\n' }, { GH_HOST: 'github.com', gh_host: 'ghe.example.invalid' },
    { GH_HOST: 'github.com:443', Gh_Host: 'github.com:00443' }]) {
    for (const key of Object.keys(f.env)) if (key.toUpperCase() === 'GH_HOST') delete f.env[key]; Object.assign(f.env, values);
    await assert.rejects(f.prepare(request()), error => ['INVALID_GITHUB_HOST', 'AMBIGUOUS_GITHUB_HOST'].includes(error.code));
  }
  assert.deepEqual(await fs.readFile(path.join(f.project, 'README.md')), original); await assert.rejects(fs.stat(path.join(f.project, '.git')), { code: 'ENOENT' });
  assert.equal(f.state.creates, 0); assert.equal(f.state.pushes, 0); assert.equal(f.state.calls.length, 0);
});
test('actual original init publishes all source to a real local bare and proves the remote commit', async t => {
  const f = await fixture(t), p = await f.prepare(request()), response = await f.call(request());
  assert.equal(response.result.structuredContent.value.ok, true); const result = await p.verify(response); assert.ok(result?.resultSha256); assert.equal(result.target.commitOid, (await f.git(['rev-parse', 'HEAD'])).trim());
  assert.equal(f.state.creates, 1); assert.equal(JSON.parse(await fs.readFile(f.recordFile, 'utf8')).halfCreated, false);
  assert.equal(await fs.readFile(f.provider, 'utf8'), '[model_providers.deepseek]\nname="retained fixture"\n');
});
test('existing Git and old origin preserve the parent while original handler creates and switches to the exact target', async t => {
  const f = await fixture(t, { existing: true, origin: true }), parent = (await f.git(['rev-parse', 'HEAD'])).trim(), value = request(), p = await f.prepare(value);
  assert.ok(await p.verify(await f.call(value))); assert.equal((await f.git(['rev-parse', 'HEAD^'])).trim(), parent); assert.equal((await f.git(['remote', 'get-url', 'origin'])).trim(), f.remote);
});
test('proved created repo with failed push persists a known partial; explicit retry from a new factory never recreates it', async t => {
  const f = await fixture(t); f.state.pushFails = true; const value = request(), p = await f.prepare(value), partial = await p.verify(await f.call(value));
  assert.equal(partial?.outcome, 'failed'); assert.equal(partial?.result.errorKind, 'partial');
  const record = JSON.parse(await fs.readFile(f.recordFile, 'utf8')); assert.equal(record.repositoryId, 456); assert.equal(record.halfCreated, true); assert.equal(record.commitOid, (await f.git(['rev-parse', 'HEAD'])).trim());
  const retry = request('retryPush'), prepared = await f.prepare(retry); assert.equal(prepared.dispatchContext.publication.retry.repositoryId, 456);
  const failedAgain = await prepared.verify(await f.call(retry)); assert.equal(failedAgain?.outcome, 'failed');
  f.state.pushFails = false; const final = await f.prepare(retry); assert.ok((await final.verify(await f.call(retry)))?.resultSha256); assert.equal(f.state.creates, 1);
  await assert.rejects(f.prepare(retry), /record/);
});
test('a URL, halfCreated flag, or forged success cannot replace missing independent remote evidence', async t => {
  const f = await fixture(t), p = await f.prepare(request());
  assert.equal(await p.verify(wrap({ ok: true, repoUrl: 'https://github.com/fixture-owner/fixture-publication' })), null);
  await assert.rejects(f.prepare(request('retryPush')), /ENOENT/);
  f.state.pushFails = true; const partial = await f.prepare(request()); const response = await f.call(request()); f.state.exists = false;
  assert.equal(await partial.verify(response), null); await assert.rejects(fs.stat(f.recordFile), { code: 'ENOENT' });
});
test('unknown remote reads preserve unknown and create no retry authorization or automatic second write', async t => {
  const f = await fixture(t); f.state.pushFails = true; const p = await f.prepare(request()), response = await f.call(request()); f.state.readFails = true;
  assert.equal(await p.verify(response), null); assert.equal(f.state.creates, 1); assert.equal(f.state.pushes, 1); await assert.rejects(fs.stat(f.recordFile), { code: 'ENOENT' });
});
test('wrong visibility, changed account, and concurrent source edits cannot pass independent verification', async t => {
  for (const change of [f => { f.state.visibility = 'public'; }, f => { f.state.owner = 'another-owner'; }, async f => { await fs.writeFile(path.join(f.project, 'README.md'), 'concurrent work\n'); }]) {
    const f = await fixture(t), p = await f.prepare(request()), response = await f.call(request()); await change(f); assert.equal(await p.verify(response), null);
  }
});
test('pre-existing remote, multiple push URLs, wrong thread and model-selected retry target are rejected before dispatch', async t => {
  const f = await fixture(t, { existing: true }); f.state.exists = true; await assert.rejects(f.prepare(request()), /already exists/); f.state.exists = false;
  await f.git(['config', '--add', 'remote.origin.pushurl', 'https://github.com/other-owner/other-repo.git']); await assert.rejects(f.prepare(request()), /push URLs/); await f.git(['config', '--unset-all', 'remote.origin.pushurl']);
  const wrong = request(); wrong.params._meta.threadId = 'other'; await assert.rejects(f.prepare(wrong), /unbound|thread identity/);
  f.state.pushFails = true; const p = await f.prepare(request()); assert.equal((await p.verify(await f.call(request())))?.outcome, 'failed');
  await assert.rejects(f.prepare(request('retryPush', { owner: 'other-owner' })), /owner/);
  await assert.rejects(f.prepare(request('retryPush', { repoUrl: 'https://github.com/other-owner/other-repo' })), /URL/);
  await f.git(['remote', 'set-url', 'origin', 'https://github.com/other-owner/other-repo.git']); await assert.rejects(f.prepare(request('retryPush')), /origin/);
});
test('retry rejects a replaced remote identity, changed refs or changed local HEAD', async t => {
  const f = await fixture(t); f.state.pushFails = true; const p = await f.prepare(request()); assert.equal((await p.verify(await f.call(request())))?.outcome, 'failed');
  f.state.id = 999; await assert.rejects(f.prepare(request('retryPush')), /identity/); f.state.id = 456;
  await f.git(['push', 'origin', 'HEAD:refs/heads/unexpected']); await assert.rejects(f.prepare(request('retryPush')), /refs changed/);
  await f.git(['push', 'origin', ':refs/heads/unexpected']); await f.git(['commit', '--allow-empty', '-m', 'new unrelated commit']); await assert.rejects(f.prepare(request('retryPush')), /record/);
});
test('successful-looking partial with no actual push and unexpected remote side branches remains unknown', async t => {
  const f = await fixture(t); f.state.pushFails = true; const p = await f.prepare(request()), response = await f.call(request());
  assert.equal(await p.verify(wrap({ ...response.result.structuredContent.value, ok: true })), null);
  await f.git(['push', 'origin', 'HEAD:refs/heads/unexpected']); assert.equal(await p.verify(response), null); await assert.rejects(fs.stat(f.recordFile), { code: 'ENOENT' });
});
