import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const client = await readFile(new URL('dist/client.js', import.meta.url), 'utf8');

async function scenario(detail = false, exercise = null, options = {}) {
  const dom = new JSDOM('<main id="root"></main>', { url: 'https://direct.invalid', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  w.confirm = () => assert.fail('the normal direct path must not ask for confirmation');
  const row = { key: '10', number: 10, type: 'issue', title: 'Direct fixture', state: 'OPEN', labels: ['needs-triage'], assignees: [], comments: { nodes: [] }, blockedBy: [], url: 'https://github.com/fixture/repo/issues/10' };
  const session = { id: 'direct', cwd: '/direct' }, sessions = { current: 'direct', byId: { direct: session }, items: [session] };
  const snapshot = { ok: true, value: { ok: true, workspaceRoot: '/direct', repoRoot: '/direct', repo: { owner: 'fixture', name: 'repo' }, repository: { name: 'fixture/repo', refId: 'fixture/repo' }, selection: { backendId: 'github' }, backendModules: [{ id: 'github' }], issues: [row], maps: [], labels: [] } };
  const writes = [], copies = [], controls = { source: 'A', allowed: true, result: 'requested', reliable: false, fail: false };
  Object.defineProperty(w.navigator, 'clipboard', { value: { async writeText(text) { copies.push(text); } } });
  w.eval(client);
  const dispose = w.MattSkillsCodex.mount(w.document.getElementById('root'), {
    codexActions: { capabilities: { nativeDraftRequest: true, active: options.active !== false, new: false, reason: '当前宿主缺少可用追加接口', get reliableDraft() { return controls.reliable; } }, async prefill(target, text) {
      if (controls.fail) throw new Error('host unavailable');
      writes.push({ target, text });
      return controls.result === 'unknown' ? {} : { status: controls.result, target };
    } },
    skillPreparation: { async prepare() { return { status: 'checked', bindings: [] }; } },
    sessions: { list: { getSnapshot: () => sessions, subscribe: () => () => {} }, get: () => session },
    connection: { rpc: { async call(c, e, r) {
      if (['snapshot', 'refresh'].includes(r.method)) return snapshot;
      if (r.method === 'cwd') return { ok: true, value: { ok: true, cwd: '/direct', workspaceRoot: '/direct' } };
      if (r.method === 'issueDetail') return { ok: true, value: { ok: true, issue: { ...row, body: 'Direct evidence' } } };
      if (r.method === 'skill.readDoc') return { ok: true, value: { ok: true, path: '/rules/' + controls.source, md: '# source ' + controls.source, source: { kind: 'host-resolved' }, execution: { allowed: controls.allowed } } };
      return { ok: true, value: { ok: false } };
    } } },
  }, { sessionId: session.id, session, useSessions: select => typeof select === 'function' ? select(sessions) : sessions });
  const until = async check => { for (let i = 0; i < 100; i++) { if (check()) return; await new Promise(r => setTimeout(r, 15)); } assert.fail('Direct UI timed out: ' + w.document.body.textContent.slice(-500)); };
  try {
    await until(() => w.document.querySelector('[aria-label="#10 Direct fixture"]'));
    if (detail) { w.document.querySelector('[aria-label="#10 Direct fixture"]').click(); await until(() => w.document.querySelector('[data-bottom-action-bar]')); }
    const active = [...w.document.querySelectorAll('button')].find(b => b.textContent === '填入当前聊天');
    assert.ok(active, 'the primary action must be explicitly named and directly available');
    const group = active.closest('[data-issue-direct-actions]');
    assert.ok(group, 'direct feedback and copy belong to the same visible action group');
    if (exercise) await exercise({ w, active, group, until, writes, copies, controls });
    else {
      active.click(); await until(() => writes.length === 1);
      await until(() => group.textContent.includes('已请求'));
      assert.equal(writes[0].target, 'active');
      assert.ok(writes[0].text.startsWith('$triage\n\n目标：Direct fixture\nIssue：https://github.com/fixture/repo/issues/10\n'));
      assert.equal(w.document.querySelector('[data-issue-action-preview]'), null, 'direct fill must not mount the old editor');
      const copy = [...group.querySelectorAll('button')].find(b => b.textContent === '复制');
      copy.click(); await until(() => copies.length === 1);
      assert.equal(copies[0], writes[0].text, 'normal copy must use the same generated request');
      assert.doesNotMatch(group.textContent, /已填入|任务已执行/);
    }
  } finally { dispose(); w.close(); }
}

for (const detail of [false, true]) await scenario(detail);
await scenario(false, async ({ active, group, until, copies, writes }) => {
  assert.equal(active.disabled, true);
  assert.match(group.textContent, /当前宿主缺少可用追加接口/, 'unavailable direct output explains its reason before a click');
  [...group.querySelectorAll('button')].find(b => b.textContent === '复制').click();
  await until(() => copies.length === 1);
  assert.equal(writes.length, 0);
}, { active: false });
for (const detail of [false, true]) {
  await scenario(detail, async ({ active, group, until, controls, writes, copies }) => {
    controls.allowed = false;
    active.click(); await until(() => group.textContent.includes('必要来源'));
    assert.equal(writes.length, 0, 'missing necessary source conditions stop the host request');
    assert.equal(copies.length, 0, 'a blocked injection must not silently choose copying');
  });
  await scenario(detail, async ({ active, group, until, controls, writes, copies }) => {
    active.click(); await until(() => group.textContent.includes('已请求'));
    controls.source = 'B';
    [...group.querySelectorAll('button')].find(b => b.textContent === '复制').click();
    await until(() => group.textContent.includes('已变化'));
    assert.equal(writes.length, 1);
    assert.equal(copies.length, 0, 'changed sources stop the previous generated request');
  });
  for (const result of ['filled', 'unknown', 'failure']) await scenario(detail, async ({ active, group, until, controls, writes, copies }) => {
    controls.result = result;
    controls.reliable = result === 'filled';
    controls.fail = result === 'failure';
    active.click();
    await until(() => group.textContent.includes(result === 'filled' ? '已填入当前聊天' : result === 'unknown' ? '无法确认是否填入' : 'host unavailable'));
    if (result === 'filled') assert.match(group.textContent, /已填入当前聊天/);
    if (result === 'unknown') {
      assert.match(group.textContent, /无法确认是否填入，请先检查输入框/);
      assert.doesNotMatch(group.textContent, /已填入当前聊天/);
    }
    if (result === 'failure') {
      assert.match(group.textContent, /host unavailable/);
      assert.equal(writes.length, 0);
      [...group.querySelectorAll('button')].find(b => b.textContent === '复制').click();
      await until(() => copies.length === 1);
      assert.match(copies[0], /^\$triage\n\n目标：Direct fixture/);
    }
    assert.doesNotMatch(group.textContent, /任务已执行/);
  });
}
console.log('PASS direct current-chat actions and same-text copy through production sidebar');
