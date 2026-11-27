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
  const writes = [], copies = [], controls = { source: 'A', allowed: true, result: 'requested', reliable: false, fail: false, reasonsByRead: [], sourceReads: 0 };
  Object.defineProperty(w.navigator, 'clipboard', { value: { async writeText(text) { if (controls.copyFailure) throw new Error(controls.copyFailure); copies.push(text); } } });
  w.eval(client);
  const dispose = w.MattSkillsCodex.mount(w.document.getElementById('root'), {
    codexActions: { capabilities: { nativeDraftRequest: true, active: options.active !== false, new: false, reason: '当前宿主缺少可用追加接口', get reliableDraft() { return controls.reliable; } }, async prefill(target, text) {
      if (controls.fail) throw new Error('host unavailable');
      writes.push({ target, text });
      return controls.result === 'unknown' ? {} : { status: controls.result, target };
    } },
    skillPreparation: { async prepare() { if (controls.prepareFailure) throw new Error('source prepare transport failed'); return { status: 'checked', bindings: [] }; } },
    sessions: { list: { getSnapshot: () => sessions, subscribe: () => () => {} }, get: () => session },
    connection: { rpc: { async call(c, e, r) {
      if (['snapshot', 'refresh'].includes(r.method)) return snapshot;
      if (r.method === 'cwd') return { ok: true, value: { ok: true, cwd: '/direct', workspaceRoot: '/direct' } };
      if (r.method === 'issueDetail') return { ok: true, value: { ok: true, issue: { ...row, labels: controls.detailLabels || { nodes: row.labels.map(name => ({ name, color: '' })) }, body: 'Direct evidence' } } };
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
    const active = [...w.document.querySelectorAll('button')].find(b => b.textContent === '填入当前聊天');
    assert.ok(active, 'the primary action must be explicitly named and directly available');
    const group = active.closest('[data-issue-direct-actions]');
    assert.ok(group, 'direct feedback and copy belong to the same visible action group');
    if (exercise) await exercise({ w, active, group, until, writes, copies, controls });
    else {
      active.click(); await until(() => writes.length === 1 || group.textContent.includes('操作失败'));
      assert.equal(writes.length, 1, 'fresh native issue detail must reach the draft outlet: ' + group.textContent);
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
await scenario(false, async ({ active, group, until, controls, writes, copies }) => {
  controls.detailLabels = { unexpected: [] };
  active.click(); await until(() => group.textContent.includes('无法读取最新标签'));
  assert.equal(writes.length, 0, 'malformed fresh labels stop the stale request instead of becoming an empty label set');
  assert.equal(copies.length, 0, 'a failed refresh never silently copies');
});
for (const detail of [false, true]) await scenario(detail, async ({ active, group, until, controls, writes, copies }) => {
  controls.allowed = false;
  controls.reasonsByRead = Array(8).fill(['必要工具不可用：GitHub；必要资料尚未核验']);
  active.click(); await until(() => writes.length === 1);
  assert.match(writes[0].text, /未核验草稿/);
  assert.match(writes[0].text, /发送后.*目标 Agent.*核验/);
  assert.match(writes[0].text, /必要工具不可用：GitHub；必要资料尚未核验/);
  assert.match(writes[0].text, /暂停依赖/);
  assert.doesNotMatch(group.textContent, /任务已执行|已填入/);
  await until(() => group.textContent.includes('已请求'));
  [...group.querySelectorAll('button')].find(b => b.textContent === '复制').click();
  await until(() => copies.length === 1);
  assert.equal(copies[0], writes[0].text, 'unverified fill and deliberate Copy retain the same warning-bearing text');
});
await scenario(false, async ({ active, group, until, controls }) => {
  controls.result = 'filled';
  controls.reliable = false;
  active.click(); await until(() => group.textContent.includes('已请求'));
  assert.doesNotMatch(group.textContent, /已填入/, 'an unverified filled receipt cannot grant a native-only outlet reliable confirmation');
});
await scenario(false, async ({ active, group, until, copies, writes }) => {
  assert.equal(active.disabled, true);
  assert.match(group.textContent, /当前宿主缺少可用追加接口/, 'unavailable direct output explains its reason before a click');
  [...group.querySelectorAll('button')].find(b => b.textContent === '复制').click();
  await until(() => copies.length === 1);
  assert.equal(writes.length, 0);
}, { active: false });
for (const detail of [false, true]) {
  await scenario(detail, async ({ active, group, until, controls, writes, copies }) => {
    const reasons = ['triage', 'implement-spec', 'to-spec', 'to-tickets'].map(name => name + '：工具及其他必要资料要求未核验；先查证，暂停依赖步骤。');
    controls.allowed = false;
    controls.reasonsByRead = Array(12).fill(reasons);
    active.click();
    await until(() => writes.length === 1);
    await until(() => group.textContent.includes('已请求'));
    for (const reason of reasons) assert.ok(writes[0].text.includes(reason), 'the unverified draft retains every prerequisite explanation for the target Agent');
    controls.copyFailure = 'Failed to execute writeText on Clipboard: Write permission denied.';
    [...group.querySelectorAll('button')].find(b => b.textContent === '复制').click();
    await until(() => group.textContent.includes(controls.copyFailure));
    assert.match(group.textContent, /未核验草稿/, 'copy failure does not replace the original request status');
    assert.equal(writes.length, 1, 'copy failure does not resubmit the host request');
    assert.equal(copies.length, 0);
    controls.copyFailure = null;
    [...group.querySelectorAll('button')].find(b => b.textContent === '复制').click();
    await until(() => copies.length === 1);
    assert.equal(copies[0], writes[0].text, 'an intentional retry can copy the retained warning-bearing text');
  });
  for (const more of [false, true]) await scenario(detail, async ({ w, active, group, until, controls, writes, copies }) => {
    controls.allowed = false;
    controls.reasonsByRead = [['旧的未核验原因'], ...Array(12).fill(['缺少 GitHub 工具授权；请连接 GitHub 后重试'])];
    if (more) {
      [...group.querySelectorAll('button')].find(b => b.textContent === '更多动作').click();
      await until(() => group.querySelector('select[aria-label="选择其他动作"]'));
      const choice = group.querySelector('select');
      choice.value = 'skill:tdd';
      choice.dispatchEvent(new w.Event('change', { bubbles: true }));
      await until(() => group.querySelector('[aria-label="更多动作"] button:not([disabled])'));
      [...group.querySelector('[aria-label="更多动作"]').querySelectorAll('button')].find(b => b.textContent === '填入当前聊天').click();
    } else active.click();
    await until(() => group.textContent.includes('操作失败'));
    assert.match(group.textContent, /已变化/, 'changed prerequisite observations still stop the stale draft until explicit regeneration');
    assert.doesNotMatch(group.textContent, /旧的未核验原因/, 'the earlier preparation diagnosis must not replace the latest check');
    assert.equal(writes.length, 0, 'a changed observation cannot silently reuse the old warning text');
    assert.equal(copies.length, 0);
    [...group.querySelectorAll('button')].find(b => b.textContent === '按最新来源重新生成并填入').click();
    await until(() => writes.length === 1);
    assert.match(writes[0].text, /缺少 GitHub 工具授权；请连接 GitHub 后重试/);
  });
  for (const failure of ['prepareFailure', 'readFailure', 'missingRule']) await scenario(detail, async ({ active, group, until, controls, writes, copies }) => {
    controls[failure] = true;
    active.click(); await until(() => group.textContent.includes('来源准备未完成'));
    assert.equal(writes.length, 0, 'a real source preparation/read failure still stops the host request');
    assert.equal(copies.length, 0, 'a stopped injection must not silently choose copying');
    assert.match(group.textContent, /生成文本已保留/);
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
