import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, cp, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createExecutor, startCompanion } from './companion.mjs';
import { createStdioAdapter } from './stdio.mjs';
import { createRelay } from './relay.mjs';
import { Journal } from './journal.mjs';
import { WriteLedger } from './write-ledger.mjs';
import { normalizeWriteGrant, installationWriteLedgerFile } from './write-grant.mjs';
import { digest, requestHash } from './protocol.mjs';
import { createSessionProjectResolver } from '../upstream-port/session-project.mjs';
import { classifyEndpoint } from '../upstream-port/rpc-endpoints.mjs';
import { resolveExecutable } from '../upstream-port/executables.mjs';
import { createPairing, loadPairing, createRuntimeControl } from './lifecycle.mjs';
import { launchPairing } from './launch.mjs';
import { createWriteEffects } from './write-effects.mjs';

const run = promisify(execFile);
const A = '01a1b180-89f8-7291-beb2-43f569f3709c';
const A2 = '01a1b180-89f8-7291-beb2-43f569f3709d';
const B = '01a1b180-89f8-7291-beb2-43f569f3709e';
const req = (id, name = 'deck_upstream_write', args = { method: 'gitStage', payload: { paths: ['sample.txt'], expectedThreadId: A } }, thread = A) =>
  ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args, _meta: { threadId: thread } } });
const job = request => ({ version: 1, operationId: digest(JSON.stringify(request)), deliveryId: randomUUID(), fingerprint: requestHash(request), expiresAt: Date.now() + 10000, request });
async function until(predicate, limit = 5000) {
  const deadline = Date.now() + limit;
  while (!await predicate()) { if (Date.now() >= deadline) throw new Error('Isolated write condition did not become true'); await new Promise(resolve => setTimeout(resolve, 20)); }
}
async function fixture(t, { realAdapter = false, delayed = false, methods = ['gitStage', 'deck_issue_report'] } = {}) {
  const base = fileURLToPath(new URL('../../.scratch/', import.meta.url)); await mkdir(base, { recursive: true });
  const directory = await realpath(await mkdtemp(path.join(base, 'remote-write-test-')));
  const resources = [];
  t.after(async () => {
    const failures = [];
    for (const cleanup of resources.reverse()) { try { await cleanup(); } catch (error) { failures.push(error); } }
    const actual = await realpath(directory), parent = await realpath(base);
    assert.equal(path.dirname(actual).toLowerCase(), parent.toLowerCase()); assert.ok(path.basename(actual).startsWith('remote-write-test-'));
    await rm(actual, { recursive: true, maxRetries: 10, retryDelay: 100 });
    if (failures.length) throw new AggregateError(failures, 'Isolated write cleanup failed');
  });
  const cleanup = callback => resources.push(callback);
  const projectA = path.join(directory, 'project-a'), projectB = path.join(directory, 'project-b'), home = path.join(directory, 'codex-home');
  await Promise.all([projectA, projectB, home].map(dir => mkdir(dir)));
  const database = new DatabaseSync(path.join(home, 'state_5.sqlite'));
  try {
    database.exec('CREATE TABLE threads (id TEXT PRIMARY KEY,cwd TEXT,rollout_path TEXT); CREATE TABLE project_roots (project_id TEXT,position INTEGER,path TEXT);');
    const threads = database.prepare('INSERT INTO threads VALUES (?,?,NULL)');
    threads.run(A, projectA); threads.run(A2, projectA); threads.run(B, projectB);
    const roots = database.prepare('INSERT INTO project_roots VALUES (?,0,?)'); roots.run('a', projectA); roots.run('b', projectB);
  } finally { database.close(); }
  const journal = new Journal(path.join(directory, 'pair-a-journal.sqlite')); cleanup(() => journal.close());
  const ledgerFile = path.join(directory, 'installation-write-ledger.sqlite');
  const writeLedger = new WriteLedger(ledgerFile); cleanup(() => writeLedger.close());
  const grant = { enabled: true, projectRoots: [projectA], methods };
  let effects;
  const resolveProject = createSessionProjectResolver({ codexHome: home });
  const executor = (adapter, { pairingId = 'trial-pair-a', journal: pairJournal = journal, writeLedger: ledger = writeLedger, writeGrant = grant, prepareWrite } = {}) => {
    const execute = createExecutor({ adapter, journal: pairJournal, writeLedger: ledger, writeGrant, resolveProject, pairingId,
      isReadMethod: (method, payload) => classifyEndpoint(method, payload) === 'read',
      prepareWrite: prepareWrite ?? effects?.prepare ?? (async ({ method, request }) => method === 'gitStage'
        ? { target: { paths: request.params.arguments?.payload?.paths }, verify: async () => null } : null),
      observeRead: effects?.observeRead });
    cleanup(() => execute.drain()); return execute;
  };
  let adapter, git, env;
  if (realAdapter) {
    git = await resolveExecutable('git'); assert.ok(git);
    const gitConfig = path.join(directory, 'empty-git-config'); await writeFile(gitConfig, '');
    const fakeHome = path.join(directory, 'os-home'), gh = path.join(directory, 'gh-config'); await Promise.all([fakeHome, gh].map(dir => mkdir(dir)));
    env = {};
    for (const key of ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP']) if (process.env[key]) env[key] = process.env[key];
    Object.assign(env, { CODEX_HOME: home, USERPROFILE: fakeHome, HOME: fakeHome, APPDATA: path.join(fakeHome, 'AppData/Roaming'),
      GH_CONFIG_DIR: gh, DECK_GIT: git, DECK_GH: process.execPath, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_SYSTEM: gitConfig });
    Object.assign(env, { GIT_AUTHOR_NAME: 'Isolated Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Isolated Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' });
    for (const project of [projectA, projectB]) {
      await run(git, ['-C', project, 'init', '--quiet'], { env, windowsHide: true });
      await writeFile(path.join(project, 'sample.txt'), 'initial\n');
      await run(git, ['-C', project, 'add', '--', 'sample.txt'], { env, windowsHide: true });
      await run(git, ['-C', project, '-c', 'user.name=Isolated Test', '-c', 'user.email=test@example.invalid', '-c', 'core.hooksPath=' + gh, 'commit', '--quiet', '-m', 'fixture'], { env, windowsHide: true });
      await writeFile(path.join(project, 'sample.txt'), 'isolated trial change\n');
    }
    const source = process.env.DECK_TEST_ADAPTER_ROOT || fileURLToPath(new URL('../../', import.meta.url));
    const runtime = path.join(directory, 'runtime');
    const filter = file => !file.split(/[\\/]/).some(part => ['node_modules', '.scratch', '.git'].includes(part) || part === '.env' || part.startsWith('.env.') || part.endsWith('.secret'));
    // Select the source directories explicitly. Parent .scratch components are
    // legitimate source locations; exclusion applies inside the copied tree.
    for (const relative of ['prototypes/upstream-port', 'vendor/mattskills-1.8.0-rc.7']) {
      const sourceDirectory = path.join(source, relative);
      await cp(sourceDirectory, path.join(runtime, relative), { recursive: true,
        filter: file => filter(path.relative(sourceDirectory, file)) });
    }
    let adapterFile = path.join(runtime, 'prototypes/upstream-port/sidebar-server.mjs');
    effects = await createWriteEffects({ adapterPath: adapterFile, env });
    if (delayed) {
      const original = adapterFile; adapterFile = path.join(directory, 'delayed-stdio.mjs');
      await writeFile(adapterFile, `import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
const child=spawn(process.execPath,[${JSON.stringify(original)}],{env:process.env,windowsHide:true,stdio:['pipe','pipe','pipe']});
const delayed=new Set();
createInterface({input:process.stdin}).on('line',line=>{const message=JSON.parse(line);if(message.params?.name==='deck_upstream_write'&&message.params?.arguments?.method==='gitStage')delayed.add(message.id);child.stdin.write(line+'\\n');}).on('close',()=>child.stdin.end());
createInterface({input:child.stdout}).on('line',line=>{const message=JSON.parse(line);if(delayed.delete(message.id))setTimeout(()=>process.stdout.write(line+'\\n'),2000);else process.stdout.write(line+'\\n');});
child.stderr.resume(); child.on('exit',()=>process.exit(0));
`);
    }
    adapter = createStdioAdapter(adapterFile, { env, timeout: delayed ? 1500 : 45000, completionTimeout: delayed ? 7000 : 300000 });
    cleanup(() => adapter.close());
  }
  return { directory, projectA, projectB, journal, writeLedger, ledgerFile, resolveProject, grant, executor, cleanup, adapter, git, env,
    async staged(project = projectA) { return (await run(git, ['-C', project, 'diff', '--cached', '--name-only'], { env, windowsHide: true })).stdout.trim(); } };
}

test('local grants require explicit enable plus nonempty absolute project and supported-method allowlists', () => {
  assert.equal(normalizeWriteGrant(undefined), null); assert.equal(normalizeWriteGrant({ enabled: false }), null);
  for (const grant of [{ enabled: true, projectRoots: [], methods: ['gitStage'] }, { enabled: true, projectRoots: ['relative'], methods: ['gitStage'] },
    { enabled: true, projectRoots: [path.resolve('.')], methods: [] }, { enabled: true, projectRoots: [path.resolve('.')], methods: ['setupLayout'] },
    { enabled: 'true', projectRoots: [path.resolve('.')], methods: ['gitStage'] }]) assert.throws(() => normalizeWriteGrant(grant), /policy/);
  const stable = installationWriteLedgerFile(); assert.ok(path.isAbsolute(stable));
  assert.ok(stable.endsWith(path.join('MattSkillsDeck', 'RemoteCompanion', 'write-ledger.sqlite')));
});

test('trial pairing validates the full local grant and revocation still acts when status publication fails', { skip: process.platform !== 'win32', timeout: 10000 }, async t => {
  const f = await fixture(t), file = path.join(f.directory, 'trial-pair.json');
  const config = await createPairing({ file, relayOrigin: 'https://fixture.example.invalid',
    adapterPath: fileURLToPath(new URL('../upstream-port/sidebar-server.mjs', import.meta.url)),
    journalPath: path.join(f.directory, 'trial-pair-cache.sqlite'), deviceToken: randomBytes(32).toString('hex'),
    writeEnabled: true, writeGrant: f.grant });
  assert.equal((await loadPairing(file)).writeEnabled, true);
  assert.deepEqual(config.writeGrant.methods, ['gitStage', 'deck_issue_report']);
  let revoked = 0, stopped = 0;
  const control = await createRuntimeControl(file, { intervalMs: 1000, onRevoke: () => { revoked++; }, onStop: () => { stopped++; } });
  f.cleanup(() => control.close());
  const runtime = file + '.runtime.json', original = JSON.parse(await readFile(runtime, 'utf8'));
  await writeFile(runtime, JSON.stringify({ ...original, instanceId: randomUUID() }));
  await assert.rejects(control.setState('connected'), /ownership changed/);
  assert.equal(stopped, 0, 'inject the publish failure before the first monitor tick');
  await writeFile(file + '.revoked', JSON.stringify({ pairingId: config.pairingId }));
  await until(() => revoked === 1, 4000);
  assert.equal(stopped, 0); assert.equal(revoked, 1, 'optional diagnostics must not swallow revocation');
  await assert.rejects(loadPairing(file), /revoked/);
});

test('launch refuses a write grant for a legacy read-only frozen candidate before taking runtime ownership', { skip: process.platform !== 'win32', timeout: 10000 }, async t => {
  const f = await fixture(t), candidate = path.join(f.directory, 'legacy-frozen');
  await mkdir(path.join(candidate, 'vendor/mattskills-1.8.0-rc.7'), { recursive: true });
  const files = [];
  for (const name of ['sidebar-server.mjs', 'project-worker.mjs', 'snapshot-cache-identity.mjs']) {
    const relative = 'prototypes/upstream-port/' + name, file = path.join(candidate, relative), contents = '// legacy fixture; must never execute\n';
    await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, contents);
    files.push({ path: relative, bytes: Buffer.byteLength(contents), sha256: digest(contents) });
  }
  const manifest = JSON.stringify({ schemaVersion: 1, ready: true, overlayVersion: 'choices-data-root-v1',
    adapterRelativePath: 'prototypes/upstream-port/sidebar-server.mjs', files });
  await writeFile(path.join(candidate, 'frozen-adapter.json'), manifest);
  const pairing = path.join(f.directory, 'legacy-pair.json'), notCreatedLedger = path.join(f.directory, 'must-not-create.sqlite');
  await createPairing({ file: pairing, relayOrigin: 'https://fixture.example.invalid',
    adapterPath: path.join(candidate, 'prototypes/upstream-port/sidebar-server.mjs'), journalPath: path.join(f.directory, 'legacy-cache.sqlite'),
    deviceToken: randomBytes(32).toString('hex'), baseline: { directory: candidate, manifestSha256: digest(manifest) },
    writeEnabled: true, writeGrant: f.grant });
  await assert.rejects(launchPairing(pairing, { writeLedgerFile: notCreatedLedger }), /legacy candidates are read-only/);
  await assert.rejects(readFile(pairing + '.runtime.json'), { code: 'ENOENT' });
  await assert.rejects(readFile(notCreatedLedger), { code: 'ENOENT' });
});

test('real temporary Git staging reuses the original adapter while routing, project and path negatives do not stage', { timeout: 20000 }, async t => {
  const f = await fixture(t, { realAdapter: true }); let dispatches = 0;
  const adapter = { request: (request, context) => f.adapter.request(request, context), beginRequest: (request, context) => { dispatches++; return f.adapter.beginRequest(request, context); } };
  const execute = f.executor(adapter);
  assert.equal(await f.staged(), '');
  assert.ok((await execute(job(req(1, 'deck_upstream_read')))).error);
  assert.ok((await execute(job(req(2, 'deck_upstream_write', { method: 'gitCommit', payload: { message: 'must not commit', expectedThreadId: A } })))).error);
  assert.ok((await execute(job(req(3, 'deck_upstream_write', { method: 'gitStage', payload: { paths: ['sample.txt'], expectedThreadId: B } }, B)))).error);
  assert.match((await execute(job(req(4, 'deck_upstream_write', { method: 'gitStage', payload: { paths: ['sample.txt'], expectedThreadId: A2 } })))).error.message, /thread changed/);
  assert.ok((await execute(job(req(5, 'deck_upstream_write', { method: 'gitStage', payload: { paths: ['../outside.txt'], expectedThreadId: A } })))).error);
  assert.equal(await f.staged(), ''); assert.equal(await f.staged(f.projectB), ''); assert.equal(dispatches, 0);
  const mutation = job(req(6));
  const result = await execute(mutation);
  assert.ok(result.result, JSON.stringify(result));
  assert.equal(await f.staged(), 'sample.txt'); assert.equal(dispatches, 1);
  assert.equal(await readFile(path.join(f.projectA, 'sample.txt'), 'utf8'), 'isolated trial change\n');
  const repeated = await execute(mutation); assert.equal(repeated.error.data.state, 'completed'); assert.equal(dispatches, 1);
  const tools = await execute({ ...job(req(7)), request: { jsonrpc: '2.0', id: 7, method: 'tools/list' }, fingerprint: requestHash({ method: 'tools/list' }) });
  const writeTool = tools.result.tools.find(tool => tool.name === 'deck_upstream_write');
  assert.deepEqual(writeTool.annotations, { readOnlyHint: false, destructiveHint: true }, 'original host approval hints remain intact');
  assert.equal(tools.result.tools.find(tool => tool.name === 'deck_issue_report').annotations.readOnlyHint, false);
});

test('original adapter stage, unstage and ticketed commit complete only after independent Git readback', { timeout: 30000 }, async t => {
  const f = await fixture(t, { realAdapter: true, methods: ['gitStage', 'gitUnstage', 'gitCommit'] });
  const execute = f.executor(f.adapter);
  assert.ok((await execute(job(req(1)))).result);
  const unstage = req(2, 'deck_upstream_write', { method: 'gitUnstage', payload: { paths: ['sample.txt'], expectedThreadId: A } });
  assert.ok((await execute(job(unstage))).result); assert.equal(await f.staged(), '');
  assert.ok((await execute(job(req(3)))).result);
  const missing = req(4, 'deck_upstream_write', { method: 'gitCommit', payload: { message: 'isolated effect commit', ticketId: 'not-a-local-ticket', expectedThreadId: A } });
  const rejected = await execute(job(missing));
  assert.equal(rejected.error.data.state, 'not-executed'); assert.match(rejected.error.message, /precheck/);
  const check = req(5, 'deck_upstream_read', { method: 'gitWriteCheck', payload: { op: 'commit', message: 'isolated effect commit', expectedThreadId: A } });
  const checked = await execute(job(check));
  const ticket = checked.result?.structuredContent?.value?.ticket;
  assert.ok(ticket?.id, JSON.stringify(checked));
  const commit = job(req(6, 'deck_upstream_write', { method: 'gitCommit', payload: {
    message: 'isolated effect commit', ticketId: ticket.id, requestId: 'isolated-commit-1', expectedThreadId: A,
  } }));
  const result = await execute(commit);
  assert.ok(result.result, JSON.stringify(result));
  assert.equal(result.result.structuredContent.value.committed, true);
  assert.equal(await f.staged(), '');
  const head = (await run(f.git, ['-C', f.projectA, 'rev-parse', 'HEAD'], { env: f.env, windowsHide: true })).stdout.trim();
  assert.equal(head, result.result.structuredContent.value.headAfter);
  assert.equal((await execute(commit)).error.data.state, 'completed');
  assert.equal((await run(f.git, ['-C', f.projectA, 'rev-parse', 'HEAD'], { env: f.env, windowsHide: true })).stdout.trim(), head);
  assert.equal(await f.staged(f.projectB), '');
});

test('original adapter pushes, fetches and fast-forwards an isolated local bare repository with captured prechecks', { timeout: 45000 }, async t => {
  const f = await fixture(t, { realAdapter: true, methods: ['gitPush', 'gitFetch', 'gitPull'] });
  const git = (root, args) => run(f.git, ['-C', root, ...args], { env: f.env, windowsHide: true, timeout: 15000 });
  const bare = path.join(f.directory, 'network-fixture.git'); await mkdir(bare);
  await git(bare, ['init', '--bare', '--quiet']);
  await git(f.projectA, ['add', '--', 'sample.txt']); await git(f.projectA, ['commit', '--quiet', '-m', 'fixture local head']);
  await git(f.projectA, ['remote', 'add', 'origin', bare]);
  let localWrite;
  const execute = f.executor({ request: (...args) => f.adapter.request(...args), beginRequest(...args) {
    const call = f.adapter.beginRequest(...args);
    return { response: call.response, completion: call.completion.then(response => { localWrite = response; return response; }) };
  } }); let id = 0;
  async function checkedWrite(method) {
    const checked = await execute(job(req(++id, 'deck_upstream_read', { method: 'gitWriteCheck', payload: { op: method.slice(3).toLowerCase(), expectedThreadId: A } })));
    const ticket = checked.result?.structuredContent?.value?.ticket;
    assert.ok(ticket?.id, JSON.stringify(checked));
    const operation = job(req(++id, 'deck_upstream_write', { method, payload: { ticketId: ticket.id, requestId: 'isolated-network-' + id, expectedThreadId: A } }));
    const response = await execute(operation);
    assert.ok(response.result, JSON.stringify({ response, localWrite }));
    assert.equal(response.result.structuredContent.value.ok, true);
    assert.equal((await execute(operation)).error.data.state, 'completed');
    return response.result.structuredContent.value;
  }
  const pushed = await checkedWrite('gitPush'); assert.equal(pushed.mode, 'set-upstream');
  const branch = (await git(f.projectA, ['symbolic-ref', '--short', 'HEAD'])).stdout.trim();
  const localHead = (await git(f.projectA, ['rev-parse', 'HEAD'])).stdout.trim();
  assert.equal((await git(bare, ['rev-parse', 'refs/heads/' + branch])).stdout.trim(), localHead);
  const peer = path.join(f.directory, 'peer');
  await run(f.git, ['clone', '--quiet', '--', bare, peer], { env: f.env, windowsHide: true, timeout: 15000 });
  await writeFile(path.join(peer, 'sample.txt'), 'isolated remote fast forward\n');
  await git(peer, ['add', '--', 'sample.txt']); await git(peer, ['commit', '--quiet', '-m', 'fixture remote head']);
  await git(peer, ['push', '--quiet', 'origin', 'HEAD']);
  const remoteHead = (await git(bare, ['rev-parse', 'refs/heads/' + branch])).stdout.trim();
  const fetched = await checkedWrite('gitFetch'); assert.equal(fetched.mode, 'fetched');
  assert.equal((await git(f.projectA, ['rev-parse', 'refs/remotes/origin/' + branch])).stdout.trim(), remoteHead);
  assert.equal((await git(f.projectA, ['rev-parse', 'HEAD'])).stdout.trim(), localHead);
  const pulled = await checkedWrite('gitPull'); assert.equal(pulled.mode, 'fast-forward');
  assert.equal((await git(f.projectA, ['rev-parse', 'HEAD'])).stdout.trim(), remoteHead);
  assert.equal(await readFile(path.join(f.projectA, 'sample.txt'), 'utf8'), 'isolated remote fast forward\n');
  assert.equal(await f.staged(f.projectB), '');
});

test('report status cannot prove durable recording and an isError write also leaves a project barrier', async t => {
  const f = await fixture(t); const seen = [];
  const execute = f.executor({ async request(request) { seen.push(request); return { jsonrpc: '2.0', id: request.id,
    result: { content: [{ type: 'text', text: 'recorded' }], structuredContent: { ok: true, status: 'ok', tool: 'deck_issue_report',
      workspace: { root: f.projectA }, backend: { id: 'local' }, repo: { backend: 'local', refId: f.projectA },
      data: { key: '1', backendId: 'local', chain: { recorded: true, count: 1 } } } } }; } });
  const request = req(1, 'deck_issue_report', { key: '1', note: 'isolated' });
  assert.equal((await execute(job(request))).error.data.state, 'unknown', 'recorded:true is still insufficient without durable local readback');
  assert.deepEqual(seen, [request], 'no synthetic confirmation field or extra UI call is added');
  const other = await fixture(t);
  const ambiguous = other.executor({ async request(request) { return { jsonrpc: '2.0', id: request.id, result: { isError: true, content: [{ type: 'text', text: 'backend error after possible side effect' }] } }; } });
  const failed = await ambiguous(job(req(2)));
  assert.equal(failed.error.data.state, 'unknown');
  const blocked = await execute(job(req(3, 'deck_issue_report', { key: '1' }, A2)));
  assert.equal(blocked.error.data.reason, 'PROJECT_WRITE_UNRESOLVED');
});

test('project barrier covers readback preparation and an expired prepared write never dispatches', async t => {
  const f = await fixture(t);
  let enter, release, calls = 0;
  const started = new Promise(resolve => { enter = resolve; });
  const wait = new Promise(resolve => { release = resolve; });
  const execute = f.executor({ async request() { calls++; throw new Error('Expired write must never reach adapter'); } }, {
    async prepareWrite() { enter(); await wait; return { target: { localStateKey: 'session-tickets' }, verify: async () => null }; },
  });
  const value = job(req(1, 'deck_issue_report', { key: '1' })); value.expiresAt = Date.now() + 100;
  const pending = execute(value); await started;
  const another = await execute(job(req(2, 'deck_issue_report', { key: '1' }, A2)));
  assert.equal(another.error.data.reason, 'PROJECT_WRITE_UNRESOLVED'); assert.equal(calls, 0);
  await new Promise(resolve => setTimeout(resolve, 110)); release();
  const expired = await pending;
  assert.equal(expired.error.data.state, 'not-executed'); assert.match(expired.error.message, /expired before/);
  assert.equal(calls, 0);
  const repeated = await execute(value); assert.equal(repeated.error.data.state, 'not-executed');
  const scope = { pairingId: 'trial-pair-a', threadId: A, projectRoot: process.platform === 'win32' ? f.projectA.toLowerCase() : f.projectA };
  const record = f.writeLedger.inspect({ operationId: value.operationId, projectKey: scope.projectRoot, ownerScope: scope });
  assert.equal(record.state, 'completed'); assert.equal(record.outcome, 'failed');
});

test('stdio strips caller spoofing and injects only the trusted local dispatch context', async t => {
  const f = await fixture(t), echo = path.join(f.directory, 'echo-dispatch.mjs');
  await writeFile(echo, "import {createInterface} from 'node:readline'; for await (const line of createInterface({input:process.stdin})) { const request=JSON.parse(line); process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result:{dispatch:request._deckLocalDispatch??null}})+'\\n'); }");
  const adapter = createStdioAdapter(echo); f.cleanup(() => adapter.close());
  const request = { jsonrpc: '2.0', id: 1, method: 'ping', _deckLocalDispatch: { projectRoot: f.projectB, threadId: B } };
  assert.equal((await adapter.request(request)).result.dispatch, null);
  const trusted = { projectRoot: await realpath(f.projectA), threadId: A };
  assert.deepEqual((await adapter.beginRequest(request, trusted).response).result.dispatch, trusted);
});

test('relay timeout and new session/thread/pair cannot replay a real staged write; late stdio completion is queryable', { timeout: 20000 }, async t => {
  const f = await fixture(t, { realAdapter: true, delayed: true }); const execute = f.executor(f.adapter);
  const credentials = { callerToken: randomBytes(32).toString('hex'), deviceToken: randomBytes(32).toString('hex'), sessionSecret: randomBytes(32).toString('hex') };
  const relay = await createRelay({ ...credentials, requestTimeout: 1000, pollTimeout: 20 }); f.cleanup(() => relay.close());
  const origin = `http://127.0.0.1:${relay.port}`;
  let connected = false;
  const companion = startCompanion({ relayOrigin: origin, deviceToken: credentials.deviceToken, execute, allowLoopback: true, retryMs: 1,
    onState: state => { if (state === 'connected') connected = true; } });
  f.cleanup(() => companion.stop()); await until(() => connected);
  async function post(request, session) {
    const response = await fetch(origin + '/mcp', { method: 'POST', headers: { authorization: 'Bearer ' + credentials.callerToken, 'content-type': 'application/json', ...(session ? { 'mcp-session-id': session } : {}) }, body: JSON.stringify(request) });
    return { session: response.headers.get('mcp-session-id'), body: await response.json() };
  }
  const initialize = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } };
  const first = await post(initialize); assert.ok(first.session);
  const outcome = await post(req(2), first.session);
  assert.equal(outcome.body.error.data.state, 'unknown'); const operationId = outcome.body.error.data.operationId;
  const second = await post(initialize); assert.notEqual(second.session, first.session);
  const blocked = await post(req(2, 'deck_upstream_write', { method: 'gitStage', payload: { paths: ['sample.txt'], expectedThreadId: A2 } }, A2), second.session);
  assert.equal(blocked.body.error.data.reason, 'PROJECT_WRITE_UNRESOLVED');
  const pairJournal = new Journal(path.join(f.directory, 'pair-b-journal.sqlite')); f.cleanup(() => pairJournal.close());
  const secondLedger = new WriteLedger(f.ledgerFile); f.cleanup(() => secondLedger.close());
  const newPair = f.executor(f.adapter, { pairingId: 'trial-pair-b', journal: pairJournal, writeLedger: secondLedger });
  assert.equal((await newPair(job(req(99)))).error.data.reason, 'PROJECT_WRITE_UNRESOLVED');
  let status;
  await until(async () => {
    const result = await post(req(100 + Date.now(), 'deck_remote_operation_status', { operationId }), first.session);
    status = result.body.result?.structuredContent;
    return status?.state === 'completed';
  });
  assert.equal(status.outcome, 'succeeded'); assert.equal(await f.staged(), 'sample.txt');
  const foreign = await newPair(job(req(101, 'deck_remote_operation_status', { operationId })));
  assert.equal(foreign.result.structuredContent.state, 'not-found');
  await execute.drain();
});
