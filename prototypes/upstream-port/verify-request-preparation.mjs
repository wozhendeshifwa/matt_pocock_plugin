import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

// Public preparation/check boundary of the real bundle. This is an adapter
// contract test, not proof of the separate bottom-bar consumer or real host.
const dom=new JSDOM('<main id="root"></main>',{url:'https://request.invalid',runScripts:'outside-only',pretendToBeVisual:true});
const w=dom.window;
w.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};
const root=w.document.getElementById('root');
let revision='r1', clock=1, bindingState='updated', maintenanceFailure=false, requirementsAllowed=true;
const prepared=[];
const session={id:'preparation-api',cwd:'C:/fixture/project'};
const sessionState={current:session.id,byId:{[session.id]:session},items:[session]};
const update=()=>({status:maintenanceFailure?'attention':'checked',checkedAt:String(clock++),latest:!maintenanceFailure,bindings:[{sourceId:'bound-upstream',revision,status:maintenanceFailure?'check-failed':bindingState,latest:!maintenanceFailure,usable:true}]});
await w.eval(await readFile(new URL('dist/client.js',import.meta.url),'utf8'));
const dispose=w.MattSkillsCodex.mount(root,{
  sessions:{list:{getSnapshot:()=>sessionState,subscribe:()=>()=>{}},get:()=>session},
  skillPreparation:{async prepare(name){prepared.push(name);return update();}},
  connection:{rpc:{async call(_channel,_endpoint,req){
    if(req.method==='skill.readDoc')return {ok:true,value:{ok:true,path:'C:/rules/research/SKILL.md',md:'Rules '+revision,
      source:{kind:'bundled-reference',path:'C:/rules/research/SKILL.md',hostResolution:'unavailable',actualLoad:'unknown'},
      execution:{allowed:requirementsAllowed,mode:'bundled-readonly',reasons:requirementsAllowed?[]:['必要工具缺失：search'],files:['C:/rules/research/SKILL.md']}}};
    return {ok:true,value:{ok:false,error:{kind:'unsupported',message:'Controlled fixture'}}};
  }}}
},{sessionId:session.id,session,useSessions:select=>select?select(sessionState):sessionState});
try{
  const service=w.MattSkillsCodex.requestPreparation(root);
  const draft=await service.prepare({text:'$research\n只研究指定问题。'});
  assert.match(draft.text,/C:\/rules\/research\/SKILL.md/);
  assert.match(draft.text,/只读备用/);
  assert.match(draft.text,/实际加载：未核验/);
  const edited=draft.text+'\n用户补充：仅查阅资料。';
  bindingState='up-to-date';
  const delivered=[];
  for(const target of ['active','new','copy']){
    const result=await service.check({draftId:draft.id,text:edited});
    assert.equal(result.allowed,true,'updated -> same verified revision must not invalidate review');
    delivered.push({target,text:result.text});
  }
  assert.deepEqual(delivered.map(x=>x.text),[edited,edited,edited]);
  revision='r2';
  const stale=await service.check({draftId:draft.id,text:edited});
  assert.equal(stale.allowed,false);
  assert.equal(stale.text,edited,'source changes preserve all user edits');
  assert.equal(stale.status,'review-required');
  maintenanceFailure=true;requirementsAllowed=false;
  const clarify=await service.prepare({text:'$research\n核验来源和必要工具缺项。'});
  assert.equal(clarify.mode,'clarify');
  assert.match(clarify.text,/更新：未通过/);
  assert.match(clarify.text,/必要工具缺失/);
  const retry=await service.check({draftId:clarify.id,text:clarify.text});
  assert.equal(retry.allowed,true,'a reviewed lookup request remains usable while dependent execution pauses');
  assert.equal(retry.dependenciesAllowed,false);
  assert.equal(retry.prefillAllowed,true,'draft readiness does not grant execution readiness');
  const removed=await service.check({draftId:clarify.id,text:'$research\n删除了必要来源说明。'});
  assert.equal(removed.allowed,true,'editing/removing displayed prose does not change the observed source facts');
  assert.equal(removed.text,'$research\n删除了必要来源说明。','never add source notes back behind the editable preview');
  const before=prepared.length;
  const pathDraft=await service.prepare({text:'/research/file.md\nhttps://example.com/research/file.md'});
  assert.ok(pathDraft.text.startsWith('/research/file.md\nhttps://example.com/research/file.md\n\n'));
  assert.match(pathDraft.text,/未核验草稿/);
  assert.match(pathDraft.text,/发送后.*目标 Agent.*核验/);
  assert.equal(prepared.length,before);
  console.log('PASS production request adapter contract: visible source notes, final text consistency, stable version snapshots, source change preserves edits, failed maintenance permits reviewed lookup only, paths do not trigger maintenance');
}finally{dispose();w.close();}
