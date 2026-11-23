import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { createPublicationCommandGuard, applyPublicationOverlay } from './publication-overlay.mjs';
import { resolveExecutable } from '../upstream-port/executables.mjs';

async function fixture(t) {
  const base = fileURLToPath(new URL('../../.scratch/', import.meta.url)); await mkdir(base, { recursive: true });
  const root = await realpath(await mkdtemp(path.join(base, 'publication-command-')));
  t.after(async () => { const actual = await realpath(root), parent = await realpath(base);
    assert.equal(path.dirname(actual).toLowerCase(), parent.toLowerCase()); assert.ok(path.basename(actual).startsWith('publication-command-'));
    await rm(actual, { recursive: true }); });
  const project = path.join(root, 'owned'), home = path.join(root, 'home'), hooks = path.join(root, 'hooks');
  for (const folder of [project, home, hooks]) await mkdir(folder);
  const config = path.join(root, 'gitconfig'); await writeFile(config, '');
  const env = { ...process.env, GIT_CONFIG_GLOBAL: config, GIT_CONFIG_SYSTEM: config, GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0', GIT_CEILING_DIRECTORIES: root, GH_HOST: 'github.com', HOME: home, USERPROFILE: home };
  const git = await resolveExecutable('git', { env }); assert.ok(git);
  const run = args => execFileSync(git, ['-C', project, '-c', 'core.hooksPath=' + hooks,
    '-c', 'user.name=Publication Guard', '-c', 'user.email=guard@example.invalid', ...args], { env, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const owner = { login: 'fixture-owner', calls: 0 };
  const guard = createPublicationCommandGuard({ path, realpathSync, existsSync, gitExecutable: git, workspaceRoot: project,
    execFileSync(program, args, options) {
      if (program === 'gh.exe') { assert.deepEqual(args, ['api', 'user', '-q', '.login']); owner.calls++; return owner.login + '\n'; }
      assert.equal(program, git); return execFileSync(program, args, options);
    } });
  const before = () => ({ repositoryExists: true, headOid: run(['rev-parse', '--verify', 'HEAD']),
    branch: run(['symbolic-ref', '--short', 'HEAD']), originUrls: [], originPushUrls: [] });
  const context = value => ({ method: 'initPublish', identity: {}, localPublication: {
    repository: 'fixture-owner/new-repository', visibility: 'private', before: value,
  } });
  const call = (active, argv) => guard(active, { argv, cwd: project }, env);
  const init = async () => { run(['init', '--quiet']); await writeFile(path.join(project, 'README.md'), 'isolated guard fixture\n');
    run(['add', '.']); run(['commit', '--quiet', '-m', 'fixture']); };
  return { project, git, run, owner, guard, call, before, context, init, env };
}

test('publication guard qualifies the original create recipe only after real local preconditions and account match', async t => {
  const f = await fixture(t); await f.init(); const active = f.context(f.before());
  assert.deepEqual(f.call(active, [f.git, 'add', '.']), [f.git, 'add', '.']);
  const original = ['gh.exe', 'repo', 'create', 'new-repository', '--private', '--source=.', '--push'];
  assert.deepEqual(f.call(active, original), ['gh.exe', 'repo', 'create', 'fixture-owner/new-repository', '--private', '--source=.', '--push']);
  assert.equal(original[3], 'new-repository'); assert.equal(f.owner.calls, 1);
  assert.throws(() => f.call(active, original), /differs/);
});

test('publication guard permits a truly unversioned owned root then the original initialization steps', async t => {
  const f = await fixture(t), active = f.context({ repositoryExists: false, headOid: null, branch: null, originUrls: [], originPushUrls: [] });
  f.call(active, [f.git, 'init']); await f.init();
  assert.deepEqual(f.call(active, ['gh.exe', 'repo', 'create', 'new-repository', '--private']).slice(0, 4), ['gh.exe', 'repo', 'create', 'fixture-owner/new-repository']);
});

test('first-write HEAD or origin drift, a different account and a visibility change cannot enter the create command', async t => {
  const f = await fixture(t); await f.init(); const initial = f.before(), changed = f.context(initial);
  f.run(['commit', '--quiet', '--allow-empty', '-m', 'external edit']);
  assert.throws(() => f.call(changed, [f.git, 'add', '.']), /facts changed/);
  const active = f.context(f.before()); f.call(active, [f.git, 'add', '.']); f.owner.login = 'other-account';
  assert.throws(() => f.call(active, ['gh.exe', 'repo', 'create', 'new-repository', '--private']), /account changed/);
  f.owner.login = 'fixture-owner';
  assert.throws(() => f.call(active, ['gh.exe', 'repo', 'create', 'new-repository', '--public']), /differs/);
  const remote = f.context(f.before()); f.run(['remote', 'add', 'origin', 'https://github.com/fixture-owner/other.git']);
  assert.throws(() => f.call(remote, [f.git, 'add', '.']), /facts changed/);
});

test('publication push must target the precise created repository and cannot use an overriding push URL', async t => {
  const f = await fixture(t); await f.init(); const active = f.context(f.before());
  f.call(active, ['gh.exe', 'repo', 'create', 'new-repository', '--private']);
  f.run(['remote', 'add', 'origin', 'https://github.com/fixture-owner/new-repository.git']);
  assert.deepEqual(f.call(active, [f.git, 'push', '-u', 'origin', 'HEAD']), [f.git, 'push', '-u', 'origin', 'HEAD']);
  f.run(['config', 'remote.origin.pushurl', 'https://github.com/fixture-owner/other.git']);
  assert.throws(() => f.call(active, [f.git, 'push', '-u', 'origin', 'HEAD']), /not bound/);
});

test('retry requires durable exact commit facts and refuses changed heads or another origin', async t => {
  const f = await fixture(t); await f.init();
  f.run(['remote', 'add', 'origin', 'git@github.com:fixture-owner/new-repository.git']);
  const before = { ...f.before(), originUrls: ['git@github.com:fixture-owner/new-repository.git'] };
  const active = f.context(before); active.method = 'retryPush';
  assert.throws(() => f.call(active, [f.git, 'push', '-u', 'origin', 'HEAD']), /durable publication/);
  active.localPublication.retry = { repositoryId: 123, commitOid: before.headOid, branch: before.branch };
  assert.deepEqual(f.call(active, [f.git, 'push', '-u', 'origin', 'HEAD']), [f.git, 'push', '-u', 'origin', 'HEAD']);
  f.run(['commit', '--quiet', '--allow-empty', '-m', 'later local commit']);
  assert.throws(() => f.call(active, [f.git, 'push', '-u', 'origin', 'HEAD']), /commit changed/);
  assert.throws(() => f.call(active, [f.git, 'remote', 'add', 'origin', 'https://github.com/fixture-owner/other.git']), /another remote/);
});

test('effective Git URL rewrites cannot redirect gh initial push or an explicit publication retry', async t => {
  const f = await fixture(t); await f.init(); const active = f.context(f.before());
  f.run(['config', 'url.https://github.com/fixture-owner/other.git.pushInsteadOf', 'https://github.com/fixture-owner/new-repository.git']);
  assert.throws(() => f.call(active, ['gh.exe', 'repo', 'create', 'new-repository', '--private']), /effective push target/);
  assert.equal(active.publicationCreateStarted, undefined);
  f.run(['remote', 'add', 'origin', 'https://github.com/fixture-owner/new-repository.git']);
  const before = { ...f.before(), originUrls: ['https://github.com/fixture-owner/new-repository.git'] };
  const retry = f.context(before); retry.method = 'retryPush';
  retry.localPublication.retry = { repositoryId: 123, commitOid: before.headOid, branch: before.branch };
  assert.throws(() => f.call(retry, [f.git, 'push', '-u', 'origin', 'HEAD']), /effective push target/);
});

test('serialized publication code retains literal replacement tokens instead of duplicating the host suffix', () => {
  const source = '  const disposers = [];\n      if (gitWrite) {\n        // Also inherited\n      const [program, ...args] = options.argv;\n';
  const patched = applyPublicationOverlay('prototypes/upstream-port/node-host.mjs', source, '\n');
  assert.equal(patched.split('// Also inherited').length - 1, 1);
  assert.ok(patched.includes(createPublicationCommandGuard.toString()), 'function body including dollar-quote regex strings remains exact');
  assert.equal(patched.split('const [program, ...args] = actualArgv;').length - 1, 1);
  assert.throws(() => applyPublicationOverlay('prototypes/upstream-port/node-host.mjs', patched, '\n'), /anchor drift/);
});

test('an unbound CLI host rejects publication before the first local or external write', async t => {
  const f = await fixture(t); await f.init(); const active = f.context(f.before());
  f.env.GH_HOST = 'other.example.invalid';
  assert.throws(() => f.call(active, [f.git, 'add', '.']), /host is not bound/);
  assert.equal(active.publicationChecked, undefined); assert.equal(f.owner.calls, 0);
});
