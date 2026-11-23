import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, realpath, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { freezeAdapter, OUTPUT_BASE } from './freeze-adapter.mjs';
import { createStdioAdapter } from './stdio.mjs';
import { createExecutor } from './companion.mjs';
import { Journal } from './journal.mjs';
import { WriteLedger } from './write-ledger.mjs';
import { digest, requestHash } from './protocol.mjs';
import { createSessionProjectResolver } from '../upstream-port/session-project.mjs';
import { classifyEndpoint } from '../upstream-port/rpc-endpoints.mjs';
import { resolveExecutable } from '../upstream-port/executables.mjs';
import { createGitWriteEffects } from './write-effects-git.mjs';

const run = promisify(execFile);
const thread = '01a1b180-89f8-7291-beb2-43f569f3709c';
const mainRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const request = id => ({ jsonrpc: '2.0', id, method: 'tools/call', params: {
  name: 'deck_upstream_write', arguments: { method: 'gitStage', payload: { paths: ['sample.txt'], expectedThreadId: thread } },
  _meta: { threadId: thread },
} });
const job = request => ({ version: 1, operationId: digest(JSON.stringify(request)), fingerprint: requestHash(request), expiresAt: Date.now() + 10000, request });

async function fixture(t) {
  await mkdir(OUTPUT_BASE, { recursive: true });
  const root = await realpath(await mkdtemp(path.join(OUTPUT_BASE, 'project-binding-test-')));
  const cleanups = [];
  t.after(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    const actual = await realpath(root), base = await realpath(OUTPUT_BASE);
    assert.equal(path.dirname(actual).toLowerCase(), base.toLowerCase());
    assert.ok(path.basename(actual).startsWith('project-binding-test-'));
    await rm(actual, { recursive: true, maxRetries: 10, retryDelay: 100 });
  });
  const a = path.join(root, 'a'), b = path.join(root, 'b'), home = path.join(root, 'codex'), user = path.join(root, 'user'), gh = path.join(root, 'gh');
  await Promise.all([a, b, home, user, gh].map(dir => mkdir(dir)));
  const git = await resolveExecutable('git'); assert.ok(git);
  const config = path.join(root, 'empty-git-config'); await writeFile(config, '');
  const env = {};
  for (const key of ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP']) if (process.env[key]) env[key] = process.env[key];
  Object.assign(env, { CODEX_HOME: home, USERPROFILE: user, HOME: user, APPDATA: path.join(user, 'AppData/Roaming'),
    GH_CONFIG_DIR: gh, DECK_GIT: git, DECK_GH: process.execPath, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: config, GIT_CONFIG_SYSTEM: config });
  for (const project of [a, b]) {
    await run(git, ['-C', project, 'init', '--quiet'], { env, windowsHide: true });
    await writeFile(path.join(project, 'sample.txt'), 'isolated project binding fixture\n');
  }
  const db = new DatabaseSync(path.join(home, 'state_5.sqlite'));
  db.exec('CREATE TABLE threads (id TEXT PRIMARY KEY,cwd TEXT,rollout_path TEXT); CREATE TABLE project_roots (project_id TEXT,position INTEGER,path TEXT);');
  db.prepare('INSERT INTO threads VALUES (?,?,NULL)').run(thread, a);
  const insert = db.prepare('INSERT INTO project_roots VALUES (?,0,?)'); insert.run('a', a); insert.run('b', b);
  cleanups.push(() => db.close());
  const frozen = await freezeAdapter({ sourceRoot: mainRoot, outputRoot: path.join(root, 'candidate') });
  const stdio = createStdioAdapter(frozen.adapterPath, { env }); cleanups.push(() => stdio.close());
  const journal = new Journal(path.join(root, 'journal.sqlite')); cleanups.push(() => journal.close());
  const ledger = new WriteLedger(path.join(root, 'write-ledger.sqlite')); cleanups.push(() => ledger.close());
  const effects = await createGitWriteEffects({ env });
  const execute = adapter => {
    const execute = createExecutor({ adapter, journal, writeLedger: ledger, pairingId: 'binding-fixture',
      resolveProject: createSessionProjectResolver({ codexHome: home }),
      writeGrant: { enabled: true, projectRoots: [a], methods: ['gitStage'] },
      prepareWrite: ({ method, projectRoot, request }) => effects.prepare({ method, projectRoot, parameters: request.params.arguments?.payload }),
      isReadMethod: (method, payload) => classifyEndpoint(method, payload) === 'read' });
    cleanups.push(() => execute.drain()); return execute;
  };
  const staged = async project => (await run(git, ['-C', project, 'diff', '--cached', '--name-only'], { env, windowsHide: true })).stdout.trim();
  return { a, b, db, stdio, execute, staged, ledger };
}

test('same-thread project change before adapter dispatch leaves both Git projects untouched', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  const execute = f.execute({
    request: (...args) => f.stdio.request(...args),
    beginRequest(value, context) {
      f.db.prepare('UPDATE threads SET cwd=? WHERE id=?').run(f.b, thread);
      return f.stdio.beginRequest(value, context);
    },
  });
  const value = job(request(1));
  const response = await execute(value);
  assert.equal(response.error?.data?.state, 'unknown', JSON.stringify(response));
  assert.equal(await f.staged(f.a), ''); assert.equal(await f.staged(f.b), '');
  assert.equal(f.ledger.inspect({ operationId: value.operationId, projectKey: process.platform === 'win32' ? f.a.toLowerCase() : f.a,
    ownerScope: { pairingId: 'binding-fixture', threadId: thread, projectRoot: process.platform === 'win32' ? f.a.toLowerCase() : f.a } }).state, 'unknown');
});

test('remote project envelope cannot replace the locally verified project binding', { timeout: 20000 }, async t => {
  const f = await fixture(t), execute = f.execute(f.stdio);
  const value = request(1); value._deckLocalDispatch = { projectRoot: f.b, threadId: thread };
  const result = await execute(job(value));
  assert.ok(result.result, JSON.stringify(result));
  assert.equal(await f.staged(f.a), 'sample.txt'); assert.equal(await f.staged(f.b), '');
});

test('frozen adapter rejects business writes without a trusted local dispatch envelope', { timeout: 20000 }, async t => {
  const f = await fixture(t), value = request(1);
  value._deckLocalDispatch = { projectRoot: f.a, threadId: thread };
  const response = await f.stdio.request(value);
  assert.equal(response.result?.isError, true, JSON.stringify(response));
  assert.match(response.result.content[0].text, /Missing verified local dispatch project/);
  assert.equal(await f.staged(f.a), ''); assert.equal(await f.staged(f.b), '');
});
