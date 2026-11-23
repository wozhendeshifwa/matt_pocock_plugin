import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, stat, unlink, writeFile, utimes } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createExecutor } from './companion.mjs';
import { createStdioAdapter } from './stdio.mjs';
import { createWriteEffects } from './write-effects.mjs';
import { createLocalWriteEffects } from './write-effects-local.mjs';
import { Journal } from './journal.mjs';
import { WriteLedger } from './write-ledger.mjs';
import { digest, requestHash } from './protocol.mjs';
import { verifyFrozenAdapter, OVERLAY_VERSION } from './freeze-adapter.mjs';
import { createSessionProjectResolver } from '../upstream-port/session-project.mjs';
import { classifyEndpoint } from '../upstream-port/rpc-endpoints.mjs';
import { resolveExecutable } from '../upstream-port/executables.mjs';

const run = promisify(execFile);
const A = '01a1b180-89f8-7291-beb2-43f569f3709c';
const A2 = '01a1b180-89f8-7291-beb2-43f569f3709d';
const B = '01a1b180-89f8-7291-beb2-43f569f3709e';
const METHODS = ['bind', 'logSetSwitch', 'logClear', 'cancelNewSessionWatcher', 'handoffResolve'];
const normalized = value => process.platform === 'win32' ? value.toLowerCase() : value;
const valueOf = response => response?.result?.structuredContent?.value ?? response?.result?.structuredContent;
const jobOf = request => ({ version: 1, operationId: digest(JSON.stringify(request)), deliveryId: randomUUID(),
  fingerprint: requestHash(request), expiresAt: Date.now() + 90000, request });

async function fixture(t) {
  const base = fileURLToPath(new URL('../../.scratch/', import.meta.url));
  await mkdir(base, { recursive: true });
  const directory = await realpath(await mkdtemp(path.join(base, 'local-write-integration-')));
  const resources = [];
  t.after(async () => {
    const failures = [];
    for (const close of resources.reverse()) { try { await close(); } catch (error) { failures.push(error); } }
    const actual = await realpath(directory), parent = await realpath(base);
    assert.equal(normalized(path.dirname(actual)), normalized(parent));
    assert.ok(path.basename(actual).startsWith('local-write-integration-'));
    await rm(actual, { recursive: true, maxRetries: 10, retryDelay: 100 });
    if (failures.length) throw new AggregateError(failures, 'Isolated local integration cleanup failed');
  });
  const source = process.env.DECK_TEST_ADAPTER_ROOT ?? fileURLToPath(new URL('../../.scratch/frozen-adapter-20261124-log-v3-reviewed/', import.meta.url));
  const manifestBytes = await readFile(path.join(source, 'frozen-adapter.json'));
  const verified = await verifyFrozenAdapter({ directory: source, expectedManifestSha256: digest(manifestBytes) });
  assert.equal(verified.overlayVersion, OVERLAY_VERSION, 'Real write integration must use the current bound-project overlay');
  const runtime = path.join(directory, 'runtime');
  for (const relative of ['prototypes/upstream-port', 'vendor/mattskills-1.8.0-rc.7']) {
    const selected = path.join(source, relative);
    await cp(selected, path.join(runtime, relative), { recursive: true, filter: file => !path.relative(selected, file).split(/[\\/]/).some(part =>
      ['node_modules', '.scratch', '.git'].includes(part) || part === '.env' || part.startsWith('.env.') || part.endsWith('.secret')) });
  }
  const project = path.join(directory, 'project'), other = path.join(directory, 'other-project');
  const codexHome = path.join(directory, 'codex-home'), emptyHome = path.join(directory, 'empty-home'), ghHome = path.join(directory, 'empty-gh');
  for (const folder of [project, other, codexHome, emptyHome, ghHome]) await mkdir(folder);
  const database = new DatabaseSync(path.join(codexHome, 'state_5.sqlite'));
  try {
    database.exec('CREATE TABLE threads(id TEXT PRIMARY KEY,cwd TEXT,rollout_path TEXT,title TEXT); CREATE TABLE project_roots(project_id TEXT,position INTEGER,path TEXT);');
    const insert = database.prepare('INSERT INTO threads VALUES(?,?,NULL,?)');
    insert.run(A, project, 'Existing isolated C-group chat'); insert.run(A2, project, 'Other isolated chat in same project');
    insert.run(B, other, 'Out-of-grant isolated chat');
    const roots = database.prepare('INSERT INTO project_roots VALUES(?,0,?)'); roots.run('local-c', project); roots.run('other', other);
  } finally { database.close(); }
  const git = await resolveExecutable('git'); assert.ok(git);
  const emptyConfig = path.join(directory, 'empty-git-config'); await writeFile(emptyConfig, '');
  const env = {};
  for (const name of ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP']) if (process.env[name]) env[name] = process.env[name];
  Object.assign(env, { CODEX_HOME: codexHome, HOME: emptyHome, USERPROFILE: emptyHome, APPDATA: path.join(emptyHome, 'AppData/Roaming'),
    GH_CONFIG_DIR: ghHome, DECK_GH: process.execPath, DECK_GIT: git, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: emptyConfig,
    GIT_CONFIG_SYSTEM: emptyConfig, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' });
  // No remotes or credentials exist in these repositories. The adapter's gh
  // resolver is explicitly pinned to Node, so it cannot run real gh/auth.
  for (const root of [project, other]) {
    await run(git, ['-C', root, 'init', '--quiet'], { env, windowsHide: true });
    await writeFile(path.join(root, 'sample.txt'), 'Isolated local C-group fixture\n');
    await run(git, ['-C', root, 'add', '--', 'sample.txt'], { env, windowsHide: true });
    await run(git, ['-C', root, '-c', 'user.name=Isolated Test', '-c', 'user.email=test@example.invalid',
      '-c', 'core.hooksPath=' + ghHome, 'commit', '--quiet', '-m', 'isolated fixture'], { env, windowsHide: true });
    assert.equal((await run(git, ['-C', root, 'remote'], { env, windowsHide: true })).stdout, '');
  }
  const journal = new Journal(path.join(directory, 'pair-journal.sqlite')); resources.push(() => journal.close());
  const ledgerFile = path.join(directory, 'installation-write-ledger.sqlite');
  const ledger = new WriteLedger(ledgerFile); resources.push(() => ledger.close());
  const adapterPath = path.join(runtime, 'prototypes/upstream-port/sidebar-server.mjs');
  const effects = await createWriteEffects({ adapterPath, env });
  const local = await createLocalWriteEffects({ adapterPath });
  const resolveProject = createSessionProjectResolver({ codexHome });
  const pairingId = 'isolated-c-pair';
  const scope = { pairingId, threadId: A, projectRoot: normalized(await realpath(project)) };
  let raw, execute, completionFault, dispatches = 0, sequence = 0;
  const replies = [];
  async function restart() {
    if (execute) await execute.drain();
    await raw?.close();
    raw = createStdioAdapter(adapterPath, { env });
    const adapter = { request: (request, context) => raw.request(request, context), beginRequest(request, context) {
      dispatches++;
      const call = raw.beginRequest(request, context);
      const completion = call.completion.then(async response => {
        replies.push({ method: request.params.arguments?.method, response });
        // Test-local external-state fault, after the real port returned. The
        // original response and adapter source remain unmodified.
        await completionFault?.({ request, response });
        return response;
      });
      return { response: call.response, completion };
    } };
    execute = createExecutor({ adapter, journal, writeLedger: ledger, resolveProject, pairingId,
      isReadMethod: (method, payload) => classifyEndpoint(method, payload) === 'read',
      writeGrant: { enabled: true, projectRoots: [project], methods: METHODS }, prepareWrite: effects.prepare, observeRead: effects.observeRead });
  }
  resources.push(async () => { await execute?.drain(); await raw?.close(); });
  await restart();
  function request(method, parameters = {}, { write = true, thread = A } = {}) {
    return { jsonrpc: '2.0', id: ++sequence, method: 'tools/call', params: { name: write ? 'deck_upstream_write' : 'deck_upstream_read',
      arguments: { method, payload: { ...parameters, expectedThreadId: thread } }, _meta: { threadId: thread } } };
  }
  async function read(method, parameters = {}, thread = A) {
    const response = await execute(jobOf(request(method, parameters, { write: false, thread })));
    assert.equal(response.error, undefined, JSON.stringify(response));
    assert.equal(response.result?.isError, undefined, JSON.stringify(response));
    return valueOf(response);
  }
  async function write(method, parameters, outcome = 'succeeded') {
    const job = jobOf(request(method, parameters)), count = dispatches;
    const response = await execute(job);
    const record = ledger.inspect({ operationId: job.operationId, projectKey: scope.projectRoot, ownerScope: scope });
    let disk;
    if (response.error && method === 'bind') {
      const data = await local.dataRootFor(project);
      const { defaultLabelColorsText } = await import(pathToFileURL(path.join(runtime, 'vendor/mattskills-1.8.0-rc.7/lib/tracker/backends/markdown/label-colors.js')).href);
      disk = {};
      for (const [key, file] of [['choices', path.join(data, '.dsh/mattskillsdeck/choices.json')],
        ['workspace', path.join(project, 'docs/agents/workspace.json')], ['colors', path.join(project, 'docs/agents/label-colors.json')]]) {
        const bytes = await readFile(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
        disk[key] = bytes ? { sha256: digest(bytes), value: JSON.parse(bytes.toString('utf8')) } : null;
      }
      disk.defaultColorsSha256 = digest(defaultLabelColorsText());
    }
    assert.equal(response.error, undefined, method + ': ' + JSON.stringify({ response, record, raw: replies.at(-1), disk }));
    assert.equal(record.state, 'completed', method + ': ' + JSON.stringify(record));
    assert.equal(record.outcome, outcome, method + ': ' + JSON.stringify(record));
    assert.equal(dispatches, count + 1, 'A business write is dispatched exactly once');
    return { response, value: valueOf(response), record, job };
  }
  async function replay(job) {
    const count = dispatches, response = await execute({ ...job, deliveryId: randomUUID(), expiresAt: Date.now() + 90000 });
    assert.equal(response.error?.code, -32006); assert.equal(dispatches, count, 'A replay must never reach the adapter');
  }
  // Read the actual worker once before preparing file evidence; no synthetic
  // data-root creation substitutes for the real adapter bootstrap.
  assert.equal((await read('logGetSwitch')).ok, true);
  return { directory, project, other, ledger, ledgerFile, local, scope, read, write, replay, restart, request,
    get execute() { return execute; }, get dispatches() { return dispatches; }, replies,
    setCompletionFault(callback) { completionFault = callback; } };
}

test('five local C methods execute through the verified frozen stdio adapter and durable ledger without real gh', { timeout: 120000 }, async t => {
  const f = await fixture(t), data = await f.local.dataRootFor(f.project);
  const enabled = await f.write('logSetSwitch', { enabled: true, sampleRate: 0.25 });
  assert.equal(enabled.value.enabled, true); await f.replay(enabled.job);
  assert.deepEqual(JSON.parse(await readFile(path.join(data, '.dsh-mattskillsdeck-cache/log-switch.json'), 'utf8')), { enabled: true, sampleRate: 0.25 });
  const disabled = await f.write('logSetSwitch', { enabled: false, sampleRate: 0.25 });
  await f.replay(disabled.job);
  const logs = path.join(data, '.dsh-mattskillsdeck-cache/logs'); await mkdir(logs, { recursive: true });
  const log = path.join(logs, '2020-01-01.log'), backup = path.join(f.directory, 'recoverable-log-backup.log');
  await writeFile(log, 'Only a generated local integration log\n'); await cp(log, backup);
  assert.deepEqual(await readFile(backup), await readFile(log));
  const cleared = await f.write('logClear', { date: '2020-01-01' });
  assert.equal(cleared.value.removed, 1); await f.replay(cleared.job);
  await assert.rejects(stat(log), { code: 'ENOENT' });
  assert.equal(await readFile(backup, 'utf8'), 'Only a generated local integration log\n');
  // Restore the generated file from its independent backup to prove recovery.
  await cp(backup, log); assert.deepEqual(await readFile(log), await readFile(backup));

  const github = await f.write('bind', { backendId: 'github' });
  assert.equal(github.value.persisted, true); assert.equal(github.value.workspaceFile.placed, true);
  const workspaceFile = path.join(f.project, 'docs/agents/workspace.json'), workspaceBefore = await readFile(workspaceFile);
  const markdown = await f.write('bind', { backendId: 'markdown' });
  assert.equal(markdown.value.labelColorsFile.placed, true); assert.equal(markdown.value.workspaceFile.reason, 'exists');
  assert.deepEqual(await readFile(workspaceFile), workspaceBefore);
  const choicesFile = path.join(data, '.dsh/mattskillsdeck/choices.json'), choicesBefore = await readFile(choicesFile);
  await f.replay(markdown.job); assert.deepEqual(await readFile(choicesFile), choicesBefore);
  const none = await f.write('bind', { backendId: null }, 'failed');
  assert.equal(none.value.backendId, null); assert.equal(none.value.persisted, false);
  assert.equal(none.record.result.errorKind, 'partial'); await f.replay(none.job);
  assert.deepEqual(await readFile(choicesFile), choicesBefore, 'Explicit-none does not invent persistent upstream support');
  assert.equal((await f.read('selection')).selection.source, 'explicit');

  const handoff = path.join(f.project, '.scratch/handoff'); await mkdir(handoff, { recursive: true });
  const old = '20200101-000000-000-old.md', latest = '20200102-000000-000-latest.MD';
  await writeFile(path.join(handoff, old), '# Generated old handoff\n');
  await writeFile(path.join(handoff, latest), '# Generated latest handoff\n');
  await utimes(path.join(handoff, old), new Date(1000), new Date(1000));
  const resolved = await f.write('handoffResolve', { name: '20200102*' });
  assert.equal(resolved.value.file, latest); await f.replay(resolved.job);

  const plan = await f.read('namingPlan');
  assert.equal(plan.manual, true); assert.ok(plan.suggestions.length > 0, 'The existing temporary Codex record yields an original manual suggestion');
  const suggestion = plan.suggestions[0], cancelled = await f.write('cancelNewSessionWatcher', { suggestionId: suggestion.id });
  assert.equal(cancelled.value.cancelled, true); await f.replay(cancelled.job);
  assert.equal(JSON.parse(await readFile(path.join(data, 'manual-naming.json'), 'utf8'))[A].cancelled, suggestion.id);
  assert.deepEqual((await f.read('namingPlan')).suggestions, []);

  await f.restart();
  const switchOnDisk = JSON.parse(await readFile(path.join(data, '.dsh-mattskillsdeck-cache/log-switch.json'), 'utf8'));
  const firstRestartSwitch = await f.read('logGetSwitch'), secondRestartSwitch = await f.read('logGetSwitch');
  t.diagnostic('Actual restart log state: ' + JSON.stringify({ onDisk: switchOnDisk, first: firstRestartSwitch, second: secondRestartSwitch }));
  assert.deepEqual((await f.read('namingPlan')).suggestions, [], 'Manual cancellation survives a real worker restart');
  const detection = await f.read('detect');
  assert.equal(detection.selection.backendId, 'markdown', 'The original detection pipeline recovers the previous disk choice instead of inventing persistent null');
  await f.replay(cancelled.job);
  const reopened = new WriteLedger(f.ledgerFile);
  try { assert.equal(reopened.inspect({ operationId: cancelled.job.operationId, projectKey: f.scope.projectRoot, ownerScope: f.scope }).outcome, 'succeeded'); }
  finally { reopened.close(); }

  const count = f.dispatches;
  const deniedRead = await f.execute(jobOf(f.request('logSetSwitch', { enabled: true }, { write: false })));
  assert.match(deniedRead.error.message, /read route/);
  const deniedProject = await f.execute(jobOf(f.request('logSetSwitch', { enabled: true }, { thread: B })));
  assert.match(deniedProject.error.message, /project.*granted/i);
  assert.equal(f.dispatches, count, 'Read-route and out-of-grant negatives do not dispatch a business write');

  // This exact original false branch returns before update(). Unchanged disk
  // proves a known rejected no-op; it must not permanently block the project.
  const manualBefore = await readFile(path.join(data, 'manual-naming.json'));
  const missing = await f.write('cancelNewSessionWatcher', { suggestionId: '0'.repeat(24) }, 'failed');
  assert.deepEqual(missing.value, { ok: true, cancelled: false });
  assert.equal(missing.record.result.errorKind, 'rejected');
  assert.deepEqual(await readFile(path.join(data, 'manual-naming.json')), manualBefore);
  await f.replay(missing.job);
  const next = jobOf(f.request('logSetSwitch', { enabled: true, sampleRate: 0.25 }, { thread: A2 }));
  const nextResponse = await f.execute(next);
  assert.equal(nextResponse.error, undefined, JSON.stringify(nextResponse));
  const nextRecord = f.ledger.inspect({ operationId: next.operationId, projectKey: f.scope.projectRoot, ownerScope: { ...f.scope, threadId: A2 } });
  assert.equal(nextRecord.state, 'completed'); assert.equal(nextRecord.outcome, 'succeeded');
  assert.equal(f.dispatches, count + 2, 'The no-op executes once and a new operation in another chat remains allowed');
  assert.deepEqual(switchOnDisk, { enabled: false, sampleRate: 0.25 });
  assert.deepEqual(firstRestartSwitch, { ok: true, enabled: false, sampleRate: 0.25 }, 'The original worker must recover the persisted log state on its first read');
  assert.deepEqual(secondRestartSwitch, firstRestartSwitch);
  t.diagnostic('Verified five local methods, original explicit-none partial terminal, worker restart and durable replay protection; no window was opened.');
});

test('real cancelled true with lost or cross-thread disk evidence retains the project barrier', { timeout: 120000 }, async t => {
  for (const fault of ['lost-write', 'cross-thread']) {
    await t.test(fault, async t => {
      const f = await fixture(t), data = await f.local.dataRootFor(f.project);
      const suggestion = (await f.read('namingPlan')).suggestions[0]; assert.ok(suggestion);
      const file = path.join(data, 'manual-naming.json');
      let triggered = false;
      f.setCompletionFault(async ({ request, response }) => {
        if (request.params.arguments?.method !== 'cancelNewSessionWatcher') return;
        assert.equal(valueOf(response).cancelled, true, 'Fault injection follows a genuine original successful cancellation');
        triggered = true;
        await cp(file, path.join(f.directory, 'recoverable-manual-naming.json'));
        if (fault === 'lost-write') await unlink(file);
        else await writeFile(file, JSON.stringify({ [A2]: { cancelled: suggestion.id } }));
      });
      const job = jobOf(f.request('cancelNewSessionWatcher', { suggestionId: suggestion.id }));
      const response = await f.execute(job);
      assert.equal(triggered, true); assert.equal(valueOf(f.replies.at(-1).response).cancelled, true);
      assert.equal(response.error?.code, -32004);
      const record = f.ledger.inspect({ operationId: job.operationId, projectKey: f.scope.projectRoot, ownerScope: f.scope });
      assert.equal(record.state, 'unknown'); assert.equal(record.outcome, undefined);
      const count = f.dispatches;
      await f.replay(job);
      const blocked = await f.execute(jobOf(f.request('logSetSwitch', { enabled: true }, { thread: A2 })));
      assert.equal(blocked.error.data.reason, 'PROJECT_WRITE_UNRESOLVED'); assert.equal(f.dispatches, count);
      assert.equal((await f.read('logGetSwitch')).ok, true, 'Read-only inspection remains available during an unresolved write');
    });
  }
});

test('frozen primary and fallback log stores share an unfinished initial load before reads or new writes', { timeout: 15000 }, async t => {
  const base = fileURLToPath(new URL('../../.scratch/', import.meta.url)); await mkdir(base, { recursive: true });
  const directory = await realpath(await mkdtemp(path.join(base, 'local-log-load-race-')));
  t.after(async () => {
    const actual = await realpath(directory), parent = await realpath(base);
    assert.equal(normalized(path.dirname(actual)), normalized(parent)); assert.ok(path.basename(actual).startsWith('local-log-load-race-'));
    await rm(actual, { recursive: true, maxRetries: 5, retryDelay: 100 });
  });
  const source = process.env.DECK_TEST_ADAPTER_ROOT ?? fileURLToPath(new URL('../../.scratch/frozen-adapter-20261124-log-v3-reviewed/', import.meta.url));
  for (const relative of ['lib/logPkg/store.js', 'lib/logStore.js']) {
    await t.test(relative, async () => {
      const { createLogStore } = await import(pathToFileURL(path.join(source, 'vendor/mattskills-1.8.0-rc.7', relative)).href);
      const data = path.join(directory, relative.includes('logPkg') ? 'primary' : 'fallback'); await mkdir(data);
      const file = path.join(data, 'log-switch.json'); await writeFile(file, JSON.stringify({ enabled: true, sampleRate: 0.25 }));
      let release, started, writesBeforeRelease = 0, released = false;
      const blocked = new Promise(resolve => { release = () => { released = true; resolve(); }; });
      const readStarted = new Promise(resolve => { started = resolve; });
      const owned = target => { assert.equal(normalized(path.resolve(target)), normalized(path.resolve(file))); return target; };
      const fs = { resolve: async value => owned(value), readText: async target => {
        const text = await readFile(owned(target), 'utf8'); started(); await blocked; return text;
      }, writeText: async (target, text) => { if (!released) writesBeforeRelease++; await writeFile(owned(target), text); } };
      const store = createLogStore({ fs, timer: { timeout: () => 0 }, getCacheDir: async () => data, getPlatform: async () => ({ path, fs }) });
      const first = store.loadSwitch(); await readStarted;
      let earlyRead = false;
      const concurrent = store.loadSwitch().then(value => { earlyRead = true; return value; });
      const write = store.setSwitch(false, 0.75);
      await new Promise(resolve => setImmediate(resolve));
      const answeredBeforeReadCompleted = earlyRead, writesBeforeReadCompleted = writesBeforeRelease;
      release();
      const [loaded, observed, written] = await Promise.all([first, concurrent, write]);
      assert.deepEqual(loaded, { enabled: true, sampleRate: 0.25 });
      assert.equal(answeredBeforeReadCompleted, false, 'A second caller must await the actual initial disk read');
      assert.equal(writesBeforeReadCompleted, 0, 'A new setting must wait for the pending initial read, preventing late overwrite');
      assert.deepEqual(observed, { enabled: true, sampleRate: 0.25 });
      assert.deepEqual(written, { enabled: false, sampleRate: 0.75 });
      assert.deepEqual(store.getSwitchState(), { enabled: false, sampleRate: 0.75 });
      assert.deepEqual(await store.loadSwitch(), { enabled: false, sampleRate: 0.75 }, 'A shared initialization promise must not cache an obsolete state value');
      assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { enabled: false, sampleRate: 0.75 });
    });
  }
});
