import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createGitWriteEffects } from './write-effects-git.mjs';
import { resolveExecutable } from '../upstream-port/executables.mjs';

const run = promisify(execFile);
const output = value => ({ jsonrpc: '2.0', id: 1, result: { structuredContent: { ok: true, value } } });
const response = (method, paths) => output({ ok: true, [method === 'gitStage' ? 'staged' : 'unstaged']: paths });

async function fixture(t) {
  const base = fileURLToPath(new URL('../../.scratch/', import.meta.url)); await mkdir(base, { recursive: true });
  const directory = await realpath(await mkdtemp(path.join(base, 'git-effects-test-')));
  t.after(async () => {
    const root = await realpath(directory), parent = await realpath(base);
    assert.equal(path.dirname(root).toLowerCase(), parent.toLowerCase()); assert.ok(path.basename(root).startsWith('git-effects-test-'));
    await rm(root, { recursive: true, maxRetries: 10, retryDelay: 100 });
  });
  const project = path.join(directory, 'project'), home = path.join(directory, 'home'), hooks = path.join(directory, 'hooks');
  await Promise.all([project, home, hooks].map(value => mkdir(value)));
  const config = path.join(directory, 'empty-git-config'); await writeFile(config, '');
  const env = {};
  for (const key of ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP']) if (process.env[key]) env[key] = process.env[key];
  Object.assign(env, { USERPROFILE: home, HOME: home, APPDATA: path.join(home, 'AppData/Roaming'), GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: config, GIT_CONFIG_SYSTEM: config, GIT_TERMINAL_PROMPT: '0' });
  const binary = await resolveExecutable('git', { env }); assert.ok(binary); env.DECK_GIT = binary;
  const git = async args => (await run(binary, ['--literal-pathspecs', '-C', project, '-c', 'core.hooksPath=' + hooks,
    '-c', 'core.autocrlf=false', '-c', 'user.name=Isolated Git Effects', '-c', 'user.email=git-effects@example.invalid', ...args],
    { env, windowsHide: true, timeout: 15000, maxBuffer: 4 * 1024 * 1024 })).stdout.trim();
  await git(['init', '--quiet']); await mkdir(path.join(project, 'tree'));
  for (const name of ['ordinary.txt', 'outside.txt', '[a].txt', 'a.txt', 'delete.txt', 'tree/tracked.txt', 'tree/gone.txt']) await writeFile(path.join(project, name), 'initial ' + name + '\n');
  await writeFile(path.join(project, 'binary.dat'), Buffer.from([0, 255, 10, 128]));
  await git(['add', '--', '.']); await git(['commit', '--quiet', '-m', 'initial fixture']);
  const effects = await createGitWriteEffects({ env });
  const prepare = (method, parameters) => effects.prepare({ method, projectRoot: project, parameters });
  return { directory, project, git, prepare, env, effects };
}

for (const kind of ['ordinary', 'binary', 'literal pathspec', 'deleted path', 'directory']) {
  test(`stage and unstage independently verify real ${kind} effects`, async t => {
    const f = await fixture(t);
    let paths;
    if (kind === 'ordinary') { paths = ['ordinary.txt']; await writeFile(path.join(f.project, paths[0]), 'changed ordinary\n'); }
    if (kind === 'binary') { paths = ['binary.dat']; await writeFile(path.join(f.project, paths[0]), Buffer.from([255, 0, 129, 31, 1])); }
    if (kind === 'literal pathspec') {
      paths = ['[a].txt']; await writeFile(path.join(f.project, paths[0]), 'literal bracket name\n'); await writeFile(path.join(f.project, 'a.txt'), 'must stay unstaged\n');
    }
    if (kind === 'deleted path') { paths = ['delete.txt']; await rm(path.join(f.project, paths[0])); }
    if (kind === 'directory') {
      paths = ['tree']; await writeFile(path.join(f.project, 'tree/tracked.txt'), 'directory tracked change\n');
      await writeFile(path.join(f.project, 'tree/new.txt'), 'directory new file\n'); await rm(path.join(f.project, 'tree/gone.txt'));
    }
    // An unrelated staged entry must survive both selected-path operations.
    await writeFile(path.join(f.project, 'outside.txt'), 'outside staged change\n'); await f.git(['add', '--', 'outside.txt']);
    const outsideOid = await f.git(['rev-parse', ':outside.txt']);
    const stage = await f.prepare('gitStage', { paths });
    await f.git(['add', '--', ...paths]);
    assert.ok(await stage.verify(response('gitStage', paths)), 'real stage result must be independently found');
    assert.equal(await f.git(['rev-parse', ':outside.txt']), outsideOid);
    if (kind === 'literal pathspec') assert.equal(await f.git(['diff', '--cached', '--name-only', '--', 'a.txt']), '');
    const unstage = await f.prepare('gitUnstage', { paths });
    await f.git(['reset', '--quiet', 'HEAD', '--', ...paths]);
    assert.ok(await unstage.verify(response('gitUnstage', paths)), 'real reset result must be independently found');
    assert.equal(await f.git(['rev-parse', ':outside.txt']), outsideOid);
    assert.equal(await f.git(['diff', '--cached', '--name-only', '--', ...paths]), '');
  });
}

test('a success-shaped reply without staging tracked or untracked content cannot complete an effect', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.project, 'ordinary.txt'), 'tracked not staged\n');
  await writeFile(path.join(f.project, 'untracked.txt'), 'untracked not staged\n');
  for (const paths of [['ordinary.txt'], ['untracked.txt']]) {
    const effect = await f.prepare('gitStage', { paths });
    assert.equal(await effect.verify(response('gitStage', paths)), null);
  }
  await f.git(['add', '--', 'ordinary.txt']);
  const unstage = await f.prepare('gitUnstage', { paths: ['ordinary.txt'] });
  assert.equal(await unstage.verify(response('gitUnstage', ['ordinary.txt'])), null);
});

test('selected worktree races and index writes outside the intended paths remain uncertain', async t => {
  const f = await fixture(t), paths = ['ordinary.txt'];
  await writeFile(path.join(f.project, paths[0]), 'prepared contents\n');
  const race = await f.prepare('gitStage', { paths });
  await writeFile(path.join(f.project, paths[0]), 'changed while pending\n'); await f.git(['add', '--', ...paths]);
  assert.equal(await race.verify(response('gitStage', paths)), null);
  await f.git(['reset', '--quiet', 'HEAD', '--', ...paths]);
  const outside = await f.prepare('gitStage', { paths });
  await writeFile(path.join(f.project, 'outside.txt'), 'unexpected other staged file\n'); await f.git(['add', '--', ...paths, 'outside.txt']);
  assert.equal(await outside.verify(response('gitStage', paths)), null);
  const unstage = await f.prepare('gitUnstage', { paths });
  await writeFile(path.join(f.project, paths[0]), 'changed while unstage pending\n'); await f.git(['reset', '--quiet', 'HEAD', '--', ...paths]);
  assert.equal(await unstage.verify(response('gitUnstage', paths)), null);
});

test('index contents are checked even when response echoes the exact requested path list', async t => {
  const f = await fixture(t), paths = ['ordinary.txt'];
  await writeFile(path.join(f.project, paths[0]), 'exact requested new blob\n');
  const effect = await f.prepare('gitStage', { paths });
  // Stage a different older content, then restore the requested worktree bytes.
  await writeFile(path.join(f.project, paths[0]), 'wrong staged blob\n'); await f.git(['add', '--', ...paths]);
  await writeFile(path.join(f.project, paths[0]), 'exact requested new blob\n');
  assert.equal(await effect.verify(response('gitStage', paths)), null);
});

test('commit requires an independently observed parent, prepared index tree and intended message', async t => {
  const f = await fixture(t), message = 'Verified isolated commit\n\nSecond paragraph.';
  await writeFile(path.join(f.project, 'ordinary.txt'), 'committed prepared tree\n'); await f.git(['add', '--', 'ordinary.txt']);
  const before = await f.git(['rev-parse', 'HEAD']), effect = await f.prepare('gitCommit', { message });
  await f.git(['commit', '--quiet', '-m', message]); const after = await f.git(['rev-parse', 'HEAD']);
  const result = await effect.verify(output({ ok: true, committed: true, headBefore: before, headAfter: after }));
  assert.ok(result); assert.equal(result.target.commitOid, after); assert.equal(result.target.beforeOid, before);
});

for (const mismatch of ['not executed', 'tree', 'parent', 'message']) {
  test(`commit rejects a success-shaped reply with ${mismatch} mismatch`, async t => {
    const f = await fixture(t), message = 'Expected isolated message';
    await writeFile(path.join(f.project, 'ordinary.txt'), 'expected commit content\n'); await f.git(['add', '--', 'ordinary.txt']);
    const before = await f.git(['rev-parse', 'HEAD']), effect = await f.prepare('gitCommit', { message });
    if (mismatch === 'tree') { await writeFile(path.join(f.project, 'outside.txt'), 'extra commit tree entry\n'); await f.git(['add', '--', 'outside.txt']); }
    if (mismatch === 'parent') await f.git(['commit', '--quiet', '-m', 'Intermediate parent']);
    if (mismatch !== 'not executed') await f.git(['commit', '--quiet', '--allow-empty', '-m', mismatch === 'message' ? 'Another actual message' : message]);
    const after = await f.git(['rev-parse', 'HEAD']);
    assert.equal(await effect.verify(output({ ok: true, committed: true, headBefore: before, headAfter: after })), null);
  });
}
