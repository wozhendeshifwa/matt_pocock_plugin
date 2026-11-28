import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm, access } from 'node:fs/promises';
import { runChromiumVisual } from './test-fixtures/chromium-visual-fixture.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';

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
const dir = await mkdtemp(path.join(tmpdir(), 'deck-native-surfaces-'));
const client = await readFile(new URL('dist/client.js', import.meta.url), 'utf8');
const css = await readFile(new URL('theme.css', import.meta.url), 'utf8');

async function scenario() {
  const errors=[];window.addEventListener('error',e=>errors.push(e.message));window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
  const check=(yes,message)=>{if(!yes)throw new Error(message)};
  const wait=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,20));}throw new Error('UI timeout: '+document.body.innerText.slice(-2000)+JSON.stringify(errors));};
  const session={id:'surfaces',cwd:'/fixture'};
  const sessions={current:session.id,byId:{[session.id]:session},items:[session]};
  const envelope=value=>({ok:true,value});
  const issue={key:'108',number:108,type:'issue',title:'Long readable task title '+ 'details '.repeat(18),state:'OPEN',labels:['enhancement','ready-for-agent'],assignees:[],blockedBy:[],level:0};
  const map={type:'map',key:'101',number:101,title:'Native map with a long descriptive destination',state:'OPEN',labels:['wayfinder:map'],tickets:[issue],destination:'Keep every field and action reachable.',notes:'',decisions:[],fog:[],outOfScope:[],stats:{total:1,open:1,closed:0,frontier:1,levels:[{total:1,open:1,closed:0}]}};
  const selection={backendId:'github',source:'explicit'};
  const snapshot=envelope({ok:true,workspaceRoot:'/fixture',repoRoot:'/fixture',repo:{owner:'fixture',name:'repo'},repository:{name:'fixture/repo',refId:'fixture/repo'},issues:[{...issue,key:'110',number:110},map],maps:[map],labels:[],selection,backendModules:[{id:'github'}]});
  const calls=[];
  let failSkill=false;
  window.MattSkillsCodex.mount(document.getElementById('root'),{
    sandboxTasks:{setCurrentIssue(){},async call(method){if(method==='list')return {tasks:[],models:['fixture-model'],defaultModel:'fixture-model',limit:2};throw new Error('No execution allowed')}},
    sessions:{list:{getSnapshot:()=>sessions,subscribe:()=>()=>{}},get:()=>session},
    codexActions:{capabilities:{nativeDraftRequest:true,active:true,new:true},prefill(){throw new Error('fixture must never fill a draft')}},
    connection:{rpc:{async call(c,e,r){calls.push(r.method);
      if(['snapshot','refresh'].includes(r.method))return snapshot;
      if(r.method==='cwd')return envelope({ok:true,cwd:'/fixture',workspaceRoot:'/fixture'});
      if(r.method==='selection')return envelope({ok:true,selection});
      if(r.method==='chain')return envelope({ok:true,fullSnapshot:{steps:[{id:'visual-form',status:'fail',show:{title:'视觉表单检查'},actions:[{type:'form',label:'视觉表单',schema:[{name:'provider',label:'后端选择',type:'single',options:['推荐后端配置','替代后端配置','第三个后端配置'],defaultValue:'推荐后端配置'}],submitAction:{type:'rpc',method:'visual-never-submit'}}]}]}});
      if(r.method==='skill.readDoc'&&failSkill)throw new Error('Controlled skill read failure');
      if(r.method==='skill.readDoc')return envelope({ok:true,path:'/rules/'+r.payload.name+'/SKILL.md',md:'# Skill guide\n\n## Principles\n\n1. First principle\n2. Second principle\n\n'+ 'Readable long paragraph '.repeat(50)+'\n\n\x60\x60\x60js\n'+ 'const longValue = '.repeat(40)+'\n\x60\x60\x60',source:{kind:'host-resolved'},execution:{allowed:true}});
      if(r.method==='issueDetail')return envelope({ok:true,issue:{...issue,key:String(r.payload.number),number:r.payload.number,body:'Readable body',comments:{nodes:[]}}});
      if(r.method==='mapTickets')return envelope({ok:true,items:[issue],stats:map.stats});
      return envelope({ok:false,error:{message:'Controlled empty/error fixture'}});
    }}},
  },{sessionId:session.id,session,useSessions:sel=>typeof sel==='function'?sel(sessions):sessions});
  const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text);
  await wait(()=>button('技能'));
  button('技能').click();
  await wait(()=>document.querySelector('.pixel-skillrow'));
  [...document.querySelector('.pixel-skillrow').querySelectorAll('button')].find(b=>b.textContent.trim()==='详情').click();
  await wait(()=>document.querySelector('.pixel-doc h2'));
  const modal=document.querySelector('.pixel-modal');
  check(getComputedStyle(modal).borderTopWidth==='1px','skill detail uses a light 1px border, got '+getComputedStyle(modal).borderTopWidth);
  check(getComputedStyle(modal).boxShadow==='none','skill detail has no pixel shadow');
  const report=[];
  const reachable=control=>{
    const r=control.getBoundingClientRect();
    check(r.width>0&&r.height>0&&r.left>=-1&&r.top>=-1&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1,'close/cancel entirely inside viewport (1px layout rounding): '+control.textContent+' '+JSON.stringify(r.toJSON()));
    const target=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
    check(control===target||control.contains(target),'close/cancel receives a hit at its center');
  };
  const viewport=(width,height)=>new Promise(resolve=>{window.__viewportDone=resolve;window.__viewportRequest={width,height};});
  const pointerTo=control=>new Promise(resolve=>{const r=control.getBoundingClientRect();window.__hoverDone=resolve;window.__hoverRequest={x:r.left+r.width/2,y:r.top+r.height/2};});
  const layout=async name=>{
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    check(document.documentElement.scrollWidth<=innerWidth+1,name+' root overflow '+document.documentElement.scrollWidth+'/'+innerWidth);
    const overflow=[...document.querySelectorAll('.mattskills-tabpanel:not([hidden]),.dsws-body')].filter(el=>el.getClientRects().length&&el.scrollWidth>el.clientWidth+1);
    check(!overflow.length,name+' ordinary container overflow: '+overflow.map(el=>el.className+' '+el.scrollWidth+'/'+el.clientWidth+' '+[...el.querySelectorAll('*')].filter(x=>x.getBoundingClientRect().right>el.getBoundingClientRect().left+el.clientWidth+1).slice(0,6).map(x=>x.outerHTML.slice(0,280))));
    const visible=[...document.querySelectorAll('button')].filter(b=>b.getClientRects().length);
    check(visible.every(b=>b.getBoundingClientRect().right<=innerWidth+1), name+' button outside viewport: '+visible.filter(b=>b.getBoundingClientRect().right>innerWidth+1).map(b=>b.textContent));
    report.push({name,width:innerWidth,height:innerHeight,mode:document.documentElement.dataset.theme});
    if((innerWidth===320||innerWidth===900)&&['skill','map','mode-dialog','schema-form','skill-error','settings','sandbox'].includes(name))await new Promise(resolve=>{window.__screenshotDone=resolve;window.__screenshotRequest=document.documentElement.dataset.theme+'-'+innerWidth+'-'+name;});
  };
  for(const mode of ['light','dark'])for(const [width,height] of [[320,400],[520,822],[900,822],[1440,960]]){
    document.documentElement.dataset.theme=mode;
    document.documentElement.style.setProperty('--font-sans','Arial, sans-serif');
    document.documentElement.style.setProperty('--color-text-primary',mode==='light'?'rgb(41, 36, 29)':'rgb(236, 228, 241)');
    document.documentElement.style.setProperty('--color-background-primary',mode==='light'?'rgb(242, 237, 226)':'rgb(31, 27, 35)');
    document.documentElement.style.setProperty('--color-ring-primary','rgb(174, 57, 103)');
    await viewport(width,height);
    button('技能').click();
    if(!document.querySelector('.pixel-modal')){await wait(()=>document.querySelector('.pixel-skillrow'));[...document.querySelector('.pixel-skillrow').querySelectorAll('button')].find(b=>b.textContent.trim()==='详情').click();}
    await wait(()=>document.querySelector('.pixel-doc h2'));
    await layout('skill');
    check(getComputedStyle(document.querySelector('.pixel-doc h2')).fontFamily.startsWith('Arial'),'skill headings follow host sans');
    check(getComputedStyle(document.querySelector('.pixel-tab')).backgroundImage==='none','skill catalog has no checkerboard texture');
    check(getComputedStyle(document.querySelector('.pixel-doc pre')).whiteSpace==='pre','skill code has local horizontal scroll');
    check(/monospace|Consolas|Menlo/.test(getComputedStyle(document.querySelector('.pixel-doc pre')).fontFamily),'skill code retains monospace');
    const skillClose=document.querySelector('.pixel-top button:last-child');reachable(skillClose);
    check(getComputedStyle(document.querySelector('.pixel-toc b')).color===(mode==='light'?'rgb(41, 36, 29)':'rgb(236, 228, 241)'),'TOC header follows readable primary text');
    await pointerTo(document.querySelector('[data-head-refresh]'));
    const ordinaryHover=getComputedStyle(document.querySelector('[data-head-refresh]')).backgroundColor;
    const tocLink=document.querySelector('.pixel-toc a');reachable(tocLink);await pointerTo(tocLink);
    check(tocLink.matches(':hover'),'real pointer reaches skill TOC');
    check(getComputedStyle(tocLink).color===(mode==='light'?'rgb(41, 36, 29)':'rgb(236, 228, 241)'),'hovered TOC retains host primary text');
    check(getComputedStyle(tocLink).backgroundColor===ordinaryHover,'TOC hover follows ordinary host control hover');
    const marker=getComputedStyle(document.querySelector('.pixel-doc ol>li'),'::before');
    check(marker.color===(mode==='light'?'rgb(41, 36, 29)':'rgb(236, 228, 241)'),'ordered list marker retains readable host primary text');
    check(marker.backgroundColor===getComputedStyle(document.querySelector('.pixel-modal')).backgroundColor,'ordered list marker uses ordinary host surface');
    for(const footerButton of document.querySelectorAll('.pixel-bot button')){
      footerButton.scrollIntoView({block:'nearest'});reachable(footerButton);
    }
    skillClose.scrollIntoView({block:'nearest'});reachable(skillClose);
    document.querySelector('.pixel-top button:last-child').click();
    button('列表').click();await wait(()=>document.querySelector('[aria-label^="#110 "]'));
    await layout('list');
    document.querySelector('[aria-label^="#110 "]').click();await wait(()=>document.querySelector('[data-bottom-action-bar]'));
    await layout('issue-detail');
    // Public map shortcut in the existing list opens the dependency view.
    button('返回列表').click();await wait(()=>document.querySelector('[aria-label^="#101 "]'));
    document.querySelector('[aria-label^="#101 "]').click();await wait(()=>document.querySelector('.dsws-node'));
    await layout('map');
    check(getComputedStyle(document.querySelector('.dsws-node')).backgroundImage==='none','map node has neutral surface');
    check(getComputedStyle(document.querySelector('.dsws-node.now')).boxShadow==='none','current layer has no neon glow');
    check(getComputedStyle(document.querySelector('[data-native-map-destination]')).color===(mode==='light'?'rgb(41, 36, 29)':'rgb(236, 228, 241)'),'map destination uses primary host text');
    for(let el=document.querySelector('[data-native-map-destination]');el;el=el.parentElement){
      check(getComputedStyle(el).textShadow==='none'&&getComputedStyle(el).filter==='none','map destination and ancestors have no text shadow or filter');
    }
    document.querySelector('.dsws-stickybar button').click();await wait(()=>document.querySelector('[aria-label^="#101 "]'));
    document.querySelector('[aria-label^="#101 "]').querySelector('[aria-label="填入当前聊天"]').click();await wait(()=>document.querySelector('[data-map-mode-dialog]'));
    const dialog=document.querySelector('[data-map-mode-dialog]');
    check(dialog.parentElement.parentElement===document.body||!document.querySelector('.mattskills-shell').contains(dialog),'mode dialog exercises actual body portal');
    check(getComputedStyle(dialog).color===(mode==='light'?'rgb(41, 36, 29)':'rgb(236, 228, 241)'),'portal uses host primary text');
    const cancel=[...dialog.querySelectorAll('button')].find(b=>b.textContent==='取消');reachable(cancel);cancel.focus();
    check(getComputedStyle(cancel).fontFamily.startsWith('Arial')&&getComputedStyle(cancel).fontSize==='13px','portal ordinary typography');
    check(getComputedStyle(cancel).outlineColor==='rgb(174, 57, 103)','portal focus uses host ring');
    await layout('mode-dialog');cancel.click();
    button('环境检查').click();await wait(()=>button('视觉表单'));button('视觉表单').click();
    await wait(()=>document.querySelector('.dsws-modalbox [role=radio]'));
    const form=document.querySelector('.dsws-modalbox');
    check(form.scrollWidth<=form.clientWidth+1,'schema form has no local horizontal overflow: '+form.scrollWidth+'/'+form.clientWidth);
    for(const option of form.querySelectorAll('[role=radio]')){
      const r=option.getBoundingClientRect();check(r.right<=innerWidth&&r.left>=0,'schema option inside viewport');
    }
    const options=[...form.querySelectorAll('[role=radio]')];options[2].click();await wait(()=>options[2].getAttribute('aria-checked')==='true');
    check(options[0].getAttribute('aria-checked')==='false','responsive schema keeps single-selection semantics');
    await layout('schema-form');
    [...form.querySelectorAll('button')].find(b=>/取消|关闭/.test(b.textContent)).click();
    for(const tab of ['settings','status','run','sandbox']){
      document.querySelector('[data-mattskills-tab='+tab+']').click();await layout(tab);
      const active=document.querySelector('.mattskills-tabs .is-active');const inactive=document.querySelector('.mattskills-tabs button:not(.is-active)');
      check(getComputedStyle(active).backgroundColor!==getComputedStyle(inactive).backgroundColor,'active top tab visibly differs');
    }
    document.querySelector('[data-mattskills-tab=board]').click();
  }
  failSkill=true;
  for(const mode of ['light','dark']){
    await viewport(320,400);
    document.documentElement.dataset.theme=mode;
    document.documentElement.style.setProperty('--color-text-primary',mode==='light'?'rgb(41, 36, 29)':'rgb(236, 228, 241)');
    document.documentElement.style.setProperty('--color-background-primary',mode==='light'?'rgb(242, 237, 226)':'rgb(31, 27, 35)');
    document.documentElement.style.setProperty('--color-text-danger','rgb(181, 61, 42)');
    document.documentElement.style.setProperty('--color-background-danger',mode==='light'?'rgb(250, 232, 226)':'rgb(55, 25, 20)');
    button('技能').click();await wait(()=>document.querySelector('.pixel-skillrow'));
    [...document.querySelector('.pixel-skillrow').querySelectorAll('button')].find(b=>b.textContent.trim()==='详情').click();
    await wait(()=>document.querySelector('.pixel-ic-err'));
    const icon=document.querySelector('.pixel-ic-err');
    check(getComputedStyle(icon).color==='rgb(181, 61, 42)','skill error icon uses semantic danger text');
    check(getComputedStyle(icon).backgroundColor===(mode==='light'?'rgb(250, 232, 226)':'rgb(55, 25, 20)'),'skill error icon pairs semantic danger background');
    await layout('skill-error');reachable(document.querySelector('.pixel-top button:last-child'));
    const retry=[...document.querySelectorAll('.pixel-bot button')].find(b=>b.textContent.includes('重试'));
    retry.scrollIntoView({block:'nearest'});reachable(retry);
    document.querySelector('.pixel-top button:last-child').scrollIntoView({block:'nearest'});reachable(document.querySelector('.pixel-top button:last-child'));
    document.querySelector('.pixel-top button:last-child').click();
  }
  check(!calls.includes('issueComment')&&!calls.includes('gitPush'),'presentation checks perform no writes');
  check(!calls.includes('visual-never-submit'),'schema check never submits its external action');
  check(!errors.length,'no renderer errors: '+errors.join(';'));
  return report;
}
try {
 const html=path.join(dir,'case.html');
 await writeFile(html,'<!doctype html><meta charset="utf-8"><style>'+css+'</style><main id="root"></main><script>'+client.replace(/<\/script/gi,'<\\/script')+'</script><script>('+scenario+')().then(value=>{window.__result={ok:true,value}}).catch(e=>{window.__result={ok:false,error:e.stack}})</script>');
 const report=await runChromiumVisual(html,760,{browser,dir,screenshotsDir:process.env.DECK_VISUAL_ARTIFACTS});assert.equal(report.ok,true,report.error);console.log('PASS production native visual surfaces: '+report.value.length+' layouts/states, light/dark at 320x400, 520x822, 900x822, 1440x960; skill/list/detail/map/portal/schema/settings/status/run/sandbox plus 320px skill errors');
} finally {await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:200});}



