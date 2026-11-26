import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';

const dom=new JSDOM('<main id="root"></main>',{url:'https://drafts.invalid',runScripts:'outside-only',pretendToBeVisual:true});
const w=dom.window;
w.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};
let answer=false,confirmations=0,sequence=0,dispose,copyFails=false,sourceVersion='current';
w.confirm=()=>{confirmations++;return answer;};
const copied=[];
Object.defineProperty(w.navigator,'clipboard',{value:{async writeText(text){if(copyFails)throw new Error('copy blocked');copied.push(text);}}});
w.eval(await readFile(new URL('dist/client.js',import.meta.url),'utf8'));
const until=async check=>{for(let i=0;i<150;i++){if(check())return;await new Promise(r=>setTimeout(r,20));}assert.fail('Production draft UI timed out');};
async function open(project,number=10,repo='fixture/repo',effortId='',backend='github'){
  dispose?.();
  const session={id:'thread-'+(++sequence),cwd:project};
  const sessions={current:session.id,byId:{[session.id]:session},items:[session]};
  const row={key:String(number),number,type:'issue',effortId,title:'Draft fixture '+number,state:'OPEN',labels:['ready-for-agent','wayfinder:task'],comments:{nodes:[]},assignees:[],blockedBy:[]};
  const snapshot={ok:true,value:{ok:true,workspaceRoot:project,repoRoot:project,repo:{owner:repo.split('/')[0],name:repo.split('/')[1]},repository:{name:repo,refId:repo,url:'https://github.com/'+repo},issues:[row],maps:[],labels:[],selection:{backendId:backend},backendModules:[{id:backend}]}};
  dispose=w.MattSkillsCodex.mount(w.document.getElementById('root'),{
    sessions:{list:{getSnapshot:()=>sessions,subscribe:()=>()=>{}},get:()=>session},
    skillPreparation:{async prepare(){return {status:'checked',bindings:[]};}},
    connection:{rpc:{async call(c,e,r){
      if(['snapshot','refresh'].includes(r.method))return snapshot;
      if(r.method==='cwd')return {ok:true,value:{ok:true,cwd:project,workspaceRoot:project}};
      if(r.method==='issueDetail')return {ok:true,value:{ok:true,issue:{...row,body:'Draft source body'}}};
      if(r.method==='skill.readDoc')return {ok:true,value:{ok:true,path:project+'/skills/'+sourceVersion+'/SKILL.md',source:{kind:'host-resolved'},execution:{allowed:true},update:{status:'checked'}}};
      return {ok:true,value:{ok:false}};
    }}},
  },{sessionId:session.id,session,useSessions:select=>typeof select==='function'?select(sessions):sessions});
  await until(()=>w.document.querySelector('[aria-label="#'+number+' Draft fixture '+number+'"]'));
  w.document.querySelector('[aria-label="#'+number+' Draft fixture '+number+'"]')?.click();
  await until(()=>w.document.querySelector('[data-bottom-action-toggle]'));
  const toggle=w.document.querySelector('[data-bottom-action-toggle]');
  if(toggle.getAttribute('aria-expanded')==='false')toggle.click();
  await until(()=>w.document.querySelector('[data-issue-action-draft]'));
  await until(()=>w.document.querySelector('[data-issue-action-source]').textContent.includes(project+'/skills/'+sourceVersion+'/SKILL.md'));
  return w.document.querySelector('[data-issue-action-draft]');
}
function edit(editor,text){editor.value=text;editor.dispatchEvent(new w.Event('input',{bubbles:true}));}
try{
  let editor=await open('/project-a');
  edit(editor,'Project A handwritten draft');
  editor=await open('/project-b');
  assert.notEqual(editor.value,'Project A handwritten draft','same issue number in another project must not share draft');
  edit(editor,'Project B handwritten draft');
  editor=await open('/project-a');
  assert.equal(editor.value,'Project A handwritten draft','returning to a project with a new thread must restore its draft');
  editor=await open('/project-a',11);
  assert.notEqual(editor.value,'Project A handwritten draft');
  edit(editor,'Issue eleven draft');
  editor=await open('/project-a',10,'fixture/another');
  assert.notEqual(editor.value,'Project A handwritten draft','repository identity participates in isolation');
  editor=await open('/project-a',10,'fixture/repo','another-effort');
  assert.notEqual(editor.value,'Project A handwritten draft','effort identity participates in isolation');
  editor=await open('/project-a',10,'fixture/repo','','markdown');
  assert.notEqual(editor.value,'Project A handwritten draft','backend identity participates in isolation');
  editor=await open('/project-a');
  assert.equal(editor.value,'Project A handwritten draft');
  const choice=w.document.querySelector('[data-issue-action-choice]');
  const before=confirmations;
  choice.value='pr';choice.dispatchEvent(new w.Event('change'));
  assert.equal(choice.value,'main');
  assert.equal(editor.value,'Project A handwritten draft');
  assert.equal(confirmations,before+1,'edited action replacement must request one explicit confirmation');
  w.document.querySelector('[data-issue-action-export="copy"]').click();
  await until(()=>copied.length===1);
  assert.equal(copied[0],'Project A handwritten draft');
  assert.equal(editor.value,'Project A handwritten draft','successful outlet preserves edits');
  copyFails=true;
  w.document.querySelector('[data-issue-action-export="copy"]').click();
  await until(()=>w.document.querySelector('[data-bottom-action-bar]').textContent.includes('copy blocked'));
  assert.equal(editor.value,'Project A handwritten draft','failed outlet preserves edits');
  copyFails=false;
  sourceVersion='changed';
  const refresh=[...w.document.querySelectorAll('button')].find(button=>button.textContent==='重新核验技能来源');
  refresh.click();
  await until(()=>w.document.querySelector('[data-issue-action-source]').textContent.includes('来源变化尚未写入预览'));
  assert.equal(editor.value,'Project A handwritten draft','canceling a source candidate preserves exact manual text');
  answer=true;
  refresh.click();
  await until(()=>editor.value.includes('/skills/changed/SKILL.md'));
  assert.notEqual(editor.value,'Project A handwritten draft','confirmed source candidate becomes the visible preview');
  const clear=w.document.querySelector('[data-issue-action-clear]');
  assert.ok(clear,'users can explicitly clear the draft');
  clear.click();
  assert.equal(editor.value,'');
  answer=false;
  editor=await open('/project-b');
  assert.equal(editor.value,'Project B handwritten draft');
  editor=await open('/project-a');
  assert.equal(editor.value,'','explicitly cleared draft remains empty when returning');
  const restoredChoice=w.document.querySelector('[data-issue-action-choice]');
  const unchangedConfirmations=confirmations;
  restoredChoice.value='pr';restoredChoice.dispatchEvent(new w.Event('change'));
  assert.equal(confirmations,unchangedConfirmations,'an unmodified empty draft can switch directly');
  const scope=w.document.querySelector('[data-issue-action-context="scope"]');
  scope.value='Feature changes';scope.dispatchEvent(new w.Event('input'));
  edit(editor,'Edited PR draft');
  await open('/project-b');
  editor=await open('/project-a');
  assert.equal(editor.value,'Edited PR draft');
  assert.equal(w.document.querySelector('[data-issue-action-choice]').value,'pr','selected action follows its restored draft');
  assert.equal(w.document.querySelector('[data-issue-action-context="scope"]').value,'Feature changes','action context restores alongside edits');
  console.log('PASS production draft restoration across projects/threads/issues/repos, canceled replacement and clear');
}finally{dispose?.();w.close();}
