import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, writeFile, stat, symlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { freezeAdapter, OUTPUT_BASE } from './freeze-adapter.mjs';
import { createStdioAdapter } from './stdio.mjs';
import { createExecutor } from './companion.mjs';
import { Journal } from './journal.mjs';
import { WriteLedger } from './write-ledger.mjs';
import { requestHash, digest } from './protocol.mjs';
import { createSessionProjectResolver } from '../upstream-port/session-project.mjs';
import { classifyEndpoint } from '../upstream-port/rpc-endpoints.mjs';

const run = promisify(execFile);
const thread = '01a1b180-89f8-7291-beb2-43f569f3709c';
const mainRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const request = id => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'deck_current_project', arguments: {}, _meta: { threadId: thread } } });
const job = value => ({ version: 1, operationId: digest(JSON.stringify(value)), fingerprint: requestHash(value), expiresAt: Date.now() + 15000, request: value });
async function fixture(t) {
  await mkdir(OUTPUT_BASE, { recursive: true });
  const root = await realpath(await mkdtemp(path.join(OUTPUT_BASE, 'tracker-project-read-'))), cleanups = [];
  t.after(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    const actual = await realpath(root), parent = await realpath(OUTPUT_BASE);
    assert.equal(path.dirname(actual).toLowerCase(), parent.toLowerCase());
    assert.ok(path.basename(actual).startsWith('tracker-project-read-'));
    await rm(actual, { recursive: true, maxRetries: 10, retryDelay: 100 });
  });
  const a = path.join(root, 'a'), b = path.join(root, 'b'), home = path.join(root, 'codex'), user = path.join(root, 'user');
  await Promise.all([a, b, home, user].map(folder => mkdir(folder)));
  const database = new DatabaseSync(path.join(home, 'state_5.sqlite'));
  database.exec('CREATE TABLE threads (id TEXT PRIMARY KEY,cwd TEXT,rollout_path TEXT); CREATE TABLE project_roots (project_id TEXT,position INTEGER,path TEXT);');
  database.prepare('INSERT INTO threads VALUES (?,?,NULL)').run(thread, a);
  const roots = database.prepare('INSERT INTO project_roots VALUES (?,0,?)'); roots.run('a', a); roots.run('b', b);
  cleanups.push(() => database.close());
  const candidate = await freezeAdapter({ sourceRoot: mainRoot, outputRoot: path.join(root, 'candidate') });
  const env = {};
  for (const key of ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP']) if (process.env[key]) env[key] = process.env[key];
  Object.assign(env, { CODEX_HOME: home, USERPROFILE: user, HOME: user, APPDATA: path.join(user, 'AppData/Roaming') });
  const open = extra => { const adapter = createStdioAdapter(candidate.adapterPath, { env: { ...env, ...extra } }); cleanups.push(() => adapter.close()); return adapter; };
  return { root, a, b, database, candidate, env, open, cleanup: callback => cleanups.push(callback) };
}

test('current-project diagnostic cannot cache another project under the first locally resolved owner', { timeout: 20000 }, async t => {
  const f = await fixture(t), adapter = f.open(), journal = new Journal(path.join(f.root, 'journal.sqlite'));
  f.cleanup(() => journal.close());
  let move = true;
  const execute = createExecutor({ adapter: { async request(value, context) {
    if (move) { move = false; f.database.prepare('UPDATE threads SET cwd=? WHERE id=?').run(f.b, thread); }
    return adapter.request(value, context);
  } }, journal, pairingId: 'read-diagnostic-fixture', resolveProject: createSessionProjectResolver({ codexHome: path.join(f.root, 'codex') }),
    isReadMethod: (method, payload) => classifyEndpoint(method, payload) === 'read' });
  const operation = job(request(1));
  const changed = await execute(operation);
  assert.equal(changed.result?.isError, true, JSON.stringify(changed));
  assert.match(changed.result.content[0].text, /Project changed before local dispatch/);
  assert.equal(JSON.stringify(changed).toLowerCase().includes(f.b.toLowerCase().replaceAll('\\', '\\\\')), false);
  f.database.prepare('UPDATE threads SET cwd=? WHERE id=?').run(f.a, thread);
  const cached = await execute(operation);
  assert.equal(cached.result?.isError, true);
  assert.equal(cached.result.structuredContent, undefined, 'only the refusal, never B, was cached for A');
  const fresh = await execute(job(request(2)));
  assert.equal(fresh.result.structuredContent.projectRoot.toLowerCase(), f.a.toLowerCase());
});

test('explicit existing local data root uses joined paths and invalid local overrides never create a new data directory', { timeout: 20000 }, async t => {
  const f = await fixture(t), data = path.join(f.root, 'local-data'); await mkdir(data);
  await writeFile(path.join(data, 'seed-marker'), 'owned fixture, not a production activation\n');
  const adapter = f.open({ DECK_LOCAL_DATA_ROOT: data });
  const response = await adapter.request(request(1), { projectRoot: f.a, threadId: thread });
  assert.equal(response.result.structuredContent.projectRoot.toLowerCase(), f.a.toLowerCase());
  const cwd = await adapter.request({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: {
    name: 'deck_upstream_read', arguments: { method: 'cwd', payload: { expectedThreadId: thread } }, _meta: { threadId: thread },
  } }, { projectRoot: f.a, threadId: thread });
  assert.equal(cwd.result.structuredContent.value.workspaceRoot.toLowerCase(), f.a.toLowerCase());
  assert.ok((await stat(path.join(data, 'host-context-captures.json'))).isFile());
  assert.ok((await stat(path.join(data, 'projects'))).isDirectory());
  await assert.rejects(stat(data + 'host-context-captures.json'), { code: 'ENOENT' });
  const missing = path.join(f.root, 'missing-data');
  for (const value of ['relative-root', '', missing]) {
    await assert.rejects(run(process.execPath, [f.candidate.adapterPath], { env: { ...f.env, DECK_LOCAL_DATA_ROOT: value }, windowsHide: true, timeout: 5000 }), error => error.code === 1);
  }
  await assert.rejects(stat(missing), { code: 'ENOENT' });
  const redirected = path.join(f.root, 'redirected-data');
  await symlink(data, redirected, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(run(process.execPath, [f.candidate.adapterPath], { env: { ...f.env, DECK_LOCAL_DATA_ROOT: redirected }, windowsHide: true, timeout: 5000 }), error => error.code === 1 && /must not redirect/.test(error.stderr));
});

test('executor accepts tracker facts only from local preparation and never lets them replace the verified project owner', { timeout: 15000 }, async t => {
  const f = await fixture(t);
  const cases = [
    { name: 'prepared', context: { tracker: { backendId: 'github', repository: 'fixture/a' } }, expected: 'fixture/a' },
    { name: 'remote-only', context: undefined, expected: undefined },
    { name: 'project-override', context: { tracker: { backendId: 'github', repository: 'fixture/a' }, projectRoot: f.b }, rejected: true },
    { name: 'invalid-repo', context: { tracker: { backendId: 'github', repository: 'invalid owner/repo' } }, rejected: true },
  ];
  for (const entry of cases) {
    const journal = new Journal(path.join(f.root, entry.name + '-journal.sqlite'));
    const ledger = new WriteLedger(path.join(f.root, entry.name + '-ledger.sqlite'));
    f.cleanup(() => journal.close()); f.cleanup(() => ledger.close());
    let seen;
    const execute = createExecutor({ adapter: { request(value, context) {
      seen = context; return Promise.resolve({ jsonrpc: '2.0', id: value.id, result: { structuredContent: { ok: true } } });
    } }, journal, writeLedger: ledger, pairingId: 'local-context-' + entry.name,
      writeGrant: { enabled: true, projectRoots: [f.a], methods: ['bind'] },
      resolveProject: async () => ({ projectRoot: f.a, associated: true, threadId: thread }),
      isReadMethod: () => false,
      prepareWrite: async () => ({ target: { localStateKey: 'binding' }, verify: async () => null,
        ...(entry.context ? { dispatchContext: entry.context } : {}) }),
    });
    const value = { jsonrpc: '2.0', id: entry.name, method: 'tools/call', _deckLocalDispatch: { projectRoot: f.b }, params: {
      name: 'deck_upstream_write', arguments: { method: 'bind', payload: { backendId: 'github', expectedThreadId: thread,
        dispatchContext: { tracker: { backendId: 'github', repository: 'fixture/b' }, projectRoot: f.b } } }, _meta: { threadId: thread },
    } };
    const response = await execute(job(value)); await execute.drain();
    if (entry.rejected) {
      assert.equal(response.error.data.state, 'not-executed', entry.name); assert.equal(seen, undefined, entry.name);
    } else {
      assert.equal(response.error.data.state, 'unknown', 'unit adapter does not certify a business effect');
      assert.equal(seen.projectRoot.toLowerCase(), f.a.toLowerCase()); assert.equal(seen.threadId, thread);
      assert.equal(seen.tracker?.repository, entry.expected);
    }
  }
});
