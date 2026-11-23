import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM, VirtualConsole } from 'jsdom';
// Exercise the host handlers used by the panel, with transport fixtures only.
if (!process.argv.includes('--baseline')) await import('./node-host.mjs');
const { createCommentThreads } = await import('../../vendor/mattskills-1.8.0-rc.7/lib/commentThreads.js');
const { createIssueDetail } = await import('../../vendor/mattskills-1.8.0-rc.7/lib/issueDetail.js');
const comments = Array.from({ length: 101 }, (_, i) => ({
  author: { login: 'fixture' }, body: `comment-${i + 1}`, createdAt: `2026-01-01T00:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}Z`,
}));
let kind = 'PullRequest';
const deps = {
  DEFAULT_CWD: '/fixture', normCwd: async x => x,
  selectEarly: async () => ({ backendId: 'github' }), isComposerSelection: () => false,
  getRepoKey: async () => ({ owner: 'fixture', name: 'repo' }),
  isRateLimitError: () => false, errText: e => e.message,
  runGh: async args => {
    const query = args.find(a => a.startsWith('query=')) || '';
    const field = query.includes('issueOrPullRequest(') ? 'issueOrPullRequest' : query.includes('pullRequest(') ? 'pullRequest' : 'issue';
    if ((field === 'issue' && kind === 'PullRequest') || (field === 'pullRequest' && kind === 'Issue')) {
      return { ok: false, kind: 'notfound', error: 'Could not resolve to an Issue' };
    }
    const after = args.find(a => a.startsWith('after='))?.slice(6);
    const start = after ? Number(Buffer.from(after, 'base64').toString()) : 0;
    const end = Math.min(start + 50, comments.length);
    return { ok: true, text: JSON.stringify({ data: { repository: { [field]: {
      __typename: kind, number: 10, state: 'OPEN', comments: {
        nodes: comments.slice(start, end), pageInfo: { hasNextPage: end < comments.length, endCursor: Buffer.from(String(end)).toString('base64') },
      },
    } } } }) };
  },
};
for (kind of ['PullRequest', 'Issue']) {
  const detail = await createIssueDetail(deps).fetchIssueDetail(10, '/fixture', { isPullRequest: kind === 'PullRequest' });
  assert.equal(detail.ok, true);
  const result = [...detail.issue.comments.nodes];
  let pageInfo = detail.issue.comments.pageInfo;
  const sizes = [result.length];
  while (pageInfo.hasNextPage) {
    const page = await createCommentThreads(deps).handleIssueComments({ number: 10, after: pageInfo.endCursor });
    assert.equal(page.ok, true, `${kind} next page: ${JSON.stringify(page)}`);
    result.push(...page.nodes); sizes.push(page.nodes.length); pageInfo = page.pageInfo;
    assert.ok(sizes.length <= 3, 'pagination must terminate');
  }
  assert.deepEqual(sizes, [50, 50, 1]);
  assert.deepEqual(result, comments);
  console.log(`PASS ${kind} 50/50/1, ordered, complete, no duplicates`);
}

const handler = runGh => createCommentThreads({ ...deps, runGh });
const read = (runGh, after = null) => handler(runGh).handleIssueComments({ number: 10, after });
const good = { ok: true, text: JSON.stringify({ data: { repository: { issueOrPullRequest: { comments: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } } } }) };
assert.equal((await read(async () => good)).ok, true, 'empty comments are valid');
for (const [response, expected] of [
  [{ ok: false, kind: 'network', error: 'HTTP 403: forbidden' }, 'auth'],
  [{ ok: false, kind: 'notfound', error: 'HTTP 404' }, 'notFound'],
  [{ ok: false, kind: 'network', error: 'rate limit exceeded' }, 'rateLimit'],
  [{ ok: false, kind: 'network', error: 'invalid cursor' }, 'parse'],
  [{ ok: false, kind: 'network', error: 'connection reset' }, 'network'],
  [{ ok: true, text: '{' }, 'parse'],
  [{ ok: true, text: '{"data":{"repository":{"issueOrPullRequest":null}}}' }, 'notFound'],
  [{ ok: true, text: '{"data":{"repository":{"issueOrPullRequest":{"comments":{"nodes":[],"pageInfo":{"hasNextPage":true,"endCursor":"same"}}}}}}' }, 'parse'],
  [{ ok: true, text: '{"errors":[{"message":"Resource not accessible by integration"}]}' }, 'auth'],
]) {
  const result = await read(async () => response, 'opaque-cursor');
  assert.equal(result.ok, false); assert.equal(result.error.kind, expected);
}
let calls = 0;
assert.equal((await read(async () => ++calls === 1 ? { ok: false, kind: 'network', error: 'timeout' } : good)).ok, true);
assert.equal(calls, 2, 'one transient failure retries once');
const restRows = comments.slice(50, 100).map(c => ({ body: c.body, user: c.author, created_at: c.createdAt }));
const restPage = await read(async args => {
  assert.match(args[1], /per_page=50&page=2$/);
  return { ok: true, text: JSON.stringify(restRows) };
}, '50');
assert.equal(restPage.ok, true); assert.equal(restPage.nodes[0].body, 'comment-51');
assert.equal(restPage.pageInfo.endCursor, '100');
assert.equal((await read(async () => assert.fail('invalid offsets must not fetch'), '51')).ok, false);
assert.equal((await read(async () => assert.fail('unsafe offsets must not fetch'), '9007199254741000')).ok, false);
// Simultaneous requests retain their own repo/cursor and may finish out of order.
const repos = ['project-a', 'project-b'];
const concurrent = await Promise.all(repos.map((name, i) => createCommentThreads({ ...deps,
  getRepoKey: async () => ({ owner: 'fixture', name }),
  runGh: async args => {
    assert.ok(args.includes(`name=${name}`)); assert.ok(args.includes(`after=cursor-${i}`));
    await new Promise(resolve => setTimeout(resolve, i === 0 ? 15 : 0));
    return good;
  },
}).handleIssueComments({ number: 10, after: `cursor-${i}` })));
assert.ok(concurrent.every(r => r.ok));
console.log('PASS empty, auth/notFound/rateLimit/network/cursor/parse failures, bounded retry, REST offset 50→page2, parallel project isolation');

// Drive the shipped panel against the same real handlers and deterministic
// transport; this is a DOM regression, separate from the live GitHub check.
kind = 'PullRequest';
const errors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', e => errors.push(e.message));
const dom = new JSDOM('<main id="root"></main>', { url: 'https://pagination.invalid/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole });
const { window } = dom;
window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
window.eval(await readFile(process.env.DECK_COMMENT_TEST_CLIENT || new URL('dist/client.js', import.meta.url), 'utf8'));
const session = { id: 'pagination-dom', cwd: '/fixture' };
const row = { key: '10', number: 10, type: 'issue', title: 'Pagination PR', state: 'OPEN', isPullRequest: true, labels: [], assignees: [], blockedBy: [], url: 'https://github.com/fixture/repo/pull/10' };
const snapshot = { ok: true, value: { ok: true, workspaceRoot: '/fixture', repoRoot: '/fixture', repo: { owner: 'fixture', name: 'repo' }, repository: { name: 'fixture/repo' }, issues: [row], maps: [], labels: [], backendModules: [{ id: 'github', capabilities: { pullRequests: true } }], selection: { backendId: 'github' } } };
const api = createCommentThreads({ ...deps, fetchIssueDetail: createIssueDetail(deps).fetchIssueDetail });
const sessionState = { current: session.id, byId: { [session.id]: session }, items: [session] };
let pageReads = 0;
const dispose = window.MattSkillsCodex.mount(window.document.getElementById('root'), {
  sessions: { list: { getSnapshot: () => sessionState, subscribe: () => () => {} }, get: () => session },
  connection: { rpc: { async call(channel, endpoint, request) {
    if (['snapshot', 'refresh'].includes(request.method)) return snapshot;
    if (request.method === 'cwd') return { ok: true, value: { ok: true, cwd: '/fixture', workspaceRoot: '/fixture' } };
    if (request.method === 'issueDetail') return { ok: true, value: await api.handleIssueDetail({ ...request.payload, isPullRequest: true }) };
    if (request.method === 'issueComments') { pageReads++; return { ok: true, value: await api.handleIssueComments(request.payload) }; }
    return { ok: true, value: { ok: false, error: { kind: 'unsupported', message: 'DOM fixture' } } };
  } } },
}, { sessionId: session.id, session, useSessions: selector => typeof selector === 'function' ? selector(sessionState) : sessionState });
const text = () => window.document.body.textContent;
const button = label => [...window.document.querySelectorAll('button')].find(b => b.textContent.trim() === label);
async function until(check) {
  for (let i = 0; i < 150; i++) { if (check()) return; await new Promise(r => setTimeout(r, 20)); }
  assert.fail('Panel timeout: ' + text().slice(-1600));
}
try {
  await until(() => button('拉取请求')); button('拉取请求').click();
  const prRow = () => window.document.querySelector('[role="button"][aria-label="#10 Pagination PR"]');
  await until(prRow); prRow().click();
  await until(() => text().includes('comment-50'));
  assert.ok(!text().includes('comment-51'));
  for (const last of ['comment-100', 'comment-101']) {
    await new Promise(resolve => setTimeout(resolve, 650)); // existing 600 ms UI throttle
    await until(() => button('加载下 50') && !button('加载下 50').disabled);
    button('加载下 50').click(); await until(() => text().includes(last));
  }
  assert.equal(pageReads, 2);
  assert.equal(button('加载下 50'), undefined);
  assert.equal(window.document.querySelector('textarea'), null, 'PR stays read-only');
  assert.deepEqual(errors, []);
  console.log('PASS shipped panel 101-comment PR: two load-more clicks, last page, read-only');
} finally { dispose(); window.close(); }
