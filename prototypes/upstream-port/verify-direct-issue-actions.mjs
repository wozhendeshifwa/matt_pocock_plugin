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
  const writes = [], copies = [], controls = { prepares: 0, detailReads: 0, source: 'A', allowed: true, result: 'requested', reliable: false, fail: false, reasonsByRead: [], sourceReads: 0 };
  controls.snapshot = snapshot;
  Object.defineProperty(w.navigator, 'clipboard', { value: { async writeText(text) { if (controls.copyFailure) throw new Error(controls.copyFailure); copies.push(text); } } });
  w.eval(client);
  const dispose = w.MattSkillsCodex.mount(w.document.getElementById('root'), {
    codexActions: { capabilities: { nativeDraftRequest: true, active: options.active !== false, new: options.new === true, reason: '当前宿主缺少可用追加接口', get reliableDraft() { return controls.reliable; } }, async prefill(target, text) {
      if (controls.fail) throw new Error('host unavailable');
      writes.push({ target, text });
      if (controls.hostGate) await controls.hostGate;
      return controls.result === 'unknown' ? {} : { status: controls.result, target };
    } },
    skillPreparation: { async prepare() { controls.prepares++; if (controls.prepareFailure) throw new Error('source prepare transport failed'); return { status: 'checked', bindings: [] }; } },
    sessions: { list: { getSnapshot: () => sessions, subscribe: () => () => {} }, get: () => session },
    connection: { rpc: { async call(c, e, r) {
      if (['snapshot', 'refresh'].includes(r.method)) return snapshot;
      if (r.method === 'cwd') return { ok: true, value: { ok: true, cwd: '/direct', workspaceRoot: '/direct' } };
      if (r.method === 'issueDetail') { controls.detailReads++; return { ok: true, value: { ok: true, issue: { ...row, labels: controls.detailLabels || { nodes: row.labels.map(name => ({ name, color: '' })) }, body: 'Direct evidence' } } }; }
      if (r.method === 'skill.readDoc') {
        if (controls.readFailure) throw new Error('source read transport failed');
        if (controls.missingRule) return { ok: true, value: { ok: false, missing: true } };
        return { ok: true, value: { ok: true, path: '/rules/' + controls.source, md: '# source ' + controls.source, source: { kind: 'host-resolved' }, execution: { allowed: controls.allowed, reasons: controls.reasonsByRead[controls.sourceReads++] || [] } } };
      }
      return { ok: true, value: { ok: false } };
    } } },
  }, { sessionId: session.id, session, useSessions: select => typeof select === 'function' ? select(sessions) : sessions });
  const until = async check => { for (let i = 0; i < 100; i++) { if (check()) return; await new Promise(r => setTimeout(r, 15)); } assert.fail('Direct UI timed out: ' + w.document.body.textContent.slice(-500)); };
  try {
    await until(() => w.document.querySelector('[aria-label="#10 Direct fixture"]'));
    if (detail) { w.document.querySelector('[aria-label="#10 Direct fixture"]').click(); await until(() => w.document.querySelector('[data-bottom-action-bar]')); }
    const active = w.document.querySelector('button[aria-label="填入当前聊天"]');
    assert.ok(active, 'the primary action must be explicitly named and directly available');
    const group = active.closest('[data-issue-direct-actions]');
    assert.ok(group, 'direct feedback and copy belong to the same visible action group');
    const notice = () => w.document.querySelector('[data-draft-toast]');
    if (exercise) await exercise({ w, active, group, until, writes, copies, controls, notice });
    else {
      const detailReads = controls.detailReads;
      active.click(); await until(() => writes.length === 1 || group.textContent.includes('操作失败'));
      assert.equal(writes.length, 1, 'fresh native issue detail must reach the draft outlet: ' + group.textContent);
      assert.equal(controls.prepares, 0, 'filling a draft does not run plugin source verification');
      assert.equal(controls.sourceReads, 0, 'filling a draft does not read skill rules');
      assert.equal(controls.detailReads, detailReads, 'filling uses the visible Issue without an extra remote verification');
      assert.doesNotMatch(writes[0].text, /未核验草稿|技能 triage：|发送后，目标 Agent 必须先核验/);
      await until(() => notice()?.textContent.includes('已请求'));
      assert.equal(writes[0].target, 'active');
      assert.ok(writes[0].text.startsWith('$triage\n\n目标：Direct fixture\nIssue：https://github.com/fixture/repo/issues/10\n'));
      assert.equal(w.document.querySelector('[data-issue-action-preview]'), null, 'direct fill must not mount the old editor');
      assert.equal(group.querySelectorAll('button').length, 2, 'each task shows only its two fill outlets');
      assert.equal(group.querySelector('[role="status"]'), null, 'no text is rendered underneath fill buttons');
      assert.equal(group.querySelector('[data-issue-more-actions]'), null);
      assert.equal(w.document.querySelector('button[aria-label="更多动作"]'), null);
      assert.equal(w.document.querySelectorAll('button[aria-label="复制"]').length, 0);
      assert.doesNotMatch(w.document.querySelector('[data-draft-toast]').textContent, /已填入|任务已执行/);
    }
  } finally { dispose(); w.close(); }
}
for (const detail of [false, true]) await scenario(detail);
for (const detail of [false, true]) await scenario(detail, async ({active, until, controls, writes, notice}) => {
  controls.prepareFailure = true; controls.readFailure = true; controls.allowed = false;
  active.click(); await until(() => writes.length === 1);
  assert.doesNotMatch(writes[0].text, /未核验草稿|技能 triage：/);
  assert.equal(controls.prepares, 0); assert.equal(controls.sourceReads, 0);
  await until(() => notice()?.textContent.includes('已请求'));
});
for (const result of ['filled', 'unknown', 'failure']) await scenario(false, async ({ active, until, controls, writes, notice }) => {
  controls.result = result; controls.reliable = result === 'filled'; controls.fail = result === 'failure';
  active.click();
  await until(() => notice()?.textContent.includes(result === 'filled' ? '已填入' : result === 'unknown' ? '无法确认是否填入' : 'host unavailable'));
  assert.equal(writes.length, result === 'failure' ? 0 : 1);
  assert.doesNotMatch(notice().textContent, /任务已执行/);
});
await scenario(false, async ({active,group}) => { assert.equal(active.disabled,true); assert.match(active.title,/当前宿主缺少可用追加接口/); assert.equal(group.querySelectorAll('button').length,2); }, {active:false});
await scenario(false, async ({w,active,until,writes}) => {
  active.click(); await until(() => writes.length===1); await until(() => w.document.querySelector('[data-draft-toast]')?.textContent.includes('已请求')); await until(() => !active.disabled);
  w.document.querySelector('[aria-label="填入新聊天"]').click(); await until(() => writes.length===2);
  assert.equal(writes[0].text,writes[1].text,'both outlets use identical plain generated text');
}, {new:true});
await scenario(false, async ({w,active,until,writes,controls,notice}) => {
  let release;
  controls.hostGate = new Promise(resolve => { release = resolve; });
  active.click(); await until(() => writes.length === 1);
  const refresh = async name => {
    controls.snapshot.value.repo = { owner:'fixture', name };
    controls.snapshot.value.repository = { name:'fixture/'+name, refId:'fixture/'+name };
    [...w.document.querySelectorAll('button')].find(b => b.title === '刷新' || b.textContent === '刷新').click();
    await until(() => w.document.body.textContent.includes('fixture/'+name));
  };
  await refresh('other'); release();
  await until(() => !w.document.querySelector('[aria-label="填入当前聊天"]').disabled);
  assert.equal(notice(), null, 'late old-repository receipt must not appear on the new repository');
  await refresh('repo');
  await until(() => notice()?.textContent.includes('已请求'));
  assert.equal(writes.length,1,'returning restores feedback without resending');
});
await scenario(false, async ({w,active,until,writes,controls,notice}) => {
  controls.result='unknown'; active.click(); await until(() => notice()?.textContent.includes('无法确认'));
  [...notice().querySelectorAll('button')].find(b => b.textContent==='重试').click();
  await until(() => [...notice().querySelectorAll('button')].some(b => b.textContent==='已检查输入框，重试'));
  const retry=[...notice().querySelectorAll('button')].find(b => b.textContent==='已检查输入框，重试');
  assert.ok(retry);
  controls.snapshot.value.repo={owner:'fixture',name:'other'};
  controls.snapshot.value.repository={name:'fixture/other',refId:'fixture/other'};
  retry.click();
  [...w.document.querySelectorAll('button')].find(b=>b.title==='刷新'||b.textContent==='刷新').click();
  await until(()=>w.document.body.textContent.includes('fixture/other'));
  assert.equal(writes.length,1,'a stale retry never writes an Issue URL from another repository');
  assert.equal(notice(),null,'the old failure never acquires the new repository scope');
});
console.log('PASS plain direct fill without plugin verification or row captions');
