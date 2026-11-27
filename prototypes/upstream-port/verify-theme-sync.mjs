import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM, VirtualConsole } from 'jsdom';

const [client, bridge, css] = await Promise.all(['dist/client.js', 'sidebar-bridge.js', 'theme.css'].map(name => readFile(new URL(name, import.meta.url), 'utf8')));
const project = { threadId: 'theme-fixture', projectRoot: 'C:/theme-fixture', cwd: 'C:/theme-fixture' };
const snapshot = { ok: true, value: { ok: true, workspaceRoot: project.cwd, repoRoot: project.cwd, repo: { owner: 'fixture', name: 'repo' }, repository: { backend: 'github', name: 'fixture/repo', refId: 'fixture/repo' }, issues: [], maps: [], labels: [], selection: { backendId: 'github', source: 'explicit' }, backendModules: [{id:'github'}] } };
const screen = {
  identity: { worktreePath: project.cwd, branch: 'theme-fixture', sync: 'local', detached: false, ahead: 1, behind: 0, basisMs: null },
  repo: { name: 'theme fixture', root: project.cwd, hasCommits: true }, staged: [{ path: 'theme.txt', change: 'modified', staged: true, unstaged: false, conflict: false, additions: 1, deletions: 1 }], unstaged: [], otherWorktrees: [], branches: [], commits: [], stagedCount: 1, unstagedCount: 0, conflictCount: 0,
};

async function panel({ context = {}, system, openai } = {}) {
  const errors = [];
  const console = new VirtualConsole();
  console.on('jsdomError', error => errors.push(error.cause?.stack ?? error.stack ?? error.message));
  const dom = new JSDOM('<style>' + css + '</style><main id="root"></main>', { url: 'https://theme-fixture.invalid', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: console });
  const w = dom.window;
  const mediaListeners = new Set();
  const media = { matches: !!system, addEventListener(type, fn) { mediaListeners.add(fn); } };
  if (system !== undefined) w.matchMedia = () => {
    if (system === 'unreadable') throw new Error('System theme unavailable');
    return media;
  };
  if (openai) w.openai = openai;
  w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  const calls = [];
  w.postMessage = message => {
    if (!message.id) return;
    let result;
    if (message.method === 'ui/initialize') result = { hostContext: context, hostCapabilities: {} };
    else if (message.params?.name === 'deck_current_project') result = { structuredContent: project };
    else if (message.params?.name === 'deck_sandbox_read') result = { structuredContent: { tasks: [], models: [], limit: 2 } };
    else {
      const method = message.params?.arguments?.method;
      calls.push(method);
      let value = { ok: true, value: {} };
      if (['snapshot', 'refresh'].includes(method)) value = snapshot;
      if (method === 'selection') value = { ok: true, value: { ok: true, selection: snapshot.value.selection } };
      if (method === 'gitStatus') value = { ok: true, value: { ok: true, screen, readAtMs: Date.now() } };
      if (method === 'gitDiff') value = { ok: true, value: { ok: true, lines: [{ kind: 'add', text: '+new theme' }, { kind: 'del', text: '-old theme' }], reason: 'ok' } };
      if (method === 'gitWriteCheck') value = { ok: true, value: { ok: true, plan: { mode: 'existing-upstream', localBranch: 'theme-fixture', remote: 'origin', branch: 'theme-fixture' }, ticket: { id: 'read-only-confirmation-fixture', expiresAtMs: Date.now() + 60000 } } };
      if (method === 'cwd') value = { ok: true, value: { cwd: project.cwd, workspaceRoot: project.cwd } };
      result = { structuredContent: value };
    }
    queueMicrotask(() => w.dispatchEvent(new w.MessageEvent('message', { source: w, data: { jsonrpc: '2.0', id: message.id, result } })));
  };
  w.eval(client); w.eval(bridge);
  const until = async (check, label) => {
    for (let i = 0; i < 150; i++) { if (check()) return; await new Promise(r => setTimeout(r, 10)); }
    assert.fail(label + ': ' + w.document.getElementById('root').textContent.slice(0,1600) + JSON.stringify(calls) + JSON.stringify(errors));
  };
  const tab = label => [...w.document.querySelectorAll('button')].find(b => b.textContent.trim() === label);
  await until(() => tab('版本管理'), 'production version-control tab');
  tab('版本管理').click();
  await until(() => w.document.querySelector('[data-vc-file]'), 'production version-control file list');
  return {
    w, calls, errors, until, tab,
    notify(params) { w.dispatchEvent(new w.MessageEvent('message', { source: w, data: { method: 'ui/notifications/host-context-changed', params } })); },
    system(dark) { media.matches = dark; for (const fn of mediaListeners) fn({ matches: dark }); },
    close() { w.close(); },
  };
}

const p = await panel();
try {
  assert.equal(p.w.document.documentElement.dataset.theme, 'light', 'T4: no host or system signal uses a concrete light theme');
  assert.ok(p.w.document.body.textContent.includes('theme-fixture'), 'the actual version-control view is rendered');
  assert.deepEqual(p.errors, []);
  console.log('PASS T4 production panel defaults to light when host/system signals are unavailable');
} finally { p.close(); }

const unavailable = await panel({ system: 'unreadable' });
try {
  assert.equal(unavailable.w.document.documentElement.dataset.theme, 'light', 'T4: unreadable system information also falls back to light');
  assert.deepEqual(unavailable.errors, []);
} finally { unavailable.close(); }

const incremental = await panel({ context: { theme: 'light', styles: { variables: { '--background': 'rgb(246, 248, 250)', '--foreground': 'rgb(20, 24, 28)' } } }, system: true, openai: { theme: 'light' } });
try {
  const { w } = incremental;
  const root = w.document.documentElement;
  assert.equal(root.dataset.theme, 'light', 'T1: explicit host light overrides system dark');
  incremental.system(false); incremental.system(true);
  assert.equal(root.dataset.theme, 'light');
  const before = root.style.getPropertyValue('--background');
  incremental.notify({ locale: 'zh-CN', width: 380 });
  assert.equal(root.style.getPropertyValue('--background'), before, 'T5: unrelated updates preserve the existing host palette even with openai globals present');
  incremental.notify({ theme: 'light' });
  assert.equal(root.style.getPropertyValue('--foreground'), 'rgb(20, 24, 28)', 'T5: same-mode update without a palette preserves it');
  w.dispatchEvent(new w.CustomEvent('openai:set_globals', { detail: { globals: { locale: 'zh-CN' } } }));
  assert.equal(root.style.getPropertyValue('--background'), before, 'T5: unrelated globals updates also preserve palette');
  incremental.notify({ theme: 'dark' });
  assert.equal(root.dataset.theme, 'dark');
  assert.equal(root.style.getPropertyValue('--background'), '', 'T6: cross-mode update without a new palette discards old-mode colors');
  assert.equal(w.document.body.hasAttribute('data-ds-dark-theme'), true, 'the production version-control theme consumer follows the same host mode');
  incremental.notify({ theme: null }); incremental.system(false);
  assert.equal(root.dataset.theme, 'dark', 'T4: a missing host signal keeps the last valid theme');
  incremental.notify({ theme: 'light', styles: { variables: { '--background': 'rgb(254, 253, 252)' } } });
  assert.equal(root.style.getPropertyValue('--foreground'), '', 'T6: absent colors use the current mode defaults');
  assert.equal(root.style.getPropertyValue('--background'), 'rgb(254, 253, 252)');
  incremental.notify({ styles: { variables: { '--background': 'not-a-color', '--foreground': 'rgb(12, 13, 14)', '--font-sans': 'Example Sans, sans-serif' } } });
  assert.equal(root.style.getPropertyValue('--background'), '', 'T6: malformed host colors leave the current theme default usable');
  assert.equal(root.style.getPropertyValue('--foreground'), 'rgb(12, 13, 14)');
  assert.equal(root.style.getPropertyValue('--font-sans'), 'Example Sans, sans-serif', 'valid non-color host variables remain supported');
  incremental.notify({ styles: { variables: { '--background': 'hsl(210 20% 95%)', '--foreground': 'var(--custom-host-text)', '--custom-host-text': '#111111' } } });
  assert.equal(root.style.getPropertyValue('--background'), 'hsl(210 20% 95%)', 'valid modern color syntax is retained');
  assert.equal(root.style.getPropertyValue('--foreground'), 'var(--custom-host-text)', 'valid host variable references remain supported');
  incremental.notify({ styles: { variables: null } });
  assert.equal(root.style.getPropertyValue('--background'), '', 'an explicit palette reset uses current-mode defaults');
  assert.deepEqual(incremental.errors, []);
  console.log('PASS T1/T4/T5/T6 host precedence, incremental palette preservation and cross-mode reset');
} finally { incremental.close(); }

const stateful = await panel({ system: true });
try {
  const { w } = stateful;
  const select = selector => w.document.querySelector(selector);
  assert.equal(w.document.documentElement.dataset.theme, 'dark', 'T4: system fallback before any valid host signal');
  stateful.system(false);
  assert.equal(w.document.documentElement.dataset.theme, 'light', 'T2: fallback follows system both ways');
  stateful.system(true);
  assert.equal(w.document.documentElement.dataset.theme, 'dark');
  const file = select('[data-vc-file]');
  file.querySelector('.dsws-vc-row').click();
  await stateful.until(() => select('[data-vc-diff="lines"]'), 'expanded production diff');
  const editor = select('[data-vc-commit-msg]');
  assert.ok(editor, 'actual commit editor exists');
  Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set.call(editor, '未发送的提交说明');
  editor.dispatchEvent(new w.Event('input', { bubbles: true }));
  const diff = select('[data-vc-diff="lines"]');
  const view = select('[data-vc-root]');
  view.scrollTop = 145; diff.scrollLeft = 75;
  editor.focus(); editor.setSelectionRange(2, 6);
  for (const theme of ['light', 'dark', 'light']) {
    stateful.notify({ theme });
    await new Promise(r => setTimeout(r, 0));
    assert.equal(select('[data-vc-commit-msg]'), editor, 'T7: theme update preserves the actual input node');
    assert.equal(editor.value, '未发送的提交说明');
    assert.equal(w.document.activeElement, editor);
    assert.equal(editor.selectionStart, 2);
    assert.equal(editor.selectionEnd, 6);
    assert.equal(select('[data-vc-file]'), file, 'T7: file selection remains attached to the same row');
    assert.equal(select('[data-vc-diff="lines"]'), diff, 'T7: selected file and diff expansion survive theme updates');
    assert.equal(view.scrollTop, 145); assert.equal(diff.scrollLeft, 75);
    assert.match(diff.textContent, /new theme/);
    assert.match(diff.textContent, /old theme/);
  }
  stateful.system(true);
  assert.equal(w.document.documentElement.dataset.theme, 'light', 'T1: recovered explicit host light overrides system dark');
  select('[data-vc-action="push"]').click();
  await stateful.until(() => select('[data-vc-confirm="push"]'), 'production confirmation without executing a write');
  const confirmation = select('[data-vc-confirm="push"]');
  const confirmText = confirmation.textContent;
  stateful.notify({ theme: 'dark' });
  await new Promise(r => setTimeout(r, 0));
  assert.equal(select('[data-vc-confirm="push"]'), confirmation, 'T7: open confirmation is neither discarded nor executed by a theme update');
  assert.equal(confirmation.textContent, confirmText);
  assert.equal(editor.value, '未发送的提交说明');
  assert.equal(w.document.body.hasAttribute('data-ds-dark-theme'), true, 'T2: open confirmation consumes the same current theme');
  select('[data-vc-confirm-cancel]').click();
  await stateful.until(() => !select('[data-vc-confirm]'), 'cancel confirmation');
  stateful.tab('列表').click();
  await stateful.until(() => !select('[data-vc-root]'), 'close version-control view');
  stateful.notify({ theme: 'dark' });
  stateful.tab('版本管理').click();
  await stateful.until(() => select('[data-vc-root]'), 'reopen version-control view');
  assert.equal(w.document.body.hasAttribute('data-ds-dark-theme'), true, 'T3: reopened view uses the current host theme');
  assert.equal(w.document.documentElement.dataset.theme, 'dark');
  assert.equal(stateful.calls.some(name => /^git(Stage|Unstage|Commit|Push|Pull|Fetch)$/.test(name)), false, 'theme verification never executes a Git mutation');
  assert.deepEqual(stateful.errors, []);
  console.log('PASS T1/T2/T3/T7 fallback/recovery, actual editor/selection/diff/scroll preservation and reopening');
} finally { stateful.close(); }





