import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

// Agreed seam: production sidebar actions -> host drafts / clipboard.
const issue = { key: '61', number: 61, type: 'issue', title: 'Context rules', state: 'OPEN', body: '## Goal\nContext rules', labels: [{name:'ready-for-agent'},{name:'wayfinder:task'}], assignees: [], comments: [], blockedBy: [], url: 'https://github.com/example/deck/issues/61' };
const snapshot = { ok: true, value: { ok: true, workspaceRoot:'C:/example/deck', repoRoot:'C:/example/deck', repo: {owner:'example',name:'deck'}, repository:{backend:'github',refId:'example/deck',name:'example/deck',url:'https://github.com/example/deck'}, selection:{backendId:'github',source:'explicit',ref:{backend:'github',refId:'example/deck',name:'example/deck',url:'https://github.com/example/deck'}}, backendModules:[{id:'github',label:'GitHub',links:{issueUrlTemplate:'https://github.com/{refId}/issues/{key}',repoUrlTemplate:'https://github.com/{refId}'},prompts:{commandVocabulary:{cli:'gh',cliBrand:'GitHub'}}}], issues:[issue], thinTickets:[issue], maps:[], labels:[{name:'ready-for-agent'},{name:'wayfinder:task'}], deck:{labels:[],progressOf:{},blockedByKeys:{},stats:{total:1,open:1,closed:0,frontier:1,claimed:0,blocked:0,indeterminate:0,levels:[],levelOf:{}},counts:{total:1,open:1,closed:0}} } };
const dom = new JSDOM('<main id="root"></main>', {url:'https://context.invalid',runScripts:'outside-only',pretendToBeVisual:true});
const w=dom.window;
w.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};
const oldTemplates=JSON.stringify({execute:'OLD ACTIVE TEMPLATE {url}'});
const oldStart=JSON.stringify({custom:'OLD START TEMPLATE {url}'});
w.localStorage.setItem('dsws.templates',oldTemplates);
w.localStorage.setItem('dsws.startCfg',oldStart);
const drafts=[];const copies=[];const preparations=[];
let preparationOutcome={status:'source-unbound',bindings:[]};
Object.defineProperty(w.navigator,'clipboard',{value:{async writeText(text){copies.push(text);}}});
const session={id:'context-test',cwd:'C:/example/deck'};
const sessions={current:session.id,byId:{[session.id]:session},items:[session]};
await w.eval(await readFile(new URL('dist/client.js',import.meta.url),'utf8'));
const dispose=w.MattSkillsCodex.mount(w.document.getElementById('root'),{
  codexActions:{async prefill(target,text){drafts.push({target,text});}},
  skillPreparation:{async prepare(name){preparations.push(name);return preparationOutcome;}},
  sessions:{list:{getSnapshot:()=>sessions,subscribe:()=>()=>{}},get:()=>session},
  connection:{rpc:{async call(_channel,_endpoint,req){
    if(['snapshot','refresh'].includes(req.method))return snapshot;
    if(req.method==='issueDetail')return {ok:true,value:{ok:true,issue}};
    if(req.method==='cwd')return {ok:true,value:{ok:true,cwd:session.cwd,workspaceRoot:session.cwd}};
    return {ok:true,value:{ok:false,error:{kind:'unsupported',message:'Fixture'}}};
  }}}
},{sessionId:session.id,session,useSessions:select=>select?select(sessions):sessions});
async function until(f){for(let i=0;i<150;i++){if(f())return;await new Promise(r=>setTimeout(r,20));}assert.fail('Sidebar state timed out: '+w.document.body.textContent.slice(-2000));}
function button(text){return [...w.document.querySelectorAll('button')].find(b=>b.textContent.trim()===text);}
try{
  await until(()=>w.document.querySelector('[aria-label="#61 Context rules"]'));
  w.document.querySelector('[aria-label="#61 Context rules"]').click();
  await until(()=>button('执行'));
  let releasePreparation;
  preparationOutcome=new Promise(resolve=>{releasePreparation=resolve;});
  button('执行').click();
  await until(()=>w.document.querySelector('[data-issue-action-draft]'));
  assert.equal(preparations.length,0,'preview alone does not use a skill');
  w.document.querySelector('[data-issue-action-export="active"]').click();
  await until(()=>preparations.length===1);
  assert.equal(drafts.length,0,'host draft waits while skill preparation is pending');
  preparationOutcome={status:'source-unbound',bindings:[]};
  releasePreparation(preparationOutcome);
  await until(()=>drafts.length===1);
  assert.ok(preparations.includes('implement-spec'),'actual issue outlet prepares its skill before using the draft');
  assert.doesNotMatch(drafts[0].text,/OLD ACTIVE|OLD START/);
  assert.match(drafts[0].text,/\$implement-spec/);
  assert.match(drafts[0].text,/https:\/\/github.com\/example\/deck\/issues\/61/);
  assert.match(drafts[0].text,/规格.*实施票|spec.*ticket/i);
  assert.match(drafts[0].text,/范围|scope/i);
  w.document.querySelector('[data-issue-action-export="new"]').click();await until(()=>drafts.length===2);
  w.document.querySelector('[data-issue-action-export="close"]').click();
  assert.equal(drafts[1].text,drafts[0].text);
  assert.equal(w.localStorage.getItem('dsws.templates'),oldTemplates,'old values remain recoverable, inactive');
  assert.equal(w.localStorage.getItem('dsws.startCfg'),oldStart,'no migration overwrites user config');
  for(const [name,required] of [['pr',/基线|comparison base/],['retro',/原始记录|original records/],['implement-spec',/规格.*实施票|spec.*ticket/i],['implement',/\$implement-spec/]]){
    const before=drafts.length;
    w.document.querySelector('.dsws-skillbtn').click();
    await until(()=>w.document.querySelector('.dsws-skillpop-row[aria-label="$'+name+'"]'));
    w.document.querySelector('.dsws-skillpop-row[aria-label="$'+name+'"]').click();
    await until(()=>drafts.length===before+1);
    const text=drafts.at(-1).text;
    assert.match(text,required,name+' request must identify prerequisites, not only inject a name');
    assert.match(text,/C:\/example\/deck/);
    assert.doesNotMatch(text,/\[object Object\]/);
    if(name==='implement')assert.doesNotMatch(text,/\$implement(?:\s|$)/,'legacy menu item must use the spec implementation workflow');
  }
  const before=drafts.length;
  button('+ 需求').click();await until(()=>drafts.length===before+1);
  assert.match(drafts.at(-1).text,/\$wayfinder/);
  assert.match(drafts.at(-1).text,/example\/deck/);
  assert.match(drafts.at(-1).text,/目的地|destination/);
  const sent=drafts.length;
  preparationOutcome={status:'checked',bindings:[{status:'updated',latest:true}]};
  button('执行').click();
  await until(()=>w.document.querySelector('[data-issue-action-draft]'));
  w.document.querySelector('[data-issue-action-export="active"]').click();
  await until(()=>w.document.body.textContent.includes('技能状态已变化'));
  assert.equal(drafts.length,sent,'changed skill state stops the old outlet for visible review');
  console.log('PASS production sidebar: scoped implementation request, same current/new draft, legacy templates inactive and preserved');
}finally{dispose();w.close();}
