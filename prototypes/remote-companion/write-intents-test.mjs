import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile, symlink } from 'node:fs/promises';
import { buildWriteIntent, prepareWriteIntent, readLocalGitState, WRITE_INTENT_METHODS } from './write-intents.mjs';
import { WriteLedger } from './write-ledger.mjs';

const run = promisify(execFile);
const threadId = '11111111-1111-4111-8111-111111111111';
const head = 'a'.repeat(40), hash = 'b'.repeat(64), repository = 'fixture-owner/fixture';
const normalized = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
async function fixture(t) {
  const base = fileURLToPath(new URL('../../.scratch/', import.meta.url));
  await mkdir(base, { recursive: true });
  const directory = await realpath(await mkdtemp(path.join(base, 'write-intents-test-')));
  const project = path.join(directory, 'project'), data = path.join(directory, 'data'), other = path.join(directory, 'other');
  for (const folder of [project, data, other]) await mkdir(folder);
  await writeFile(path.join(project, 'sample.txt'), 'fixture content\n');
  t.after(async () => {
    const target = await realpath(directory), parent = await realpath(base), relative = path.relative(normalized(parent), normalized(target));
    assert.ok(relative.startsWith('write-intents-test-') && !relative.includes(path.sep) && !path.isAbsolute(relative), 'Remove only the exact new isolated fixture');
    await rm(target, { recursive: true });
  });
  const input = (method, parameters, extra = {}) => ({ method, parameters, projectRoot: project, threadId, ...extra });
  const deps = {
    dataRootFor: async () => data,
    readLocalState: async () => ({ files: [{ exists: false, path: 'fixture-state' }] }),
    readBackend: async () => ({ backendId: 'github', repository, registeredBackendIds: ['github', 'markdown'] }),
    readTracker: async () => ({ backendId: 'github', repository, issues: [1, 2, 3].map(key => ({ key: String(key), state: 'OPEN' })), complete: true, labels: [], existingMatches: [] }),
    readGitTicket: async ({ method, parameters }) => ({ id: parameters.ticketId, op: method.slice(3).toLowerCase(), repoRoot: project,
      headOid: head, expiresAtMs: Date.now() + 120000, target: { remote: 'origin', branch: 'intent-test', localBranch: 'intent-test', upstream: 'origin/intent-test' } }),
    readGitState: async ({ remote }) => ({ projectRoot: project, repositoryExists: true, headOid: head, indexSha256: hash, statusSha256: hash,
      branch: 'intent-test', originExists: true, originRepository: repository, originUrlSha256: hash,
      ...(remote ? { remote, remoteUrlSha256: hash } : {}), files: [{ path: 'sample.txt', exists: true, sha256: hash }] }),
    readGithubIdentity: async () => ({ login: 'fixture-owner' }),
    readPublicationRecord: async () => ({ halfCreated: true, repository, commitOid: head }),
  };
  return { directory, project, data, other, input, deps };
}

test('all 17 enabled RPC and five deck write intents satisfy the existing ledger target schema', async t => {
  const f = await fixture(t);
  const parameters = {
    gitStage: { paths: ['sample.txt'] }, gitUnstage: { paths: ['sample.txt'] }, gitCommit: { message: 'intent fixture', ticketId: 'ticket-1', requestId: 'request-1' },
    gitPull: { ticketId: 'ticket-1' }, gitFetch: { ticketId: 'ticket-1' }, gitPush: { ticketId: 'ticket-1' },
    initPublish: { name: 'fixture', visibility: 'private' }, retryPush: { name: 'fixture', owner: 'fixture-owner', repoUrl: 'https://github.com/' + repository },
    commentIssue: { number: 1, body: 'fixture private comment' }, setLabelColors: { changes: [{ name: 'fixture label', color: '00Aa11' }] },
    bind: { backendId: 'github' }, handoffResolve: { name: '20261124*' }, cancelNewSessionWatcher: { suggestionId: 'c'.repeat(24) },
    logSetSwitch: { enabled: true, sampleRate: 0.5 }, logClear: { date: 'all' }, openFolder: { cwd: f.project }, openPath: { path: path.join(f.project, 'sample.txt') },
    deck_issue_create: { title: 'fixture issue', body: 'private fixture body' },
    deck_map_plan_create: { title: 'fixture map', children: [{ key: 'a', title: 'A' }, { key: 'b', title: 'B' }], edges: [{ from: 'b', to: 'a' }] },
    deck_map_link: { key: '1', parentKey: '2', blockedBy: ['3'] },
    deck_issue_patch: { key: '1', comment: 'fixture private comment', progress: 'fixture progress', close: false },
    deck_issue_report: { key: '#0001', note: 'fixture private note' },
  };
  assert.equal(WRITE_INTENT_METHODS.length, 22);
  assert.deepEqual(new Set(Object.keys(parameters)), new Set(WRITE_INTENT_METHODS));
  const ledger = new WriteLedger(path.join(f.directory, 'intents.sqlite'));
  try {
    let n = 1;
    for (const method of WRITE_INTENT_METHODS) {
      const intent = await buildWriteIntent(f.input(method, parameters[method]), f.deps);
      assert.deepEqual(Object.keys(intent).sort(), ['method', 'parametersSha256', 'target']);
      assert.equal(intent.method, method);
      assert.match(intent.parametersSha256, /^[a-f0-9]{64}$/);
      const serialized = JSON.stringify(intent);
      for (const raw of ['fixture private comment', 'private fixture body', 'fixture private note', f.project]) assert.ok(!serialized.includes(raw), method + ' must persist hashes instead of raw private content');
      const operationId = (n++).toString(16).padStart(64, '0');
      const scope = { operationId, projectKey: normalized(f.project), ownerScope: { pairingId: 'fixture-pair', threadId } };
      assert.equal(ledger.reserve({ ...scope, intent }).reserved, true, method);
      ledger.complete({ ...scope, outcome: 'succeeded' });
    }
  } finally { ledger.close(); }
});

test('canonical parameter hashes are stable and local before-state changes remain separate', async t => {
  const f = await fixture(t);
  const a = await buildWriteIntent(f.input('deck_issue_report', { key: '1', note: 'same' }), f.deps);
  const b = await buildWriteIntent(f.input('deck_issue_report', { note: 'same', key: '1' }), f.deps);
  assert.equal(a.parametersSha256, b.parametersSha256);
  assert.deepEqual(a.target, b.target);
  const c = await buildWriteIntent(f.input('deck_issue_report', { key: '1', note: 'same' }), { ...f.deps, readLocalState: async () => ({ files: [{ path: 'fixture-state', exists: true, sha256: 'd'.repeat(64) }] }) });
  assert.equal(c.parametersSha256, a.parametersSha256);
  assert.notEqual(c.target.beforeStateSha256, a.target.beforeStateSha256);
});

test('unopened/conditional methods and model-supplied authority or local facts are rejected', async t => {
  const f = await fixture(t);
  let reads = 0;
  const deps = { ...f.deps, readBackend: async () => { reads++; return {}; } };
  for (const method of ['setupLayout', 'updateInstall', 'deckExec', 'namingSignal', 'arbitraryWrite']) {
    await assert.rejects(buildWriteIntent(f.input(method, { layout: 'single' }), deps), { code: 'INVALID_WRITE_INTENT' });
  }
  for (const key of ['projectRoot', 'ownerScope', 'target', 'readBackend', 'readTracker', 'confirmed']) {
    await assert.rejects(buildWriteIntent(f.input('deck_issue_report', { key: '1', [key]: {} }), deps), /Unknown write parameter/);
  }
  assert.equal(reads, 0);
  await assert.rejects(buildWriteIntent(f.input('gitStage', { paths: ['sample.txt'] }, { projectRoot: '.' }), f.deps), /absolute project root/);
  await assert.rejects(buildWriteIntent(f.input('gitStage', { paths: ['sample.txt'], expectedThreadId: 'another-thread' }), f.deps), { code: 'LOCAL_FACT_MISMATCH' });
  await assert.rejects(buildWriteIntent(f.input('cancelNewSessionWatcher', { suggestionId: 'c'.repeat(24), sessionId: 'another-thread' }), f.deps), { code: 'LOCAL_FACT_MISMATCH' });
});

test('Git targets must come from a live local preflight ticket and match current local facts', async t => {
  const f = await fixture(t), request = f.input('gitPush', { ticketId: 'ticket-1' });
  await assert.rejects(buildWriteIntent(request, { ...f.deps, readGitTicket: undefined }), { code: 'LOCAL_PRECONDITION_REQUIRED' });
  for (const change of [{ id: 'other-ticket' }, { op: 'fetch' }, { repoRoot: f.other }, { expiresAtMs: 1 }, { headOid: 'e'.repeat(40) }]) {
    await assert.rejects(buildWriteIntent(request, { ...f.deps, readGitTicket: async scope => ({ ...await f.deps.readGitTicket(scope), ...change }) }), { code: 'LOCAL_FACT_MISMATCH' });
  }
  await assert.rejects(buildWriteIntent(request, { ...f.deps, readGitState: async scope => ({ ...await f.deps.readGitState(scope), remote: 'another-remote' }) }), { code: 'LOCAL_FACT_MISMATCH' });
  await assert.rejects(buildWriteIntent(f.input('gitStage', { paths: ['../other'] }), f.deps), /project-relative/);
  await assert.rejects(buildWriteIntent(f.input('gitStage', { paths: ['.git/config'] }), f.deps), /project-relative/);
  const captured = { projectRoot: f.project, threadId, check: { ok: true, decision: { verdict: 'allow', reasons: [] },
    ticket: { id: 'ticket-1', op: 'push', checkedAtMs: Date.now(), expiresAtMs: Date.now() + 120000 },
    plan: { mode: 'existing', remote: 'origin', branch: 'intent-test', localBranch: 'intent-test' } } };
  const prepared = await prepareWriteIntent(request, { ...f.deps, readGitTicket: async () => captured });
  assert.equal(prepared.intent.target.branch, 'intent-test');
  assert.equal(prepared.intent.target.beforeOid, head, 'HEAD comes from an independent local read, not an invented public ticket field');
  assert.equal(prepared.facts.ticket.ticket.headOid, undefined);
  await assert.rejects(buildWriteIntent(request, { ...f.deps, readGitTicket: async () => ({ ...captured, threadId: 'other-thread' }) }), { code: 'LOCAL_FACT_MISMATCH' });
});

test('local state reads use the trusted worker data root and include real disk changes', async t => {
  const f = await fixture(t), deps = { ...f.deps, readLocalState: undefined };
  const cache = path.join(f.data, '.dsh-mattskillsdeck-cache');
  await mkdir(cache);
  await writeFile(path.join(cache, 'session-tickets.json'), '{"v":2,"shards":[]}');
  const first = await prepareWriteIntent(f.input('deck_issue_report', { key: '1' }), deps);
  assert.equal(first.facts.local.files[0].exists, true);
  await writeFile(path.join(cache, 'session-tickets.json'), '{"v":2,"shards":[],"fixture":true}');
  const after = await prepareWriteIntent(f.input('deck_issue_report', { key: '1' }), deps);
  assert.notEqual(first.intent.target.beforeStateSha256, after.intent.target.beforeStateSha256);
  assert.equal(first.intent.target.issueNumber, 1);
  assert.equal(first.intent.target.repository, repository);
  await assert.rejects(buildWriteIntent(f.input('logSetSwitch', { enabled: false }), { ...deps, dataRootFor: undefined }), { code: 'LOCAL_PRECONDITION_REQUIRED' });
  const switchIntent = await prepareWriteIntent(f.input('logSetSwitch', { enabled: false }), deps);
  assert.equal(switchIntent.facts.local.files[0].exists, false, 'a missing state file is recorded, not invented');
  const logs = path.join(cache, 'logs');
  await mkdir(logs);
  await writeFile(path.join(logs, '2026-11-24.log'), 'fixture log');
  await writeFile(path.join(logs, 'unrelated.txt'), 'leave untouched');
  const clear = await prepareWriteIntent(f.input('logClear', { date: '2026-11-24' }), deps);
  assert.equal(clear.facts.local.files.length, 1);
  assert.equal(await readFile(path.join(logs, 'unrelated.txt'), 'utf8'), 'leave untouched');
  assert.equal(await readFile(path.join(logs, '2026-11-24.log'), 'utf8'), 'fixture log', 'intent preparation never clears logs');
});

test('binding can start from no selected backend and does not claim persisted configuration', async t => {
  const f = await fixture(t);
  const deps = { ...f.deps, readLocalState: undefined, readBackend: async () => ({ backendId: null, registeredBackendIds: ['github'] }) };
  const result = await prepareWriteIntent(f.input('bind', { backendId: 'github' }), deps);
  assert.equal(result.intent.target.localStateKey, 'binding');
  assert.equal(result.facts.local.files[0].exists, false);
  assert.equal(result.facts.local.choices.exists, false);
  await assert.rejects(buildWriteIntent(f.input('bind', { backendId: 'unregistered' }), deps), { code: 'LOCAL_PRECONDITION_REQUIRED' });
});

test('open targets are read and confined without launching a host window', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.other, 'outside.txt'), 'outside');
  const intent = await buildWriteIntent(f.input('openPath', { path: path.join(f.project, 'sample.txt') }), f.deps);
  assert.equal(intent.target.localStateKey, 'open-path');
  assert.ok(!JSON.stringify(intent).includes(f.project));
  await assert.rejects(buildWriteIntent(f.input('openPath', { path: path.join(f.other, 'outside.txt') }), f.deps), { code: 'LOCAL_FACT_MISMATCH' });
  const link = path.join(f.project, 'linked-outside');
  try { await symlink(f.other, link, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (!['EPERM', 'EACCES'].includes(error.code)) throw error; t.diagnostic('Junction/symlink creation unavailable; direct outside-path refusal is still exercised'); return; }
  await assert.rejects(buildWriteIntent(f.input('openPath', { path: path.join(link, 'outside.txt') }), f.deps), { code: 'LOCAL_FACT_MISMATCH' });
});

test('tracker pre-read must identify the same backend/repository and actual issue targets', async t => {
  const f = await fixture(t), request = f.input('deck_issue_report', { key: '1' });
  await assert.rejects(buildWriteIntent(request, { ...f.deps, readTracker: undefined }), { code: 'LOCAL_PRECONDITION_REQUIRED' });
  await assert.rejects(buildWriteIntent(request, { ...f.deps, readTracker: async () => ({ backendId: 'github', repository: 'other/repo', issues: [{ key: '1' }] }) }), { code: 'LOCAL_FACT_MISMATCH' });
  await assert.rejects(buildWriteIntent(request, { ...f.deps, readTracker: async () => ({ backendId: 'github', repository, issues: [] }) }), { code: 'LOCAL_PRECONDITION_REQUIRED' });
  await assert.rejects(buildWriteIntent(f.input('setLabelColors', { changes: [{ name: 'fixture', color: 'ffffff' }] }), { ...f.deps, readTracker: async () => ({ backendId: 'github', repository, labels: [] }) }), { code: 'LOCAL_PRECONDITION_REQUIRED' });
});

test('creation keeps optional upstream anchors distinct from local operation correlation', async t => {
  const f = await fixture(t), request = f.input('deck_issue_create', { title: 'same title' });
  const a = await prepareWriteIntent({ ...request, operationId: '1'.repeat(64) }, f.deps);
  const b = await prepareWriteIntent({ ...request, operationId: '2'.repeat(64) }, f.deps);
  assert.equal(a.facts.creation.explicitAnchor, false);
  assert.equal(a.intent.parametersSha256, b.intent.parametersSha256);
  assert.notEqual(a.intent.target.correlationKey, b.intent.target.correlationKey);
  const anchored = await prepareWriteIntent(f.input('deck_issue_create', { title: 'same title', idempotencyKey: 'stable-fixture-anchor' }), f.deps);
  assert.equal(anchored.facts.creation.explicitAnchor, true);
  for (const length of [161, 200]) {
    const originalKey = 'a'.repeat(length);
    const long = await prepareWriteIntent(f.input('deck_issue_create', { title: 'same title', idempotencyKey: originalKey }), f.deps);
    assert.equal(long.facts.creation.explicitAnchor, true);
    assert.match(long.intent.target.correlationKey, /^[a-f0-9]{64}$/);
  }
  await assert.rejects(prepareWriteIntent(f.input('deck_issue_create', { title: 'same title', idempotencyKey: 'a'.repeat(201) }), f.deps), /correlation key/);
  await assert.rejects(buildWriteIntent(f.input('deck_map_plan_create', { title: 'plan', children: [{ key: 'a', title: 'A' }], edges: [{ from: 'a', to: 'unknown' }] }), f.deps), /unknown child/);
});

test('retry publication cannot accept caller-provided ownership or an unrelated existing origin', async t => {
  const f = await fixture(t), request = f.input('retryPush', { name: 'fixture', owner: 'fixture-owner', repoUrl: 'https://github.com/' + repository });
  await assert.rejects(buildWriteIntent(request, { ...f.deps, readPublicationRecord: undefined }), { code: 'LOCAL_PRECONDITION_REQUIRED' });
  await assert.rejects(buildWriteIntent({ ...request, parameters: { ...request.parameters, repoUrl: 'https://github.com/other/repo' } }, f.deps), { code: 'LOCAL_FACT_MISMATCH' });
  await assert.rejects(buildWriteIntent(request, { ...f.deps, readGitState: async scope => ({ ...await f.deps.readGitState(scope), originRepository: 'other/repo' }) }), { code: 'LOCAL_FACT_MISMATCH' });
});

test('default Git pre-read records real index/worktree state without staging or contacting a remote', async t => {
  const f = await fixture(t);
  const git = async args => (await run('git', ['-C', f.project, ...args], { windowsHide: true, encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 'Intent Fixture', GIT_AUTHOR_EMAIL: 'intent@example.test', GIT_COMMITTER_NAME: 'Intent Fixture', GIT_COMMITTER_EMAIL: 'intent@example.test', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'commit.gpgsign', GIT_CONFIG_VALUE_0: 'false' } })).stdout.trim();
  await git(['init', '-b', 'intent-test']);
  await git(['add', 'sample.txt']);
  await git(['commit', '-m', 'fixture seed']);
  await writeFile(path.join(f.project, 'sample.txt'), 'changed, remains unstaged\n');
  const beforeHead = await git(['rev-parse', 'HEAD']), beforeIndex = await git(['ls-files', '--stage']);
  const prepared = await prepareWriteIntent(f.input('gitStage', { paths: ['sample.txt'] }), {});
  assert.equal(prepared.intent.target.beforeOid, beforeHead);
  assert.equal(prepared.facts.git.files[0].exists, true);
  assert.equal(await git(['ls-files', '--stage']), beforeIndex);
  assert.equal(await git(['diff', '--cached', '--name-only']), '');
  assert.equal(await git(['remote']), '');
  const nested = path.join(f.project, 'nested');
  await mkdir(nested);
  await assert.rejects(readLocalGitState({ projectRoot: nested, method: 'gitStage', paths: [] }), { code: 'LOCAL_FACT_MISMATCH' });
});
