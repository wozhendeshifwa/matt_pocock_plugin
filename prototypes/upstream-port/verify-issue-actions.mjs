import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const client = await readFile(new URL('dist/client.js', import.meta.url), 'utf8');
async function scenario(labels, expected, detail = false) {
  const dom = new JSDOM('<main id="root"></main>', { url: 'https://actions.invalid', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  const row = { key: '10', number: 10, type: 'issue', title: 'Action fixture', state: 'OPEN', labels, assignees: [], blockedBy: [], url: 'https://github.com/fixture/repo/issues/10' };
  const session = { id: 'actions', cwd: '/fixture' };
  const state = { current: session.id, byId: { actions: session }, items: [session] };
  const actions = [];
  const copied = [];
  Object.defineProperty(w.navigator, 'clipboard', { value: { async writeText(text) { copied.push(text); } } });
  const snapshot = { ok: true, value: { ok: true, workspaceRoot: '/fixture', repoRoot: '/fixture', repo: { owner: 'fixture', name: 'repo' }, repository: { name: 'fixture/repo', url: 'https://github.com/fixture/repo' }, issues: [row], maps: [], labels: [], selection: { backendId: 'github' }, backendModules: [{ id: 'github' }] } };
  w.eval(client);
  const dispose = w.MattSkillsCodex.mount(w.document.getElementById('root'), {
    codexActions: { async prefill(target, text) { actions.push({ target, text }); } },
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
    await until(() => w.document.querySelector('[role="button"][aria-label="#10 Action fixture"]'));
    assert.equal(actions.length, 0, 'reading labels must not change the host draft');
    const rowElement = w.document.querySelector('[role="button"][aria-label="#10 Action fixture"]');
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
    assert.match(editor.value, /https:\/\/github.com\/fixture\/repo\/issues\/10/);
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
console.log('PASS shipped action click -> editable preview -> final host draft');
