import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createMarkdownWriteEffects } from './write-effects-markdown.mjs';
import { createWriteEffects } from './write-effects.mjs';
import { resolveExecutable } from '../upstream-port/executables.mjs';
import { digest } from './protocol.mjs';

const run = promisify(execFile), threadId = '01a1b180-89f8-7291-beb2-43f569f3709c';
const relative = 'docs/agents/label-colors.json';
const wrap = (id, value) => ({ jsonrpc: '2.0', id, result: { structuredContent: { ok: true, value } } });
const request = changes => ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'deck_upstream_write', arguments: {
  method: 'setLabelColors', payload: { changes, backendId: 'markdown', expectedThreadId: threadId },
}, _meta: { threadId } } });

async function fixture(t) {
  const base = fileURLToPath(new URL('../../.scratch/', import.meta.url)); await fs.mkdir(base, { recursive: true });
  const directory = await fs.realpath(await fs.mkdtemp(path.join(base, 'markdown-effects-test-')));
  t.after(async () => {
    const actual = await fs.realpath(directory), parent = await fs.realpath(base);
    assert.equal(path.dirname(actual).toLowerCase(), parent.toLowerCase()); assert.ok(path.basename(actual).startsWith('markdown-effects-test-'));
    await fs.rm(actual, { recursive: true, maxRetries: 10, retryDelay: 100 });
  });
  const project = path.join(directory, 'Project'), other = path.join(directory, 'Other'), data = path.join(directory, 'private-data'), fakeHome = path.join(directory, 'home'), hooks = path.join(directory, 'hooks');
  await Promise.all([project, other, data, fakeHome, hooks].map(value => fs.mkdir(value)));
  const provider = path.join(fakeHome, 'config.toml'); await fs.writeFile(provider, '[model_providers.deepseek]\nname="sentinel"\n');
  const empty = path.join(directory, 'empty-git-config'); await fs.writeFile(empty, '');
  const env = {};
  for (const key of ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP']) if (process.env[key]) env[key] = process.env[key];
  Object.assign(env, { USERPROFILE: fakeHome, HOME: fakeHome, APPDATA: path.join(fakeHome, 'AppData/Roaming'),
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: empty, GIT_CONFIG_SYSTEM: empty, GIT_TERMINAL_PROMPT: '0' });
  const binary = await resolveExecutable('git', { env }); assert.ok(binary);
  const git = async args => (await run(binary, ['--literal-pathspecs', '-C', project, '-c', 'core.hooksPath=' + hooks,
    '-c', 'user.name=Isolated Markdown Effects', '-c', 'user.email=markdown@example.invalid', ...args], { env, windowsHide: true, timeout: 15000 })).stdout;
  await git(['init', '--quiet']); await fs.writeFile(path.join(project, 'README.md'), 'initial\n'); await git(['add', '--', 'README.md']); await git(['commit', '--quiet', '-m', 'fixture']);
  await fs.writeFile(path.join(project, 'README.md'), 'unrelated user worktree change\n');
  assert.equal((await git(['remote', '-v'])).trim(), '');
  const runtime = path.join(directory, 'runtime'), vendor = path.join(runtime, 'vendor/mattskills-1.8.0-rc.7');
  const source = fileURLToPath(new URL('../../vendor/mattskills-1.8.0-rc.7/', import.meta.url));
  for (const part of ['lib', 'shared']) await fs.cp(path.join(source, part), path.join(vendor, part), { recursive: true });
  await fs.writeFile(path.join(vendor, 'package.json'), '{"type":"module"}\n');
  const adapterPath = path.join(runtime, 'prototypes/upstream-port/sidebar-server.mjs'); await fs.mkdir(path.dirname(adapterPath), { recursive: true }); await fs.writeFile(adapterPath, '// Isolated entrypoint marker; never executed.\n');
  const mod = name => import(pathToFileURL(path.join(vendor, name)).href);
  await mod('lib/tracker/backends/markdown/index.js');
  const [colors, operations] = await Promise.all([mod('lib/tracker/backends/markdown/label-colors.js'), mod('lib/tracker/backends/markdown/label-colors-ops.js')]);
  const state = { backend: 'markdown', repo: project, workspace: project, session: threadId, dropRename: false }, calls = [];
  const adapter = { async request(value, context) {
    assert.equal(value.params.name, 'deck_context', 'the verifier must not use listLabels to initialize a real file'); assert.equal(context.threadId, threadId);
    calls.push(structuredClone(context));
    return { jsonrpc: '2.0', id: value.id, result: { structuredContent: { ok: true, status: 'ok', tool: 'deck_context',
      workspace: { root: process.platform === 'win32' ? state.workspace.toLowerCase() : state.workspace }, backend: { id: state.backend },
      repo: { backend: state.backend, refId: state.repo, name: 'local fixture', url: '' }, data: { workspace: { sessionId: state.session } } } } };
  } };
  const native = {
    ...fs, resolve: async value => path.resolve(value), readText: file => fs.readFile(file, 'utf8'),
    writeText: async (file, text) => { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, text, 'utf8'); },
    rename: async (from, to) => { if (!state.dropRename) await fs.rename(from, to); },
    listDir: async folder => (await fs.readdir(folder, { withFileTypes: true })).map(entry => ({ name: entry.name })),
  };
  const context = { cwd: project, platform: { os: process.platform, path, fs: native }, fs: native }, repo = { backend: 'markdown', refId: project, path: path.join(project, '.scratch') };
  const effects = await createMarkdownWriteEffects({ adapterPath, localDataRoot: data }), file = path.join(project, relative);
  const prepare = value => effects.prepare({ method: 'setLabelColors', request: value, projectRoot: project, threadId, adapter });
  const call = async value => { const result = await operations.setLabelColors(context, repo, value.params.arguments.payload.changes); return { result, response: wrap(value.id, result.ok ? { ok: true, backendId: 'markdown', ...result.data } : result) }; };
  const seed = async raw => { await fs.mkdir(path.dirname(file), { recursive: true }); const bytes = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 3) + '\n'; await fs.writeFile(file, bytes); return bytes; };
  return { directory, project, other, data, provider, file, state, colors, operations, context, repo, prepare, call, seed, git, calls, adapterPath, adapter, env };
}

test('the launcher factory routes a trusted Markdown palette without requiring GitHub credentials', async t => {
  const f = await fixture(t); await f.seed({ bug: '111111', keep: '222222' });
  const factory = await createWriteEffects({ adapterPath: f.adapterPath, localDataRoot: f.data, env: f.env });
  const value = request([{ name: 'bug', color: 'abcdef' }]);
  const prepared = await factory.prepare({ method: 'setLabelColors', request: value, projectRoot: f.project, threadId, adapter: f.adapter });
  const { response } = await f.call(value); assert.ok(await prepared.verify(response));
  assert.equal(prepared.dispatchContext.tracker.backendId, 'markdown');
  f.state.backend = 'gitlab';
  await assert.rejects(factory.prepare({ method: 'setLabelColors', request: value, projectRoot: f.project, threadId, adapter: f.adapter }), /supported trusted/);
});

test('the original Markdown palette writer is usable and exact readback preserves custom entries and unrelated Git state', async t => {
  const f = await fixture(t), raw = { bug: { color: '111111', description: 'custom user description', notes: { retained: true } }, Custom: 'ABCDEF', unset: '' };
  const before = await f.seed(raw), index = await f.git(['ls-files', '--stage', '-z']);
  const value = request([{ name: 'bug', color: 'A1B2C3' }]), prepared = await f.prepare(value), { result, response } = await f.call(value);
  assert.equal(result.ok, true); assert.deepEqual(result.data.applied, [{ name: 'bug', color: 'a1b2c3' }]);
  const proof = await prepared.verify(response); assert.match(proof?.resultSha256 ?? '', /^[a-f0-9]{64}$/);
  assert.deepEqual(JSON.parse(await fs.readFile(f.file, 'utf8')), { ...raw, bug: { ...raw.bug, color: 'a1b2c3' } });
  assert.equal(await fs.readFile(prepared.backup.file, 'utf8'), before); assert.equal(prepared.backup.sha256, digest(Buffer.from(before)));
  assert.ok(prepared.backup.file.startsWith(path.join(f.data, 'projects') + path.sep));
  assert.deepEqual(prepared.dispatchContext, { tracker: { backendId: 'markdown', repository: f.project } });
  assert.equal(await f.git(['ls-files', '--stage', '-z']), index); assert.equal(await fs.readFile(path.join(f.project, 'README.md'), 'utf8'), 'unrelated user worktree change\n');
  assert.equal(await fs.readFile(f.provider, 'utf8'), '[model_providers.deepseek]\nname="sentinel"\n');
});

test('the one original initialized palette is retained while only the requested default label changes', async t => {
  const f = await fixture(t), listed = await f.operations.listLabels(f.context, f.repo); assert.equal(listed.ok, true);
  const original = f.colors.defaultLabelColorsText(); assert.equal(await fs.readFile(f.file, 'utf8'), original);
  const defaults = JSON.parse(original), name = Object.keys(defaults)[0], value = request([{ name, color: '123456' }]);
  const prepared = await f.prepare(value), { response } = await f.call(value); assert.ok(await prepared.verify(response));
  assert.deepEqual(JSON.parse(await fs.readFile(f.file, 'utf8')), { ...defaults, [name]: '123456' });
  assert.equal(await fs.readFile(prepared.backup.file, 'utf8'), original);
});

test('a silent original rename drop and a forged success envelope never prove a saved palette', async t => {
  const f = await fixture(t), original = await f.seed({ bug: '111111', retain: '222222' }), value = request([{ name: 'bug', color: 'abcdef' }]);
  const prepared = await f.prepare(value); f.state.dropRename = true;
  const { result, response } = await f.call(value); assert.equal(result.ok, false, 'original writer itself rereads the published target');
  assert.equal(await prepared.verify(response), null); assert.equal(await fs.readFile(f.file, 'utf8'), original);
  assert.equal(await prepared.verify(wrap(1, { ok: true, backendId: 'markdown', applied: [{ name: 'bug', color: 'abcdef' }], failed: [] })), null);
});

test('original mixed valid/invalid changes yield a known terminal partial only when every retained byte agrees', async t => {
  const f = await fixture(t), initial = { bug: '111111', retain: { color: '222222', description: 'keep' } }; await f.seed(initial);
  const value = request([{ name: 'bug', color: 'abcdef' }, { name: 'retain', color: 'not-a-color' }]), prepared = await f.prepare(value), { result, response } = await f.call(value);
  assert.equal(result.ok, true); assert.equal(result.data.applied.length, 1); assert.equal(result.data.failed.length, 1);
  const proof = await prepared.verify(response); assert.equal(proof.outcome, 'failed'); assert.equal(proof.result.errorKind, 'partial');
  const tampered = JSON.parse(await fs.readFile(f.file, 'utf8')); tampered.retain.description = 'unrequested edit'; await fs.writeFile(f.file, JSON.stringify(tampered, null, 2) + '\n');
  assert.equal(await prepared.verify(response), null);
});

test('missing palette stays missing and missing names are not silently added or initialized by verification', async t => {
  const f = await fixture(t), value = request([{ name: 'bug', color: 'abcdef' }]), prepared = await f.prepare(value), { result, response } = await f.call(value);
  assert.equal(prepared.backup, null); assert.equal(result.ok, true); assert.equal(result.data.failed.length, 1);
  assert.equal((await prepared.verify(response)).outcome, 'failed'); await assert.rejects(fs.stat(f.file), { code: 'ENOENT' });
  await f.seed({ bug: '111111' }); const absent = request([{ name: 'not-configured', color: 'abcdef' }]), next = await f.prepare(absent), written = await f.call(absent);
  assert.equal((await next.verify(written.response)).outcome, 'failed'); assert.deepEqual(JSON.parse(await fs.readFile(f.file, 'utf8')), { bug: '111111' });
});

test('wrong backend/root/thread and remote authority fields reject before creating backups', async t => {
  const f = await fixture(t); await f.seed({ bug: '111111' });
  for (const change of [
    () => { f.state.backend = 'github'; }, () => { f.state.workspace = f.other; }, () => { f.state.session = '01a1b180-89f8-7291-beb2-43f569f3709d'; },
  ]) {
    change(); await assert.rejects(f.prepare(request([{ name: 'bug', color: 'abcdef' }]))); f.state.backend = 'markdown'; f.state.workspace = f.project; f.state.session = threadId;
  }
  const remote = request([{ name: 'bug', color: 'abcdef' }]); remote.params.arguments.payload.repository = 'other/repo'; await assert.rejects(f.prepare(remote), /parameters/);
  await assert.rejects(fs.stat(path.join(f.data, 'projects')), { code: 'ENOENT' });
});

test('binding drift, different result backend and an unexplained rewrite remain unknown without retry or restore', async t => {
  const f = await fixture(t); await f.seed({ bug: '111111', retain: '222222' });
  const value = request([{ name: 'bug', color: 'abcdef' }]), prepared = await f.prepare(value), { response } = await f.call(value);
  f.state.backend = 'github'; assert.equal(await prepared.verify(response), null); f.state.backend = 'markdown';
  const wrong = structuredClone(response); wrong.result.structuredContent.value.backendId = 'github'; assert.equal(await prepared.verify(wrong), null);
  await fs.writeFile(f.file, '{"bug":"abcdef","retain":"222222"}'); assert.equal(await prepared.verify(response), null, 'formatter bytes are independently checked');
  assert.equal(await fs.readFile(prepared.backup.file, 'utf8'), '{\n   "bug": "111111",\n   "retain": "222222"\n}\n');
});

test('unreadable JSON and duplicate input leave the existing user palette intact', async t => {
  const f = await fixture(t), broken = '{ user-written incomplete file'; await f.seed(broken);
  await assert.rejects(f.prepare(request([{ name: 'bug', color: 'abcdef' }])), /cannot be read/); assert.equal(await fs.readFile(f.file, 'utf8'), broken);
  await f.seed({ bug: '111111' }); await assert.rejects(f.prepare(request([{ name: 'bug', color: 'abcdef' }, { name: 'bug', color: '123456' }])), /handler rejected/);
  await assert.rejects(fs.stat(path.join(f.data, 'projects')), { code: 'ENOENT' });
});

test('an empty change list preserves exact user formatting and keeps distinct recoverable backups', async t => {
  const f = await fixture(t), original = '{ "custom label": {"color":"ABCDEF", "description":"preserve spacing"} }\n'; await f.seed(original);
  const value = request([]), first = await f.prepare(value), second = await f.prepare(value);
  assert.notEqual(first.backup.file, second.backup.file);
  const { result, response } = await f.call(value); assert.deepEqual(result.data, { applied: [], failed: [] });
  assert.ok(await first.verify(response)); assert.equal(await fs.readFile(f.file, 'utf8'), original);
  assert.equal(await fs.readFile(first.backup.file, 'utf8'), original); assert.equal(await fs.readFile(second.backup.file, 'utf8'), original);
});

test('a project palette directory redirected to another local project is rejected before backup or writing', async t => {
  const f = await fixture(t); await fs.mkdir(path.join(f.project, 'docs')); await fs.mkdir(path.join(f.other, 'agents'));
  const outside = path.join(f.other, 'agents', 'label-colors.json'); await fs.writeFile(outside, '{"bug":"111111"}');
  await fs.symlink(path.join(f.other, 'agents'), path.join(f.project, 'docs/agents'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(f.prepare(request([{ name: 'bug', color: 'abcdef' }])), /redirected/);
  assert.equal(await fs.readFile(outside, 'utf8'), '{"bug":"111111"}'); await assert.rejects(fs.stat(path.join(f.data, 'projects')), { code: 'ENOENT' });
});
