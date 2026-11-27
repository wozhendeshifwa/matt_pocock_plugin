import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Exercise the production renderer in a real layout engine. The only fake is
// the host RPC boundary; no Git commands or user repository writes are made.
const run = promisify(execFile);
const candidates = [process.env.DECK_TEST_BROWSER,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean);
let browser;
for (const candidate of candidates) { try { await access(candidate); browser = candidate; break; } catch {} }
assert.ok(browser, 'Set DECK_TEST_BROWSER to a Chromium executable for real layout checks');
const dir = await mkdtemp(path.join(tmpdir(), 'deck-vc-style-'));
const client = await readFile(new URL('dist/client.js', import.meta.url), 'utf8');
const css = await readFile(new URL('theme.css', import.meta.url), 'utf8');

async function scenario() {
  // Virtual-time headless runs can stop producing compositor frames while
  // timers advance. Keep the production deferred mount deterministic; layout
  // and ResizeObserver remain the real browser implementations.
  window.requestAnimationFrame = fn => setTimeout(() => fn(performance.now()), 16);
  window.cancelAnimationFrame = clearTimeout;
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const calls = [];
  window.addEventListener('error', e => calls.push('ERROR:' + e.message));
  window.addEventListener('unhandledrejection', e => calls.push('REJECTION:' + e.reason));
  const until = async fn => { for (let i = 0; i < 200; i++) { if (fn()) return; await new Promise(r => setTimeout(r, 20)); } throw new Error('UI timeout: ' + document.getElementById('root').innerHTML.slice(0,3600) + JSON.stringify(calls)); };
  const session = { id: 'style', cwd: '/fixture' };
  const state = { current: 'style', byId: { style: session }, items: [session] };
  const longPath = 'src/' + 'long-directory/'.repeat(25) + 'changed-file.js';
  const screen = {
    identity: { worktreePath: '/fixture', branch: 'feature/theme', sync: 'no-upstream', detached: false, ahead: 0, behind: 0, basisMs: null },
    repo: { root: '/fixture', hasCommits: true }, staged: [{ path: 'added.js', change:'added', x: 'A', y: ' ', staged: true }],
    unstaged: [{ path: longPath, change:'modified', x: ' ', y: 'M', unstaged: true }, { path: 'deleted.js', change:'deleted', x: ' ', y: 'D', unstaged: true }, { path: 'conflict.js', change:'conflict', x: 'U', y: 'U', conflict: true }],
    otherWorktrees: [], branches: [], commits: [], stagedCount: 1, unstagedCount: 3, conflictCount: 1,
  };
  const selection = { backendId: 'github', source: 'explicit' };
  const snapshot = { ok: true, value: { ok: true, workspaceRoot: '/fixture', repoRoot: '/fixture', repo: {owner:'fixture',name:'repo'}, repository: { backend:'github',name: 'fixture/repo',refId:'fixture/repo' }, issues: [], maps: [], labels: [], selection, backendModules: [{ id: 'github' }] } };
  const envelope = value => ({ ok: true, value });
  window.MattSkillsCodex.mount(document.getElementById('root'), {
    sessions: { list: { getSnapshot: () => state, subscribe: () => () => {} }, get: () => session },
    connection: { rpc: { async call(c, e, r) {
      calls.push(r.method);
      if (['snapshot', 'refresh'].includes(r.method)) return snapshot;
      if (r.method === 'selection') return envelope({ok:true,selection});
      if (r.method === 'cwd') return envelope({ ok: true, cwd: '/fixture', workspaceRoot: '/fixture' });
      if (r.method === 'gitStatus') return envelope({ ok: true, screen, tier: 'full', gitVersion: '2.50', readAtMs: 1 });
      if (r.method === 'gitDiff') return envelope({ ok: true, path: r.payload.path, lines: [{kind:'hunk',text:'@@ -1 +1 @@'}, {kind:'del',text:'-old line'}, {kind:'add',text:'+' + 'long added line '.repeat(75)}], truncated: false, reason: 'ok' });
      if (r.method === 'gitLog') return envelope({ ok: true, commits: [], hasMore: false, returned: 0 });
      if (r.method === 'gitWriteCheck') return envelope({ok:true,plan:{op:'push',mode:'existing-upstream',remote:'origin',branch:'feature/theme',localBranch:'feature/theme',remoteBranch:'feature/theme'},ticket:{id:'style-only',expiresAtMs:Date.now()+60000}});
      return envelope({});
    } } },
  }, { sessionId: session.id, session, useSessions: sel => typeof sel === 'function' ? sel(state) : state });
  const tab = () => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '版本管理');
  await until(tab);
  await new Promise(r => setTimeout(r, 500));
  tab().click();
  await until(() => document.querySelector('[data-vc-file]'));
  const root = document.querySelector('[data-vc-root]');
  const sidebarWidth = document.body.clientWidth;
  check(sidebarWidth === window.__TEST_WIDTH, 'browser measures the requested sidebar width');
  const button = root.querySelector('.dsws-btn:not([data-vc-reload])');
  const input = root.querySelector('input');
  check(button && input, 'production version-control actions and commit input render');
  // Compare the ordinary control contract through computed presentation, not
  // through its token names. A reference uses the existing main UI class.
  const reference = document.createElement('button');
  reference.className = 'dsws-btn'; reference.textContent = '主体控件';
  document.querySelector('.mattskills-shell').append(reference);
  const geometry = element => {
    const s = getComputedStyle(element);
    return [s.fontFamily, s.fontSize, s.borderRadius, s.paddingTop, s.paddingBottom, element.getBoundingClientRect().height];
  };
  const reports = [];
  for (const theme of ['light', 'dark']) {
    document.documentElement.dataset.theme = theme;
    document.body.toggleAttribute('data-ds-dark-theme', theme === 'dark');
    await new Promise(r => requestAnimationFrame(r));
    const actual = geometry(button), expected = geometry(reference);
    check(JSON.stringify(actual) === JSON.stringify(expected), 'ordinary VC button matches main UI geometry in ' + theme + ': ' + JSON.stringify({ actual, expected }));
    check(getComputedStyle(input).fontFamily === getComputedStyle(reference).fontFamily, 'commit input uses main sans font');
    check(getComputedStyle(input).borderRadius === getComputedStyle(reference).borderRadius, 'commit input shares main radius');
    input.focus();
    check(getComputedStyle(input).outlineStyle !== 'none' && getComputedStyle(input).outlineWidth !== '0px', 'keyboard focus remains visible');
    check(getComputedStyle(root).backgroundColor === getComputedStyle(document.querySelector('.mattskills-shell')).backgroundColor, 'VC background follows main palette');
    const semantic = [...root.querySelectorAll('.dsws-vc-badge,.dsws-vc-stat-n')].map(b => ({ text: b.textContent, color: getComputedStyle(b).color }));
    check(new Set(semantic.map(x => x.color)).size >= 3, 'added/deleted/conflict meaning stays visually distinct: ' + JSON.stringify(semantic));
    const mono = root.querySelector('.dsws-vc-badge,.dsws-vc-stat-n');
    check(/mono|consolas/i.test(getComputedStyle(mono).fontFamily), 'Git status retains monospace');
    reports.push({ theme, button: actual, inputHeight: input.getBoundingClientRect().height, semantic });
  }
  check(JSON.stringify(reports[0].button) === JSON.stringify(reports[1].button), 'theme switching preserves button dimensions');
  check(reports[0].inputHeight === reports[1].inputHeight, 'theme switching preserves input dimensions');
  // Expand an actual changed-file row to render the production diff component.
  const file = [...root.querySelectorAll('[data-vc-file]')].find(x => x.textContent.includes('changed-file'));
  const toggle = file.querySelector('[data-vc-row]') || file.querySelector('.dsws-vc-row');
  toggle.click();
  await until(() => root.querySelector('.dsws-vc-diff'));
  const diff = root.querySelector('.dsws-vc-diff');
  check(/mono|consolas/i.test(getComputedStyle(diff).fontFamily), 'diff retains monospace');
  check(diff.scrollWidth > diff.clientWidth && ['auto', 'scroll'].includes(getComputedStyle(diff).overflowX), 'long diff scrolls inside its content area: ' + JSON.stringify({scroll:diff.scrollWidth,width:diff.clientWidth,html:diff.outerHTML.slice(0,1800)}));
  check(root.getBoundingClientRect().right <= sidebarWidth + 1, 'long paths and diff do not widen the sidebar');
  for (const control of root.querySelectorAll('button,input')) {
    const r = control.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    check(r.left >= -1 && r.right <= sidebarWidth + 1, 'ordinary controls remain reachable at sidebar width ' + sidebarWidth);
  }
  const currentFile = [...root.querySelectorAll('[data-vc-file]')].find(x => x.textContent.includes('changed-file'));
  const pathNode = currentFile.querySelector('[data-vc-file-path]');
  check(pathNode, 'long path element exists: '+currentFile.outerHTML.slice(0,1400));
  check(pathNode.scrollWidth > pathNode.clientWidth && ['auto','scroll'].includes(getComputedStyle(pathNode).overflowX), 'long file path scrolls in its content area');
  check(pathNode.textContent === longPath, 'long path remains complete, not shortened before rendering');
  // Refresh a controlled clean-enough screen, open a genuine push confirmation,
  // inspect it in both themes, then cancel. No write request is permitted.
  screen.conflictCount = 0;
  screen.identity.sync = 'tracked-known'; screen.identity.basisMs = 1;
  root.querySelector('[data-vc-reload]').click();
  await until(() => !root.querySelector('[data-vc-action="push"]').disabled);
  root.querySelector('[data-vc-action="push"]').click();
  await until(() => root.querySelector('[data-vc-confirm]'));
  const confirm = root.querySelector('[data-vc-confirm]');
  const confirmation = [];
  for (const theme of ['light','dark']) {
    document.documentElement.dataset.theme = theme;
    document.body.toggleAttribute('data-ds-dark-theme', theme === 'dark');
    const cancel = confirm.querySelector('[data-vc-confirm-cancel]');
    check(JSON.stringify(geometry(cancel)) === JSON.stringify(geometry(reference)), 'confirmation controls share main geometry');
    check(getComputedStyle(confirm).backgroundColor === getComputedStyle(input).backgroundColor, 'confirmation uses current shared input surface');
    confirmation.push({theme,height:cancel.getBoundingClientRect().height,background:getComputedStyle(confirm).backgroundColor});
  }
  confirm.querySelector('[data-vc-confirm-cancel]').click();
  check(!calls.includes('gitPush'), 'style verification never performs a Git write');
  return { viewport: innerWidth, sidebarWidth, reports, confirmation, diff: { clientWidth: diff.clientWidth, scrollWidth: diff.scrollWidth } };
}

try {
  const source = `<!doctype html><meta charset="utf-8"><style>${css}\nbody{width:__WIDTH__px}</style><main id="root"></main><script>window.__TEST_WIDTH=__WIDTH__;</script><script>${client.replace(/<\/script/gi, '<\\/script')}</script><script>(${scenario})().then(value=>{document.body.innerHTML='<pre id="result"></pre>';document.getElementById('result').textContent=JSON.stringify({ok:true,value});}).catch(e=>{document.body.innerHTML='<pre id="result"></pre>';document.getElementById('result').textContent=JSON.stringify({ok:false,error:e.stack});});</script>`;
  const html = path.join(dir, 'case.html');
  for (const width of [320, 380, 760]) {
    await writeFile(html, source.replaceAll('__WIDTH__', String(width)));
    const { stdout } = await run(browser, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--disable-extensions', '--allow-file-access-from-files', '--user-data-dir=' + path.join(dir, 'profile-' + width), '--window-size=' + (width + 100) + ',900', '--virtual-time-budget=20000', '--dump-dom', pathToFileURL(html).href], { timeout: 45000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
    const result = stdout.match(/<pre id="result">([\s\S]*?)<\/pre>/);
    assert.ok(result, 'browser must finish production UI scenario');
    const decoded = result[1].replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
    const report = JSON.parse(decoded);
    assert.equal(report.ok, true, report.error);
    console.log('PASS production version-control style/layout: ' + JSON.stringify(report.value));
  }
} finally {
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
