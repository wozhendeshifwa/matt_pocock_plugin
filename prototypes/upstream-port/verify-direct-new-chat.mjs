import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createNativeDraftOutputs } from './native-draft-outputs.mjs';

const client = await readFile(new URL('dist/client.js', import.meta.url), 'utf8');
const projectRoot = 'C:/项目 & space/repo';

async function scenario({ detail = false, cwd = projectRoot, projectId = 'source-project', links = true, navigate = false, unavailable = false, recheckedCwd, lateIdentity = false } = {}) {
  const dom = new JSDOM('<main id="root"></main>', { url: 'https://new-draft.invalid', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  w.confirm = () => assert.fail('the normal direct new-chat path must not ask for confirmation');
  const sourceIdentity = { threadId: 'source-thread', projectRoot, projectId, cwd };
  let identity = lateIdentity ? null : sourceIdentity;
  const requests = [], copies = [];
  const actions = createNativeDraftOutputs({
    capabilities: { ...(links ? { openLinks: {} } : {}), experimental: { 'openai/message': { draft: {} } } },
    getIdentity: () => identity,
    readIdentity: async () => recheckedCwd === undefined ? identity : { ...identity, cwd: recheckedCwd },
    async request(method, params) {
      requests.push({ method, params });
      if (navigate) identity = { ...identity, threadId: 'new-thread' };
      return {};
    },
  });
  if (lateIdentity) identity = sourceIdentity;
  const row = { key: '10', number: 10, type: 'issue', title: '新草稿 & ? # fixture', state: 'OPEN', labels: ['needs-triage'], assignees: [], comments: { nodes: [] }, blockedBy: [], url: 'https://github.com/fixture/repo/issues/10' };
  const session = { id: 'source-thread', cwd: projectRoot }, sessions = { current: session.id, byId: { [session.id]: session }, items: [session] };
  const snapshot = { ok: true, value: { ok: true, workspaceRoot: projectRoot, repoRoot: projectRoot, repo: { owner: 'fixture', name: 'repo' }, repository: { name: 'fixture/repo', refId: 'fixture/repo' }, selection: { backendId: 'github' }, backendModules: [{ id: 'github' }], issues: [row], maps: [], labels: [] } };
  Object.defineProperty(w.navigator, 'clipboard', { value: { async writeText(text) { copies.push(text); } } });
  w.eval(client);
  const dispose = w.MattSkillsCodex.mount(w.document.getElementById('root'), {
    codexActions: actions,
    skillPreparation: { async prepare() { return { status: 'checked', bindings: [] }; } },
    sessions: { list: { getSnapshot: () => sessions, subscribe: () => () => {} }, get: () => session },
    connection: { rpc: { async call(c, e, r) {
      if (['snapshot', 'refresh'].includes(r.method)) return snapshot;
      if (r.method === 'cwd') return { ok: true, value: { ok: true, cwd: projectRoot, workspaceRoot: projectRoot } };
      if (r.method === 'issueDetail') return { ok: true, value: { ok: true, issue: { ...row, body: 'Source project and actual directory evidence' } } };
      if (r.method === 'skill.readDoc') return { ok: true, value: { ok: true, path: '/rules/triage', md: '# current rules', source: { kind: 'host-resolved' }, execution: { allowed: true } } };
      return { ok: true, value: { ok: false } };
    } } },
  }, { sessionId: session.id, session, useSessions: select => typeof select === 'function' ? select(sessions) : sessions });
  const until = async check => { for (let i = 0; i < 100; i++) { if (check()) return; await new Promise(r => setTimeout(r, 15)); } assert.fail('New-chat UI timed out: ' + w.document.body.textContent.slice(-700)); };
  try {
    await until(() => w.document.querySelector('[aria-label="#10 新草稿 & ? # fixture"]'));
    if (detail) { w.document.querySelector('[aria-label="#10 新草稿 & ? # fixture"]').click(); await until(() => w.document.querySelector('[data-bottom-action-bar]')); }
    const active = [...w.document.querySelectorAll('button')].find(button => button.textContent === '填入当前聊天');
    const group = active.closest('[data-issue-direct-actions]');
    const issueSurface = detail ? w.document.body : w.document.querySelector('[aria-label="#10 新草稿 & ? # fixture"]');
    assert.equal([...issueSurface.querySelectorAll('button')].some(button => button.textContent.trim() === '新会话'), false, 'the old editor entry must not masquerade as the new-chat direct action');
    const open = [...group.querySelectorAll('button')].find(button => button.textContent === '填入新聊天');
    assert.ok(open, 'the Issue action group must directly offer a new host draft');
    if (unavailable) {
      assert.equal(open.disabled, true, 'missing source identity or link capability disables new-chat injection before a click');
      assert.match(group.textContent, /新聊天.*(?:来源|目录|能力|接口)/, 'disabled new-chat action exposes its reason without requiring a click');
      [...group.querySelectorAll('button')].find(button => button.textContent === '复制').click();
      await until(() => copies.length === 1);
      assert.equal(requests.length, 0, 'copying is explicit and never falls back to another chat');
      return;
    }
    open.click();
    if (recheckedCwd !== undefined) {
      await until(() => /切换|已请求/.test(group.textContent));
      assert.match(group.textContent, /切换/, 'a changed actual source directory stops the old new-chat request');
      assert.equal(requests.length, 0);
      assert.equal(copies.length, 0);
      return;
    }
    await until(() => requests.length === 1);
    await until(() => group.textContent.includes('已请求'));
    assert.equal(requests[0].method, 'ui/open-link');
    const url = new URL(requests[0].params.url);
    assert.equal(url.searchParams.get('projectId'), 'source-project');
    assert.equal(url.searchParams.get('path'), cwd);
    const prompt = url.searchParams.get('prompt');
    assert.match(prompt, /^\$triage\n\n目标：新草稿 & \? # fixture\nIssue：https:\/\/github.com\/fixture\/repo\/issues\/10\n/);
    assert.equal(url.searchParams.get('mode'), 'codex');
    assert.equal(url.searchParams.has('send'), false);
    assert.equal(w.document.querySelector('[data-issue-action-preview]'), null, 'direct new-chat action must not mount the old editor');
    assert.doesNotMatch(group.textContent, /已填入|任务已执行|切换|取消成功/);
    [...group.querySelectorAll('button')].find(button => button.textContent === '复制').click();
    await until(() => copies.length === 1);
    assert.equal(copies[0], prompt, 'copy and new-chat routing use the same complete generated prompt');
  } finally { dispose(); w.close(); }
}

for (const detail of [false, true]) {
  await scenario({ detail });
  await scenario({ detail, cwd: 'C:/项目 & space/repo/packages/客户端' });
  await scenario({ detail, cwd: 'D:/工作树 & branches/feature/ui' });
  await scenario({ detail, navigate: true });
  await scenario({ detail, lateIdentity: true });
  await scenario({ detail, projectId: null, unavailable: true });
  await scenario({ detail, cwd: null, unavailable: true });
  await scenario({ detail, links: false, unavailable: true });
  await scenario({ detail, recheckedCwd: 'C:/worktrees/other' });
}
console.log('PASS direct new-chat actions preserve source project and directory through the production UI');
