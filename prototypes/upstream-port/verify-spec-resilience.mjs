import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import createGithubBackend from '../../vendor/mattskills-1.8.0-rc.7/lib/tracker/backends/github/index.js';
import { createSnapshotComposer } from '../../vendor/mattskills-1.8.0-rc.7/lib/tracker/snapshot.js';
import { listIssues } from '../../vendor/mattskills-1.8.0-rc.7/lib/tracker/backends/github/issues.js';

const client = await readFile(new URL('dist/client.js', import.meta.url), 'utf8');
const row = (number, title, state = 'OPEN', parentKey = null, labels = []) => ({ key: String(number), number, title, state, parentKey, labels: labels.map(name => ({ name })), type: 'issue', assignees: [], blockedBy: [], url: `https://github.com/fixture/repo/issues/${number}` });
async function mount(issues) {
  const dom = new JSDOM('<main id="root"></main>', { url: 'https://spec-resilience.invalid', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  w.eval(client);
  const session = { id: 'resilience', cwd: '/fixture' };
  const sessions = { current: session.id, byId: { resilience: session }, items: [session] };
  let snapshot = { ok: true, workspaceRoot: '/fixture', repoRoot: '/fixture', repository: { name: 'fixture/repo' }, repo: { owner: 'fixture', name: 'repo' }, issues, maps: [], labels: [], selection: { backendId: 'github' }, backendModules: [{ id: 'github' }] };
  const original = JSON.stringify(issues);
  const writes = [];
  const dispose = w.MattSkillsCodex.mount(w.document.getElementById('root'), {
    codexActions: { capabilities: { nativeDraftRequest: true, active: true, new: true }, async prefill(target, text) { writes.push({ target, text }); return { status: 'requested', target }; } },
    sessions: { get: () => session, list: { getSnapshot: () => sessions, subscribe: () => () => {} } },
    connection: { rpc: { async call(c, e, r) {
      if (['snapshot', 'refresh'].includes(r.method)) return { ok: true, value: snapshot };
      if (r.method === 'cwd') return { ok: true, value: { cwd: '/fixture', workspaceRoot: '/fixture' } };
      if (r.method === 'issueDetail') { const issue = issues.find(item => item.number === Number(r.payload?.number ?? 80)); return { ok: true, value: { ok: true, issue: { ...issue, body: 'Evidence', labels: { nodes: issue?.labels || [] }, comments: { nodes: [] } } } }; }
      return { ok: true, value: { ok: false } };
    } } },
  }, { session, sessionId: session.id, useSessions: select => typeof select === 'function' ? select(sessions) : sessions });
  const until = async check => { for (let i = 0; i < 150; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 20)); } assert.fail('UI timeout: ' + w.document.body.textContent.slice(-700)); };
  const find = n => [...w.document.querySelectorAll('[role="button"]')].find(element => element.getAttribute('aria-label')?.startsWith('#' + n + ' '));
  await until(() => w.document.querySelector('[data-spec-search]'));
  return { w, until, find, writes, setRows(next) { snapshot = { ...snapshot, issues: next }; }, close() { assert.equal(JSON.stringify(issues), original, 'display never mutates backend issue state or relationships'); dispose(); w.close(); } };
}

const openChild = row(83, 'Still open', 'OPEN', '80');
const doneChild = row(84, 'Done child', 'CLOSED', '80');
const closedSpec = { ...row(80, 'Closed specification', 'CLOSED', null, ['spec']), children: [openChild, doneChild], childrenRead: { state: 'complete', total: 2 } };
for (const state of ['partial', 'unknown']) {
  const spec = { ...closedSpec, children: [doneChild], childrenRead: { state, total: null } };
  const ui = await mount([spec, openChild, doneChild]);
  try {
    assert.ok(ui.find(80) && !ui.find(80).closest('details'), 'uncertain closed spec stays visible');
    assert.ok(ui.find(83), 'unverified child stays visible');
    assert.match(ui.find(80).textContent, /不完整.*未知/);
  } finally { ui.close(); }
}
{
  const complete = { ...closedSpec, children: [doneChild], childrenRead: { state: 'complete', total: 1 } };
  const ui = await mount([complete, doneChild]);
  try {
    assert.ok(ui.find(80)?.closest('details'), 'fully completed spec follows existing closed fold');
    const closedButton = [...ui.w.document.querySelectorAll('button, [role=button]')].find(button => button.textContent.trim() === '已关闭');
    closedButton.click();
    await ui.until(() => ui.find(80) && !ui.find(80).closest('details'));
    assert.match(ui.find(80).textContent, /1\/1/);
  } finally { ui.close(); }
}
{
  const ui = await mount([openChild]);
  try { assert.ok(ui.find(83), 'missing parent never folds its child'); } finally { ui.close(); }
}
{
  const empty = { ...closedSpec, state: 'OPEN', children: [], childrenRead: { state: 'complete', total: 0 } };
  const ui = await mount([empty, openChild]);
  try {
    assert.ok(ui.find(83), 'a stale parent edge absent from the native child set does not hide work');
    assert.match(ui.find(80).textContent, /0\/0/, 'a confirmed empty native set can display zero');
  } finally { ui.close(); }
}
{
  const otherEffort = { ...closedSpec, state: 'OPEN', effortId: 'other' };
  const ui = await mount([otherEffort, openChild]);
  try { assert.ok(ui.find(83), 'same parent number in a different effort is not ownership'); } finally { ui.close(); }
}
{
  const map = { ...closedSpec, state: 'OPEN', labels: [{ name: 'spec' }, { name: 'wayfinder:map' }] };
  const ui = await mount([map, openChild]);
  try {
    assert.ok(ui.find(83), 'map labels take precedence over a spec label');
    assert.ok(!ui.find(80).querySelector('[data-spec-count]'));
  } finally { ui.close(); }
}

let mode = 'failed';
const rawSpec = { number: 80, title: 'Specification', state: 'closed', labels: [{ name: 'spec' }] };
const rawChild = { number: 83, title: 'Still open', state: 'open', labels: [], parent: { number: 80 }, issue_dependencies_summary: { total_blocked_by: 0 } };
const apiContext = {
  cwd: '/fixture', platform: { resolveExecutable: async () => 'gh' },
  async exec(command, args) {
    if (args[1] === 'graphql') return { code: 0, stdout: JSON.stringify({ data: { repository: { issues: { nodes: [rawSpec, { ...rawChild, parent: mode === 'orphan' ? null : rawChild.parent }], pageInfo: { hasNextPage: false } }, pullRequests: { nodes: [], pageInfo: { hasNextPage: false } } } } }), stderr: '' };
    if (mode === 'tail-failed' && args[1].endsWith('page=1')) return { code: 0, stdout: JSON.stringify(Array.from({ length: 100 }, (_, index) => ({ ...rawChild, number: 1000 + index }))), stderr: '' };
    if (args[1].includes('/sub_issues?')) return mode === 'complete' || mode === 'invalid'
      ? { code: 0, stdout: JSON.stringify(mode === 'invalid' ? [rawChild, null, { number: 0, state: 'open' }, { ...rawChild, number: 85, title: 'Later valid child' }] : [rawChild]), stderr: '' }
      : { code: 1, stdout: '', stderr: 'Offline' };
    return { code: 1, stdout: '', stderr: 'Fixture unsupported external operation' };
  },
};
const backend = createGithubBackend();
const composer = createSnapshotComposer({ get: () => backend });
const ref = { refId: 'fixture/repo', name: 'fixture/repo', backend: 'github' };
const failed = await composer.composeSnapshot('github', ref, apiContext, { force: true });
assert.ok(failed.ok);
mode = 'complete';
const recovered = await composer.composeSnapshot('github', ref, apiContext, { force: true, ifNoneMatch: failed.version });
assert.notEqual(recovered.version, failed.version, 'native children read recovery changes public snapshot version');
mode = 'orphan';
const orphan = await composer.composeSnapshot('github', ref, apiContext, { force: true });
assert.notEqual(orphan.version, failed.version, 'native parent change changes public snapshot version');
mode = 'invalid';
const invalid = await composer.composeSnapshot('github', ref, apiContext, { force: true });
const invalidSpec = invalid.snapshot.issues.find(issue => issue.key === '80');
assert.equal(invalidSpec.childrenRead.state, 'partial', 'invalid native rows cannot establish complete child count');
assert.equal(invalidSpec.childrenRead.total, null);
assert.equal(invalidSpec.children.length, 2, 'valid native child remains accessible when another row is malformed');
mode = 'tail-failed';
const partial = await composer.composeSnapshot('github', ref, apiContext, { force: true });
const partialSpec = partial.snapshot.issues.find(issue => issue.key === '80');
assert.equal(partialSpec.childrenRead.state, 'partial');
assert.equal(partialSpec.childrenRead.total, null, 'a failed later page never establishes a complete total');
assert.equal(partialSpec.children.length, 100, 'earlier valid pages remain accessible');
console.log('PASS incomplete relation UI, existing filters and snapshot recovery version');


{
  const ui = await mount([closedSpec, openChild, doneChild]);
  try {
    assert.ok(ui.find(80) && !ui.find(80).closest('details'), 'closed spec with open work stays directly visible');
    assert.match(ui.find(80).textContent, /规格已关闭.*还有未完成子票/);
    assert.match(ui.find(80).textContent, /1\/2/);
    assert.ok(!ui.find(83), 'confirmed child remains accessible through its spec');
  } finally { ui.close(); }
}
console.log('PASS closed specification retains unfinished work without changing actual state');

// A native sub-issue response has no dependency detail. Keep the original
// issue's metadata, or obtain the missing edges before offering execution.
for (const inPool of [false, true]) {
  const nativeChild = { ...rawChild, labels: [{ name: 'ready-for-agent' }, { name: 'wayfinder:task' }], issue_dependencies_summary: { blocked_by: 1, total_blocked_by: 1 } };
  const blocker = { number: 99, title: 'Required work', state: 'open' };
  const result = await listIssues({ refId: 'fixture/repo' }, {}, {
    ...apiContext,
    async exec(command, args) {
      if (args[1] === 'graphql') return { code: 0, stdout: JSON.stringify({ data: { repository: { issues: { nodes: [rawSpec, ...(inPool ? [{ ...nativeChild, blockedBy: { nodes: [blocker] } }] : []), blocker], pageInfo: { hasNextPage: false } }, pullRequests: { nodes: [], pageInfo: { hasNextPage: false } } } } }), stderr: '' };
      const data = args[1].includes('/dependencies/blocked_by') ? [blocker] : [nativeChild];
      return { code: 0, stdout: JSON.stringify(data), stderr: '' };
    },
  });
  assert.ok(result.ok);
  const child = result.data.find(issue => issue.key === '83');
  const nested = result.data.find(issue => issue.key === '80').children[0];
  assert.deepEqual(child.blockedBy.map(ref => ref.key), ['99'], 'native child keeps its real blocker in the main pool');
  assert.deepEqual(nested.blockedBy.map(ref => ref.key), ['99'], 'nested child cannot replace complete dependency metadata with an empty REST projection');
}
console.log('PASS native children preserve dependencies inside and outside the initial pool');

{
  const unknownChild = { ...row(83, 'Dependency read failed', 'OPEN', '80', ['ready-for-agent', 'wayfinder:task']), dependenciesRead: { state: 'failed' } };
  const ui = await mount([unknownChild]);
  try {
    assert.match(ui.find(83).textContent, /依赖.*未知/, 'unknown dependencies stay visible and are not presented as unblocked');
    assert.equal(ui.find(83).querySelectorAll('[data-issue-direct-actions] button').length, 2, 'draft outlets remain distinct from execution gates');
    ui.find(83).click();
    await ui.until(() => ui.w.document.querySelector('[data-bottom-action-bar] button[aria-label="填入当前聊天"]'));
    ui.w.document.querySelector('[data-bottom-action-bar] button[aria-label="填入当前聊天"]').click();
    await ui.until(() => ui.writes.length === 1);
    assert.match(ui.writes[0].text, /issues\/83/, 'unknown execution dependencies do not prevent a plain draft for the explicitly opened child');
  } finally { ui.close(); }
}
console.log('PASS failed dependency reads preserve metadata without blocking plain draft fill');

{
  let dependencies = 'failed';
  const context = { ...apiContext, async exec(command, args) {
    const blocker = { number: 99, title: 'Prerequisite', state: dependencies === 'closed' ? 'closed' : 'open' };
    if (args[1] === 'graphql') return { code: 0, stdout: JSON.stringify({ data: { repository: { issues: { nodes: [rawSpec], pageInfo: { hasNextPage: false } }, pullRequests: { nodes: [], pageInfo: { hasNextPage: false } } } } }), stderr: '' };
    if (args[1].includes('/dependencies/blocked_by')) return dependencies === 'failed' ? { code: 1, stdout: '', stderr: 'Offline' } : { code: 0, stdout: JSON.stringify([blocker]), stderr: '' };
    return { code: 0, stdout: JSON.stringify([{ ...rawChild, issue_dependencies_summary: { blocked_by: 1, total_blocked_by: 1 } }]), stderr: '' };
  } };
  const composer = createSnapshotComposer({ get: () => createGithubBackend() });
  const unknown = await composer.composeSnapshot('github', ref, context, { force: true });
  assert.ok(unknown.ok);
  assert.equal(unknown.snapshot.issues.find(issue => issue.key === '83').dependenciesRead.state, 'failed');
  assert.equal(unknown.snapshot.deck.stats.blocked, 1, 'unknown dependencies cannot enter ready counts');
  dependencies = 'open';
  const blocked = await composer.composeSnapshot('github', ref, context, { force: true, ifNoneMatch: unknown.version });
  assert.notEqual(blocked.version, unknown.version, 'dependency recovery invalidates the public snapshot');
  assert.equal(blocked.snapshot.deck.stats.blocked, 1);
  dependencies = 'closed';
  const unblocked = await composer.composeSnapshot('github', ref, context, { force: true });
  assert.equal(unblocked.snapshot.deck.stats.blocked, 0, 'real closed blockers satisfy the original dependency gate');
}

{
  const ui = await mount([openChild]);
  try {
    assert.ok(ui.find(83));
    ui.setRows([{ ...closedSpec, state: 'OPEN' }, openChild, doneChild]);
    [...ui.w.document.querySelectorAll('button')].find(button => button.textContent.trim() === '刷新').click();
    await ui.until(() => ui.find(80) && !ui.find(83));
    assert.match(ui.find(80).textContent, /1\/2/, 'the render index follows a new public snapshot');
  } finally { ui.close(); }
}
console.log('PASS dependency failure/recovery gates and indexed refresh stay truthful');

{
  const child = { ...openChild, blockedBy: ['99'], dependenciesRead: { state: 'complete', openKeys: ['99'] } };
  const ui = await mount([child]);
  try {
    assert.match(ui.find(83).textContent, /被阻塞.*#99/, 'a real open prerequisite outside the bounded pool still blocks execution');
    assert.equal(ui.find(83).querySelectorAll('[data-issue-direct-actions] button').length, 2, 'blocker metadata is retained without turning draft fill into execution');
  } finally { ui.close(); }
}

{
  const spec = { ...closedSpec, state: 'OPEN', children: [], childrenRead: { state: 'failed', total: null } };
  const ui = await mount([spec, openChild]);
  try {
    assert.ok(ui.find(83), 'failed native relation read preserves the child entry');
    assert.match(ui.find(80).textContent, /子票.*未知/);
    assert.doesNotMatch(ui.find(80).textContent, /0\/0|\/null/);
    ui.find(83).click();
    await ui.until(() => ui.w.document.querySelector('[data-bottom-action-bar]'));
    assert.ok(ui.w.document.querySelector('[data-parent-spec]'), 'child keeps its own action and parent navigation during read failure');
    ui.w.document.querySelector('[data-parent-spec] a').click();
    await ui.until(() => ui.w.document.querySelector('[data-spec-children]'));
    assert.match(ui.w.document.querySelector('[data-spec-children]').textContent, /读取失败.*未知/);
  } finally { ui.close(); }
}
