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
  const actions = createNativeDraftOutputs({ capabilities: { openLinks: {}, experimental: { 'openai/message': { draft: {} } } }, getIdentity: () => controls.current, readIdentity: async () => { if (controls.identityGate) await controls.identityGate.promise; return controls.current; }, async request(method, params) {
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
      if (r.method === 'issueDetail') {
        const row = rows.find(row => row.number === r.payload.number);
        return { ok: true, value: { ok: true, issue: { ...row, labels: { nodes: row.labels.map(name => ({ name, color: '' })) }, body: 'Recovery evidence' } } };
      }
      if (r.method === 'skill.readDoc') return { ok: true, value: { ok: true, path: '/rules/' + controls.source, md: '# ' + controls.source, source: { kind: 'host-resolved' }, execution: { allowed: controls.allowed } } };
      return { ok: true, value: { ok: false } };
    } } },
  }, { sessionId: session.id, session, useSessions: select => typeof select === 'function' ? select(sessions) : sessions });
  const until = async predicate => { for (let i = 0; i < 180; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); } assert.fail('Recovery UI timeout: ' + w.document.body.textContent.slice(-1300)); };
  await until(() => w.document.querySelector('[aria-label="#10 Recovery 10"]'));
  if (detail) { w.document.querySelector('[aria-label="#10 Recovery 10"]').click(); await until(() => w.document.querySelector('[data-bottom-action-bar]')); }
  const group = number => detail ? w.document.querySelector('[data-issue-direct-actions]') : w.document.querySelector('[aria-label="#' + number + ' Recovery ' + number + '"] [data-issue-direct-actions]');
  const button = (label, number = 10) => [...group(number).querySelectorAll('button')].find(button => button.getAttribute('aria-label') === label) || [...w.document.querySelectorAll('[data-draft-toast] button')].find(button => button.textContent === label);
  return { w, controls, rows, writes, copies, until, group, button, close() { dispose(); w.close(); } };
}

const notice = f => f.w.document.querySelector('[data-draft-toast]')?.textContent || '';
for (const detail of [false,true]) {
 const f=await fixture({detail}); try {
   f.button('填入当前聊天').click(); await f.until(()=>notice(f).includes('已请求'));
   assert.equal(f.writes.length,1); assert.doesNotMatch(f.writes[0].params.content[0].text,/未核验草稿|路径：/);
   assert.equal(f.group(10).querySelector('[role="status"]'),null);
 } finally {f.close()}
}
{
 const f=await fixture(); try {
  f.controls.hostGate=deferred(); f.button('填入当前聊天').click(); await f.until(()=>f.writes.length===1);
  assert.equal(f.button('填入当前聊天',11).disabled,true); assert.equal(f.button('填入新聊天',11).disabled,true);
  assert.equal(f.w.document.querySelector('[data-board-action="fixate"]').disabled,true);
  assert.equal(f.copies.length,0); f.controls.hostGate.resolve(); await f.until(()=>notice(f).includes('已请求'));
  assert.equal(f.writes.length,1);
 } finally {f.close()}
}
for(const target of ['填入当前聊天','填入新聊天']) {
 const f=await fixture(); try {
  f.controls.identityGate=deferred(); f.button(target).click();
  f.controls.current={...f.controls.current,threadId:'other-thread'}; f.controls.identityGate.resolve();
  await f.until(()=>notice(f).includes('切换')); assert.equal(f.writes.length,0);
 } finally {f.close()}
}
for(const target of ['填入当前聊天','填入新聊天']) {
 const f=await fixture(); try {
  f.controls.hostFailure=new Error('transport timed out'); f.button(target).click(); await f.until(()=>notice(f).includes('无法确认'));
  assert.equal(f.writes.length,1); f.controls.hostFailure=null;
  f.button('重试').click(); await f.until(()=>f.button('已检查输入框，重试')); assert.equal(f.writes.length,1);
  f.button('已检查输入框，重试').click(); await f.until(()=>f.writes.length===2); await f.until(()=>notice(f).includes('已请求'));
  assert.equal(f.copies.length,0);
 } finally {f.close()}
}
{
 const f=await fixture(); try {
  f.controls.hostFailure=new Error('transport timed out'); f.button('填入当前聊天').click(); await f.until(()=>notice(f).includes('无法确认'));
  f.controls.hostFailure=null; f.controls.current={...f.controls.current,threadId:'changed'};
  f.button('重试').click(); await f.until(()=>f.button('已检查输入框，重试')); f.button('已检查输入框，重试').click();
  await f.until(()=>notice(f).includes('切换')); assert.equal(f.writes.length,1);
 } finally {f.close()}
}
{
 const f=await fixture(); try {
  f.controls.navigate=true; f.button('填入新聊天').click(); await f.until(()=>notice(f).includes('已请求'));
  assert.doesNotMatch(notice(f),/无法确认|切换|取消/);
 } finally {f.close()}
}
{
 const f=await fixture(); try {
  f.controls.hostReply={isError:true}; f.button('填入当前聊天').click(); await f.until(()=>notice(f).includes('宿主拒绝'));
  assert.doesNotMatch(notice(f),/无法确认/); f.controls.hostReply=null; f.button('重试').click(); await f.until(()=>f.writes.length===2);
  await f.until(()=>notice(f).includes('已请求'));
 } finally {f.close()}
}
{
 const f=await fixture({detail:true}); try {
  f.controls.hostGate=deferred(); f.button('填入当前聊天').click(); await f.until(()=>f.writes.length===1);
  f.w.document.querySelector('[data-detail-back-text]').closest('button').click(); await f.until(()=>f.w.document.querySelector('[aria-label="#11 Recovery 11"]'));
  f.w.document.querySelector('[aria-label="#11 Recovery 11"]').click(); await f.until(()=>f.w.document.querySelector('[data-bottom-action-bar]'));
  f.controls.hostGate.resolve(); await f.until(()=>notice(f).includes('已请求'));
  assert.match(notice(f),/#10/); assert.doesNotMatch(f.group(11).textContent,/已请求/);
 } finally {f.close()}
}
console.log('PASS plain-fill host target, waiting, navigation and retry protections');
