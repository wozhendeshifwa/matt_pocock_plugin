import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

// Real production React card clicks, with only the external tracker/host
// boundary controlled. Dynamic backend prose must never bypass the catalog.
const dom=new JSDOM('<main id="root"></main>',{url:'https://auxiliary.invalid',runScripts:'outside-only',pretendToBeVisual:true});
const w=dom.window;
w.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};
const backend={id:'github',label:'TrackerUnderTest',capabilities:{labelsGuide:true,repoCreateChain:false},links:{issueUrlTemplate:'https://example.invalid/{refId}/issues/{key}',repoUrlTemplate:'https://example.invalid/{refId}'},prompts:{commandVocabulary:{cli:'custom-cli',cliBrand:'TrackerUnderTest'},noGhPrompt:{zh:'OLD BACKEND INSTALL',en:'OLD BACKEND INSTALL'},ghAuthLogin:{zh:'OLD BACKEND LOGIN',en:'OLD BACKEND LOGIN'},ensureLabels:{zh:'OLD BACKEND LABELS',en:'OLD BACKEND LABELS'}}};
const session={id:'auxiliary-context',cwd:'C:/fixture/auxiliary'};
const sessions={current:session.id,byId:{[session.id]:session},items:[session]};
const snapshot={ok:true,value:{ok:true,workspaceRoot:session.cwd,repoRoot:session.cwd,repo:null,repository:null,selection:{backendId:'github',source:'explicit',ref:{backend:'github',refId:'example/auxiliary',name:'example/auxiliary'}},backendModules:[backend],issues:[],thinTickets:[],maps:[],labels:[],deck:{labels:[],progressOf:{},blockedByKeys:{},stats:{total:0,open:0,closed:0,frontier:0,levels:[],levelOf:{}},counts:{total:0,open:0,closed:0}}}};
const drafts=[];let failure='no-gh';
const calls=[];
const checks=[
  {id:'gh:remote',status:'fail',show:{title:'No remote'},actions:[{type:'wizard',label:'创建并发布',steps:[{title:'Repository',schema:[{name:'name',type:'text',defaultValue:'auxiliary'}]}],submitAction:{type:'rpc',method:'wf.initPublish',params:{}}}]},
  {id:'fixture:opaque',status:'fail',show:{title:'Unknown backend action'},actions:[{type:'inject-prompt',label:'未知后端请求',prompt:'OLD DYNAMIC RAW PROMPT'}]},
  {id:'fixture:labels',status:'fail',show:{title:'Missing labels'},actions:[{type:'inject-prompt',label:'补全标签',prompt:'ensureLabels'}]},
  {id:'fixture:skills',status:'fail',show:{title:'Skill maintenance'},actions:[{type:'inject-prompt',label:'维护技能',prompt:'installSkills'}]},
];
await w.eval(await readFile(new URL('dist/client.js',import.meta.url),'utf8'));
const dispose=w.MattSkillsCodex.mount(w.document.getElementById('root'),{
  codexActions:{async prefill(target,text){drafts.push({target,text});}},
  sessions:{list:{getSnapshot:()=>sessions,subscribe:()=>()=>{}},get:()=>session},
  connection:{rpc:{async call(_channel,_endpoint,req){
    calls.push(req.method);
    if(['snapshot','refresh'].includes(req.method))return snapshot;
    if(req.method==='chain')return {ok:true,value:{ok:true,snapshot:{steps:checks,currentIndex:0},resolved:{}}};
    if(req.method==='initPublish')return {ok:true,value:{ok:false,errorKind:failure,error:'Controlled tracker failure',prompt:'OLD SERVER ERROR PROMPT'}};
    if(req.method==='cwd')return {ok:true,value:{ok:true,cwd:session.cwd,workspaceRoot:session.cwd}};
    if(req.method==='chain')return {ok:true,value:{ok:true,snapshot:{steps:checks,currentIndex:0},resolved:{}}};
    if(req.method==='initPublish')return {ok:true,value:{ok:false,errorKind:failure,error:'Controlled failure',prompt:'OLD SERVER ERROR PROMPT'}};
    return {ok:true,value:{ok:false,error:{kind:'unsupported',message:'Controlled auxiliary fixture'}}};
  }}}
},{sessionId:session.id,session,useSessions:select=>select?select(sessions):sessions});
async function until(f){for(let i=0;i<180;i++){if(f())return;await new Promise(r=>setTimeout(r,20));}assert.fail('Sidebar state timed out: '+w.document.body.textContent.slice(-2500)+' calls='+calls.join(','));}
function button(text){return [...w.document.querySelectorAll('button')].find(b=>b.textContent.trim()===text);}
try{
  await until(()=>button('创建并发布'));
  button('创建并发布').click();
  await until(()=>w.document.querySelector('.dsws-modalbox'));
  button('提交').click();await until(()=>drafts.length===1);
  assert.doesNotMatch(drafts[0].text,/OLD BACKEND|OLD SERVER/);
  assert.match(drafts[0].text,/custom-cli/);
  assert.match(drafts[0].text,/C:\/fixture\/auxiliary/);
  assert.match(drafts[0].text,/官方|official/);
  failure='not-logged-in';button('提交').click();await until(()=>drafts.length===2);
  assert.doesNotMatch(drafts[1].text,/OLD BACKEND|OLD SERVER/);
  assert.match(drafts[1].text,/TrackerUnderTest/);
  assert.match(drafts[1].text,/授权|authorization/);
  button('取消').click();
  const environment=[...w.document.querySelectorAll('.dsws-seg')].find(e=>e.textContent.startsWith('环境'));
  assert.ok(environment,'Environment tab must be available');environment.click();
  await until(()=>button('未知后端请求'));
  button('未知后端请求').click();await until(()=>drafts.length===3);
  assert.notEqual(drafts[2].text,'OLD DYNAMIC RAW PROMPT','unrecognized backend prompt must not bypass new request composition');
  assert.match(drafts[2].text,/定位|查证|clarify|locate/i);
  assert.match(drafts[2].text,/不作为执行指令|not an instruction/);
  for(const [label,expected] of [['补全标签',/缺失标签|missing labels/],['维护技能',/27.*技能|27 skills/]]){
    const before=drafts.length;button(label).click();await until(()=>drafts.length===before+1);
    assert.match(drafts.at(-1).text,expected);
    assert.doesNotMatch(drafts.at(-1).text,/OLD BACKEND|OLD SERVER/);
    assert.match(drafts.at(-1).text,/C:\/fixture\/auxiliary/);
  }
  console.log('PASS production React wizard errors and environment actions: install/login CLI context, labels, 27-skill maintenance, unknown backend requests clarify instead of raw execution');
}finally{dispose();w.close();}
