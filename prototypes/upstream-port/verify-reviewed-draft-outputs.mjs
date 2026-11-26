import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const client=await readFile(new URL('dist/client.js',import.meta.url),'utf8');
for(const detail of [false,true]){
  const dom=new JSDOM('<main id="root"></main>',{url:'https://reviewed.invalid',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window;
  w.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};
  let answer=false,version='A',receipt='valid',bodyRevision=1;
  w.confirm=()=>answer;
  const writes=[],copies=[];
  Object.defineProperty(w.navigator,'clipboard',{value:{async writeText(text){copies.push(text);}}});
  const row={key:'10',number:10,type:'issue',title:'Reviewed outputs',state:'OPEN',labels:['needs-triage'],assignees:[],comments:{nodes:[]},blockedBy:[],url:'https://github.com/fixture/repo/issues/10'};
  const session={id:'reviewed',cwd:'/reviewed'};const sessions={current:session.id,byId:{reviewed:session},items:[session]};
  const snapshot={ok:true,value:{ok:true,workspaceRoot:session.cwd,repoRoot:session.cwd,repo:{owner:'fixture',name:'repo'},repository:{name:'fixture/repo',refId:'fixture/repo'},selection:{backendId:'github'},backendModules:[{id:'github'}],issues:[row],maps:[],labels:[]}};
  w.eval(client);
  const mount=()=>w.MattSkillsCodex.mount(w.document.getElementById('root'),{
    codexActions:{capabilities:{reliableDraft:true},async prefill(target,text){writes.push({target,text});return receipt==='valid'?{status:'filled',target}:receipt==='wrong'?{status:'filled',target:target==='new'?'active':'new'}:{};}},
    skillPreparation:{async prepare(){return {status:'checked',bindings:[]};}},
    sessions:{list:{getSnapshot:()=>sessions,subscribe:()=>()=>{}},get:()=>session},
    connection:{rpc:{async call(c,e,r){
      if(['snapshot','refresh'].includes(r.method))return snapshot;
      if(r.method==='cwd')return {ok:true,value:{ok:true,cwd:session.cwd,workspaceRoot:session.cwd}};
      if(r.method==='issueDetail')return {ok:true,value:{ok:true,issue:{...row,body:'Original issue'}}};
      if(r.method==='skill.readDoc')return {ok:true,value:{ok:true,path:'/rules/'+version+'/'+r.payload.name+'.md',md:'# '+version+' revision '+bodyRevision,source:{kind:'host-resolved',hostResolution:'resolved'},execution:{allowed:true}}};
      return {ok:true,value:{ok:false}};
    }}},
  },{sessionId:session.id,session,useSessions:select=>typeof select==='function'?select(sessions):sessions});
  let dispose=mount();
  const until=async check=>{for(let i=0;i<180;i++){if(check())return;await new Promise(r=>setTimeout(r,20));}assert.fail('Reviewed output UI timed out: '+w.document.body.textContent.slice(0,1100));};
  try{
    await until(()=>w.document.querySelector('[aria-label="#10 Reviewed outputs"]'));
    const rowButton=w.document.querySelector('[aria-label="#10 Reviewed outputs"]');
    if(detail){rowButton.click();await until(()=>w.document.querySelector('[data-bottom-action-toggle]'));w.document.querySelector('[data-bottom-action-toggle]').click();}
    else rowButton.querySelector('button').click();
    await until(()=>w.document.querySelector('[data-issue-action-draft]'));
    const editor=w.document.querySelector('[data-issue-action-draft]');
    assert.equal(w.document.querySelector('[data-issue-action-export="active"]').disabled,false,'a reliable adapter keeps current chat available');
    assert.equal(w.document.querySelector('[data-issue-action-export="new"]').disabled,false,'a reliable adapter keeps new chat available');
    assert.equal(w.document.querySelector('[data-issue-action-output-availability]'),null,'reliable chat outputs do not show an unavailable notice');
    await until(()=>editor.value.includes('/rules/A/'));
    editor.value='Manual refinement\n'+editor.value;editor.dispatchEvent(new w.Event('input',{bubbles:true}));
    const click=target=>w.document.querySelector('[data-issue-action-export="'+target+'"]').click();
    click('active');await until(()=>writes.length===1);
    await until(()=>w.document.body.textContent.includes('已填入当前聊天'));
    click('new');await until(()=>writes.length===2);
    await until(()=>w.document.body.textContent.includes('已填入新聊天'));
    const final=editor.value;
    receipt='unknown';click('active');await until(()=>writes.length===3);
    await until(()=>w.document.querySelector('[data-issue-action-preview]').textContent.includes('结果'));
    assert.doesNotMatch(w.document.querySelector('[data-issue-action-preview]').textContent,/已填入当前聊天/);
    receipt='wrong';click('new');await until(()=>writes.length===4);
    await until(()=>w.document.querySelector('[data-issue-action-preview]').textContent.includes('目标'));
    assert.equal(editor.value,final);
    bodyRevision=2;
    click('copy');await new Promise(r=>setTimeout(r,30));
    assert.equal(copies.length,0,'a changed source body must stop the old outlet even if its path and note are unchanged');
    version='B';
    for(const target of ['copy','active','new']){
      const beforeWrites=writes.length,beforeCopies=copies.length;
      click(target);await until(()=>w.document.querySelector('[data-issue-action-preview]').textContent.includes('审阅'));
      await new Promise(r=>setTimeout(r,10));
      assert.equal(writes.length,beforeWrites,'unreviewed changed sources stop host outputs');
      assert.equal(copies.length,beforeCopies,'unreviewed changed sources stop copy');
      assert.equal(editor.value,final,'cancel preserves exact manual text');
    }
    answer=true;
    const refresh=[...w.document.querySelectorAll('button')].find(button=>button.textContent==='重新核验技能来源');
    refresh.click();await until(()=>editor.value.includes('/rules/B/'));
    assert.match(editor.value,/Manual refinement/,'accepting a source update preserves manual task refinements');
    assert.doesNotMatch(editor.value,/\/rules\/A\//,'superseded generated source note is replaced');
    const accepted=editor.value;receipt='valid';
    click('copy');await until(()=>copies.length===1);
    click('active');await until(()=>writes.length===5);
    click('new');await until(()=>writes.length===6);
    assert.equal(copies[0],accepted);assert.equal(writes.at(-1).text,accepted);assert.equal(writes.at(-2).text,accepted);
    assert.equal(editor.value,accepted);
    if(!detail){
      click('close');
      w.document.querySelector('[aria-label="#10 Reviewed outputs"]').click();
      await until(()=>w.document.querySelector('[data-bottom-action-toggle]'));
      const toggle=w.document.querySelector('[data-bottom-action-toggle]');
      if(toggle.getAttribute('aria-expanded')==='false')toggle.click();
      await until(()=>w.document.querySelector('[data-issue-action-source]')?.getAttribute('data-source-state')==='ready');
      assert.equal(w.document.querySelector('[data-issue-action-draft]').value,accepted,'list and detail previews share the same unsent issue draft');
    }
    if(detail){
      dispose();version='C';answer=false;dispose=mount();
      await until(()=>w.document.querySelector('[aria-label="#10 Reviewed outputs"]'));
      w.document.querySelector('[aria-label="#10 Reviewed outputs"]').click();
      await until(()=>w.document.querySelector('[data-issue-action-source]')?.getAttribute('data-source-state')==='review-required');
      const restored=w.document.querySelector('[data-issue-action-draft]');
      assert.equal(restored.value,accepted,'expired remount snapshots never replace manual drafts without review');
      click('copy');await new Promise(r=>setTimeout(r,30));
      assert.equal(copies.length,1,'canceling remount source review keeps all outlets stopped');
      answer=true;
      [...w.document.querySelectorAll('button')].find(button=>button.textContent==='重新核验技能来源').click();
      await until(()=>restored.value.includes('/rules/C/'));
      assert.doesNotMatch(restored.value,/\/rules\/[AB]\//,'remount candidate replaces prior generated source notes');
      assert.equal(restored.value.match(/Manual refinement/g).length,1,'remount review preserves refinements once');
      click('copy');await until(()=>copies.length===2);
      assert.equal(copies[1],restored.value);
    }
    console.log('PASS '+(detail?'bottom bar':'list preview')+' reliable receipts and reviewed source changes across all outputs');
  }finally{dispose();w.close();}
}
