import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const client = await readFile(new URL('dist/client.js', import.meta.url), 'utf8');

function fixture({ newAvailable = false } = {}) {
  const dom = new JSDOM('<main id="root"></main>', { url: 'https://more.invalid', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  w.confirm = () => assert.fail('choosing an action does not open a draft-replacement confirmation');
  const writes = [], copies = [];
  let dispose, sequence = 0;
  Object.defineProperty(w.navigator, 'clipboard', { value: { async writeText(text) { copies.push(text); } } });
  w.eval(client);
  const until = async check => { for (let i = 0; i < 120; i++) { if (check()) return; await new Promise(r => setTimeout(r, 15)); } assert.fail('More-actions UI timed out: ' + w.document.body.textContent.slice(-700)); };
  async function open({ project = '/more-a', number = 10, repo = 'fixture/repo', effortId = '', backend = 'github', detail = false, labels = ['needs-triage'] } = {}) {
    dispose?.();
    const session = { id: 'more-thread-' + (++sequence), cwd: project }, sessions = { current: session.id, byId: { [session.id]: session }, items: [session] };
    const row = { key: String(number), number, effortId, type: 'issue', title: 'More fixture ' + number, state: 'OPEN', labels, assignees: [], comments: { nodes: [] }, blockedBy: [], url: 'https://github.com/' + repo + '/issues/' + number };
    const snapshot = { ok: true, value: { ok: true, workspaceRoot: project, repoRoot: project, repo: { owner: repo.split('/')[0], name: repo.split('/')[1] }, repository: { name: repo, refId: repo }, selection: { backendId: backend }, backendModules: [{ id: backend }], issues: [row], maps: [], labels: [] } };
    dispose = w.MattSkillsCodex.mount(w.document.getElementById('root'), {
      codexActions: { capabilities: { nativeDraftRequest: true, active: true, new: newAvailable }, async prefill(target, text) { writes.push({ target, text }); return { status: 'requested', target }; } },
      skillPreparation: { async prepare() { return { status: 'checked', bindings: [] }; } },
      sessions: { list: { getSnapshot: () => sessions, subscribe: () => () => {} }, get: () => session },
      connection: { rpc: { async call(c, e, r) {
        if (['snapshot', 'refresh'].includes(r.method)) return snapshot;
        if (r.method === 'cwd') return { ok: true, value: { ok: true, cwd: project, workspaceRoot: project } };
        if (r.method === 'issueDetail') return { ok: true, value: { ok: true, issue: { ...row, body: 'More action source' } } };
        if (r.method === 'skill.readDoc') return { ok: true, value: { ok: true, path: '/rules/' + r.payload.name, md: '# stable rules', source: { kind: 'host-resolved' }, execution: { allowed: true } } };
        return { ok: true, value: { ok: false } };
      } } },
    }, { sessionId: session.id, session, useSessions: select => typeof select === 'function' ? select(sessions) : sessions });
    await until(() => w.document.querySelector('[aria-label="#' + number + ' More fixture ' + number + '"]'));
    if (detail) { w.document.querySelector('[aria-label="#' + number + ' More fixture ' + number + '"]').click(); await until(() => w.document.querySelector('[data-bottom-action-bar]')); }
    const group = w.document.querySelector('[data-issue-direct-actions]');
    const button = text => [...group.querySelectorAll('button')].find(b => b.textContent === text);
    assert.ok(button('更多动作'), 'the production direct action group offers compact more actions');
    return { group, button };
  }
  const change = async (field, value) => { field.value = value; field.dispatchEvent(new w.Event(field.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); await new Promise(r => setTimeout(r, 0)); };
  return { w, writes, copies, until, open, change, close() { dispose?.(); w.close(); } };
}

for (const detail of [false, true]) {
  const f = fixture();
  try {
    const { group, button } = await f.open({ detail });
    button('更多动作').click();
    await f.until(() => group.querySelector('select[aria-label="选择其他动作"]'));
    const choice = group.querySelector('select[aria-label="选择其他动作"]');
    assert.ok(choice);
    assert.equal(choice.querySelectorAll('optgroup[label="全部技能"] option').length,27);
    await f.change(choice, 'pr');
    const field = label => group.querySelector('[aria-label="' + label + '"]');
    assert.ok(field('改动范围'));
    assert.ok(field('分支或 PR'));
    const panel = group.querySelector('[aria-label="更多动作"]');
    const inject = [...panel.querySelectorAll('button')].find(b => b.textContent === '填入当前聊天');
    const newChat = [...panel.querySelectorAll('button')].find(b => b.textContent === '填入新聊天');
    assert.equal(inject.disabled, true, 'missing required context prevents injection');
    await f.change(field('改动范围'), 'Only the approved feature');
    await f.change(field('分支或 PR'), 'codex/explicit-feature');
    assert.equal(inject.disabled, false);
    assert.equal(newChat.disabled, true, 'more actions respect unavailable host outlets');
    inject.click();
    await f.until(() => f.writes.length === 1);
    assert.match(f.writes[0].text, /^\$pr\n\n目标：More fixture 10/);
    for(const pattern of [/Summary、Evidence、Merge Danger/,/缺失或未验证如实标注/,/不创建 PR、不推送、不合并/]) assert.match(f.writes[0].text,pattern);
    assert.match(f.writes[0].text, /改动范围：Only the approved feature/);
    assert.match(f.writes[0].text, /分支或 PR：codex\/explicit-feature/);
    assert.equal(f.w.document.querySelector('[data-issue-action-preview]'), null);
    await f.until(() => group.textContent.includes('已请求'));
    [...panel.querySelectorAll('button')].find(b => b.textContent === '取消').click();
    await f.until(() => !group.querySelector('[aria-label="更多动作"]'));
    button('填入当前聊天').click();
    await f.until(() => f.writes.length === 2);
    assert.match(f.writes[1].text, /^\$triage\n/, 'remembering a manual choice never changes the label-driven primary action');
    await f.until(() => !button('填入当前聊天').disabled);
    button('更多动作').click();
    await f.until(() => group.querySelector('select[aria-label="选择其他动作"]'));
    assert.equal(group.querySelector('select[aria-label="选择其他动作"]').value, 'pr');
    assert.equal(field('分支或 PR').value, 'codex/explicit-feature');
    assert.equal(f.writes.length, 2, 'restoring a selection does not execute it');
    await f.change(group.querySelector('select[aria-label="选择其他动作"]'), 'code-review');
    assert.equal(field('分支或 PR'), null, 'only context needed by the selected action is shown');
    assert.ok(field('比较基线'));
    await f.change(field('比较基线'), 'release-v2');
    const reviewPanel = group.querySelector('[aria-label="更多动作"]');
    [...reviewPanel.querySelectorAll('button')].find(b => b.textContent === '填入当前聊天').click();
    await f.until(() => f.writes.length === 3);
    assert.match(f.writes[2].text, /^\$code-review\n/);
    assert.match(f.writes[2].text,/进行中改动亦可/);assert.match(f.writes[2].text,/修复进入统一 \$implement-spec/);
    assert.match(f.writes[2].text, /比较基线：release-v2/);
    assert.doesNotMatch(f.writes[2].text, /分支或 PR：/, 'retained fields for another action are not injected into this request');
  } finally { f.close(); }
}

{
  const f = fixture();
  try {
    async function menu(options) {
      const view = await f.open(options);
      view.button('更多动作').click();
      await f.until(() => view.group.querySelector('select[aria-label="选择其他动作"]'));
      return { ...view, choice: view.group.querySelector('select[aria-label="选择其他动作"]'), field: label => view.group.querySelector('[aria-label="' + label + '"]') };
    }
    let view = await menu();
    await f.change(view.choice, 'retro');
    assert.equal(view.field('目标编码会话').value, '', 'a target coding session is never inferred from the current chat');
    assert.equal(view.field('原始会话记录').value, '');
    assert.equal(view.field('改动范围'), null);
    assert.equal(view.field('分支或 PR'), null);
    assert.equal(view.field('比较基线'), null);
    await f.change(view.field('目标编码会话'), 'explicit-coding-session');
    await f.change(view.field('原始会话记录'), 'explicit-record-pointer');
    await f.change(view.field('阶段／观察'), '失败结束');
    const panel = view.group.querySelector('[aria-label="更多动作"]');
    [...panel.querySelectorAll('button')].find(b => b.textContent === '复制').click();
    await f.until(() => f.copies.length === 1);
    assert.match(f.copies[0], /^\$retro\n/);
    for(const pattern of [/读取指定编码会话原始证据/,/先提供候选供用户选择/,/不默认当前会话/]) assert.match(f.copies[0],pattern);
    assert.match(f.copies[0], /目标编码会话：explicit-coding-session/);
    assert.match(f.copies[0], /原始会话记录：explicit-record-pointer/);
    assert.match(f.copies[0], /阶段／观察：失败结束/);
    assert.equal(f.writes.length, 0, 'copying is not a host draft submission');
    view = await menu({ detail: true });
    assert.equal(view.choice.value, 'retro', 'a new chat for the same project and Issue restores the manual selection');
    assert.equal(view.field('目标编码会话').value, 'explicit-coding-session');
    assert.equal(view.field('阶段／观察').value, '失败结束');
    assert.equal(f.copies.length, 1);
    assert.equal(f.writes.length, 0, 'restoring context never executes the remembered action');
    const restoredPanel = view.group.querySelector('[aria-label="更多动作"]');
    [...restoredPanel.querySelectorAll('button')].find(b => b.textContent === '填入当前聊天').click();
    await f.until(() => f.writes.length === 1);
    assert.match(f.writes[0].text, /^\$retro\n/);
    assert.match(f.writes[0].text, /目标编码会话：explicit-coding-session/);
    for (const options of [{ number: 11 }, { repo: 'fixture/another' }, { project: '/more-b' }, { backend: 'markdown' }, { effortId: 'separate-effort' }]) {
      view = await menu(options);
      assert.equal(view.choice.value, '', 'other Issue/project/repository/backend/effort starts without another task’s manual choice');
      await f.change(view.choice, 'retro');
      assert.equal(view.field('目标编码会话').value, '');
      assert.equal(view.field('原始会话记录').value, '');
    }
    view = await menu({ labels: ['wayfinder:research'] });
    assert.equal(view.choice.value, 'retro');
    assert.equal(view.field('目标编码会话').value, 'explicit-coding-session');
    view.button('填入当前聊天').click();
    await f.until(() => f.writes.length === 2);
    assert.match(f.writes[1].text, /^\$research\n/, 'the main action always follows the latest labels despite restored more-action state');
    assert.doesNotMatch(f.writes[1].text, /目标编码会话：/);
  } finally { f.close(); }
}

{
  const f = fixture({ newAvailable: true });
  try {
    const { group, button } = await f.open({ detail: true });
    button('更多动作').click();
    await f.until(() => group.querySelector('select[aria-label="选择其他动作"]'));
    await f.change(group.querySelector('select[aria-label="选择其他动作"]'), 'skill:research');
    const panel = group.querySelector('[aria-label="更多动作"]');
    assert.equal(panel.querySelector('input'), null, 'skills without known contextual requirements do not show unrelated fields');
    [...panel.querySelectorAll('button')].find(b => b.textContent === '填入新聊天').click();
    await f.until(() => f.writes.length === 1);
    assert.match(f.writes[0].text, /^\$research\n/);
    assert.equal(f.writes[0].target, 'new');
    assert.equal(f.w.document.querySelector('[data-issue-action-preview]'), null);
  } finally { f.close(); }
}
console.log('PASS more actions through production sidebar');
