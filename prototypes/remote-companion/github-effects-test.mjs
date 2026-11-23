import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createGithubWriteEffects } from './write-effects-github.mjs';
import { ensureBody, ensureLabels } from '../../vendor/mattskills-1.8.0-rc.7/shared/deck-tools/plan.js';
import { anchorLineFor } from '../../vendor/mattskills-1.8.0-rc.7/shared/refresh/idempotency.js';
import { replaceProgressSection } from '../../vendor/mattskills-1.8.0-rc.7/lib/tools/deckIssuePatch.js';
import { WriteLedger } from './write-ledger.mjs';
import { digest, requestHash } from './protocol.mjs';

// Stateful local contract fixture only. No gh process, GitHub connection or
// online write. It exercises independent REST-shaped state, not tool counters.
const threadId = '01a1b180-89f8-7291-beb2-43f569f3709c', repository = 'isolated/fixture';
const request = (method, args, id = 1) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: {
  name: method.startsWith('deck_') ? method : 'deck_upstream_write',
  arguments: method.startsWith('deck_') ? args : { method, payload: { ...args, expectedThreadId: threadId } }, _meta: { threadId },
} });
const wrap = (id, value) => ({ jsonrpc: '2.0', id, result: { structuredContent: value } });

async function fixture(t, { env = {}, hostname = 'github.com', repositoryApiUrl = 'https://api.github.com/repos/' + repository } = {}) {
  const base = fileURLToPath(new URL('../../.scratch/', import.meta.url)); await mkdir(base, { recursive: true });
  const directory = await realpath(await mkdtemp(path.join(base, 'github-effects-test-'))), projectRoot = path.join(directory, 'project'); await mkdir(projectRoot);
  t.after(async () => { const actual = await realpath(directory), parent = await realpath(base); assert.equal(path.dirname(actual).toLowerCase(), parent.toLowerCase()); assert.ok(path.basename(actual).startsWith('github-effects-test-')); await rm(actual, { recursive: true, maxRetries: 5, retryDelay: 100 }); });
  const issues = new Map(), comments = new Map(), plans = new Map(), reads = [], calls = [], labels = [
    { id: 1, name: 'preexisting', color: '111111', description: '' }, { id: 2, name: 'keep', color: '222222', description: 'preserve this label' },
  ];
  const state = { repo: repository, backend: 'github', faultPage: null, omitCommentPage: false, failLabels: [], partial: false,
    repositoryMetadata: { id: 42001, full_name: repository, url: repositoryApiUrl } };
  let next = 10, commentId = 1000;
  function row(n, options = {}) { return { id: 10000 + n, number: n, repository_url: repositoryApiUrl,
    html_url: 'https://github.com/' + repository + '/issues/' + n, title: 'Fixture ' + n, body: '# Fixture\n\n## 进度\n\ninitial\n', state: 'open',
    labels: [{ name: 'preexisting' }], assignees: [], parent: null, blockedBy: [], ...options }; }
  issues.set(1, row(1, { title: 'Parent map', labels: [{ name: 'wayfinder:map' }] }));
  issues.set(2, row(2, { parent: 1 })); issues.set(3, row(3)); issues.set(4, row(4, { parent: 1 }));
  const rootKey = process.platform === 'win32' ? projectRoot.toLowerCase() : projectRoot;
  const repo = () => ({ backend: state.backend, refId: state.repo, name: state.repo, url: 'https://github.com/' + state.repo });
  const deck = (tool, data, extra = {}) => ({ ok: true, status: state.partial ? 'partial' : 'ok', tool, workspace: { root: rootKey, key: 'fixture' }, backend: { id: state.backend }, repo: repo(), data, items: [], ...extra });
  const brief = raw => ({ key: String(raw.number), title: raw.title, body: raw.body, state: raw.state,
    labels: raw.labels.map(item => item.name), assignees: raw.assignees.map(item => item.login) });
  async function readGithub(scope) {
    reads.push(structuredClone(scope)); assert.equal(scope.repository, repository); assert.equal(scope.projectRoot, await realpath(projectRoot)); assert.equal(scope.hostname, hostname);
    if (state.faultPage?.resource === scope.resource && state.faultPage.page === scope.page) throw new Error('isolated page failure');
    const raw = issues.get(scope.issueNumber), page = scope.page ?? 1;
    const pageOf = list => ({ status: 200, body: structuredClone(list.slice((page - 1) * 100, page * 100)) });
    if (scope.resource === 'viewer') return { status: 200, body: { login: 'fixture-user' } };
    if (scope.resource === 'repository') return { status: 200, body: structuredClone(state.repositoryMetadata) };
    if (scope.resource === 'issues') return pageOf([...issues.values()].sort((a, b) => a.number - b.number));
    if (scope.resource === 'labels') return pageOf(labels);
    if (!raw) return { status: 404, body: { message: 'Not Found' } };
    if (scope.resource === 'issue') return { status: 200, body: structuredClone(raw) };
    if (scope.resource === 'parent') return raw.parent == null ? { status: 404, body: { message: 'Not Found' } } : { status: 200, body: structuredClone(issues.get(raw.parent)) };
    if (scope.resource === 'children') return pageOf([...issues.values()].filter(item => item.parent === raw.number));
    if (scope.resource === 'blockers') return pageOf(raw.blockedBy.map(key => issues.get(key)));
    if (scope.resource === 'comments') return pageOf(comments.get(raw.number) ?? []);
    throw new Error('unexpected local fixture read');
  }
  const adapter = { async request(value, context) {
    calls.push({ name: value.params.name, arguments: structuredClone(value.params.arguments), context: structuredClone(context) });
    assert.equal(context.threadId, threadId); assert.equal((await realpath(context.projectRoot)).toLowerCase(), projectRoot.toLowerCase());
    const name = value.params.name, args = value.params.arguments;
    if (name === 'deck_context') return wrap(value.id, deck(name, { workspace: { root: rootKey, sessionId: threadId } }));
    if (name === 'deck_issue_get') { const raw = issues.get(Number(args.key)); return wrap(value.id, deck(name, { ticket: brief(raw),
      relations: { parentKey: raw.parent == null ? '' : String(raw.parent), blockedBy: raw.blockedBy.map(String), blocking: [] }, dependenciesRaw: { blockedBy: raw.blockedBy.map(key => ({ key: String(key) })), blocking: [] } })); }
    if (name === 'deck_map_snapshot') { const kids = [...issues.values()].filter(item => item.parent === Number(args.key)); return wrap(value.id, deck(name, { truncated: false, children: kids.map(brief), stats: { total: kids.length } })); }
    if (name === 'deck_upstream_read' && args.method === 'listLabels') return wrap(value.id, { ok: true, value: { ok: true, backendId: 'github', labels: structuredClone(labels) } });
    if (name === 'deck_upstream_read' && args.method === 'issueComments') {
      const all = comments.get(Number(args.payload.number)) ?? [], offset = Number(args.payload.after ?? 0), rows = all.slice(offset, offset + 50);
      const hasNextPage = !state.omitCommentPage && offset + rows.length < all.length;
      return wrap(value.id, { ok: true, value: { ok: true, nodes: rows.map(item => ({ author: { login: item.user.login }, body: item.body, createdAt: item.created_at, updatedAt: item.updated_at })), pageInfo: { hasNextPage, endCursor: String(offset + rows.length) } } });
    }
    throw new Error('The verifier attempted a write or an unsupported read');
  } };
  function create(spec, anchor, parent = null) {
    const existing = [...issues.values()].find(item => item.state === 'open' && item.body.startsWith(anchorLineFor(anchor)));
    if (existing) return existing;
    const n = next++, kind = ['map', 'bug'].includes(spec.kind) ? spec.kind : 'task';
    const made = row(n, { title: spec.title.trim(), body: anchorLineFor(anchor) + ensureBody(spec.body, kind).body,
      labels: ensureLabels(spec.labels, kind).labels.map(name => ({ name })), assignees: (spec.assignees ?? []).map(login => ({ login: login === '@me' ? 'fixture-user' : login })), parent });
    issues.set(n, made); return made;
  }
  function postComment(key, body) { const list = comments.get(key) ?? [], at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'); const made = { id: ++commentId, body, user: { login: 'fixture-user' }, created_at: at, updated_at: at }; list.push(made); comments.set(key, list); return made; }
  function write(value) {
    const method = value.params.name === 'deck_upstream_write' ? value.params.arguments.method : value.params.name;
    const args = method.startsWith('deck_') ? value.params.arguments : value.params.arguments.payload;
    if (method === 'deck_issue_create') { const anchor = args.idempotencyKey ?? 'automatic-fixture-anchor', made = create(args, anchor, args.parentKey ? Number(args.parentKey) : null); return wrap(value.id, deck(method, { ticket: brief(made), idempotencyKey: anchor })); }
    if (method === 'deck_issue_patch') {
      const raw = issues.get(Number(args.key)); if (args.comment?.trim()) postComment(raw.number, args.comment);
      raw.labels = [...new Set([...raw.labels.map(item => item.name), ...(args.addLabels ?? [])])].filter(name => !(args.removeLabels ?? []).includes(name)).map(name => ({ name }));
      if (args.assignees !== undefined) raw.assignees = args.assignees.map(login => ({ login: login === '@me' ? 'fixture-user' : login }));
      if (typeof args.title === 'string') raw.title = args.title; if (typeof args.body === 'string') raw.body = args.body;
      if (typeof args.progress === 'string') raw.body = replaceProgressSection(args.body === undefined ? ensureBody(raw.body, 'task').body : args.body, args.progress);
      if (typeof args.close === 'boolean') raw.state = args.close ? 'closed' : 'open'; return wrap(value.id, deck(method, { ticket: brief(raw) }));
    }
    if (method === 'deck_map_link') {
      const jobs = args.edges?.length ? args.edges : [args], blockers = new Map();
      for (const job of jobs) { const raw = issues.get(Number(job.key)); if (job.parentKey !== undefined) raw.parent = job.parentKey === '' ? null : Number(job.parentKey); if (job.blockedBy !== undefined) blockers.set(raw.number, [...new Set([...(blockers.get(raw.number) ?? []), ...job.blockedBy.map(Number)])]); }
      for (const [key, values] of blockers) issues.get(key).blockedBy = values;
      return wrap(value.id, deck(method, { requested: jobs.length, done: jobs.length, jobs }));
    }
    if (method === 'deck_map_plan_create') {
      const id = args.planId ?? 'automatic-plan-fixture', map = create({ ...args, kind: 'map' }, 'deck-plan-' + id + '-map'), keys = plans.get(id) ?? new Map();
      for (const child of args.children) keys.set(child.key, create(child, 'deck-plan-' + id + '-child-' + child.key, map.number).number);
      plans.set(id, keys); const refs = new Map([['@map', map.number], ...keys]), blocks = new Map();
      for (const edge of args.edges ?? []) { const from = refs.get(edge.from), to = refs.get(edge.to); if (edge.type === 'parent') issues.get(from).parent = to; else blocks.set(from, [...new Set([...(blocks.get(from) ?? []), to])]); }
      for (const [key, values] of blocks) issues.get(key).blockedBy = values;
      const kids = [...issues.values()].filter(item => item.parent === map.number);
      return wrap(value.id, deck(method, { planId: id, mapKey: String(map.number), durable: true, builtKeys: [...keys.values()].map(String), restKeys: [], nextCall: null,
        counts: { planned: keys.size + 1, actual: kids.length + 1, ok: keys.size === kids.length, compared: true } }));
    }
    if (method === 'commentIssue') { const made = postComment(Number(args.number), args.body); return wrap(value.id, { ok: true, value: { ok: true, data: { id: made.id, body: made.body, author: { login: made.user.login }, createdAt: made.created_at, updatedAt: made.updated_at } } }); }
    if (method === 'setLabelColors') {
      const applied = [], failed = [];
      for (const change of args.changes) { const row = labels.find(row => row.name.toLowerCase() === change.name.toLowerCase()); if (!row || state.failLabels.includes(change.name)) failed.push({ name: change.name, reason: { kind: 'fixture-failure' } }); else { row.color = change.color.toLowerCase(); applied.push({ name: change.name, color: row.color }); } }
      return wrap(value.id, { ok: true, value: { ok: true, backendId: 'github', applied, failed } });
    }
    throw new Error('Unsupported fixture write');
  }
  const effects = await createGithubWriteEffects({ adapterPath: fileURLToPath(new URL('../upstream-port/sidebar-server.mjs', import.meta.url)), env, readGithub });
  const prepare = value => effects.prepare({ method: value.params.name === 'deck_upstream_write' ? value.params.arguments.method : value.params.name, request: value, projectRoot, threadId, adapter });
  return { directory, projectRoot, issues, comments, labels, state, reads, calls, prepare, write, postComment, create, row };
}

test('create independently verifies exact fields, optional automatic anchor and native parent membership', async t => {
  const f = await fixture(t), value = request('deck_issue_create', { title: 'New task', body: 'Question', labels: ['keep'], assignees: ['@me'], parentKey: '1' });
  const prepared = await f.prepare(value), response = f.write(value), proof = await prepared.verify(response);
  assert.ok(proof); assert.equal(proof.target.issueNumber, Number(response.result.structuredContent.data.ticket.key)); assert.equal(proof.target.repository, repository);
  assert.ok(f.reads.some(read => read.resource === 'parent')); assert.ok(f.reads.some(read => read.resource === 'children'));
});

test('an ok create echo without a new issue, duplicate anchor or changed field remains unknown', async t => {
  for (const fault of ['no write', 'duplicate', 'body']) {
    const f = await fixture(t), value = request('deck_issue_create', { title: 'Create fault ' + fault, idempotencyKey: 'explicit-' + fault.replace(' ', '-'), body: 'Intent' });
    const prepared = await f.prepare(value), response = f.write(value), key = Number(response.result.structuredContent.data.ticket.key), raw = f.issues.get(key);
    if (fault === 'no write') f.issues.delete(key); if (fault === 'duplicate') f.issues.set(99, { ...structuredClone(raw), id: 10099, number: 99 }); if (fault === 'body') raw.body += '\nunrequested';
    assert.equal(await prepared.verify(response), null);
  }
});

test('patch checks every requested field and its new unique comment while preserving other fields', async t => {
  const f = await fixture(t), value = request('deck_issue_patch', { key: '2', title: 'Updated title', progress: 'Work completed', addLabels: ['keep'], removeLabels: ['preexisting'], assignees: ['@me'], comment: 'One verified comment', close: true });
  const prepared = await f.prepare(value), proof = await prepared.verify(f.write(value)); assert.ok(proof);
  assert.equal(f.comments.get(2).length, 1); assert.equal(f.issues.get(2).parent, 1); assert.equal(f.issues.get(2).state, 'closed');
});

test('patch does not accept counts or partial multi-step success as a complete result', async t => {
  for (const fault of ['body', 'comment duplicate', 'partial']) {
    const f = await fixture(t), value = request('deck_issue_patch', { key: '2', body: 'Expected body', comment: 'Expected comment' });
    const prepared = await f.prepare(value), response = f.write(value);
    if (fault === 'body') f.issues.get(2).body = 'wrong body'; if (fault === 'comment duplicate') f.postComment(2, 'Expected comment'); if (fault === 'partial') response.result.structuredContent.status = 'partial';
    assert.equal(await prepared.verify(response), null);
  }
});

test('map link verifies complete blocker replacement, moved native parent and unrelated child preservation', async t => {
  const f = await fixture(t); f.issues.get(2).blockedBy = [1];
  const value = request('deck_map_link', { edges: [{ key: '2', parentKey: '4', blockedBy: ['3'] }, { key: '2', blockedBy: ['4'] }] });
  const prepared = await f.prepare(value), proof = await prepared.verify(f.write(value)); assert.ok(proof);
  assert.deepEqual(f.issues.get(2).blockedBy, [3, 4]); assert.equal(f.issues.get(2).parent, 4); assert.equal(f.issues.get(4).parent, 1);
});

test('same edge count with different native blocker identity cannot pass', async t => {
  const f = await fixture(t), value = request('deck_map_link', { key: '2', blockedBy: ['3'] });
  const prepared = await f.prepare(value), response = f.write(value); f.issues.get(2).blockedBy = [4];
  assert.equal(await prepared.verify(response), null);
});

test('plan verifies each child anchor, fields and native relation identities independently of counts', async t => {
  const f = await fixture(t), value = request('deck_map_plan_create', { title: 'Complete plan', planId: 'local-plan', children: [{ key: 'a', title: 'First', body: 'A' }, { key: 'b', title: 'Second', kind: 'bug', assignees: ['@me'] }], edges: [{ from: 'b', to: 'a' }] });
  const prepared = await f.prepare(value), response = f.write(value), proof = await prepared.verify(response); assert.ok(proof); assert.equal(proof.target.issueNumbers.length, 3);
  const key = Number(response.result.structuredContent.data.builtKeys[1]); f.issues.get(key).blockedBy = [3];
  assert.equal(await prepared.verify(response), null, 'same child/count with wrong blocker remains unknown');
});

test('plan false counts and unfinished shard remain unknown even if top-level status is ok', async t => {
  for (const fault of ['counts', 'rest']) {
    const f = await fixture(t), value = request('deck_map_plan_create', { title: 'Plan fault', children: [{ key: 'a', title: 'A' }] });
    const prepared = await f.prepare(value), response = f.write(value);
    if (fault === 'counts') response.result.structuredContent.data.counts.ok = false; else response.result.structuredContent.data.restKeys = ['not-made'];
    assert.equal(await prepared.verify(response), null);
  }
});

test('a plan continuation preserves prior map/child edits and verifies old plus new identities', async t => {
  const f = await fixture(t), first = request('deck_map_plan_create', { title: 'Continued plan', planId: 'continued-local', children: [{ key: 'a', title: 'Existing A' }] });
  const original = await f.prepare(first), response = f.write(first); assert.ok(await original.verify(response));
  const mapKey = Number(response.result.structuredContent.data.mapKey), oldKey = Number(response.result.structuredContent.data.builtKeys[0]);
  f.issues.get(mapKey).body += '\nUser destination notes'; f.issues.get(oldKey).body += '\nUser child progress';
  const next = request('deck_map_plan_create', { title: 'Continued plan', planId: 'continued-local', children: [{ key: 'b', title: 'New B' }], edges: [{ from: 'b', to: 'a' }] }, 2);
  const prepared = await f.prepare(next), followup = f.write(next), proof = await prepared.verify(followup); assert.ok(proof);
  assert.equal(proof.target.issueNumbers.length, 3); assert.ok(f.issues.get(oldKey).body.endsWith('User child progress'));
});

test('plan edges can bind the map itself while native child identities remain exact', async t => {
  const f = await fixture(t), value = request('deck_map_plan_create', { title: 'Map dependency', planId: 'map-dependency', children: [{ key: 'a', title: 'Child A' }], edges: [{ from: '@map', to: 'a' }] });
  const prepared = await f.prepare(value); assert.ok(await prepared.verify(f.write(value)));
});

test('comment result uses new REST identity and complete pagination, including original adapter pages', async t => {
  const f = await fixture(t);
  for (let id = 1; id <= 105; id++) f.comments.set(2, [...(f.comments.get(2) ?? []), { id, body: 'Old ' + id, user: { login: 'other' }, created_at: '2020-01-01T00:00:00Z', updated_at: '2020-01-01T00:00:00Z' }]);
  const value = request('commentIssue', { number: 2, body: 'Exactly once' }), prepared = await f.prepare(value), response = f.write(value);
  assert.ok(await prepared.verify(response)); assert.ok(f.reads.some(read => read.resource === 'comments' && read.page === 2));
  assert.ok(f.calls.filter(call => call.arguments?.method === 'issueComments').some(call => call.arguments.payload.after === '100'));
});

test('comment duplicate, missing tail page and unmatched returned id are not known success', async t => {
  for (const fault of ['duplicate', 'page', 'id']) {
    const f = await fixture(t), value = request('commentIssue', { number: 2, body: 'Comment fault' }), prepared = await f.prepare(value), response = f.write(value);
    if (fault === 'duplicate') f.postComment(2, 'Comment fault'); if (fault === 'page') f.state.faultPage = { resource: 'comments', page: 1 }; if (fault === 'id') response.result.structuredContent.value.data.id = 999999;
    assert.equal(await prepared.verify(response), null);
  }
});

test('a missing adapter comment tail cannot certify a fully read independent comment list', async t => {
  const f = await fixture(t);
  for (let id = 1; id <= 55; id++) f.comments.set(2, [...(f.comments.get(2) ?? []), { id, body: 'Old ' + id, user: { login: 'other' }, created_at: '2020-01-01T00:00:00Z', updated_at: '2020-01-01T00:00:00Z' }]);
  const value = request('commentIssue', { number: 2, body: 'Tail proof' }), prepared = await f.prepare(value), response = f.write(value);
  f.state.omitCommentPage = true; assert.equal(await prepared.verify(response), null);
});

test('creation does not stop at an early matching anchor when a later REST page fails', async t => {
  const f = await fixture(t);
  for (let key = 100; key < 305; key++) f.issues.set(key, f.row(key));
  const value = request('deck_issue_create', { title: 'Read every page', idempotencyKey: 'all-pages' }), prepared = await f.prepare(value), response = f.write(value);
  f.state.faultPage = { resource: 'issues', page: 3 }; assert.equal(await prepared.verify(response), null);
  assert.ok(f.reads.some(read => read.resource === 'issues' && read.page === 3));
});

test('label batch verifies complete partition and independently records a known terminal partial', async t => {
  const f = await fixture(t), value = request('setLabelColors', { changes: [{ name: 'preexisting', color: 'abcdef' }, { name: 'keep', color: '123456' }] }); f.state.failLabels = ['keep'];
  const prepared = await f.prepare(value), response = f.write(value), proof = await prepared.verify(response);
  assert.equal(proof.outcome, 'failed'); assert.equal(proof.result.errorKind, 'partial');
  f.labels.find(row => row.name === 'keep').color = '654321'; assert.equal(await prepared.verify(response), null, 'an unexplained failed-item change is unknown');
});

test('successful label batch and unchanged empty batch have independent readback', async t => {
  const f = await fixture(t);
  for (const changes of [[{ name: 'preexisting', color: 'ABCDEF' }], []]) { const value = request('setLabelColors', { changes }), prepared = await f.prepare(value); assert.ok(await prepared.verify(f.write(value))); }
});

test('repository drift and unsupported backend cannot be recorded as the previous project tracker', async t => {
  const f = await fixture(t), value = request('deck_issue_create', { title: 'Bound to A' }), prepared = await f.prepare(value), response = f.write(value);
  response.result.structuredContent.repo.refId = 'other/repository'; assert.equal(await prepared.verify(response), null);
  f.state.repo = 'other/repository'; assert.equal(await prepared.verify(response), null);
  f.state.repo = repository; f.state.backend = 'markdown'; await assert.rejects(f.prepare(request('deck_issue_create', { title: 'No GH binding' })), /trusted local GitHub context/);
  assert.equal(f.calls.filter(call => !['deck_context', 'deck_issue_get', 'deck_map_snapshot', 'deck_upstream_read'].includes(call.name)).length, 0, 'all verifier calls are reads');
});

test('remote authority parameters are rejected and utility correlation never replaces ledger ownership', async t => {
  const f = await fixture(t);
  await assert.rejects(f.prepare(request('deck_issue_create', { title: 'Bad authority', repository: 'other/repo' })), /Unknown write parameter/);
  for (const authority of [{ hostname: 'attacker.example.invalid' }, { repositoryHost: 'attacker.example.invalid' }]) {
    await assert.rejects(f.prepare(request('deck_issue_create', { title: 'Host belongs to local environment', ...authority })), /Unknown write parameter/);
  }
  const value = request('deck_issue_create', { title: 'Durable typed result', idempotencyKey: 'typed-ledger' }), prepared = await f.prepare(value);
  assert.equal(prepared.target.correlationKey, undefined);
  const ledger = new WriteLedger(path.join(f.directory, 'ledger.sqlite'));
  try {
  const operationId = digest('local-gh-ledger'), projectKey = process.platform === 'win32' ? f.projectRoot.toLowerCase() : f.projectRoot;
  const ownerScope = { pairingId: 'fixture', threadId, projectRoot: projectKey }, record = { operationId, projectKey, ownerScope };
  const intent = { method: 'deck_issue_create', parametersSha256: requestHash(value), target: { correlationKey: operationId } };
  ledger.reserve({ ...record, intent });
  const refined = ledger.refineIntent({ ...record, intent: { ...intent, target: { ...intent.target, ...prepared.target } } });
  const effect = await prepared.verify(f.write(value)); assert.ok(effect);
  ledger.complete({ ...record, outcome: 'succeeded', result: { ...effect, target: { ...refined.target, ...effect.target } } });
  const status = ledger.inspect(record); assert.equal(status.state, 'completed'); assert.equal(status.result.target.correlationKey, operationId);
  } finally { ledger.close(); }
});

test('all six enterprise effects bind independent reads, dispatch and durable ledger targets to the same trusted hostname', async t => {
  for (const [hostname, repositoryApiUrl] of [
    ['ghe.example.invalid', 'https://ghe.example.invalid/api/v3/repos/' + repository],
    ['ghe.example.invalid:8443', 'https://api.ghe.example.invalid:8443/repos/' + repository],
    ['ghe.example.invalid:443', 'https://ghe.example.invalid:443/api/v3/repos/' + repository],
    ['ghe.example.invalid:00443', 'https://api.ghe.example.invalid:443/repos/' + repository],
  ]) {
    const f = await fixture(t, { env: { GH_HOST: hostname.toUpperCase() }, hostname, repositoryApiUrl });
    const cases = [
      ['deck_issue_create', { title: 'Enterprise create', parentKey: '1', idempotencyKey: 'ghe-create' }],
      ['deck_issue_patch', { key: '2', title: 'Enterprise patch', comment: 'Enterprise patch comment' }],
      ['deck_map_link', { key: '2', blockedBy: ['3'] }],
      ['deck_map_plan_create', { title: 'Enterprise plan', planId: 'ghe-plan', children: [{ key: 'a', title: 'Enterprise child' }] }],
      ['commentIssue', { number: 2, body: 'Enterprise standalone comment' }],
      ['setLabelColors', { changes: [{ name: 'keep', color: 'abcdef' }] }],
    ];
    const ledger = new WriteLedger(path.join(f.directory, 'enterprise-ledger.sqlite'));
    try {
      for (const [method, args] of cases) {
        const value = request(method, args), prepared = await f.prepare(value);
        assert.deepEqual(prepared.dispatchContext.tracker, { backendId: 'github', repository, hostname });
        assert.equal(prepared.target.repositoryHost, hostname);
        const operationId = digest(hostname + ':' + method), ownerScope = { pairingId: 'enterprise-fixture', threadId }, record = { operationId, projectKey: f.projectRoot, ownerScope };
        const intent = { method, parametersSha256: requestHash(value), target: { correlationKey: operationId, ...prepared.target } };
        ledger.reserve({ ...record, intent });
        const response = f.write(value), proof = await prepared.verify(response); assert.ok(proof?.resultSha256, method + ' must independently verify its enterprise side effect');
        assert.equal(proof.target.repositoryHost, hostname); ledger.complete({ ...record, outcome: 'succeeded', result: proof });
        const status = ledger.inspect(record); assert.equal(status.intent.target.repositoryHost, hostname); assert.equal(status.result.target.repositoryHost, hostname);
        if (method.startsWith('deck_')) assert.equal(response.result.structuredContent.repo.url, 'https://github.com/' + repository, 'original hard-coded display links remain compatible but do not choose the API host');
      }
    } finally { ledger.close(); }
    assert.ok(f.reads.some(read => read.resource === 'repository')); assert.ok(f.reads.length > 20);
    assert.ok(f.reads.every(read => read.hostname === hostname && read.repository === repository));
  }
});

test('enterprise metadata rejects a foreign API host, repository, identity or unsafe URL before business dispatch', async t => {
  for (const override of [
    { url: 'https://api.github.com/repos/' + repository }, { url: 'https://other.example.invalid/api/v3/repos/' + repository },
    { url: 'https://ghe.example.invalid:8443/api/v3/repos/' + repository },
    { url: 'https://ghe.example.invalid/repos/other/repo' }, { url: 'http://ghe.example.invalid/repos/' + repository },
    { url: 'https://user@ghe.example.invalid/repos/' + repository }, { url: 'https://ghe.example.invalid/repos/' + repository + '?scope=elsewhere' },
    { url: 'https://ghe.example.invalid/arbitrary/' + repository }, { full_name: 'other/repo' }, { id: 0 }, { id: '42001' },
  ]) {
    const hostname = 'ghe.example.invalid', f = await fixture(t, { env: { GH_HOST: hostname }, hostname, repositoryApiUrl: 'https://' + hostname + '/api/v3/repos/' + repository });
    Object.assign(f.state.repositoryMetadata, override);
    await assert.rejects(f.prepare(request('deck_issue_create', { title: 'Must not dispatch' })), /API authority|repository identity/);
    assert.equal(f.issues.size, 4); assert.equal(f.comments.size, 0); assert.equal(f.calls.filter(call => call.name !== 'deck_context').length, 0);
  }
});

test('every enterprise issue and native relation must retain the exact independently verified repository API URL', async t => {
  const hostname = 'ghe.example.invalid', repositoryApiUrl = 'https://' + hostname + '/api/v3/repos/' + repository;
  for (const identity of ['target', 'parent', 'blocker']) {
    const f = await fixture(t, { env: { GH_HOST: hostname }, hostname, repositoryApiUrl }); f.issues.get(2).blockedBy = [3];
    f.issues.get(identity === 'target' ? 2 : identity === 'parent' ? 1 : 3).repository_url = 'https://api.github.com/repos/' + repository;
    await assert.rejects(f.prepare(request('deck_issue_patch', { key: '2', title: 'Bound host only' })), /another repository/);
  }
  for (const wrongUrl of ['https://api.github.com/repos/' + repository, 'https://ghe.example.invalid/repos/' + repository, 'https://other.example.invalid/api/v3/repos/' + repository]) {
    const f = await fixture(t, { env: { GH_HOST: hostname }, hostname, repositoryApiUrl });
    const value = request('deck_issue_create', { title: 'After-dispatch host drift', idempotencyKey: 'ghe-url-drift' }), prepared = await f.prepare(value), response = f.write(value);
    const key = Number(response.result.structuredContent.data.ticket.key); f.issues.get(key).repository_url = wrongUrl;
    assert.equal(await prepared.verify(response), null, 'success cannot be recorded from an issue on another API authority/path');
  }
});

test('invalid and Windows-ambiguous local host settings reject before adapter or independent reads', async () => {
  let reads = 0;
  for (const env of [{ GH_HOST: 'https://ghe.example.invalid' }, { GH_HOST: 'user@ghe.example.invalid' }, { GH_HOST: 'ghe.example.invalid/path' },
    { GH_HOST: '--hostname' }, { GH_HOST: 'ghe.example.invalid:65536' }, { GH_HOST: 'ghe.example.invalid\n' },
    { GH_HOST: 'github.com', gh_host: 'ghe.example.invalid' }, { GH_HOST: 'ghe.example.invalid:443', Gh_Host: 'ghe.example.invalid:00443' }]) {
    await assert.rejects(createGithubWriteEffects({ adapterPath: fileURLToPath(new URL('../upstream-port/sidebar-server.mjs', import.meta.url)), env,
      readGithub: async () => { reads++; throw new Error('A rejected local host must not make a request'); } }), error => ['INVALID_GITHUB_HOST', 'AMBIGUOUS_GITHUB_HOST'].includes(error.code));
  }
  assert.equal(reads, 0);
});

test('the production GET reader parses real CLI status headers and never launches a write recipe', async t => {
  for (const hostname of ['github.com', 'ghe.example.invalid']) {
  const repositoryApiUrl = hostname === 'github.com' ? 'https://api.github.com/repos/' + repository : 'https://' + hostname + '/api/v3/repos/' + repository;
  const f = await fixture(t, { env: { GH_HOST: hostname }, hostname, repositoryApiUrl }), snapshot = path.join(f.projectRoot, 'readback-fixture.json'), log = path.join(f.projectRoot, 'reader-calls.jsonl');
  // Node is the locally selected fake gh executable; its entrypoint is the
  // fixed argv token "api" in this isolated project, not a remote script path.
  await writeFile(path.join(f.projectRoot, 'api'), `const fs=require('node:fs');
const args=process.argv.slice(2),route=args.at(-1),base='repos/${repository}';
if(args[args.indexOf('--method')+1]!=='GET'||args[args.indexOf('--hostname')+1]!==${JSON.stringify(hostname)}||!args.includes('--include')||!(route===base||route.startsWith(base+'/')))throw new Error('Non-GET or cross-repo recipe');
fs.appendFileSync('reader-calls.jsonl',JSON.stringify(args)+'\\n');
const state=JSON.parse(fs.readFileSync('readback-fixture.json','utf8')),url=new URL('https://fixture.invalid/'+route),tail=url.pathname.slice(('/'+base).length).replace(/^\\//,''),page=Number(url.searchParams.get('page')||1);
let status=200,body;const take=rows=>rows.slice((page-1)*100,page*100);
if(tail==='')body=state.repository;else if(tail==='issues')body=take(state.issues);else{const hit=/^issues\\/(\\d+)(?:\\/(parent|sub_issues|dependencies\\/blocked_by))?$/.exec(tail);if(!hit)throw new Error('Unknown fixed read resource');const issue=state.issues.find(row=>row.number===Number(hit[1]));if(!issue){status=404;body={message:'Not Found'};}else if(!hit[2])body=issue;else if(hit[2]==='parent'){if(issue.parent==null){status=404;body={message:'Not Found'};}else body=state.issues.find(row=>row.number===issue.parent);}else if(hit[2]==='sub_issues')body=take(state.issues.filter(row=>row.parent===issue.number));else body=take(issue.blockedBy.map(key=>state.issues.find(row=>row.number===key)));}
process.stdout.write('HTTP/2.0 '+status+' Fixture\\r\\ncontent-type: application/json\\r\\n\\r\\n'+JSON.stringify(body));if(status!==200)process.exitCode=1;
`);
  const save = () => writeFile(snapshot, JSON.stringify({ issues: [...f.issues.values()], repository: f.state.repositoryMetadata })); await save();
  const env = { DECK_GH: process.execPath, GH_HOST: hostname };
  for (const key of ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP']) if (process.env[key]) env[key] = process.env[key];
  const effects = await createGithubWriteEffects({ adapterPath: fileURLToPath(new URL('../upstream-port/sidebar-server.mjs', import.meta.url)), env });
  const value = request('deck_issue_create', { title: 'Fixed GET readback', parentKey: '1', idempotencyKey: 'cli-proof' });
  // Obtain the same fixture adapter through the trusted prepare wrapper's
  // captured read calls; it is never passed through the tool arguments.
  const adapter = { async request(input, context) {
    const name = input.params.name;
    const root = process.platform === 'win32' ? f.projectRoot.toLowerCase() : f.projectRoot;
    const common = { ok: true, status: 'ok', tool: name, workspace: { root }, backend: { id: 'github' }, repo: { backend: 'github', refId: repository, name: repository, url: 'https://github.com/' + repository } };
    if (name === 'deck_context') return wrap(input.id, { ...common, data: { workspace: { sessionId: context.threadId } } });
    const row = f.issues.get(Number(input.params.arguments.key));
    return wrap(input.id, { ...common, data: { ticket: { key: String(row.number), title: row.title, body: row.body, state: row.state, labels: row.labels.map(label => label.name), assignees: row.assignees.map(actor => actor.login) }, relations: { parentKey: row.parent == null ? '' : String(row.parent), blockedBy: row.blockedBy.map(String) } } });
  } };
  const prepared = await effects.prepare({ method: 'deck_issue_create', request: value, projectRoot: f.projectRoot, threadId, adapter }), response = f.write(value); await save();
  assert.ok(await prepared.verify(response));
  const calls = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.ok(calls.length >= 5); assert.ok(calls.every(args => args[args.indexOf('--method') + 1] === 'GET' && args[args.indexOf('--hostname') + 1] === hostname));
  if (hostname !== 'github.com') assert.ok(calls.some(args => args.at(-1) === 'repos/' + repository), 'the production reader independently checks enterprise metadata on its pinned host');
  }
});
