import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, writeFile, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createGitWriteEffects, gitReadEnvironment } from './write-effects-git.mjs';
import { resolveExecutable } from '../upstream-port/executables.mjs';
import { createWriteCheck } from '../../vendor/mattskills-1.8.0-rc.7/lib/versionControlCheck.js';
import { createWritePhones } from '../../vendor/mattskills-1.8.0-rc.7/lib/versionControlWrite.js';

// Real isolated Git/bare/peer plus the actual vendored preflight and write
// handlers. No gh/auth, GitHub repository or externally reachable origin.
const run = promisify(execFile), threadId = '22222222-2222-4222-8222-222222222222';
const output = value => ({ jsonrpc: '2.0', id: 1, result: { structuredContent: { ok: true, value } } });
async function fixture(t) {
  const base = fileURLToPath(new URL('../../.scratch/', import.meta.url)); await mkdir(base, { recursive: true });
  const directory = await realpath(await mkdtemp(path.join(base, 'git-network-effects-test-')));
  const project = path.join(directory, 'project'), bare = path.join(directory, 'remote.git'), peer = path.join(directory, 'peer');
  const home = path.join(directory, 'home'), hooks = path.join(directory, 'hooks'), config = path.join(directory, 'empty-git-config');
  await Promise.all([project, home, hooks].map(folder => mkdir(folder))); await writeFile(config, '');
  t.after(async () => {
    const actual = await realpath(directory), parent = await realpath(base);
    assert.equal(path.dirname(actual).toLowerCase(), parent.toLowerCase()); assert.ok(path.basename(actual).startsWith('git-network-effects-test-'));
    await rm(actual, { recursive: true, maxRetries: 10, retryDelay: 100 });
  });
  const env = {};
  for (const key of ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP']) if (process.env[key]) env[key] = process.env[key];
  Object.assign(env, { USERPROFILE: home, HOME: home, APPDATA: path.join(home, 'AppData/Roaming'), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: config,
    GIT_CONFIG_SYSTEM: config, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_CONFIG_COUNT: '5',
    GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: hooks, GIT_CONFIG_KEY_1: 'core.autocrlf', GIT_CONFIG_VALUE_1: 'false',
    GIT_CONFIG_KEY_2: 'user.name', GIT_CONFIG_VALUE_2: 'Network Effects Fixture', GIT_CONFIG_KEY_3: 'user.email', GIT_CONFIG_VALUE_3: 'network-effects@example.invalid',
    GIT_CONFIG_KEY_4: 'commit.gpgsign', GIT_CONFIG_VALUE_4: 'false' });
  const binary = await resolveExecutable('git', { env }); assert.ok(binary); env.DECK_GIT = binary;
  async function gitAt(cwd, args) {
    if (args.includes('clone')) {
      assert.ok(args.includes(bare), 'Clone only the newly-created local bare fixture');
    } else if (args.some(arg => ['fetch', 'pull', 'push'].includes(arg))) {
      const configured = (await run(binary, ['-C', cwd, 'remote', 'get-url', '--all', 'origin'], { env, windowsHide: true, encoding: 'utf8' })).stdout.trim();
      assert.equal(configured, bare, 'Never execute network Git against an external origin');
      const pushUrl = (await run(binary, ['-C', cwd, 'remote', 'get-url', '--push', '--all', 'origin'], { env, windowsHide: true, encoding: 'utf8' })).stdout.trim();
      assert.equal(pushUrl, bare, 'Never execute a configured external push URL');
    }
    return (await run(binary, ['--literal-pathspecs', '-C', cwd, ...args], { env, windowsHide: true, encoding: 'utf8', timeout: 20000, maxBuffer: 8 * 1024 * 1024 })).stdout;
  }
  const git = async args => (await gitAt(project, args)).trim();
  const optional = async args => { try { return await git(args); } catch { return null; } };
  await gitAt(directory, ['init', '--bare', '--initial-branch=main', bare]);
  await git(['init', '--initial-branch=main']);
  await writeFile(path.join(project, 'sample.txt'), 'seed\n'); await writeFile(path.join(project, 'keep.txt'), 'keep\n');
  await git(['add', '--', '.']); await git(['commit', '--quiet', '-m', 'fixture seed']);
  await git(['remote', 'add', 'origin', bare]); await git(['push', '-u', '--no-follow-tags', 'origin', 'main:main']);
  await gitAt(directory, ['clone', '--local', bare, peer]);
  const peerGit = async args => (await gitAt(peer, args)).trim();
  async function screen() {
    const branch = await git(['symbolic-ref', '--short', 'HEAD']), object = await git(['rev-parse', 'HEAD']), worktreePath = await git(['rev-parse', '--show-toplevel']);
    const remote = await optional(['config', '--get', 'branch.' + branch + '.remote']), merge = await optional(['config', '--get', 'branch.' + branch + '.merge']);
    const upstream = remote && merge?.startsWith('refs/heads/') ? remote + '/' + merge.slice(11) : null;
    const upstreamExists = upstream ? await optional(['rev-parse', '--verify', '--quiet', 'refs/remotes/' + upstream]) : null;
    const counts = upstreamExists ? (await git(['rev-list', '--left-right', '--count', 'HEAD...' + upstream])).split(/\s+/).map(Number) : [0, 0];
    const dirty = (await git(['status', '--porcelain=v2'])).split('\n').filter(Boolean);
    return { ok: true, screen: { repo: { bare: false, merging: false, rebasing: false, cherryPicking: false, reverting: false },
      identity: { branch, oid: object, worktreePath, detached: false, sync: !upstream ? 'no-upstream' : !upstreamExists ? 'upstream-gone' : 'synced', behind: counts[1], basisMs: Date.now() },
      branches: [{ short: branch, upstream, upstreamGone: Boolean(upstream && !upstreamExists) }], conflictCount: 0,
      stagedCount: dirty.filter(line => /^1 [^. ]/.test(line)).length, unstagedCount: dirty.filter(line => /^\?|^1 .[^. ]/.test(line)).length } };
  }
  const safeGit = { startCall() { return { async run({ args, cwd }) {
    try { return { ok: true, kind: 'ok', exitCode: 0, stdout: await gitAt(cwd, args), truncated: false }; }
    catch (error) { return { ok: false, kind: 'exit', exitCode: Number.isInteger(error.code) ? error.code : 1, stderr: String(error.stderr ?? error.message), message: 'isolated fixture Git failure' }; }
  } }; } };
  const checker = createWriteCheck({ vc: { readScreenOf: screen }, safeGit, randomId: () => randomBytes(12).toString('hex') });
  const phones = createWritePhones({ vc: { readScreenOf: screen }, safeGit, tickets: checker.tickets, results: checker.results });
  const diagnostics = [];
  const effects = await createGitWriteEffects({ env, localBareRoots: [bare], onMismatch: code => diagnostics.push(code) });
  async function prepare(method, extra = {}, overrides = {}) {
    const check = await checker.handleGitWriteCheck({ cwd: project, op: method.slice(3).toLowerCase(), ...extra });
    assert.equal(check.ok, true, JSON.stringify(check));
    assert.deepEqual(Object.keys(check.ticket).sort(), ['checkedAtMs', 'expiresAtMs', 'id', 'op'], 'Capture the actual limited public ticket; do not synthesize hidden fields');
    const parameters = { ticketId: check.ticket.id, requestId: 'fixture-' + randomBytes(8).toString('hex'), expectedThreadId: threadId };
    const trustedTicket = { projectRoot: project, threadId, check };
    const input = { method, projectRoot: project, parameters, trustedTicket, threadId, ...overrides };
    return { effect: await effects.prepare(input), parameters, trustedTicket, input };
  }
  const execute = async (method, parameters) => output(await phones['handle' + method[0].toUpperCase() + method.slice(1)]({ ...parameters, cwd: project }));
  async function advancePeer(name = 'peer.txt') {
    await writeFile(path.join(peer, name), randomBytes(12).toString('hex') + '\n');
    await peerGit(['add', '--', name]); await peerGit(['commit', '--quiet', '-m', 'peer advance']); await peerGit(['push', '--no-follow-tags', 'origin', 'main:main']);
    return peerGit(['rev-parse', 'HEAD']);
  }
  return { directory, project, bare, peer, git, peerGit, gitAt, env, checker, phones, effects, prepare, execute, advancePeer, diagnostics };
}

test('native fetch ticket plus real tracking refs and fresh FETCH_HEAD prove a local bare fetch', async t => {
  const f = await fixture(t), beforeHead = await f.git(['rev-parse', 'HEAD']), afterRemote = await f.advancePeer();
  const { effect, parameters } = await f.prepare('gitFetch');
  const reply = await f.execute('gitFetch', parameters);
  assert.equal(reply.result.structuredContent.value.ok, true, JSON.stringify(reply));
  const result = await effect.verify(reply);
  assert.ok(result, JSON.stringify({ diagnostics: f.diagnostics, refs: await f.git(['for-each-ref', '--format=%(refname) %(objectname) %(symref)']), fetchHead: await readFile(path.join(f.project, '.git/FETCH_HEAD'), 'utf8'), reply })); assert.equal(result.target.remote, 'origin');
  assert.equal(await f.git(['rev-parse', 'refs/remotes/origin/main']), afterRemote);
  assert.equal(await f.git(['rev-parse', 'HEAD']), beforeHead);
  assert.match(await readFile(path.join(f.project, '.git/FETCH_HEAD'), 'utf8'), new RegExp(afterRemote));
});

test('fetch reply without execution and stale FETCH_HEAD cannot complete the effect', async t => {
  const f = await fixture(t);
  await f.git(['fetch', 'origin']);
  const { effect } = await f.prepare('gitFetch');
  assert.equal(await effect.verify(output({ ok: true, mode: 'fetched', remote: 'origin' })), null);
});

test('fetch rejects wrong tracking refs, extra local branch and worktree drift', async t => {
  const f = await fixture(t), afterRemote = await f.advancePeer();
  const prepared = await f.prepare('gitFetch'), reply = await f.execute('gitFetch', prepared.parameters);
  await f.git(['update-ref', 'refs/remotes/origin/main', prepared.effect.target.beforeOid]);
  assert.equal(await prepared.effect.verify(reply), null);
  await f.git(['update-ref', 'refs/remotes/origin/main', afterRemote]);
  await f.git(['branch', 'unexpected-branch']);
  assert.equal(await prepared.effect.verify(reply), null);
  await f.git(['branch', '-D', 'unexpected-branch']);
  await writeFile(path.join(f.project, 'keep.txt'), 'unrelated worktree drift\n');
  assert.equal(await prepared.effect.verify(reply), null);
});

test('native pull performs and independently verifies the intended fast-forward tree', async t => {
  const f = await fixture(t), before = await f.git(['rev-parse', 'HEAD']), expected = await f.advancePeer();
  await writeFile(path.join(f.project, 'untracked-local.txt'), 'must survive pull\n');
  const { effect, parameters } = await f.prepare('gitPull');
  const reply = await f.execute('gitPull', parameters);
  assert.equal(reply.result.structuredContent.value.mode, 'fast-forward');
  const result = await effect.verify(reply);
  assert.ok(result, JSON.stringify({ fetchHead: await readFile(path.join(f.project, '.git/FETCH_HEAD'), 'utf8'), reply })); assert.equal(result.target.beforeOid, before); assert.equal(result.target.expectedAfterOid, expected);
  assert.equal(await f.git(['rev-parse', 'HEAD']), expected);
  assert.equal(await readFile(path.join(f.project, 'untracked-local.txt'), 'utf8'), 'must survive pull\n');
});

test('up-to-date pull still requires a fresh actual fetch rather than an echoed success', async t => {
  const f = await fixture(t); await f.git(['fetch', 'origin']);
  const { effect, parameters } = await f.prepare('gitPull'), head = await f.git(['rev-parse', 'HEAD']);
  const echoed = output({ ok: true, mode: 'up-to-date', headBefore: head, headAfter: head, upstream: 'origin/main' });
  assert.equal(await effect.verify(echoed), null);
  const reply = await f.execute('gitPull', parameters);
  assert.ok(await effect.verify(reply));
});

test('divergent pull stays unknown even though its fetch updated remote-tracking refs', async t => {
  const f = await fixture(t), remote = await f.advancePeer();
  await writeFile(path.join(f.project, 'local.txt'), 'local divergence\n'); await f.git(['add', '--', 'local.txt']); await f.git(['commit', '--quiet', '-m', 'local diverges']);
  const { effect, parameters } = await f.prepare('gitPull');
  const before = await f.git(['rev-parse', 'HEAD']), reply = await f.execute('gitPull', parameters);
  assert.equal(reply.result.structuredContent.value.ok, false);
  assert.equal(await f.git(['rev-parse', 'refs/remotes/origin/main']), remote);
  assert.equal(await f.git(['rev-parse', 'HEAD']), before);
  assert.equal(await effect.verify(reply), null);
});

test('pull result with wrong tree, altered untracked contents or extra branch remains unknown', async t => {
  const f = await fixture(t); await f.advancePeer();
  await writeFile(path.join(f.project, 'untracked-local.txt'), 'original\n');
  const { effect, parameters } = await f.prepare('gitPull'), reply = await f.execute('gitPull', parameters);
  await writeFile(path.join(f.project, 'sample.txt'), 'unexpected tracked drift\n'); await f.git(['add', '--', 'sample.txt']);
  assert.equal(await effect.verify(reply), null);
  await f.git(['reset', '--quiet', 'HEAD', '--', 'sample.txt']); await f.git(['checkout', '--', 'sample.txt']);
  await writeFile(path.join(f.project, 'untracked-local.txt'), 'changed\n');
  assert.equal(await effect.verify(reply), null);
  await writeFile(path.join(f.project, 'untracked-local.txt'), 'original\n');
  await f.git(['branch', 'unexpected-local-branch']);
  assert.equal(await effect.verify(reply), null);
});

test('native push proves exact bare target and preserves every other branch/tag and local state', async t => {
  const f = await fixture(t);
  await f.git(['branch', 'unrelated-local']);
  await writeFile(path.join(f.project, 'sample.txt'), 'push this commit\n'); await f.git(['add', '--', 'sample.txt']); await f.git(['commit', '--quiet', '-m', 'local advance']);
  const { effect, parameters } = await f.prepare('gitPush'), expected = await f.git(['rev-parse', 'HEAD']);
  const reply = await f.execute('gitPush', parameters);
  assert.ok(await effect.verify(reply));
  assert.equal((await f.gitAt(f.bare, ['rev-parse', 'refs/heads/main'])).trim(), expected);
  assert.equal((await f.gitAt(f.bare, ['for-each-ref', '--format=%(refname)', 'refs/heads'])).trim(), 'refs/heads/main');
});

test('first push native set-upstream plan verifies exact branch config', async t => {
  const f = await fixture(t); await f.git(['checkout', '--quiet', '-b', 'new-branch']);
  await writeFile(path.join(f.project, 'new.txt'), 'first push\n'); await f.git(['add', '--', 'new.txt']); await f.git(['commit', '--quiet', '-m', 'new branch']);
  const { effect, parameters, trustedTicket } = await f.prepare('gitPush');
  assert.equal(trustedTicket.check.plan.mode, 'set-upstream');
  const reply = await f.execute('gitPush', parameters), result = await effect.verify(reply);
  assert.ok(result); assert.equal(result.target.branch, 'new-branch');
  assert.equal(await f.git(['config', '--get', 'branch.new-branch.remote']), 'origin');
  assert.equal(await f.git(['config', '--get', 'branch.new-branch.merge']), 'refs/heads/new-branch');
});

test('push echoed success, extra remote branch and upstream config drift cannot complete', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.project, 'sample.txt'), 'next local\n'); await f.git(['add', '--', 'sample.txt']); await f.git(['commit', '--quiet', '-m', 'next local']);
  const { effect, parameters } = await f.prepare('gitPush');
  const echoed = output({ ok: true, mode: 'existing-upstream', remote: 'origin', branch: 'main' });
  assert.equal(await effect.verify(echoed), null);
  const reply = await f.execute('gitPush', parameters);
  await f.gitAt(f.bare, ['branch', 'unexpected-remote', 'main']);
  assert.equal(await effect.verify(reply), null);
  await f.gitAt(f.bare, ['branch', '-D', 'unexpected-remote']);
  await f.gitAt(f.bare, ['tag', 'unexpected-tag', 'main']);
  assert.equal(await effect.verify(reply), null);
  await f.gitAt(f.bare, ['tag', '-d', 'unexpected-tag']);
  await f.git(['config', 'branch.main.merge', 'refs/heads/wrong-branch']);
  assert.equal(await effect.verify(reply), null);
});

test('captured tickets are bound to actual project, thread, method, ID and lifetime', async t => {
  const f = await fixture(t), prepared = await f.prepare('gitFetch');
  const { input } = prepared;
  for (const change of [
    { threadId: 'other-thread' },
    { parameters: { ...input.parameters, ticketId: 'model-made-id' } },
    { method: 'gitPush' },
    { trustedTicket: { ...input.trustedTicket, projectRoot: f.peer } },
    { trustedTicket: { ...input.trustedTicket, check: { ...input.trustedTicket.check, ticket: { ...input.trustedTicket.check.ticket, expiresAtMs: 1 } } } },
    { parameters: { ...input.parameters, expectedThreadId: 'another-thread' } },
  ]) await assert.rejects(f.effects.prepare({ ...input, ...change }), /captured locally|captured preflight|preflight plan/);
  await assert.rejects(f.effects.prepare({ ...input, trustedTicket: undefined }), /captured locally/);
});

test('explicit fixture mode rejects network origins and push URLs before any remote read', async t => {
  const f = await fixture(t), { input } = await f.prepare('gitFetch');
  for (const url of ['https://github.com/example/never-contact', 'git@github.com:example/never-contact', 'file:///' + f.bare.replaceAll('\\', '/')]) {
    await f.git(['remote', 'set-url', 'origin', url]);
    await assert.rejects(f.effects.prepare(input), /local bare fixture|network origins/);
  }
  await f.git(['remote', 'set-url', 'origin', f.bare]);
  await f.git(['remote', 'set-url', '--push', 'origin', 'https://github.com/example/never-contact']);
  await assert.rejects(f.effects.prepare(input), /matching configured/);
});

test('production HTTPS preparation can use a trusted injected reader without an online test call', async t => {
  const command = 'custom-ssh -i private-fixture-key -p 2222';
  assert.equal(gitReadEnvironment({ GIT_SSH_COMMAND: command }).GIT_SSH_COMMAND, command);
  assert.equal(gitReadEnvironment({ GIT_SSH: 'custom-ssh.exe' }).GIT_SSH, 'custom-ssh.exe');
  assert.equal(gitReadEnvironment({ GIT_SSH: 'custom-ssh.exe' }).GIT_SSH_COMMAND, undefined);
  assert.equal(gitReadEnvironment({}, { hasConfiguredSshCommand: true }).GIT_SSH_COMMAND, undefined);
  assert.equal(gitReadEnvironment({ GIT_SSH_VARIANT: 'plink' }).GIT_SSH_COMMAND, undefined);
  assert.match(gitReadEnvironment({}).GIT_SSH_COMMAND, /BatchMode=yes/);
  assert.equal(gitReadEnvironment({ GIT_ASKPASS: 'do-not-launch.exe' }).GIT_ASKPASS, undefined);
  const f = await fixture(t), { input } = await f.prepare('gitFetch');
  await f.git(['remote', 'set-url', 'origin', 'https://github.com/example/fixture-transport-only']);
  let calls = 0;
  const effects = await createGitWriteEffects({ env: f.env, readRemoteState: async scope => {
    calls++; assert.equal(scope.projectRoot, f.project); assert.equal(scope.remote, 'origin'); assert.match(scope.urlsSha256, /^[a-f0-9]{64}$/);
    // An explicitly injected unit fixture, not evidence from that GitHub repo.
    return { refs: [{ name: 'refs/heads/main', oid: input.trustedTicket.check.ticket.id.padEnd(40, '0').slice(0, 40), symbolic: '' }], head: 'refs/heads/main', configSha256: null };
  } });
  const prepared = await effects.prepare(input);
  assert.equal(prepared.target.remote, 'origin'); assert.equal(calls, 1);
  // Deliberately no verify-success assertion: this is API routing coverage,
  // not production remote acceptance and no real HTTPS request was made.
});

test('default fixed ls-remote reader verifies real fetch against the isolated local bare only', async t => {
  const f = await fixture(t); await f.advancePeer();
  const { input, parameters } = await f.prepare('gitFetch');
  const effects = await createGitWriteEffects({ env: f.env });
  const prepared = await effects.prepare(input);
  assert.ok(await prepared.verify(await f.execute('gitFetch', parameters)));
  assert.equal(await f.git(['remote', 'get-url', 'origin']), f.bare);
});
