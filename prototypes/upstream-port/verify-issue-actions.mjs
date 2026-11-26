import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const client = await readFile(new URL('dist/client.js', import.meta.url), 'utf8');
async function scenario(labels, expected, detail = false, exercise = null, fixtureTitle = 'Action fixture', mapStats = null) {
  const dom = new JSDOM('<main id="root"></main>', { url: 'https://actions.invalid', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  const row = { key: '10', number: 10, type: 'issue', title: fixtureTitle, state: 'OPEN', labels, assignees: [], blockedBy: [], url: 'https://github.com/fixture/repo/issues/10' };
  if (mapStats) row.type = 'map';
  const session = { id: 'actions', cwd: '/fixture' };
  const state = { current: session.id, byId: { actions: session }, items: [session] };
  const actions = [];
  const copied = [];
  Object.defineProperty(w.navigator, 'clipboard', { value: { async writeText(text) { copied.push(text); } } });
  const snapshot = { ok: true, value: { ok: true, workspaceRoot: '/fixture', repoRoot: '/fixture', repo: { owner: 'fixture', name: 'repo' }, repository: { name: 'fixture/repo', url: 'https://github.com/fixture/repo' }, issues: [row], maps: [], labels: [], selection: { backendId: 'github' }, backendModules: [{ id: 'github' }] } };
  if (mapStats) snapshot.value.maps.push({ ...row, stats: mapStats, tickets: [], children: [] });
  w.eval(client);
  const dispose = w.MattSkillsCodex.mount(w.document.getElementById('root'), {
    codexActions: { capabilities: { reliableDraft: true }, async prefill(target, text) { actions.push({ target, text }); } },
    sessions: { list: { getSnapshot: () => state, subscribe: () => () => {} }, get: () => session },
    connection: { rpc: { async call(c, e, r) {
      if (['snapshot', 'refresh'].includes(r.method)) return snapshot;
      if (r.method === 'cwd') return { ok: true, value: { ok: true, cwd: '/fixture', workspaceRoot: '/fixture' } };
      if (r.method === 'issueDetail') return { ok: true, value: { ok: true, issue: { ...row, body: 'Fixture evidence', comments: { nodes: [] } } } };
      return { ok: true, value: { ok: false } };
    } } },
  }, { sessionId: session.id, session, useSessions: sel => typeof sel === 'function' ? sel(state) : state });
  const until = async check => { for (let i = 0; i < 100; i++) { if (check()) return; await new Promise(r => setTimeout(r, 20)); } assert.fail('UI timeout: ' + w.document.body.textContent.slice(-800)); };
  try {
    const findRow = () => [...w.document.querySelectorAll('[role="button"]')].find(el => el.getAttribute('aria-label') === '#10 ' + fixtureTitle);
    await until(findRow);
    assert.equal(actions.length, 0, 'reading labels must not change the host draft');
    const rowElement = findRow();
    if (detail) {
      rowElement.click();
      await until(() => w.document.querySelector('[data-detail-primary-text]'));
      w.document.querySelector('[data-detail-primary-text]').closest('button').click();
    } else rowElement.querySelector('button').click();
    await until(() => w.document.querySelector('[data-issue-action-draft]'));
    assert.equal(actions.length, 0, 'choosing an action opens an editable preview');
    const editor = w.document.querySelector('[data-issue-action-draft]');
    for (const pattern of expected) assert.match(editor.value, pattern);
    if (labels.includes('wontfix') && labels.length === 2) assert.doesNotMatch(editor.value, /^\$triage/);
    assert.match(editor.value, /deck_issue_report/);
    assert.doesNotMatch(editor.value, /不自动执行/, 'UI draft semantics must not cancel the recipient agent task');
    assert.match(editor.value, /https:\/\/github.com\/fixture\/repo\/issues\/10/);
    if (exercise) await exercise(w, editor);
    editor.value += '\nUser refinement';
    w.document.querySelector('[data-issue-action-export="active"]').click();
    await until(() => actions.length === 1);
    assert.equal(actions[0].text, editor.value);
    assert.equal(actions[0].target, 'active');
    w.document.querySelector('[data-issue-action-export="new"]').click();
    await until(() => actions.length === 2);
    w.document.querySelector('[data-issue-action-export="copy"]').click();
    await until(() => copied.length === 1);
    assert.equal(actions[1].target, 'new');
    assert.equal(actions[1].text, editor.value);
    assert.equal(copied[0], editor.value);
  } finally { dispose(); w.close(); }
}
await scenario(['needs-info', 'bug'], [/查证/, /\$grilling/, /补齐前不实施/]);
await scenario(['wontfix', 'bug'], [/保持不做边界/, /只有用户明确要求重新评估/]);
await scenario(['bug', 'wayfinder:research'], [/^\$research/, /不触发自动修复/]);
await scenario(['bug', 'wayfinder:grilling'], [/^\$grill-with-docs/, /人来定夺/]);
await scenario(['wayfinder:prototype'], [/^\$prototype/, /用户反馈/]);
await scenario(['needs-info', 'ready-for-agent', 'bug'], [/Agent 依据最新现状与证据自主选择/, /不使用固定优先级/]);
await scenario(['wayfinder:research', 'wayfinder:prototype'], [/Agent 依据最新现状与证据自主选择/]);
await scenario(['wayfinder:map', 'wayfinder:task'], [/先查证，再请用户确认/, /确认前不实施/]);
await scenario(['wayfinder:task', 'wayfinder:research'], [/类型冲突/, /确认前不实施/]);
await scenario(['ready-for-agent', 'wayfinder:task'], [/\$implement-spec/, /缺规格先 \$to-spec/, /缺实施票先 \$to-tickets/, /非代码任务/]);
await scenario(['bug'], [/^\$diagnosing-bugs/, /缺明确就绪状态/, /不直接代码实施/]);
await scenario(['ready-for-human', 'bug'], [/必要人工步骤的原因及验证点/, /仅适合交互脚本引导时才用 \$wizard/]);
await scenario(['needs-triage', 'unrelated'], [/^\$triage/, /先用 \$triage 诊断/]);
await scenario([], [/^\$triage/, /无标签/, /不默认实施/]);
await scenario(['unrecognized'], [/^\$triage/, /不默认实施/]);
await scenario(['ready-for-agent', 'bug'], [/^\$diagnosing-bugs/, /\$implement-spec/], true);
await scenario(['ready-for-agent', 'bug', 'wayfinder:task'], [/缺规格先 \$to-spec/, /缺实施票先 \$to-tickets/, /只补缺项并复用有效产物/]);
await scenario(['ready-for-agent', 'wayfinder:task'], [], false, async (w, editor) => {
  const choice = w.document.querySelector('[data-issue-action-choice]');
  assert.ok(choice, 'preview must retain all skills and supplemental actions');
  assert.equal(choice.querySelectorAll('optgroup[label="全部技能"] option').length, 27);
  assert.equal(choice.options[0].value, 'main', 'supplements must not replace main action');
  assert.equal(w.document.querySelector('[data-issue-action-recommendations]').textContent, '暂无补充推荐；可手动选择并查证缺项。');
  choice.value = 'pr';
  choice.dispatchEvent(new w.Event('change'));
  assert.match(editor.value, /先查证补齐.*改动范围.*分支或 PR/);
  assert.doesNotMatch(editor.value, /^\$pr/);
});
await scenario(['ready-for-agent', 'wayfinder:task'], [], false, async (w, editor) => {
  const choice = w.document.querySelector('[data-issue-action-choice]');
  const set = (name, value) => {
    const field = w.document.querySelector(`[data-issue-action-context="${name}"]`);
    field.value = value;
    field.dispatchEvent(new w.Event('input'));
  };
  set('scope', 'feature/topic changes against release/2');
  set('branch', 'feature/topic');
  assert.match(w.document.querySelector('[data-issue-action-recommendations]').textContent, /\$pr/);
  choice.value = 'pr';
  choice.dispatchEvent(new w.Event('change'));
  assert.match(editor.value, /^\$pr/);
  for (const pattern of [/Summary、Evidence、Merge Danger/, /缺失或未验证如实标注/, /不创建 PR、不推送、不合并/, /feature\/topic/]) assert.match(editor.value, pattern);
  editor.value += '\nPreserve handwritten text';
  w.confirm = () => false;
  choice.value = 'code-review';
  choice.dispatchEvent(new w.Event('change'));
  assert.equal(choice.value, 'pr');
  assert.match(editor.value, /Preserve handwritten text/);
  w.confirm = () => true;
  choice.value = 'code-review';
  choice.dispatchEvent(new w.Event('change'));
  assert.match(editor.value, /先查证补齐：比较基线/);
  assert.doesNotMatch(editor.value, /^\$code-review/);
  set('baseline', 'release/2');
  w.document.querySelector('[data-issue-action-apply-context]').click();
  assert.match(editor.value, /^\$code-review/);
  assert.match(editor.value, /进行中改动亦可/);
  assert.match(editor.value, /修复进入统一 \$implement-spec/);
  assert.match(w.document.querySelector('[data-issue-action-recommendations]').textContent, /\$code-review/);
  choice.value = 'retro';
  choice.dispatchEvent(new w.Event('change'));
  assert.match(editor.value, /先查证补齐：目标编码会话、原始会话记录/);
  assert.doesNotMatch(editor.value, /^\$retro/);
  set('session', 'coding-chat-ABC');
  assert.doesNotMatch(w.document.querySelector('[data-issue-action-recommendations]').textContent, /\$retro/);
  set('record', 'logs/coding-chat-ABC.jsonl');
  set('stage', '失败结束');
  w.document.querySelector('[data-issue-action-apply-context]').click();
  assert.match(editor.value, /^\$retro/);
  for (const pattern of [/coding-chat-ABC/, /读取指定编码会话原始证据/, /先提供候选供用户选择/, /不默认当前会话/]) assert.match(editor.value, pattern);
  assert.match(w.document.querySelector('[data-issue-action-recommendations]').textContent, /\$retro/);
  choice.value = 'skill:implement';
  choice.dispatchEvent(new w.Event('change'));
  assert.match(editor.value, /^\$implement\n/);
  assert.doesNotMatch(w.document.querySelector('[data-issue-action-recommendations]').textContent, /\$implement(?:\s|、|$)/);
  choice.value = 'main';
  choice.dispatchEvent(new w.Event('change'));
  assert.match(editor.value, /标签事实：ready-for-agent、wayfinder:task/);
});
await scenario(['ready-for-agent', 'wayfinder:task'], [], false, async (w, editor) => {
  const choice = w.document.querySelector('[data-issue-action-choice]');
  choice.value = 'pr';
  choice.dispatchEvent(new w.Event('change'));
  assert.match(editor.value, /Issue：https:\/\/github.com\/fixture\/repo\/issues\/10/);
  assert.match(editor.value, /标签事实：ready-for-agent、wayfinder:task/);
  assert.match(editor.value, /Label policy\n\n先读取最新Release context/);
}, 'Label policy\n\n先读取最新Release context');
await scenario(['wayfinder:map', 'wayfinder:task'], [/先查证，再请用户确认/, /确认前不实施/], false, null, 'Action fixture', { total: 0, closed: 0 });
await scenario(['wayfinder:map', 'wayfinder:research'], [/先查证，再请用户确认/, /确认前不实施/], false, null, 'Action fixture', { total: 1, closed: 1 });
console.log('PASS shipped action click -> editable preview -> final host draft');
