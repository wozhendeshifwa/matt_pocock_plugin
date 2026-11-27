import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm, access } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
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

// Optional real-pointer pass. CDP moves the browser's input pointer; page-side
// observations still read the actual rendered controls and computed styles.
async function pointerRun(html, width) {
  const profile = path.join(dir, 'pointer-profile');
  const child = spawn(browser, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--disable-extensions', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--window-size=' + (width + 100) + ',1000', pathToFileURL(html).href], { windowsHide: true, stdio: 'ignore' });
  let socket;
  const pending = new Map();
  let nextId = 0;
  const call = (method, params = {}) => new Promise((resolve,reject) => { const id = ++nextId; pending.set(id,{resolve,reject}); socket.send(JSON.stringify({id,method,params})); });
  try {
    let port;
    for (let i=0;i<100;i++) { try { port = Number((await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]); break; } catch { await new Promise(r=>setTimeout(r,50)); } }
    assert.ok(port, 'Chromium exposes its local test CDP endpoint');
    const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
    const target = targets.find(x=>x.type==='page');
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
    socket.addEventListener('message',event=>{const m=JSON.parse(event.data);const item=pending.get(m.id);if(item){pending.delete(m.id);m.error?item.reject(new Error(m.error.message)):item.resolve(m.result);}});
    const evaluate = async expression => (await call('Runtime.evaluate',{expression,returnByValue:true})).result.value;
    for (let i=0;i<600;i++) {
      const request = await evaluate('window.__hoverRequest || null');
      if (request) {
        await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:request.x,y:request.y});
        await new Promise(r=>setTimeout(r,80));
        await evaluate('window.__hoverRequest=null;window.__hoverDone();true');
      }
      const result = await evaluate('window.__result || null');
      if (result) return result;
      await new Promise(r=>setTimeout(r,25));
    }
    assert.fail('real-pointer production UI test timed out');
  } finally {
    socket?.close();
    child.kill();
    await new Promise(resolve=>child.once('exit',resolve));
  }
}

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
  const issue = {key:'94',number:94,type:'issue',title:'Style pointer fixture',state:'OPEN',labels:['ready-for-agent','wayfinder:task'],assignees:[],blockedBy:[],url:'https://github.com/fixture/repo/issues/94'};
  const state = { current: 'style', byId: { style: session }, items: [session] };
  const longPath = 'src/' + 'long-directory/'.repeat(25) + 'changed-file.js';
  const screen = {
    identity: { worktreePath: '/fixture', branch: 'feature/theme', sync: 'no-upstream', detached: false, ahead: 0, behind: 0, basisMs: null },
    repo: { root: '/fixture', hasCommits: true }, staged: [{ path: 'added.js', change:'added', x: 'A', y: ' ', staged: true }],
    unstaged: [{ path: longPath, change:'modified', x: ' ', y: 'M', unstaged: true }, { path: 'deleted.js', change:'deleted', x: ' ', y: 'D', unstaged: true }, { path: 'conflict.js', change:'conflict', x: 'U', y: 'U', conflict: true }],
    otherWorktrees: [], branches: [], commits: [], stagedCount: 1, unstagedCount: 3, conflictCount: 1,
  };
  const selection = { backendId: 'github', source: 'explicit' };
  const snapshot = { ok: true, value: { ok: true, workspaceRoot: '/fixture', repoRoot: '/fixture', repo: {owner:'fixture',name:'repo'}, repository: { backend:'github',name: 'fixture/repo',refId:'fixture/repo' }, issues: [issue], maps: [], labels: [], selection, backendModules: [{ id: 'github' }] } };
  const envelope = value => ({ ok: true, value });
  window.MattSkillsCodex.mount(document.getElementById('root'), {
    sessions: { list: { getSnapshot: () => state, subscribe: () => () => {} }, get: () => session },
    connection: { rpc: { async call(c, e, r) {
      calls.push(r.method);
      if (['snapshot', 'refresh'].includes(r.method)) return snapshot;
      if (r.method === 'selection') return envelope({ok:true,selection});
      if (r.method === 'issueDetail') return envelope({ok:true,issue:{...issue,body:'Pointer style comparison',comments:{nodes:[]}}});
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
  const mainFocusReference = document.querySelector('[data-head-refresh]');
  check(mainFocusReference && mainFocusReference.getBoundingClientRect().width, 'actual main-panel refresh control is present for interaction comparison');
  const geometry = element => {
    const s = getComputedStyle(element);
    return [s.fontFamily, s.fontSize, s.borderRadius, s.paddingTop, s.paddingBottom, element.getBoundingClientRect().height];
  };
  const reports = [];
  const focusPresentation = element => {
    const s = getComputedStyle(element);
    return [s.outlineStyle, s.outlineWidth, s.outlineColor, s.outlineOffset];
  };
  for (const theme of ['light', 'dark']) {
    document.documentElement.dataset.theme = theme;
    document.body.toggleAttribute('data-ds-dark-theme', theme === 'dark');
    await new Promise(r => requestAnimationFrame(r));
    const actual = geometry(button), expected = geometry(reference);
    check(JSON.stringify(actual) === JSON.stringify(expected), 'ordinary VC button matches main UI geometry in ' + theme + ': ' + JSON.stringify({ actual, expected }));
    check(getComputedStyle(input).fontFamily === getComputedStyle(reference).fontFamily, 'commit input uses main sans font');
    check(getComputedStyle(input).borderRadius === getComputedStyle(reference).borderRadius, 'commit input shares main radius');
    mainFocusReference.focus();
    const mainFocus = focusPresentation(mainFocusReference);
    button.focus();
    check(JSON.stringify(focusPresentation(button)) === JSON.stringify(mainFocus), 'VC button focus follows the actual main-panel focus contract');
    input.focus();
    check(JSON.stringify(focusPresentation(input)) === JSON.stringify(mainFocus), 'VC keyboard focus follows the actual main-panel focus contract: ' + JSON.stringify({actual:focusPresentation(input),expected:mainFocus}));
    check(getComputedStyle(root).backgroundColor === getComputedStyle(document.querySelector('.mattskills-shell')).backgroundColor, 'VC background follows main palette');
    const semantic = [...root.querySelectorAll('.dsws-vc-badge,.dsws-vc-stat-n')].map(b => ({ text: b.textContent, color: getComputedStyle(b).color }));
    check(new Set(semantic.map(x => x.color)).size >= 3, 'added/deleted/conflict meaning stays visually distinct: ' + JSON.stringify(semantic));
    const mono = root.querySelector('.dsws-vc-badge,.dsws-vc-stat-n');
    check(/mono|consolas/i.test(getComputedStyle(mono).fontFamily), 'Git status retains monospace');
    reports.push({ theme, button: actual, inputHeight: input.getBoundingClientRect().height, focus:mainFocus, semantic });
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
    mainFocusReference.focus();
    const expectedFocus = focusPresentation(mainFocusReference);
    cancel.focus();
    check(JSON.stringify(focusPresentation(cancel)) === JSON.stringify(expectedFocus), 'confirmation focus follows the actual main-panel focus contract');
    check(JSON.stringify(geometry(cancel)) === JSON.stringify(geometry(reference)), 'confirmation controls share main geometry');
    check(getComputedStyle(confirm).backgroundColor === getComputedStyle(input).backgroundColor, 'confirmation uses current shared input surface');
    confirmation.push({theme,height:cancel.getBoundingClientRect().height,background:getComputedStyle(confirm).backgroundColor});
  }
  const pointerTo = async element => {
    element?.scrollIntoView({block:'center'});
    const r = element?.getBoundingClientRect();
    window.__hoverRequest = r ? {x:r.left+r.width/2,y:r.top+r.height/2} : {x:1,y:1};
    await new Promise(resolve=>{window.__hoverDone=resolve;});
  };
  const hoverPresentation = async element => {
    await pointerTo(null);
    const view = () => {const s=getComputedStyle(element);return {background:s.backgroundColor,border:s.borderTopColor,shadow:s.boxShadow};};
    const before=view();
    await pointerTo(element);
    check(element.matches(':hover'), 'real browser pointer activates hover on production control');
    return {before,hover:view()};
  };
  let hover;
  if (window.__POINTER_HOVER) {
    hover = {};
    for (const theme of ['light', 'dark']) {
      document.documentElement.dataset.theme = theme;
      document.body.toggleAttribute('data-ds-dark-theme', theme === 'dark');
      hover[theme] = {vc:await hoverPresentation(confirm.querySelector('[data-vc-confirm-ok]'))};
    }
  }
  confirm.querySelector('[data-vc-confirm-cancel]').click();
  if (window.__POINTER_HOVER) {
    [...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='列表').click();
    await until(()=>document.querySelector('[aria-label="#94 Style pointer fixture"]'));
    document.querySelector('[aria-label="#94 Style pointer fixture"]').click();
    const mainPrimary = ()=>[...document.querySelectorAll('button.dsws-btn.primary')].find(b=>b.textContent.trim()==='发送');
    await until(mainPrimary);
    const commentInput = mainPrimary().closest('div').parentElement.querySelector('textarea');
    check(commentInput, 'actual comment editor is available without sending a comment');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(commentInput, 'Hover comparison only, never submitted');
    commentInput.dispatchEvent(new Event('input', {bubbles:true}));
    await until(() => !mainPrimary().disabled);
    check(!mainPrimary().disabled, 'actual main primary control is enabled for hover comparison');
    for (const theme of ['light', 'dark']) {
      document.documentElement.dataset.theme = theme;
      document.body.toggleAttribute('data-ds-dark-theme', theme === 'dark');
      hover[theme].main=await hoverPresentation(mainPrimary());
      check(JSON.stringify(hover[theme].vc)===JSON.stringify(hover[theme].main), 'VC primary hover follows actual main comment-send primary in '+theme+': '+JSON.stringify(hover[theme]));
    }
  }
  check(!calls.includes('gitPush'), 'style verification never performs a Git write');
  return { viewport: innerWidth, sidebarWidth, reports, confirmation, hover, diff: { clientWidth: diff.clientWidth, scrollWidth: diff.scrollWidth } };
}

try {
  const source = `<!doctype html><meta charset="utf-8"><style>${css}\nbody{width:__WIDTH__px}</style><main id="root"></main><script>window.__TEST_WIDTH=__WIDTH__;window.__POINTER_HOVER=${process.env.DECK_TEST_HOVER==='1'};</script><script>${client.replace(/<\/script/gi, '<\\/script')}</script><script>(${scenario})().then(value=>{window.__result={ok:true,value};document.body.innerHTML='<pre id="result"></pre>';document.getElementById('result').textContent=JSON.stringify(window.__result);}).catch(e=>{window.__result={ok:false,error:e.stack};document.body.innerHTML='<pre id="result"></pre>';document.getElementById('result').textContent=JSON.stringify(window.__result);});</script>`;
  const html = path.join(dir, 'case.html');
  for (const width of process.env.DECK_TEST_HOVER==='1' ? [760] : [320, 380, 760]) {
    await writeFile(html, source.replaceAll('__WIDTH__', String(width)));
    if (process.env.DECK_TEST_HOVER==='1') {
      const report=await pointerRun(html,width);
      assert.equal(report.ok,true,report.error);
      console.log('PASS real pointer primary hover: '+JSON.stringify(report.value.hover));
      continue;
    }
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
