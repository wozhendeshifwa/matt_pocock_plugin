import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const client = await readFile(new URL('dist/client.js', import.meta.url), 'utf8');
const dom = new JSDOM('<main id="root"></main>', { url:'https://bottom-bar.invalid',runScripts:'outside-only',pretendToBeVisual:true });
const w = dom.window;
w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
const row = {key:'10',number:10,type:'issue',title:'Bottom bar fixture',state:'OPEN',labels:['ready-for-agent','wayfinder:task'],assignees:[],blockedBy:[],url:'https://github.com/fixture/repo/issues/10'};
const session={id:'bottom',cwd:'/fixture'};
const state={current:session.id,byId:{bottom:session},items:[session]};
const copies=[];
const hostRequests=[];
let copyFails=false;
Object.defineProperty(w.navigator,'clipboard',{value:{async writeText(text){ if(copyFails)throw new Error('Clipboard denied'); copies.push(text); }}});
const snapshot={ok:true,value:{ok:true,workspaceRoot:'/fixture',repoRoot:'/fixture',repo:{owner:'fixture',name:'repo'},repository:{name:'fixture/repo',url:'https://github.com/fixture/repo'},issues:[row],maps:[],labels:[],selection:{backendId:'github'},backendModules:[{id:'github'}]}};
w.eval(client);
const dispose=w.MattSkillsCodex.mount(w.document.getElementById('root'),{
  codexActions:{async prefill(target,text){hostRequests.push({target,text});}},
  sessions:{list:{getSnapshot:()=>state,subscribe:()=>()=>{}},get:()=>session},
  connection:{rpc:{async call(c,e,r){
    if(['snapshot','refresh'].includes(r.method))return snapshot;
    if(r.method==='cwd')return {ok:true,value:{ok:true,cwd:'/fixture',workspaceRoot:'/fixture'}};
    if(r.method==='issueDetail')return {ok:true,value:{ok:true,issue:{...row,body:'Preserved issue body',comments:{nodes:[]}}}};
    if(r.method==='skill.readDoc')return {ok:true,value:{ok:true,path:'/rules/current/SKILL.md',md:'# Current rules',source:{kind:'host-resolved',hostResolution:'resolved',actualLoad:'unknown'},execution:{allowed:true}}};
    return {ok:true,value:{ok:false}};
  }}},
},{sessionId:session.id,session,useSessions:sel=>typeof sel==='function'?sel(state):state});
const until=async check=>{for(let i=0;i<100;i++){if(check())return;await new Promise(r=>setTimeout(r,20));}assert.fail('UI timeout: '+w.document.body.textContent.slice(-1000));};
try{
  await until(()=>w.document.querySelector('[aria-label="#10 Bottom bar fixture"]'));
  w.document.querySelector('[aria-label="#10 Bottom bar fixture"]').click();
  await until(()=>w.document.body.textContent.includes('Preserved issue body'));
  const bar=w.document.querySelector('[data-bottom-action-bar]');
  assert.ok(bar,'opening production Issue detail must reveal its bottom action bar');
  assert.ok(w.document.getElementById('root').contains(bar),'bottom bar belongs to React detail subtree');
  assert.notEqual(bar.style.position,'fixed','normal-flow bar must not overlay body/comments');
  const toggle=bar.querySelector('[data-bottom-action-toggle]');
  assert.equal(toggle.getAttribute('aria-expanded'),'false');
  toggle.click();
  await until(()=>bar.querySelector('[data-issue-action-draft]'));
  const editor=bar.querySelector('[data-issue-action-draft]');
  assert.equal(bar.querySelectorAll('optgroup[label="全部技能"] option').length,27);
  assert.ok(bar.querySelector('[data-issue-action-source]'),'source and update uncertainty are visible');
  await until(()=>bar.querySelector('[data-issue-action-source]').textContent.includes('/rules/current/SKILL.md'));
  assert.match(editor.value,/当前项目宿主解析.*\/rules\/current\/SKILL.md/,'real source state must enter preview before output');
  assert.ok(bar.querySelector('[data-issue-action-export="active"]'));
  assert.ok(bar.querySelector('[data-issue-action-export="new"]'));
  editor.value+='\nUser edited final text';
  editor.dispatchEvent(new w.Event('input',{bubbles:true}));
  bar.querySelector('[data-issue-action-export="copy"]').click();
  await until(()=>copies.length===1 && bar.textContent.includes('已复制'));
  assert.equal(copies[0],editor.value,'copy must receive exactly the visible final editor text');
  assert.match(bar.textContent,/已复制/);
  assert.match(editor.value,/User edited final text/);
  toggle.click();
  await until(()=>toggle.getAttribute('aria-expanded')==='false');
  toggle.click();
  assert.equal(bar.querySelector('[data-issue-action-draft]').value,editor.value,'folding must preserve edited draft');
  copyFails=true;
  bar.querySelector('[data-issue-action-export="copy"]').click();
  await until(()=>bar.textContent.includes('Clipboard denied'));
  assert.equal(bar.querySelector('[data-issue-action-draft]').value,editor.value,'failed copy preserves final text');
  bar.querySelector('[data-issue-action-export="active"]').click();
  await until(()=>bar.textContent.includes('宿主'));
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(hostRequests.length,0,'an adapter without reliable capabilities cannot mutate unknown host input');
  assert.doesNotMatch(bar.textContent,/已填入当前聊天/,'unknown native result cannot claim success');
  console.log('PASS production detail bottom bar, fold, full menu, exact copy, failure preservation');
}finally{dispose();w.close();}
