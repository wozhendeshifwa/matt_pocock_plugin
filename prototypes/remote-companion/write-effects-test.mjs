import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cp, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createWriteEffects } from './write-effects.mjs';
import { createLocalWriteEffects } from './write-effects-local.mjs';
import { createExecutor } from './companion.mjs';
import { Journal } from './journal.mjs';
import { WriteLedger } from './write-ledger.mjs';
import { digest, requestHash } from './protocol.mjs';
import { classifyEndpoint } from '../upstream-port/rpc-endpoints.mjs';
import { resolveExecutable } from '../upstream-port/executables.mjs';
import { createWriteCheck } from '../../vendor/mattskills-1.8.0-rc.7/lib/versionControlCheck.js';

const run = promisify(execFile);
const A = '01a1b180-89f8-7291-beb2-43f569f3709c', A2 = '01a1b180-89f8-7291-beb2-43f569f3709d', B = '01a1b180-89f8-7291-beb2-43f569f3709e';
const repository = { backend: 'github', refId: 'isolated/fixture', name: 'isolated/fixture', url: 'https://github.com/isolated/fixture' };
const folded = value => process.platform === 'win32' ? value.toLowerCase() : value;
const envelope = (id, structuredContent) => ({ jsonrpc: '2.0', id, result: { structuredContent } });
const request = (id, name = 'deck_issue_report', args = { key: '#00038' }, thread = A) => ({
  jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args, _meta: { threadId: thread } },
});
const job = (request, session = 'first') => ({ version: 1, operationId: digest(JSON.stringify({ session, request })),
  fingerprint: requestHash(request), expiresAt: Date.now() + 15000, request });

async function fixture(t) {
  const base = fileURLToPath(new URL('../../.scratch/', import.meta.url)); await mkdir(base, { recursive: true });
  const directory = await realpath(await mkdtemp(path.join(base, 'write-effects-test-'))), cleanups = [];
  t.after(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    const root = await realpath(directory), parent = await realpath(base);
    assert.equal(path.dirname(root).toLowerCase(), parent.toLowerCase()); assert.ok(path.basename(root).startsWith('write-effects-test-'));
    await rm(root, { recursive: true, maxRetries: 10, retryDelay: 100 });
  });
  const project = path.join(directory, 'Project-A'), other = path.join(directory, 'Project-B'), home = path.join(directory, 'home'), hooks = path.join(directory, 'hooks');
  await Promise.all([project, other, home, hooks].map(value => mkdir(value)));
  const config = path.join(directory, 'empty-git-config'); await writeFile(config, '');
  const env = {};
  for (const key of ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP']) if (process.env[key]) env[key] = process.env[key];
  Object.assign(env, { USERPROFILE: home, HOME: home, APPDATA: path.join(home, 'AppData/Roaming'), GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: config, GIT_CONFIG_SYSTEM: config, GIT_TERMINAL_PROMPT: '0' });
  const binary = await resolveExecutable('git', { env }); assert.ok(binary); env.DECK_GIT = binary;
  const git = async (args, root = project) => (await run(binary, ['--literal-pathspecs', '-C', root,
    '-c', 'core.hooksPath=' + hooks, '-c', 'core.autocrlf=false', '-c', 'user.name=Isolated Effects', '-c', 'user.email=effects@example.invalid', ...args],
    { env, windowsHide: true, timeout: 15000, maxBuffer: 4 * 1024 * 1024 })).stdout.trim();
  for (const root of [project, other]) {
    await git(['init', '--quiet'], root); await writeFile(path.join(root, 'sample.txt'), 'initial fixture\n');
    await git(['add', '--', 'sample.txt'], root); await git(['commit', '--quiet', '-m', 'initial fixture'], root);
    await writeFile(path.join(root, 'sample.txt'), 'isolated pending content\n');
  }
  const adapterRoot = path.join(directory, 'Frozen-Runtime'), adapterPath = path.join(adapterRoot, 'prototypes/upstream-port/sidebar-server.mjs');
  const vendor = path.join(adapterRoot, 'vendor/mattskills-1.8.0-rc.7'); await mkdir(path.dirname(adapterPath), { recursive: true });
  await writeFile(adapterPath, '// Isolated path marker; not executed.\n');
  const source = fileURLToPath(new URL('../../vendor/mattskills-1.8.0-rc.7/', import.meta.url));
  for (const relative of ['shared/refresh/chain.js', 'lib/workspaceKey.js', 'lib/refresh/sessionTickets.js']) {
    await mkdir(path.dirname(path.join(vendor, relative)), { recursive: true }); await cp(path.join(source, relative), path.join(vendor, relative));
  }
  await writeFile(path.join(vendor, 'package.json'), '{"type":"module"}\n');
  const [{ createSessionTickets }, { canonicalWorkspaceKey }, chain] = await Promise.all([
    import(pathToFileURL(path.join(vendor, 'lib/refresh/sessionTickets.js')).href),
    import(pathToFileURL(path.join(vendor, 'lib/workspaceKey.js')).href),
    import(pathToFileURL(path.join(vendor, 'shared/refresh/chain.js')).href),
  ]);
  const canonicalKey = root => canonicalWorkspaceKey(root, { getPlatform: () => ({ os: process.platform, path }),
    getFs: () => ({ lstat }), getDefaultCwd: () => root });
  const local = await createLocalWriteEffects({ adapterPath }), effects = await createWriteEffects({ adapterPath, env });
  const state = { failWrite: false, performGit: true, contextMutator: null, checkAt: null }, calls = [], reportWrites = [];
  let checkSequence = 0;
  async function originalCheck(root, args) {
    const check = createWriteCheck({ nowMs: () => state.checkAt ?? Date.now(), randomId: () => 'actual-check-' + ++checkSequence,
      vc: { async readScreenOf(cwd) {
        const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
        const staged = await git(['diff', '--cached', '--name-only'], cwd), unstaged = await git(['diff', '--name-only'], cwd);
        return { ok: true, screen: { identity: { oid: await git(['rev-parse', 'HEAD'], cwd), branch, detached: branch === 'HEAD', worktreePath: cwd },
          repo: { bare: false, merging: false, rebasing: false, cherryPicking: false, reverting: false },
          conflictCount: 0, stagedCount: staged ? staged.split('\n').length : 0, unstagedCount: unstaged ? unstaged.split('\n').length : 0 } };
      } },
      safeGit: { startCall() { return { async run({ args, cwd }) {
        assert.ok(args.includes('ls-files') || args.includes('status'), 'commit precheck runs fixed local read commands only');
        try {
          const out = await run(binary, ['-C', cwd, ...args], { env, windowsHide: true, timeout: 15000, maxBuffer: 8 * 1024 * 1024 });
          return { ok: true, stdout: out.stdout, truncated: false };
        } catch { return { ok: false, kind: 'fixture-read-failed' }; }
      } }; } },
    });
    return check.handleGitWriteCheck({ ...args, cwd: root });
  }
  const adapter = { async request(value, context) {
    calls.push({ name: value.params.name, arguments: structuredClone(value.params.arguments), context: structuredClone(context) });
    const root = context.projectRoot, thread = context.threadId, location = await local.locateReportChain(root);
    if (value.params.name === 'deck_context') {
      const data = { ok: true, status: 'ok', tool: 'deck_context', workspace: { root: location.rootKey, key: 'fixture' },
        backend: { id: 'github', source: 'fixture' }, repo: { ...repository },
        data: { workspace: { root: location.rootKey, sessionId: thread }, repo: { ...repository } } };
      state.contextMutator?.(data); return envelope(value.id, data);
    }
    if (value.params.name === 'deck_issue_report') {
      const writer = createSessionTickets({ cacheDir: path.dirname(location.file), canonicalKey, now: () => Date.now(),
        ...(state.failWrite ? { writeText: async () => { throw new Error('isolated flush fault'); } } : {}) });
      const args = value.params.arguments, key = chain.chainTicketKey(args.key), effortId = chain.chainEffortId(args.effortId);
      const out = await writer.note({ sessionId: thread, rootKey: root, backend: 'github', tool: 'deck_issue_report',
        source: 'tool-args', tier: 'write-confirmed', reason: 'tool.deck-write', verb: 'report', ticketKey: key, effortId, args: { key } });
      reportWrites.push({ out, stats: writer.stats() });
      return envelope(value.id, { ok: true, status: 'ok', tool: 'deck_issue_report', workspace: { root: location.rootKey, key: 'fixture' },
        backend: { id: 'github', source: 'fixture' }, repo: { ...repository },
        data: { key, backendId: 'github', effortId, chain: { recorded: out.recorded } } });
    }
    if (value.params.name === 'deck_upstream_write' && value.params.arguments.method === 'gitStage') {
      const paths = value.params.arguments.payload.paths;
      if (state.performGit) await git(['add', '--', ...paths], root);
      return envelope(value.id, { ok: true, value: { ok: true, staged: paths } });
    }
    if (value.params.name === 'deck_upstream_read' && value.params.arguments.method === 'gitWriteCheck') {
      return envelope(value.id, { ok: true, value: await originalCheck(root, value.params.arguments.payload) });
    }
    throw new Error('Unsupported isolated adapter request');
  } };
  const ledgerFile = path.join(directory, 'installation-ledger.sqlite'), ledgers = [];
  const executor = (pairingId = 'pair-a') => {
    const journal = new Journal(path.join(directory, pairingId + '-journal.sqlite')); cleanups.push(() => journal.close());
    const ledger = new WriteLedger(ledgerFile); ledgers.push(ledger); cleanups.push(() => ledger.close());
    const execute = createExecutor({ adapter, journal, writeLedger: ledger, prepareWrite: effects.prepare, observeRead: effects.observeRead,
      writeGrant: { enabled: true, projectRoots: [project], methods: ['deck_issue_report', 'gitStage'] }, pairingId,
      resolveProject: async meta => ({ threadId: meta.threadId, projectRoot: meta.threadId === B ? other : project, associated: true }),
      isReadMethod: (method, payload) => classifyEndpoint(method, payload) === 'read' });
    cleanups.push(() => execute.drain()); return execute;
  };
  const inspect = (operation, threadId = A, pairingId = 'pair-a') => ledgers[0].inspect({ operationId: operation.operationId,
    projectKey: folded(project), ownerScope: { projectRoot: folded(project), threadId, pairingId } });
  return { project, other, directory, adapterPath, adapter, local, effects, state, calls, reportWrites, git, executor, inspect, originalCheck };
}

test('orchestrated report completes only after original writer flush is independently read from disk', async t => {
  const f = await fixture(t), execute = f.executor(), operation = job(request(1));
  const result = await execute(operation); assert.ok(result.result, JSON.stringify(result));
  assert.equal(f.reportWrites.length, 1); assert.equal(f.reportWrites[0].out.recorded, true); assert.equal(f.reportWrites[0].stats.flushes, 1);
  const location = await f.local.locateReportChain(f.project), disk = await readFile(location.file, 'utf8'); assert.ok(disk.includes('report'));
  const status = f.inspect(operation); assert.equal(status.state, 'completed'); assert.equal(status.outcome, 'succeeded');
  assert.equal(status.result.target.localStateKey, 'session-tickets');
  assert.equal((await execute(operation)).error.data.state, 'completed');
  assert.equal(f.calls.filter(call => call.name === 'deck_context').length, 1); assert.equal(f.reportWrites.length, 1, 'no automatic second report');
});

test('recorded true with failed flush is unknown and blocks new sessions, threads and pairings', async t => {
  const f = await fixture(t), execute = f.executor(); f.state.failWrite = true;
  const operation = job(request(1)), result = await execute(operation);
  assert.equal(f.reportWrites[0].out.recorded, true); assert.equal(f.reportWrites[0].stats.flushes, 0);
  assert.equal(result.error.data.state, 'unknown'); assert.equal(f.inspect(operation).state, 'unknown');
  for (const next of [job(request(1), 'another-session'), job(request(2, 'deck_issue_report', { key: '38' }, A2))]) {
    assert.equal((await execute(next)).error.data.reason, 'PROJECT_WRITE_UNRESOLVED');
  }
  const secondPair = f.executor('pair-b');
  assert.equal((await secondPair(job(request(3), 'new-pair-session'))).error.data.reason, 'PROJECT_WRITE_UNRESOLVED');
  assert.equal(f.reportWrites.length, 1); assert.equal(f.calls.filter(call => call.name === 'deck_context').length, 1);
});

test('a stale durable report cannot turn a later failed flush into a known successful operation', async t => {
  const f = await fixture(t), execute = f.executor();
  assert.ok((await execute(job(request(1)))).result);
  const location = await f.local.locateReportChain(f.project), before = await readFile(location.file);
  f.state.failWrite = true; const failed = job(request(2), 'next-session');
  assert.equal((await execute(failed)).error.data.state, 'unknown');
  assert.deepEqual(await readFile(location.file), before); assert.equal(f.inspect(failed).state, 'unknown');
  assert.equal(f.reportWrites.length, 2, 'two explicit requests, no implicit retry');
});

for (const mismatch of ['workspace', 'session', 'backend/repository', 'unsuccessful']) {
  test(`untrusted report context ${mismatch} is rejected before business dispatch`, async t => {
    const f = await fixture(t), execute = f.executor();
    f.state.contextMutator = context => {
      if (mismatch === 'workspace') context.workspace.root = f.other;
      if (mismatch === 'session') context.data.workspace.sessionId = A2;
      if (mismatch === 'backend/repository') context.repo.backend = 'markdown';
      if (mismatch === 'unsuccessful') context.ok = false;
    };
    const operation = job(request(1)), result = await execute(operation);
    assert.equal(result.error.data.state, 'not-executed'); assert.equal(f.reportWrites.length, 0);
    assert.equal(f.inspect(operation).state, 'completed'); assert.equal(f.inspect(operation).outcome, 'failed');
    f.state.contextMutator = null;
    assert.ok((await execute(job(request(2)))).result, 'a pre-dispatch rejection releases the project barrier');
    assert.equal(f.reportWrites.length, 1);
  });
}

test('orchestrated real Git stage completes with independent index proof and no second dispatch', async t => {
  const f = await fixture(t), execute = f.executor();
  const operation = job(request(1, 'deck_upstream_write', { method: 'gitStage', payload: { paths: ['sample.txt'], expectedThreadId: A } }));
  assert.ok((await execute(operation)).result);
  assert.equal(await f.git(['diff', '--cached', '--name-only']), 'sample.txt');
  const status = f.inspect(operation); assert.equal(status.state, 'completed'); assert.equal(status.outcome, 'succeeded');
  assert.match(status.result.target.expectedStateSha256, /^[a-f0-9]{64}$/);
  assert.equal((await execute(operation)).error.data.state, 'completed');
  assert.equal(f.calls.filter(call => call.name === 'deck_upstream_write').length, 1);
});

test('a success-shaped Git echo without a changed index remains unknown', async t => {
  const f = await fixture(t), execute = f.executor(); f.state.performGit = false;
  const operation = job(request(1, 'deck_upstream_write', { method: 'gitStage', payload: { paths: ['sample.txt'], expectedThreadId: A } }));
  assert.equal((await execute(operation)).error.data.state, 'unknown');
  assert.equal(f.inspect(operation).state, 'unknown'); assert.equal(await f.git(['diff', '--cached', '--name-only']), '');
  assert.equal((await execute(job(request(2, 'deck_issue_report', { key: '38' }, A2)))).error.data.reason, 'PROJECT_WRITE_UNRESOLVED');
});

test('parameter-supplied Git tickets are never a substitute for an observed successful read', async t => {
  const f = await fixture(t);
  const fake = { id: 'parameter-only', expiresAtMs: Date.now() + 60000 };
  const read = request(1, 'deck_upstream_read', { method: 'gitWriteCheck', payload: { expectedThreadId: A, ticket: fake, decision: { verdict: 'allow' } } });
  await f.effects.observeRead({ request: read, response: envelope(1, { ok: false, ticket: fake, decision: { verdict: 'allow' } }), projectRoot: f.project, threadId: A });
  const write = request(2, 'deck_upstream_write', { method: 'gitPush', payload: { expectedThreadId: A, ticketId: fake.id, ticket: fake, decision: { verdict: 'allow' } } });
  await assert.rejects(f.effects.prepare({ method: 'gitPush', request: write, projectRoot: f.project, threadId: A, adapter: f.adapter }),
    error => /precheck|not implemented|trusted|observed|ticket/i.test(error.message));
});

for (const verdict of ['allow', 'warn']) {
  test(`a real original ${verdict} precheck observed through executor can prepare and verify its commit`, async t => {
    const f = await fixture(t), execute = f.executor(), message = 'Observed precheck ' + verdict;
    if (verdict === 'warn') await f.git(['checkout', '--quiet', '--detach']);
    await f.git(['add', '--', 'sample.txt']);
    const read = request(1, 'deck_upstream_read', { method: 'gitWriteCheck', payload: { op: 'commit', message, expectedThreadId: A } });
    const response = await execute(job(read)), check = response.result.structuredContent.value;
    assert.equal(check.ok, true); assert.equal(check.decision.verdict, verdict); assert.equal(check.ticket.op, 'commit');
    const write = request(2, 'deck_upstream_write', { method: 'gitCommit', payload: { message, ticketId: check.ticket.id, expectedThreadId: A } });
    const prepared = await f.effects.prepare({ method: 'gitCommit', request: write, projectRoot: f.project, threadId: A, adapter: f.adapter });
    const before = await f.git(['rev-parse', 'HEAD']); await f.git(['commit', '--quiet', '-m', message]); const after = await f.git(['rev-parse', 'HEAD']);
    assert.ok(await prepared.verify(envelope(2, { ok: true, value: { ok: true, committed: true, headBefore: before, headAfter: after } })));
    assert.equal(f.calls.filter(call => call.name === 'deck_upstream_write').length, 0, 'verification does not dispatch a second write');
  });
}

test('an observed precheck is unavailable to another project or chat and becomes unusable after expiry', async t => {
  const f = await fixture(t), execute = f.executor(), message = 'Scoped observed check';
  await f.git(['add', '--', 'sample.txt']);
  const read = request(1, 'deck_upstream_read', { method: 'gitWriteCheck', payload: { op: 'commit', message, expectedThreadId: A } });
  const check = (await execute(job(read))).result.structuredContent.value;
  const write = request(2, 'deck_upstream_write', { method: 'gitCommit', payload: { message, ticketId: check.ticket.id, expectedThreadId: A } });
  for (const scope of [{ projectRoot: f.other, threadId: B }, { projectRoot: f.project, threadId: A2 }]) {
    await assert.rejects(f.effects.prepare({ method: 'gitCommit', request: write, adapter: f.adapter, ...scope }), /precheck/);
  }
  const nearExpiry = await f.originalCheck(f.project, { op: 'commit', message }); nearExpiry.ticket.expiresAtMs = Date.now() + 30;
  await f.effects.observeRead({ request: read, response: envelope(1, { ok: true, value: nearExpiry }), projectRoot: f.project, threadId: A });
  const expiring = structuredClone(write); expiring.params.arguments.payload.ticketId = nearExpiry.ticket.id;
  await new Promise(resolve => setTimeout(resolve, 40));
  await assert.rejects(f.effects.prepare({ method: 'gitCommit', request: expiring, projectRoot: f.project, threadId: A, adapter: f.adapter }), /precheck/);
  assert.equal(await f.git(['log', '-1', '--format=%s']), 'initial fixture');
});

test('failed, blocked and incorrectly routed reads do not capture an allow-shaped ticket from parameters', async t => {
  const f = await fixture(t), message = 'Do not capture failed precheck'; await f.git(['add', '--', 'sample.txt']);
  const actual = await f.originalCheck(f.project, { op: 'commit', message });
  const read = request(1, 'deck_upstream_read', { method: 'gitWriteCheck', payload: { op: 'commit', message, expectedThreadId: A, ticket: actual.ticket } });
  const variants = [
    { request: read, response: { ...envelope(1, { ok: true, value: actual }), error: { code: -32000, message: 'failed' } } },
    { request: read, response: { jsonrpc: '2.0', id: 1, result: { isError: true, structuredContent: { ok: true, value: actual } } } },
    { request: read, response: envelope(1, { ok: true, value: { ...actual, ok: false } }) },
    { request: read, response: envelope(1, { ok: true, value: { ...actual, decision: { verdict: 'block', reasons: ['fixture'] } } }) },
    { request: { ...read, params: { ...read.params, name: 'deck_upstream_write' } }, response: envelope(1, { ok: true, value: actual }) },
    { request: { ...read, params: { ...read.params, arguments: { ...read.params.arguments, method: 'gitStatus' } } }, response: envelope(1, { ok: true, value: actual }) },
  ];
  for (const variant of variants) await f.effects.observeRead({ ...variant, projectRoot: f.project, threadId: A });
  const write = request(2, 'deck_upstream_write', { method: 'gitCommit', payload: { message, ticketId: actual.ticket.id, ticket: actual.ticket, expectedThreadId: A } });
  await assert.rejects(f.effects.prepare({ method: 'gitCommit', request: write, projectRoot: f.project, threadId: A, adapter: f.adapter }), /precheck/);
});

for (const mismatch of ['wrong operation', 'future checked time', 'fractional time', 'nonincreasing window', 'unsafe expiry']) {
  test(`an observed ticket with ${mismatch} cannot prepare a commit`, async t => {
    const f = await fixture(t), message = 'Reject invalid captured ticket'; await f.git(['add', '--', 'sample.txt']);
    const actual = await f.originalCheck(f.project, { op: 'commit', message }), now = Date.now();
    if (mismatch === 'wrong operation') actual.ticket.op = 'fetch';
    if (mismatch === 'future checked time') { actual.ticket.checkedAtMs = now + 60000; actual.ticket.expiresAtMs = now + 120000; }
    if (mismatch === 'fractional time') actual.ticket.checkedAtMs = now - 0.5;
    if (mismatch === 'nonincreasing window') { actual.ticket.checkedAtMs = now; actual.ticket.expiresAtMs = now; }
    if (mismatch === 'unsafe expiry') actual.ticket.expiresAtMs = Number.MAX_SAFE_INTEGER + 1;
    const read = request(1, 'deck_upstream_read', { method: 'gitWriteCheck', payload: { op: 'commit', message, expectedThreadId: A } });
    await f.effects.observeRead({ request: read, response: envelope(1, { ok: true, value: actual }), projectRoot: f.project, threadId: A });
    const write = request(2, 'deck_upstream_write', { method: 'gitCommit', payload: { message, ticketId: actual.ticket.id, expectedThreadId: A } });
    await assert.rejects(f.effects.prepare({ method: 'gitCommit', request: write, projectRoot: f.project, threadId: A, adapter: f.adapter }), /precheck/);
    assert.equal(await f.git(['log', '-1', '--format=%s']), 'initial fixture');
    assert.equal(f.calls.filter(call => call.name === 'deck_upstream_write').length, 0);
  });
}
