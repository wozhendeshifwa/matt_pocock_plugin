import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM, VirtualConsole } from 'jsdom';
const base=JSON.parse(await readFile(new URL('../../.scratch/performance-baseline/snapshot.json',import.meta.url),'utf8'));
const cached=structuredClone(base), fresh=structuredClone(base);
const target=cached.value.issues.find(i=>i.type==='issue');
target.title='缓存测试旧列表';
Object.assign(fresh.value.issues.find(i=>i.key===target.key), {title:'缓存测试最新列表',updatedAt:new Date().toISOString()});
cached.value.generatedMs=Date.now()-10000;
fresh.value.generatedMs=Date.now();
fresh.value.version='hydration-fresh';fresh.value.updatedAt=new Date().toISOString();
const errors=[];
const virtualConsole=new VirtualConsole();virtualConsole.on('jsdomError',e=>errors.push(e.message));
const dom=new JSDOM('<main id="root"></main>',{url:'https://isolated-cache-test.invalid/',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole});
const w=dom.window;w.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};
const client=process.argv.slice(2).find(arg=>!arg.startsWith('--')) || new URL('../../.scratch/performance-baseline/candidate-dist/client.js',import.meta.url);
w.eval(await readFile(client,'utf8'));
const session={id:'hydration-test',cwd:cached.value.workspaceRoot};
const sessions={current:session.id,byId:{[session.id]:session},items:[session]};
let release, networkStarted=false, cacheReads=0;
const pending=new Promise(r=>{release=r;});
const dispose=w.MattSkillsCodex.mount(w.document.getElementById('root'),{
  snapshotCache:{async get(key){assert.equal(key.toLowerCase().replace(/\\/g,'/'),session.cwd.toLowerCase().replace(/\\/g,'/'));cacheReads++;return{snapshot:cached.value,ts:cached.value.generatedMs};}},
  sessions:{get:()=>session,list:{getSnapshot:()=>sessions,subscribe:()=>()=>{}}},
  connection:{rpc:{async call(c,e,r){
    if(r.method==='snapshot'){networkStarted=true;await pending;return fresh;}
    if(r.method==='cwd')return{ok:true,value:{ok:true,cwd:session.cwd,workspaceRoot:session.cwd}};
    return{ok:true,value:{ok:false,error:'Unneeded fixture endpoint'}};
  }}},
},{sessionId:session.id,session,useSessions:s=>typeof s==='function'?s(sessions):sessions});
async function until(check,label){for(let n=0;n<200;n++){if(check())return;await new Promise(r=>setTimeout(r,10));}throw Error('Timed out: '+label);}
try{
  await until(()=>w.document.body.textContent.includes('缓存测试旧列表'),'cached first paint before network');
  assert.ok(networkStarted,'real network request still runs after cache hydration');
  assert.ok(cacheReads>0);
  const node=w.document.querySelector('[data-mattskills-panel="board"]');
  if(process.argv.includes('--slow')) await new Promise(r=>setTimeout(r,100));
  release();
  await until(()=>w.document.body.textContent.includes('缓存测试最新列表'),'fresh reply replaces cached list');
  assert.equal(w.document.querySelector('[data-mattskills-panel="board"]'),node,'fresh data must not remount panel');
  assert.deepEqual(errors,[]);
  console.log('PASS original UI shows cached list while network is blocked, then installs fresh reply without remount');
}catch(error){console.log([...w.document.querySelectorAll('[role="button"][aria-label^="#"]')].map(e=>e.getAttribute('aria-label')).slice(0,5));throw error;}finally{release();dispose();w.close();}
