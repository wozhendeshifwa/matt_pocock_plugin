import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm, access } from 'node:fs/promises';
import { runChromiumVisual } from './test-fixtures/chromium-visual-fixture.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Exercise the production renderer in a real layout engine. The only fake is
// the host RPC boundary; no Git commands or user repository writes are made.
const candidates = [process.env.DECK_TEST_BROWSER,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean);
let browser;
for (const candidate of candidates) { try { await access(candidate); browser = candidate; break; } catch {} }
assert.ok(browser, 'Set DECK_TEST_BROWSER to a Chromium executable for real layout checks');
const dir = await mkdtemp(path.join(tmpdir(), 'deck-native-foundation-'));
const client = await readFile(new URL('dist/client.js', import.meta.url), 'utf8');
const css = await readFile(new URL('theme.css', import.meta.url), 'utf8');

async function scenario() {
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

  await until(() => document.querySelector('[data-head-refresh]'));
  const shell=document.querySelector('.mattskills-shell');
  document.documentElement.dataset.theme='light';
  const palette={'--color-background-primary':'rgb(242, 237, 226)','--color-background-secondary':'rgb(229, 221, 204)','--color-background-tertiary':'rgb(217, 206, 185)','--color-text-primary':'rgb(41, 36, 29)','--color-text-secondary':'rgb(90, 73, 54)','--color-text-tertiary':'rgb(110, 92, 70)','--color-border-primary':'rgb(160, 138, 108)','--color-border-secondary':'rgb(135, 111, 82)','--color-ring-primary':'rgb(174, 57, 103)','--background':'rgb(255, 0, 0)','--foreground':'rgb(0, 255, 0)','--font-sans':'Arial, sans-serif'};
  for(const [key,value] of Object.entries(palette))document.documentElement.style.setProperty(key,value);
  check(getComputedStyle(shell).backgroundColor==='rgb(242, 237, 226)','host primary background takes precedence over legacy background: '+getComputedStyle(shell).backgroundColor);
  check(getComputedStyle(shell).color==='rgb(41, 36, 29)','host primary text takes precedence');
  const button=document.querySelector('[data-head-refresh]');
  check(getComputedStyle(shell).fontFamily.startsWith('Arial'), 'body follows host sans font');
  check(getComputedStyle(shell).fontSize==='14px','body uses 14px text');
  check(getComputedStyle(document.querySelector('.dsws-body')).fontSize==='14px','production panel body uses 14px text: '+document.querySelector('.dsws-body').outerHTML.slice(0,500)+' PARENT '+document.querySelector('.dsws-body').parentElement.outerHTML.slice(0,800));
  check(getComputedStyle(button).fontSize==='13px','ordinary control uses 13px text: '+button.outerHTML+' '+getComputedStyle(button).fontSize);
  check(button.getBoundingClientRect().height>=30,'ordinary control is at least 30px tall');
  button.focus();
  check(getComputedStyle(button).outlineColor==='rgb(174, 57, 103)','keyboard focus uses host ring');
  const keyTab=shift=>new Promise(resolve=>{window.__keyboardDone=resolve;window.__keyboardRequest={shift};});
  const keyboardFocus=async control=>{control.focus();await keyTab(false);await keyTab(true);check(document.activeElement===control,'Tab and Shift+Tab return to the production control');check(control.matches(':focus-visible'),'keyboard navigation makes focus visible');};
  await keyboardFocus(button);
  check(getComputedStyle(button).outlineWidth==='2px','keyboard focus has a 2px outline');
  const pointerTo=element=>new Promise(resolve=>{const r=element?.getBoundingClientRect();window.__hoverDone=resolve;window.__hoverRequest=r?{x:r.x+r.width/2,y:r.y+r.height/2}:{x:innerWidth-1,y:innerHeight-1};});
  await pointerTo(null);const resting=getComputedStyle(button).backgroundColor;
  await pointerTo(button);check(button.matches(':hover'),'real pointer reaches ordinary button');
  check(getComputedStyle(button).backgroundColor!==resting,'hover visibly changes ordinary button');
  await pointerTo(null);
  const report=[];
  const clearPalette=()=>{for(const key of [...document.documentElement.style])document.documentElement.style.removeProperty(key);};
  for(const mode of ['light','dark']) {
    document.documentElement.dataset.theme=mode;
    document.body.toggleAttribute('data-ds-dark-theme',mode==='dark');
    for(const [key,value] of Object.entries(palette))document.documentElement.style.setProperty(key,value);
    if(mode==='dark') {
      document.documentElement.style.setProperty('--color-background-primary','rgb(31, 27, 35)');
      document.documentElement.style.setProperty('--color-text-primary','rgb(236, 228, 241)');
    }
    const bg=mode==='light'?'rgb(242, 237, 226)':'rgb(31, 27, 35)';
    const fg=mode==='light'?'rgb(41, 36, 29)':'rgb(236, 228, 241)';
    check(getComputedStyle(shell).backgroundColor===bg && getComputedStyle(shell).color===fg,'non-default host palette applies in '+mode);
    const tabs=document.querySelector('.mattskills-tabs');
    check(getComputedStyle(tabs).backgroundColor==='rgb(229, 221, 204)','host secondary background applies');
    check(getComputedStyle(button).borderTopColor==='rgb(160, 138, 108)','host primary border applies');
    const tab=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='版本管理');tab.click();
    await until(()=>document.querySelector('[data-vc-root] input'));
    const vc=document.querySelector('[data-vc-root]');
    const input=vc.querySelector('input');const vcButton=vc.querySelector('.dsws-btn:not([data-vc-reload])');
    for(const control of [input,vcButton]) {
      await keyboardFocus(control);
      const style=getComputedStyle(control);
      check(style.fontSize==='13px'&&style.fontFamily.startsWith('Arial'),'VC ordinary control shares host typography');
      check(style.outlineColor==='rgb(174, 57, 103)'&&style.outlineWidth==='2px','VC keyboard focus follows host ring');
      check(control.getBoundingClientRect().height>=30,'VC control retains target height');
    }
    document.documentElement.style.setProperty('--color-text-success','rgb(43, 139, 96)');
    check(getComputedStyle(vc.querySelector('.dsws-vc-badge.is-added')).color==='rgb(43, 139, 96)','Git added state uses host semantic success text');
    report.push({mode,background:getComputedStyle(vc).backgroundColor,inputHeight:input.getBoundingClientRect().height});
    clearPalette();
    document.documentElement.style.setProperty('--background','rgb(226, 231, 219)');document.documentElement.style.setProperty('--foreground','rgb(34, 49, 27)');
    check(getComputedStyle(shell).backgroundColor==='rgb(226, 231, 219)'&&getComputedStyle(shell).color==='rgb(34, 49, 27)','legacy aliases still apply in '+mode);
    clearPalette();
    const fallbackBg=mode==='light'?'rgb(255, 255, 255)':'rgb(24, 24, 24)';
    const fallbackFg=mode==='light'?'rgb(32, 32, 32)':'rgb(238, 238, 238)';
    check(getComputedStyle(shell).backgroundColor===fallbackBg&&getComputedStyle(shell).color===fallbackFg,'neutral readable fallback in '+mode);
  }
  document.documentElement.dataset.theme='light';
  for(const [key,value] of Object.entries(palette))document.documentElement.style.setProperty(key,value);
  [...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='列表').click();
  await until(()=>document.querySelector('[aria-label="#94 Style pointer fixture"]'));
  document.querySelector('[aria-label="#94 Style pointer fixture"]').click();
  const send=()=>[...document.querySelectorAll('button.dsws-btn.primary')].find(b=>b.textContent.trim()==='发送');
  await until(send);
  check(send().disabled,'empty production comment starts disabled');
  check(getComputedStyle(send()).opacity==='1'&&getComputedStyle(send()).color==='rgb(90, 73, 54)','disabled text remains readable using host secondary text');
  const textarea=send().closest('div').parentElement.querySelector('textarea');
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(textarea,'Presentation fixture; never sent');
  textarea.dispatchEvent(new Event('input',{bubbles:true}));
  await until(()=>!send().disabled);
  await pointerTo(null);
  check(getComputedStyle(send()).backgroundColor==='rgb(41, 36, 29)'&&getComputedStyle(send()).color==='rgb(242, 237, 226)','primary action uses neutral host inversion: '+send().outerHTML+' '+getComputedStyle(send()).backgroundColor+' '+getComputedStyle(send()).color);
  await pointerTo(send());
  check(send().matches(':hover'),'real pointer reaches primary control');
  check(getComputedStyle(send()).backgroundColor!=='rgb(41, 36, 29)','primary hover visibly changes host inversion');
  check(!calls.includes('gitPush')&&!calls.includes('issueComment'),'style fixture performs no Git write or comment submission');
  return report;
}

try {
  const html=path.join(dir,'case.html');
  await writeFile(html,`<!doctype html><meta charset="utf-8"><style>${css}</style><main id="root"></main><script>${client.replace(/<\/script/gi,'<\\/script')}</script><script>(${scenario})().then(value=>{window.__result={ok:true,value}}).catch(e=>{window.__result={ok:false,error:e.stack}})</script>`);
  const report=await runChromiumVisual(html,760,{browser,dir});
  assert.equal(report.ok,true,report.error);
  console.log('PASS production native visual foundation: '+JSON.stringify(report.value));
} finally { await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:200}); }

