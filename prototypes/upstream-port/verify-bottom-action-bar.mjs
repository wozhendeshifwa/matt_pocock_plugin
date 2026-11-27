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
  assert.ok(bar,'detail exposes its normal-flow footer');
  assert.notEqual(bar.style.position,'fixed');
  assert.equal(!!w.document.querySelector('[data-bottom-action-toggle]'),false,'the footer has no editor toggle');
  assert.equal(w.document.querySelector('[data-issue-action-draft]'),null,'the old editor is removed');
  assert.doesNotMatch(w.document.body.textContent,/旧草稿预览|重新核验技能来源|选择动作／预览|清空草稿/);
  const group=bar.querySelector('[data-issue-direct-actions]');
  assert.ok(group,'direct actions are at the end of detail content');
  assert.equal(w.document.querySelectorAll('[data-issue-direct-actions]').length,1,'detail has only one action group');
  const children=[...group.children];
  assert.equal(children[0].getAttribute('data-action-primary-row'),'');
  assert.deepEqual([...children[0].querySelectorAll('button')].map(b=>b.textContent),['填入当前聊天','填入新聊天']);
  assert.equal(children[1].getAttribute('role'),'status','feedback is immediately below the fill buttons');
  assert.equal(children.at(-1).getAttribute('data-action-secondary-row'),'');
  assert.deepEqual([...children.at(-1).querySelectorAll('button')].map(b=>b.textContent),['复制','更多动作']);
  const copy=[...group.querySelectorAll('button')].find(b=>b.textContent==='复制');
  assert.equal(hostRequests.length,0);assert.equal(copies.length,0);copy.click();
  await until(()=>copies.length===1);
  assert.match(copies[0],/Bottom bar fixture/);
  assert.match(copies[0],/rules\/current/,'source check still happens through direct copy');
  copyFails=true;copy.click();
  await until(()=>group.textContent.includes('Clipboard denied'));
  assert.equal(hostRequests.length,0);
  console.log('PASS final A footer hierarchy, removal, direct copy and failure preservation');
}finally{dispose();w.close();}
