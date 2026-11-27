import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { JSDOM } from 'jsdom';
const client = await readFile(new URL('../dist/client.js', import.meta.url), 'utf8');
const prefix = client.slice(client.indexOf('const CODEX_SKILL_NAMES'), client.indexOf('window.__ModuleLoader__.load({'));
const finalRenderer = '(function(){' + prefix + client.slice(client.indexOf('window.__ModuleLoader__.load({')) + '\n})();';
const legacyRenderer = gunzipSync(await readFile(new URL('legacy-renderer-a7b22b5.js.gz', import.meta.url))).toString();
// The archived renderer prepares pre-upgrade user input only through its public UI.
// Reloading through ModuleLoader preserves the production runtime's page memory.
export function fixture() {
  const dom = new JSDOM('<main id="root"></main>', { url: 'https://legacy.invalid', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  w.confirm = () => assert.fail('recovering legacy text never asks to replace it');
  const copies = [], writes = [], observations = [];
  const controls = { native: true, reliable: false, active: true, new: true, receipt: 'requested', body: 'stable', allowed: true };
  let dispose, sequence = 0, source = 'stable', copyFails = false, hostDelay;
  Object.defineProperty(w.navigator, 'clipboard', { value: { async writeText(text) { if (copyFails) throw new Error('clipboard unavailable'); copies.push(text); } } });
  w.eval(client);
  const until = async check => { for (let i = 0; i < 140; i++) { if (check()) return; await new Promise(r => setTimeout(r, 15)); } assert.fail('Legacy-copy UI timed out: ' + w.document.body.textContent.slice(-900)); };
  async function open({ project = '/legacy-a', number = 10, repo = 'fixture/repo', effortId = '', backend = 'github', detail = false, labels = ['needs-triage'] } = {}) {
    dispose?.();
    const session = { id: 'legacy-thread-' + (++sequence), cwd: project }, sessions = { current: session.id, byId: { [session.id]: session }, items: [session] };
    const row = { key: String(number), number, effortId, type: 'issue', title: 'Legacy fixture ' + number, state: 'OPEN', labels, assignees: [], comments: { nodes: [] }, blockedBy: [], url: 'https://github.com/' + repo + '/issues/' + number };
    const snapshot = { ok: true, value: { ok: true, workspaceRoot: project, repoRoot: project, repo: { owner: repo.split('/')[0], name: repo.split('/')[1] }, repository: { name: repo, refId: repo }, selection: { backendId: backend }, backendModules: [{ id: backend }], issues: [row], maps: [], labels: [] } };
    dispose = w.MattSkillsCodex.mount(w.document.getElementById('root'), {
      codexActions: { capabilities: { nativeDraftRequest: controls.native, reliableDraft: controls.reliable, active: controls.active, new: controls.new, reason: '宿主能力暂不可用' }, async prefill(target, text) { writes.push({ target, text }); await hostDelay; return controls.receipt === 'unknown' ? {} : { status: controls.receipt, target: controls.receipt === 'wrong' ? (target === 'new' ? 'active' : 'new') : target }; } },
      skillPreparation: { async prepare(name) { observations.push(name); return { status: 'checked', bindings: [] }; } },
      sessions: { list: { getSnapshot: () => sessions, subscribe: () => () => {} }, get: () => session },
      connection: { rpc: { async call(c, e, r) {
        if (['snapshot', 'refresh'].includes(r.method)) return snapshot;
        if (r.method === 'cwd') return { ok: true, value: { ok: true, cwd: project, workspaceRoot: project } };
        if (r.method === 'issueDetail') return { ok: true, value: { ok: true, issue: { ...row, body: 'Legacy draft source' } } };
        if (r.method === 'skill.readDoc') return { ok: true, value: { ok: true, path: '/rules/' + source + '/' + r.payload.name, md: '# ' + source + controls.body, source: { kind: 'host-resolved' }, execution: { allowed: controls.allowed } } };
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
    dispose?.(); dispose = undefined;
    w.eval('(function(){' + prefix + legacyRenderer + '\n})();');
    const view = await open(options);
    [...view.rowButton.querySelectorAll('button')].find(b => b.textContent === '旧草稿预览').click();
    await until(() => w.document.querySelector('[data-issue-action-draft]'));
    if (text === '') {
      // Explicitly clearing surviving user text does not first approve a new
      // source note. The archived public Clear action also invalidates any
      // in-flight source review, so it cannot refill the intentionally empty draft.
      w.document.querySelector('[data-issue-action-clear]').click();
      assert.equal(w.document.querySelector('[data-issue-action-draft]').value, '');
    } else {
      await until(() => w.document.querySelector('[data-issue-action-source]')?.getAttribute('data-source-state') === 'ready');
      if (options.legacyContext) for (const [name,value] of Object.entries(options.legacyContext)) {
        const field=w.document.querySelector('[data-issue-action-context="'+name+'"]');
        field.value=value;field.dispatchEvent(new w.Event('input',{bubbles:true}));
      }
      const editor = w.document.querySelector('[data-issue-action-draft]');
      editor.value = text;
      editor.dispatchEvent(new w.Event('input', { bubbles: true }));
    }
    w.document.querySelector('[data-issue-action-export="close"]').click();
    assert.equal(w.document.querySelector('[data-issue-action-preview]'), null);
    dispose?.(); dispose = undefined;
    w.eval(finalRenderer);
  }
  async function menu(options = {}) {
    const view = await open(options);
    view.button('更多动作').click();
    await until(() => view.group.querySelector('[aria-label="更多动作"]'));
    return view;
  }
  return { w, copies, writes, observations, controls, until, open, seed, menu, setSource(value) { source = value; }, failCopy(value) { copyFails = value; }, delayHost(value) { hostDelay = value; }, close() { dispose?.(); w.close(); } };
}
