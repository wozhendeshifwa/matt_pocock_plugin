import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const client = await readFile(new URL('dist/client.js', import.meta.url), 'utf8');

function fixture() {
  const dom = new JSDOM('<main id="root"></main>', { url: 'https://legacy.invalid', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  w.confirm = () => assert.fail('recovering legacy text never asks to replace it');
  const copies = [], writes = [], observations = [];
  let dispose, sequence = 0, source = 'stable', copyFails = false, hostDelay;
  Object.defineProperty(w.navigator, 'clipboard', { value: { async writeText(text) { if (copyFails) throw new Error('clipboard unavailable'); copies.push(text); } } });
  w.eval(client);
  const until = async check => { for (let i = 0; i < 140; i++) { if (check()) return; await new Promise(r => setTimeout(r, 15)); } assert.fail('Legacy-copy UI timed out: ' + w.document.body.textContent.slice(-900)); };
  async function open({ project = '/legacy-a', number = 10, repo = 'fixture/repo', effortId = '', backend = 'github', detail = false } = {}) {
    dispose?.();
    const session = { id: 'legacy-thread-' + (++sequence), cwd: project }, sessions = { current: session.id, byId: { [session.id]: session }, items: [session] };
    const row = { key: String(number), number, effortId, type: 'issue', title: 'Legacy fixture ' + number, state: 'OPEN', labels: ['needs-triage'], assignees: [], comments: { nodes: [] }, blockedBy: [], url: 'https://github.com/' + repo + '/issues/' + number };
    const snapshot = { ok: true, value: { ok: true, workspaceRoot: project, repoRoot: project, repo: { owner: repo.split('/')[0], name: repo.split('/')[1] }, repository: { name: repo, refId: repo }, selection: { backendId: backend }, backendModules: [{ id: backend }], issues: [row], maps: [], labels: [] } };
    dispose = w.MattSkillsCodex.mount(w.document.getElementById('root'), {
      codexActions: { capabilities: { nativeDraftRequest: true, active: true, new: true }, async prefill(target, text) { writes.push({ target, text }); await hostDelay; return { status: 'requested', target }; } },
      skillPreparation: { async prepare(name) { observations.push(name); return { status: 'checked', bindings: [] }; } },
      sessions: { list: { getSnapshot: () => sessions, subscribe: () => () => {} }, get: () => session },
      connection: { rpc: { async call(c, e, r) {
        if (['snapshot', 'refresh'].includes(r.method)) return snapshot;
        if (r.method === 'cwd') return { ok: true, value: { ok: true, cwd: project, workspaceRoot: project } };
        if (r.method === 'issueDetail') return { ok: true, value: { ok: true, issue: { ...row, body: 'Legacy draft source' } } };
        if (r.method === 'skill.readDoc') return { ok: true, value: { ok: true, path: '/rules/' + source + '/' + r.payload.name, md: '# ' + source, source: { kind: 'host-resolved' }, execution: { allowed: true } } };
        return { ok: true, value: { ok: false } };
      } } },
    }, { sessionId: session.id, session, useSessions: select => typeof select === 'function' ? select(sessions) : sessions });
    await until(() => w.document.querySelector('[aria-label="#' + number + ' Legacy fixture ' + number + '"]'));
    const rowButton = w.document.querySelector('[aria-label="#' + number + ' Legacy fixture ' + number + '"]');
    if (detail) { rowButton.click(); await until(() => w.document.querySelector('[data-bottom-action-bar]')); }
    const group = w.document.querySelector('[data-issue-direct-actions]');
    return { group, rowButton, button: text => [...group.querySelectorAll('button')].find(b => b.textContent === text) };
  }
  async function seed(text, options = {}) {
    const view = await open(options);
    [...view.rowButton.querySelectorAll('button')].find(b => b.textContent === '旧草稿预览').click();
    await until(() => w.document.querySelector('[data-issue-action-draft]'));
    await until(() => w.document.querySelector('[data-issue-action-source]')?.getAttribute('data-source-state') === 'ready');
    const editor = w.document.querySelector('[data-issue-action-draft]');
    editor.value = text;
    editor.dispatchEvent(new w.Event('input', { bubbles: true }));
    w.document.querySelector('[data-issue-action-export="close"]').click();
    assert.equal(w.document.querySelector('[data-issue-action-preview]'), null);
  }
  async function menu(options = {}) {
    const view = await open(options);
    view.button('更多动作').click();
    await until(() => view.group.querySelector('[aria-label="更多动作"]'));
    return view;
  }
  return { w, copies, writes, observations, until, open, seed, menu, setSource(value) { source = value; }, failCopy(value) { copyFails = value; }, delayHost(value) { hostDelay = value; }, close() { dispose?.(); w.close(); } };
}

for (const detail of [false, true]) {
  const f = fixture();
  try {
    let view = await f.menu({ detail });
    assert.equal(view.button('复制旧草稿原文'), undefined, 'without surviving text there is no history-export action');
    const original = '$triage\n\n手写旧草稿，保留空格  \n旧规则路径：/old/reference\n🙂';
    await f.seed(original);
    f.setSource('changed-after-history');
    view = await f.menu({ detail });
    const copy = view.button('复制旧草稿原文');
    assert.ok(copy, 'more actions offers verbatim export for surviving legacy text');
    const observed = f.observations.length;
    copy.click();
    await f.until(() => f.copies.length === 1);
    assert.equal(f.copies[0], original, 'historical wording is copied byte-for-byte without source regeneration');
    assert.equal(f.observations.length, observed, 'historical export does not prepare or recheck a current request');
    assert.equal(f.writes.length, 0, 'history export never injects a host draft');
    assert.equal(f.w.document.querySelector('[data-issue-action-preview]'), null, 'recovering history does not mount the legacy editor');
    await f.until(() => view.group.textContent.includes('已复制旧草稿原文'));
    assert.doesNotMatch(view.group.textContent, /已核验|已填入/, 'history is not described as a current verified request');
  } finally { f.close(); }
}

{
  const f = fixture();
  let release;
  try {
    const original = '历史手写文本\n不要重新生成\n  ';
    await f.seed(original);
    let view = await f.menu();
    view.button('填入当前聊天').click();
    await f.until(() => f.writes.length === 1);
    await f.until(() => !view.button('填入当前聊天').disabled);
    view.button('复制').click();
    await f.until(() => f.copies.length === 1);
    assert.equal(f.copies[0], f.writes[0].text, 'normal copy uses the current generated request');
    assert.notEqual(f.copies[0], original);
    await f.until(() => !view.button('填入当前聊天').disabled);
    view.button('复制旧草稿原文').click();
    await f.until(() => f.copies.length === 2);
    assert.equal(f.copies[1], original, 'generating and copying a current request never overwrites history');
    await f.until(() => !view.button('复制旧草稿原文').disabled);
    f.failCopy(true);
    view.button('复制旧草稿原文').click();
    await f.until(() => view.group.textContent.includes('clipboard unavailable'));
    assert.equal(f.copies.length, 2, 'a failed copy is not retried or redirected');
    assert.equal(f.writes.length, 1);
    f.failCopy(false);
    view.button('复制旧草稿原文').click();
    await f.until(() => f.copies.length === 3);
    assert.equal(f.copies[2], original, 'failure preserves the exact historical text for a deliberate retry');

    const delay = new Promise(resolve => { release = resolve; });
    f.delayHost(delay);
    view.button('填入当前聊天').click();
    await f.until(() => f.writes.length === 2);
    assert.equal(view.button('填入当前聊天').disabled, true);
    assert.equal(view.button('复制旧草稿原文').disabled, false, 'deliberate historical copying stays available while injection waits');
    view.button('复制旧草稿原文').click();
    await f.until(() => f.copies.length === 4);
    assert.equal(f.copies[3], original);
    release();
    await f.until(() => !view.button('填入当前聊天').disabled);

    for (const options of [{ number: 11 }, { project: '/legacy-b' }, { repo: 'fixture/another' }, { backend: 'markdown' }, { effortId: 'other-effort' }]) {
      view = await f.menu(options);
      assert.equal(view.button('复制旧草稿原文'), undefined, 'another Issue/project/repository/backend/effort has no access to this history');
    }
    view = await f.menu({ detail: true });
    view.button('复制旧草稿原文').click();
    await f.until(() => f.copies.length === 5);
    assert.equal(f.copies[4], original, 'returning in a new chat for the same project and Issue preserves history');
    await f.seed('');
    view = await f.menu();
    assert.equal(view.button('复制旧草稿原文'), undefined, 'an explicitly empty legacy draft does not invent historical content');
  } finally { release?.(); f.close(); }
}
console.log('PASS verbatim legacy draft export through production more actions');
