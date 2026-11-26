import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const dom=new JSDOM('<main id="root"></main>',{url:'https://legacy-injection.invalid',runScripts:'outside-only',pretendToBeVisual:true});
const w=dom.window;w.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};
w.eval(await readFile(new URL('dist/client.js',import.meta.url),'utf8'));
const session={id:'legacy',cwd:'C:/fixture'},sessions={current:'legacy',items:[session],byId:{legacy:session}};
const calls=[];let rejectNext,hold=true;
const snapshot={ok:true,value:{ok:true,workspaceRoot:session.cwd,repoRoot:session.cwd,repo:{owner:'fixture',name:'repo'},repository:{name:'fixture/repo',refId:'fixture/repo'},selection:{backendId:'github'},backendModules:[{id:'github'}],issues:[],maps:[],labels:[]}};
const dispose=w.MattSkillsCodex.mount(w.document.getElementById('root'),{
  codexActions:{capabilities:{nativeDraftRequest:true,active:true,new:true},async prefill(target,text){calls.push({target,text});if(hold)await new Promise((resolve,reject)=>{rejectNext=reject});return {status:'requested',target};}},
  skillPreparation:{async prepare(){return {status:'checked',bindings:[]}}},
  sessions:{get:()=>session,list:{getSnapshot:()=>sessions,subscribe:()=>()=>{}}},
  connection:{rpc:{async call(c,e,r){if(['snapshot','refresh'].includes(r.method))return snapshot;if(r.method==='cwd')return {ok:true,value:{ok:true,cwd:session.cwd}};return {ok:true,value:{ok:false}}}}},
},{session,sessionId:session.id,useSessions:sel=>typeof sel==='function'?sel(sessions):sessions});
const until=async check=>{for(let i=0;i<150;i++){if(check())return;await new Promise(r=>setTimeout(r,20));}assert.fail('Legacy outlet timed out')};
const button=name=>w.document.querySelector('[data-board-action="'+name+'"]');
try{
 await until(()=>button('handoff'));button('handoff').click();await until(()=>rejectNext);
 assert.doesNotMatch(w.document.body.textContent,/已注入.*交接模板|已请求填入/,'handoff must wait for transport outcome');
 rejectNext(new Error('Fixture transport failed'));await until(()=>w.document.body.textContent.includes('Fixture transport failed'));
 assert.doesNotMatch(w.document.body.textContent,/已注入.*交接模板/);
 hold=false;button('fixate').click();await until(()=>calls.length===2);await until(()=>w.document.body.textContent.includes('已请求填入'));
 assert.equal(calls[0].target,'active');assert.match(calls[0].text,/\$handoff/);assert.equal(calls[1].target,'active');assert.ok(calls[1].text.length>100);
 console.log('PASS compiled handoff waits, failure never reports success, consolidation uses shared native draft outlet');
}finally{dispose();w.close()}
