import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const client = await readFile(new URL('dist/client.js', import.meta.url), 'utf8');
for (const detail of [false, true]) {
  const dom = new JSDOM('<main id="root"></main>', { url: 'https://availability.invalid', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  const writes = [], copies = [];
  Object.defineProperty(w.navigator, 'clipboard', { value: { async writeText(text) { copies.push(text); } } });
  const row = { key: '10', number: 10, type: 'issue', title: 'Unavailable chat outputs', state: 'OPEN', labels: ['needs-triage'], assignees: [], comments: { nodes: [] }, blockedBy: [], url: 'https://github.com/fixture/repo/issues/10' };
  const session = { id: 'availability', cwd: '/availability' };
  const sessions = { current: session.id, byId: { availability: session }, items: [session] };
  const snapshot = { ok: true, value: { ok: true, workspaceRoot: session.cwd, repoRoot: session.cwd, repo: { owner: 'fixture', name: 'repo' }, repository: { name: 'fixture/repo', refId: 'fixture/repo' }, selection: { backendId: 'github' }, backendModules: [{ id: 'github' }], issues: [row], maps: [], labels: [] } };
  w.eval(client);
  const dispose = w.MattSkillsCodex.mount(w.document.getElementById('root'), {
    codexActions: { capabilities: { reliableDraft: false, active: false, new: false, reason: '宿主缺少可靠读取与结果确认' }, async prefill(target, text) { writes.push({ target, text }); } },
    skillPreparation: { async prepare() { return { status: 'checked', bindings: [] }; } },
    sessions: { list: { getSnapshot: () => sessions, subscribe: () => () => {} }, get: () => session },
    connection: { rpc: { async call(c, e, r) {
      if (['snapshot', 'refresh'].includes(r.method)) return snapshot;
      if (r.method === 'cwd') return { ok: true, value: { ok: true, cwd: session.cwd, workspaceRoot: session.cwd } };
      if (r.method === 'issueDetail') return { ok: true, value: { ok: true, issue: { ...row, body: 'Original issue' } } };
      if (r.method === 'skill.readDoc') return { ok: true, value: { ok: true, path: '/rules/current.md', md: '# Current rules', source: { kind: 'host-resolved', hostResolution: 'resolved' }, execution: { allowed: true } } };
      return { ok: true, value: { ok: false } };
    } } },
  }, { sessionId: session.id, session, useSessions: select => typeof select === 'function' ? select(sessions) : sessions });
  const until = async check => { for (let i = 0; i < 160; i++) { if (check()) return; await new Promise(r => setTimeout(r, 20)); } assert.fail('Availability UI timed out'); };
  try {
    await until(() => w.document.querySelector('[aria-label="#10 Unavailable chat outputs"]'));
    const rowButton = w.document.querySelector('[aria-label="#10 Unavailable chat outputs"]');
    if (detail) { rowButton.click(); await until(() => w.document.querySelector('[data-bottom-action-toggle]')); w.document.querySelector('[data-bottom-action-toggle]').click(); }
    else rowButton.querySelector('button').click();
    await until(() => w.document.querySelector('[data-issue-action-draft]'));
    const preview = w.document.querySelector('[data-issue-action-preview]');
    const editor = preview.querySelector('[data-issue-action-draft]');
    assert.match(preview.textContent, /暂不可用/);
    assert.match(preview.textContent, /宿主缺少可靠读取与结果确认/);
    assert.match(preview.textContent, /选择复制/);
    for (const target of ['active', 'new']) {
      const button = preview.querySelector('[data-issue-action-export="' + target + '"]');
      assert.equal(button.disabled, true, 'unavailable chat output is disabled before interaction');
      assert.ok(button.getAttribute('aria-describedby'), 'disabled output has an accessible explanation');
      button.click();
    }
    assert.equal(editor.disabled, false);
    assert.equal(preview.querySelector('[data-issue-action-export="copy"]').disabled, false);
    assert.equal(writes.length, 0);
    assert.equal(copies.length, 0, 'opening unavailable outputs does not silently choose copy');
    await until(() => editor.value.includes('/rules/current.md'));
    editor.value += '\nManual refinement';
    editor.dispatchEvent(new w.Event('input', { bubbles: true }));
    const final = editor.value;
    preview.querySelector('[data-issue-action-export="copy"]').click();
    await until(() => copies.length === 1);
    assert.equal(copies[0], final, 'availability explanation never changes exported text');
    assert.equal(editor.value, final, 'successful copy preserves the edited draft');
    assert.equal(writes.length, 0);
    console.log('PASS ' + (detail ? 'bottom bar' : 'list preview') + ' explains disabled chat outputs while keeping editable exact copy');
  } finally { dispose(); w.close(); }
}
