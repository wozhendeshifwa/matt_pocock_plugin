import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { listIssues } from '../../vendor/mattskills-1.8.0-rc.7/lib/tracker/backends/github/issues.js';
import { normalizePanelPayload } from './panel-payload.mjs';

const client = await readFile(new URL('dist/client.js', import.meta.url), 'utf8');
const row = (n, title, labels = [], parentKey = null, state = 'OPEN') => ({ key: String(n), number: n, title, labels: labels.map(name => ({ name })), parentKey, state, type: 'issue', assignees: [], blockedBy: [], url: `https://github.com/fixture/repo/issues/${n}` });
const spec = row(80, 'Specification', ['spec'], '77');
const first = row(83, 'Searchable child', ['ready-for-agent', 'wayfinder:task'], '80');
const second = row(84, 'Finished child', [], '80', 'CLOSED');
const independent = row(90, 'Independent work');
const rows = [spec, first, second, independent];
const dom = new JSDOM('<main id="root"></main>', { url: 'https://spec.invalid', runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window;
w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
const session = { id: 'spec', cwd: '/fixture' };
const sessions = { current: session.id, byId: { spec: session }, items: [session] };
spec.children = [first, second];
spec.childrenRead = { state: 'complete', total: 2 };
const map = { ...row(77, 'Roadmap', ['wayfinder:map']), type: 'map', tickets: [spec, row(78, 'Map decision', [], '77')], stats: { total: 2, open: 2, closed: 0 } };
const snapshot = { ok: true, workspaceRoot: '/fixture', repoRoot: '/fixture', repository: { name: 'fixture/repo', url: 'https://github.com/fixture/repo' }, repo: { owner: 'fixture', name: 'repo' }, issues: [first, second, independent, ...map.tickets], maps: [map], labels: [], selection: { backendId: 'github' }, backendModules: [{ id: 'github' }] };
w.eval(client);
const dispose = w.MattSkillsCodex.mount(w.document.getElementById('root'), {
  sessions: { list: { getSnapshot: () => sessions, subscribe: () => () => {} }, get: () => session },
  connection: { rpc: { async call(c, e, r) {
    if (['snapshot', 'refresh'].includes(r.method)) return { ok: true, value: snapshot };
    if (r.method === 'cwd') return { ok: true, value: { cwd: '/fixture', workspaceRoot: '/fixture' } };
    if (r.method === 'issueDetail') return { ok: true, value: { ok: true, issue: { ...rows.find(x => x.number === Number(r.payload?.number ?? r.args?.number ?? r.number ?? 80)), labels: { nodes: (rows.find(x => x.number === Number(r.payload?.number ?? 80)) || spec).labels }, body: 'Evidence', comments: { nodes: [] } } } };
    return { ok: true, value: { ok: false } };
  } } },
}, { sessionId: 'spec', session, useSessions: selector => typeof selector === 'function' ? selector(sessions) : sessions });
const until = async check => { for (let i = 0; i < 150; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 20)); } assert.fail('UI timeout: ' + w.document.body.textContent.slice(-900)); };
const findRow = n => [...w.document.querySelectorAll('[role="button"]')].find(el => el.getAttribute('aria-label')?.startsWith('#' + n + ' '));
try {
  await until(() => findRow(80));
  assert.ok(findRow(90), 'independent task stays visible');
  assert.ok(!findRow(83), 'known spec child is folded from default list');
  assert.ok(!findRow(78), 'map decisions stay in the map page');
  const search = w.document.querySelector('[data-spec-search]');
  assert.ok(search, 'task search is available');
  search.value = 'Searchable child';
  search.dispatchEvent(new w.Event('input', { bubbles: true }));
  await until(() => findRow(83));
  assert.match(findRow(83).textContent, /所属规格 #80/);
  search.value = 'Finished child';
  search.dispatchEvent(new w.Event('input', { bubbles: true }));
  await until(() => findRow(84));
  assert.match(findRow(84).textContent, /所属规格 #80/);
  assert.ok(!findRow(84).closest('details') || findRow(84).closest('details').open, 'closed child search result is directly visible');
  search.value = '';
  search.dispatchEvent(new w.Event('input', { bubbles: true }));
  await until(() => findRow(80));
  findRow(80).click();
  await until(() => w.document.querySelector('[data-spec-children]'));
  assert.match(w.document.querySelector('[data-spec-children]').textContent, /1\/2/);
  assert.ok(findRow(83));
  assert.ok(findRow(84));
  findRow(83).click();
  await until(() => w.document.querySelector('[data-parent-spec]'));
  assert.match(w.document.querySelector('[data-parent-spec]').textContent, /所属规格.*#80/);
  assert.ok(w.document.querySelector('[data-detail-primary-text]'), 'child retains own action');
  w.document.querySelector('[data-parent-spec] a').click();
  await until(() => w.document.querySelector('[data-spec-children]'));
  console.log('PASS spec list folding and bidirectional detail navigation');
} finally { dispose(); w.close(); }

// External GitHub responses are fixtures; the real list implementation reads
// and normalizes every native child rather than counting a truncated pool.
const rawSpec = { number: 80, title: 'Specification', state: 'open', labels: [{ name: 'spec' }], parent: { number: 77 } };
const childPage = Array.from({ length: 100 }, (_, i) => ({ number: 1000 + i, title: 'Native child ' + i, state: 'closed', labels: [] }));
const nativeList = await listIssues({ refId: 'fixture/repo' }, {}, {
  cwd: '/fixture', platform: { resolveExecutable: async () => 'gh' },
  async exec(command, args) {
    let data;
    if (args[1] === 'graphql') data = { data: { repository: { issues: { nodes: [rawSpec], pageInfo: { hasNextPage: false } }, pullRequests: { nodes: [], pageInfo: { hasNextPage: false } } } } };
    else if (args[1].endsWith('page=1')) data = childPage;
    else if (args[1].endsWith('page=2')) data = [{ number: 1100, title: 'Last native child', state: 'open', labels: [] }];
    else throw new Error('Unexpected external read: ' + args.join(' '));
    return { code: 0, stdout: JSON.stringify(data), stderr: '' };
  },
});
assert.ok(nativeList.ok, 'native list succeeds');
const actualSpec = nativeList.data.find(item => item.key === '80');
assert.equal(actualSpec.childrenRead.state, 'complete');
assert.equal(actualSpec.childrenRead.total, 101);
assert.equal(actualSpec.children.length, 101);
assert.equal(nativeList.data.find(item => item.key === '1100').parentKey, '80');
const panel = normalizePanelPayload('snapshot', { ok: true, value: { issues: [actualSpec] } });
assert.equal(panel.value.issues[0].children[100].number, 1100);
assert.equal(panel.value.issues[0].children[0].state, 'CLOSED');
console.log('PASS native spec child pagination and panel identity');
