import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createNativeDraftOutputs } from './native-draft-outputs.mjs';

const client = await readFile(new URL('dist/client.js', import.meta.url), 'utf8');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

async function fixture({ detail = false } = {}) {
  const dom = new JSDOM('<main id="root"></main>', { url: 'https://recovery.invalid', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  const rows = [10, 11].map(number => ({ key: String(number), number, type: 'issue', title: 'Recovery ' + number, state: 'OPEN', labels: ['needs-triage'], assignees: [], comments: { nodes: [] }, blockedBy: [], url: 'https://github.com/fixture/repo/issues/' + number }));
  const controls = { source: 'A', allowed: true, sourceGate: null, hostGate: null, hostFailure: null, navigate: false, current: { threadId: 'thread-a', projectRoot: '/project', projectId: 'project-a', cwd: '/project/sub' } };
  const writes = [], copies = [];
  const actions = createNativeDraftOutputs({ capabilities: { openLinks: {}, experimental: { 'openai/message': { draft: {} } } }, getIdentity: () => controls.current, readIdentity: async () => controls.current, async request(method, params) {
    writes.push({ method, params });
    if (controls.hostFailure) throw controls.hostFailure;
    if (controls.hostGate) await controls.hostGate.promise;
    if (controls.navigate) controls.current = { ...controls.current, threadId: 'new-thread' };
    return controls.hostReply || {};
  } });
  const session = { id: 'thread-a', cwd: '/project' }, sessions = { current: session.id, byId: { [session.id]: session }, items: [session] };
  const snapshot = { ok: true, value: { ok: true, workspaceRoot: '/project', repoRoot: '/project', repo: { owner: 'fixture', name: 'repo' }, repository: { name: 'fixture/repo', refId: 'fixture/repo' }, selection: { backendId: 'github' }, backendModules: [{ id: 'github' }], issues: rows, maps: [], labels: [] } };
  Object.defineProperty(w.navigator, 'clipboard', { value: { async writeText(text) { copies.push(text); } } });
  w.confirm = () => assert.fail('normal recovery does not use a generic confirmation modal');
  w.eval(client);
  const dispose = w.MattSkillsCodex.mount(w.document.getElementById('root'), {
    codexActions: actions,
    skillPreparation: { async prepare() { if (controls.sourceGate) await controls.sourceGate.promise; return { status: 'checked', bindings: [] }; } },
    sessions: { list: { getSnapshot: () => sessions, subscribe: () => () => {} }, get: () => session },
    connection: { rpc: { async call(c, e, r) {
      if (['snapshot', 'refresh'].includes(r.method)) return snapshot;
      if (r.method === 'cwd') return { ok: true, value: { ok: true, cwd: '/project', workspaceRoot: '/project' } };
      if (r.method === 'issueDetail') return { ok: true, value: { ok: true, issue: { ...rows.find(row => row.number === r.payload.number), body: 'Recovery evidence' } } };
      if (r.method === 'skill.readDoc') return { ok: true, value: { ok: true, path: '/rules/' + controls.source, md: '# ' + controls.source, source: { kind: 'host-resolved' }, execution: { allowed: controls.allowed } } };
      return { ok: true, value: { ok: false } };
    } } },
  }, { sessionId: session.id, session, useSessions: select => typeof select === 'function' ? select(sessions) : sessions });
  const until = async predicate => { for (let i = 0; i < 180; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); } assert.fail('Recovery UI timeout: ' + w.document.body.textContent.slice(-1300)); };
  await until(() => w.document.querySelector('[aria-label="#10 Recovery 10"]'));
  if (detail) { w.document.querySelector('[aria-label="#10 Recovery 10"]').click(); await until(() => w.document.querySelector('[data-bottom-action-bar]')); }
  const group = number => detail ? w.document.querySelector('[data-issue-direct-actions]') : w.document.querySelector('[aria-label="#' + number + ' Recovery ' + number + '"] [data-issue-direct-actions]');
  const button = (label, number = 10) => [...group(number).querySelectorAll('button')].find(button => button.textContent === label);
  return { w, controls, rows, writes, copies, until, group, button, close() { dispose(); w.close(); } };
}

for (const detail of [false, true]) {
  const f = await fixture({ detail });
  try {
    f.button('填入当前聊天').click(); await f.until(() => f.group(10).textContent.includes('已请求'));
    f.controls.source = 'B';
    f.button('填入当前聊天').click(); await f.until(() => f.group(10).textContent.includes('已变化'));
    assert.equal(f.writes.length, 1);
    const regenerate = f.button('按最新来源重新生成并填入');
    assert.ok(regenerate, 'source changes expose an explicit regeneration action beside the stopped request');
    regenerate.click(); await f.until(() => f.writes.length === 2);
    assert.match(f.writes[1].params.content[0].text, /路径：\/rules\/B/);
  } finally { f.close(); }
}
{
  const f = await fixture();
  try {
    f.controls.hostGate = deferred();
    f.button('填入当前聊天').click(); await f.until(() => f.writes.length === 1);
    assert.equal(f.button('填入当前聊天', 11).disabled, true, 'pending injection pauses other Issue actions in this sidebar');
    assert.equal(f.button('填入新聊天', 11).disabled, true);
    assert.equal(f.w.document.querySelector('[data-board-action="fixate"]').disabled, true, 'the same sidebar toolbar cannot submit a competing injection');
    assert.equal(f.button('复制').disabled, false, 'deliberate copying stays available during a host request');
    f.button('复制').click(); await f.until(() => f.copies.length === 1);
    assert.equal(f.copies[0], f.writes[0].params.content[0].text);
    f.controls.hostGate.resolve(); await f.until(() => !f.button('填入当前聊天', 11).disabled);
    assert.equal(f.writes.length, 1);
  } finally { f.close(); }
}
for (const target of ['填入当前聊天', '填入新聊天']) {
  const f = await fixture();
  try {
    f.controls.sourceGate = deferred();
    f.button(target).click(); await f.until(() => f.group(10).textContent.includes('正在核验'));
    f.controls.current = { ...f.controls.current, threadId: 'other-thread' };
    f.controls.sourceGate.resolve();
    await f.until(() => /切换|已请求/.test(f.group(10).textContent));
    assert.equal(f.writes.length, 0, 'a target switch during source preparation cannot retarget the old click');
    assert.match(f.group(10).textContent, /切换/);
  } finally { f.close(); }
}
for (const target of ['填入当前聊天', '填入新聊天']) {
  const f = await fixture();
  try {
    f.controls.hostFailure = new Error('transport timed out');
    f.button(target).click(); await f.until(() => /操作失败|无法确认/.test(f.group(10).textContent));
    assert.match(f.group(10).textContent, /无法确认是否填入/, 'transport loss after posting is an unknown write outcome');
    assert.equal(f.writes.length, 1);
    const original = target === '填入当前聊天' ? f.writes[0].params.content[0].text : new URL(f.writes[0].params.url).searchParams.get('prompt');
    f.controls.allowed = false;
    f.button('复制').click(); await f.until(() => f.copies.length === 1);
    assert.equal(f.copies[0], original, 'failure recovery copies the retained text without silently regenerating or changing it');
    f.controls.allowed = true;
    f.controls.hostFailure = null;
    f.button('重试').click(); await f.until(() => f.button('已检查输入框，重试'));
    assert.equal(f.writes.length, 1, 'unknown-result retry first reminds the user to inspect the composer');
    f.button('已检查输入框，重试').click(); await f.until(() => f.writes.length === 2);
    await f.until(() => f.group(10).textContent.includes('已请求'));
  } finally { f.close(); }
}
for (const relevant of [true, false]) {
  const f = await fixture();
  try {
    f.controls.sourceGate = deferred();
    f.button('填入当前聊天').click(); await f.until(() => f.group(10).textContent.includes('正在核验'));
    f.rows[0].labels = relevant ? ['ready-for-agent', 'wayfinder:task'] : ['needs-triage', 'unrelated-note'];
    f.controls.sourceGate.resolve();
    await f.until(() => /推荐动作已更新|已请求/.test(f.group(10).textContent));
    assert.equal(f.writes.length, relevant ? 0 : 1, 'only a changed recommended action stops the old request');
    if (relevant) {
      f.button('填入当前聊天').click(); await f.until(() => f.writes.length === 1);
      assert.match(f.writes[0].params.content[0].text, /标签事实：ready-for-agent、wayfinder:task/);
      assert.doesNotMatch(f.writes[0].params.content[0].text, /标签事实：needs-triage/);
    }
  } finally { f.close(); }
}
{
  const f = await fixture();
  try {
    f.controls.allowed = false;
    f.button('填入当前聊天').click(); await f.until(() => f.group(10).textContent.includes('已请求'));
    assert.equal(f.writes.length, 1, 'unknown execution conditions allow an explicitly unverified draft');
    f.controls.allowed = true;
    f.button('填入当前聊天').click(); await f.until(() => f.button('按最新来源重新生成并填入'));
    assert.equal(f.writes.length, 1, 'changed preparation evidence still needs explicit regeneration');
    f.button('按最新来源重新生成并填入').click(); await f.until(() => f.writes.length === 2);
  } finally { f.close(); }
}
{
  const f = await fixture({ detail: true });
  try {
    f.controls.hostGate = deferred();
    f.button('填入当前聊天').click(); await f.until(() => f.writes.length === 1);
    f.w.document.querySelector('[data-detail-back-text]').closest('button').click();
    await f.until(() => f.w.document.querySelector('[aria-label="#11 Recovery 11"]'));
    f.w.document.querySelector('[aria-label="#11 Recovery 11"]').click();
    await f.until(() => f.w.document.querySelector('[data-bottom-action-bar]'));
    f.controls.hostGate.resolve();
    await f.until(() => !f.button('填入当前聊天').disabled);
    assert.doesNotMatch(f.group(11).textContent, /已请求|正在核验/, 'a late result must not attach to the newly selected Issue');
    f.w.document.querySelector('[data-detail-back-text]').closest('button').click();
    await f.until(() => f.w.document.querySelector('[aria-label="#10 Recovery 10"]'));
    f.w.document.querySelector('[aria-label="#10 Recovery 10"]').click();
    await f.until(() => f.w.document.querySelector('[data-bottom-action-bar]'));
    assert.match(f.group(10).textContent, /已请求/, 'the completed result remains with its original Issue');
  } finally { f.close(); }
}
for (const target of ['填入当前聊天', '填入新聊天']) {
  const f = await fixture();
  try {
    f.controls.hostGate = deferred();
    f.button(target).click(); await f.until(() => f.writes.length === 1);
    f.controls.current = { threadId: 'other', projectId: 'other', projectRoot: '/other', cwd: '/other' };
    f.controls.hostGate.resolve(); await f.until(() => /无法确认|操作失败|已请求/.test(f.group(10).textContent));
    assert.match(f.group(10).textContent, /无法确认/, 'a different project after posting remains an unknown outcome');
    assert.equal(f.writes.length, 1);
    assert.equal(f.copies.length, 0);
  } finally { f.close(); }
}
{
  const f = await fixture();
  try {
    f.controls.navigate = true;
    f.button('填入新聊天').click(); await f.until(() => f.group(10).textContent.includes('已请求'));
    assert.doesNotMatch(f.group(10).textContent, /无法确认|取消|切换/);
  } finally { f.close(); }
}
{
  const f = await fixture();
  try {
    f.button('更多动作').click(); await f.until(() => f.group(10).querySelector('select[aria-label="选择其他动作"]'));
    const choice = f.group(10).querySelector('select[aria-label="选择其他动作"]');
    choice.value = 'pr'; choice.dispatchEvent(new f.w.Event('change', { bubbles: true }));
    await f.until(() => f.group(10).querySelector('[aria-label="分支或 PR"]'));
    for (const [label, value] of [['改动范围', 'Approved scope'], ['分支或 PR', 'codex/explicit-pr']]) {
      const field = f.group(10).querySelector('[aria-label="' + label + '"]'); field.value = value; field.dispatchEvent(new f.w.Event('input', { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 0));
    }
    f.controls.hostGate = deferred();
    f.button('填入当前聊天').click(); await f.until(() => f.writes.length === 1);
    const panel = f.group(10).querySelector('[aria-label="更多动作"]');
    [...panel.querySelectorAll('button')].find(button => button.textContent === '复制').click();
    await f.until(() => f.copies.length === 1);
    assert.match(f.copies[0], /^\$pr\n/, 'copying another explicitly selected action cannot silently copy the pending primary request');
    assert.match(f.copies[0], /分支或 PR：codex\/explicit-pr/);
    f.controls.hostGate.resolve(); await f.until(() => !f.button('填入当前聊天').disabled);
  } finally { f.close(); }
}
{
  const f = await fixture();
  try {
    f.controls.hostReply = { isError: true };
    f.button('填入当前聊天').click(); await f.until(() => f.group(10).textContent.includes('宿主拒绝'));
    assert.doesNotMatch(f.group(10).textContent, /无法确认/, 'an explicit rejection remains a definite failure');
    f.controls.hostReply = null;
    f.controls.allowed = false;
    f.button('重试').click(); await f.until(() => f.group(10).textContent.includes('已变化'));
    assert.equal(f.writes.length, 1, 'retry rechecks the retained source snapshot before sending another host request');
    f.button('按最新来源重新生成并填入').click(); await f.until(() => f.writes.length === 2);
    assert.match(f.writes[1].params.content[0].text, /未核验草稿/);
  } finally { f.close(); }
}
{
  const f = await fixture();
  try {
    f.controls.hostFailure = new Error('transport timed out');
    f.button('填入当前聊天').click(); await f.until(() => f.group(10).textContent.includes('无法确认'));
    f.controls.hostFailure = null;
    f.controls.current = { ...f.controls.current, threadId: 'another-thread' };
    f.button('重试').click(); await f.until(() => f.button('已检查输入框，重试'));
    f.button('已检查输入框，重试').click();
    await f.until(() => /切换|已请求/.test(f.group(10).textContent));
    assert.equal(f.writes.length, 1, 'retry cannot silently move the retained operation into a different chat');
  } finally { f.close(); }
}
{
  const f = await fixture();
  try {
    f.button('填入当前聊天').click(); await f.until(() => f.writes.length === 1);
    await f.until(() => !f.button('填入当前聊天').disabled);
    f.button('复制').click(); await f.until(() => f.copies.length === 1);
    f.controls.source = 'B';
    f.button('复制').click(); await f.until(() => f.button('按最新来源重新生成并填入'));
    f.button('按最新来源重新生成并填入').click(); await f.until(() => f.copies.length === 2);
    assert.match(f.copies[1], /路径：\/rules\/B/);
    assert.equal(f.writes.length, 1, 'explicit copy regeneration does not switch into chat injection');
  } finally { f.close(); }
}
console.log('PASS direct recovery, result isolation and sidebar waiting through production UI');
