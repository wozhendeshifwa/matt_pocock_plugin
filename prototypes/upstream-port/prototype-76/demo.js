// THROWAWAY #76 — real board renderer, inert fixture services, three UI structures.
// Question: can users find the destination and understand the result without a draft panel?
const $ = s => document.querySelector(s);
Object.defineProperty(navigator,'clipboard',{configurable:true,value:{async writeText(text){console.info('PROTOTYPE clipboard simulation',text);}}});
const params = new URLSearchParams(location.search);
const names = {A:'正文末尾 · 紧凑双按钮',B:'底部常驻 · 操作优先',C:'去向分行 · 解释优先'};
let variant = names[params.get('variant')] ? params.get('variant') : 'A';
let phase='idle', target='active', menu=false, action='prototype', baseline='', copied=false, generation=0;
let generated='', selectedScenario='requested', lastTheme='light';
const oldDraft='历史草稿示例：保留用户原文；仅在本次页面内存中。';
const project='C:/Users/27263/Desktop/matt_pocock_';
const row={key:'76',number:76,type:'issue',title:'确认移除草稿面板后的简洁 UI 与状态反馈',state:'OPEN',labels:['wayfinder:prototype'],assignees:['wozhendeshifwa'],blockedBy:[],url:'https://github.com/wozhendeshifwa/matt_pocock_plugin/issues/76'};
const body='## 设计问题\n\n移除草稿中转面板后，怎样让用户清楚知道提示词会填到哪里，以及这次操作是否需要检查？\n\n## 本次范围\n\n- 比较按钮层级、反馈位置和信息密度。\n- 保留更多动作、按需上下文及主动复制。\n- 对照版本管理与主体的主题和普通控件。\n\n本页为抛弃式演示。填入、复制、版本管理操作均为模拟，不影响实际聊天、剪贴板或仓库。\n\n## 前置决定\n\n#77：填入宿主可编辑草稿，由用户自行发送。\n\n#79：Codex 主题优先，版本管理沿用主体控件，保留 Git 专用显示。';
const session={id:'prototype-only',cwd:project};
const sessions={current:session.id,byId:{[session.id]:session},items:[session]};
const snapshot={ok:true,value:{ok:true,workspaceRoot:project,repoRoot:project,repo:{owner:'wozhendeshifwa',name:'matt_pocock_plugin'},repository:{name:'wozhendeshifwa/matt_pocock_plugin',url:'https://github.com/wozhendeshifwa/matt_pocock_plugin'},issues:[row],maps:[],labels:[],selection:{backendId:'github'},backendModules:[{id:'github'}]}};
const file={path:'prototypes/upstream-port/theme.css',staged:false,unstaged:true,change:'modified',conflict:false,addedLines:12,deletedLines:6};
const commit={oid:'edd19db0000000000000000000000000000000000',short:'edd19db',author:'开发者',email:'demo@example.invalid',authorDateMs:Date.now()-3600000,commitDateMs:Date.now()-3600000,subject:'同步版本管理与主体主题（示例）',parents:[]};
const screen={identity:{worktreePath:project,worktreeDisplay:'matt_pocock_',branch:'main',detached:false,oid:commit.oid,sync:'tracked-known',ahead:1,behind:0,basisMs:Date.now()},staged:[],unstaged:[file],stagedCount:0,unstagedCount:1,conflictCount:0,otherWorktrees:[],branches:[{short:'main',oid:commit.oid,upstream:'origin/main',current:true,ahead:1,behind:0}],commits:[commit],repo:{merging:false,rebasing:false,cherryPicking:false,reverting:false,hasCommits:true,bare:false,tier:'full',autocrlf:false}};
const messages={idle:'',pending:'正在核验来源并请求填入…',requested:'已请求，请检查输入框后发送。',filled:'已填入，尚未发送。',failed:'填入失败。可复制本次文本，或重新核验后重试。',unknown:'无法确认是否填入，请先检查输入框。',disabled:'无法保证来源项目与实际目录，新聊天暂不可用。可主动复制。',source:'技能来源已变化，本次已暂停。',missing:'缺少必要资料：请补齐技能参考文件及工具后重试。',labels:'推荐动作已更新，旧请求已暂停。再次点击将按最新动作生成。',before:'发送前检测到聊天／项目切换，已停止本次请求。',after:'请求后检测到目标切换，结果待检查；未向新目标补发。'};
$('#lab').innerHTML=`<h1>移除草稿面板，操作还能一眼看懂吗？</h1><p>抛弃式原型 #76 · 现有页面 + 示例数据 · 所有写操作均为模拟。主题控件仅模拟宿主，不是产品设置。</p><div class="tools"><label>模拟 Codex <select id="theme"><option value="light">浅色</option><option value="dark">深色</option></select></label><label>侧栏 <select id="width"><option value="480">480 px</option><option value="320">320 px</option><option value="380">380 px</option><option value="720">720 px</option></select></label><label>状态 <select id="scenario">${Object.entries({idle:'就绪',pending:'进行中',requested:'仅请求回执',filled:'可靠确认（假设能力）',failed:'失败',unknown:'结果未知',disabled:'新聊天禁用',source:'来源变化',missing:'必要资料缺失',labels:'推荐动作变化',before:'请求前目标切换',after:'请求后目标切换'}).map(([v,t])=>`<option value="${v}" ${v==='requested'?'selected':''}>${t}</option>`).join('')}</select></label><button id="preview">直接预览状态</button><button id="issue">返回 Issue</button></div>`;
for(const el of [$('#lab'),$('#switcher'),$('#inspector')]) for(const type of ['mousedown','pointerdown','click']) el.addEventListener(type,e=>e.stopPropagation());
$('#theme').onchange=e=>{lastTheme=e.target.value;document.documentElement.dataset.theme=lastTheme;document.body.toggleAttribute('data-ds-dark-theme',lastTheme==='dark');inspect();};
$('#width').onchange=e=>{$('#canvas').style.width=e.target.value+'px';inspect();};
$('#scenario').onchange=e=>{selectedScenario=e.target.value;};
$('#preview').onclick=()=>{generation++;phase=selectedScenario;copied=false;renderAll();};
$('#issue').onclick=()=>{const back=[...document.querySelectorAll('#root button')].find(b=>b.textContent.includes('返回列表'));back?.click();setTimeout(openIssue,100);};
function esc(v){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function inspect(){
 const state={variant,theme:lastTheme,width:$('#width').value,issue:76,action,baseline,phase,target,scope:'同一侧栏',requestSent:['requested','filled','unknown','after'].includes(phase),reliableReadback:phase==='filled',autoSend:false,autoRetry:false,menuOpen:menu,generatedTextAvailable:!!generated,copiedSimulation:copied,persistence:'页面内存；刷新清空',host:'模拟，不代表真实能力'};
 const old=$('#inspector details');const open=old?.open;
 $('#inspector').innerHTML=`<details ${open?'open':''}><summary>原型观察：当前完整状态（不属于产品 UI）</summary><pre>${esc(JSON.stringify(state,null,2))}</pre></details>`;
 console.info('PROTOTYPE #76 state',state);
}
function switchVariant(delta){variant=Object.keys(names)[(Object.keys(names).indexOf(variant)+delta+3)%3];const url=new URL(location);url.searchParams.set('variant',variant);history.replaceState({},'',url);renderAll();}
$('#switcher').innerHTML='<button aria-label="上一个方案">←</button><span></span><button aria-label="下一个方案">→</button>';
$('#switcher button:first-child').onclick=()=>switchVariant(-1);
$('#switcher button:last-child').onclick=()=>switchVariant(1);
addEventListener('keydown',e=>{if(e.target.closest('input,textarea,select,[contenteditable]'))return;if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();switchVariant(e.key==='ArrowLeft'?-1:1);}});
function buttons(){const busy=phase==='pending', missing=action==='code-review'&&!baseline.trim();return `<button class="primary" data-target="active" ${busy||missing?'disabled':''}>填入当前聊天</button><button data-target="new" ${busy||missing||phase==='disabled'?'disabled':''}>填入新聊天</button>`;}
function extras(){return `<div class="row"><button class="quiet" data-copy>复制提示词</button><button class="quiet" data-more aria-expanded="${menu}">更多动作 ${menu?'⌃':'⌄'}</button></div>${menu?`<div class="menu"><label>补充动作 <select data-action><option value="prototype" ${action==='prototype'?'selected':''}>prototype（标签推荐）</option><option value="code-review" ${action==='code-review'?'selected':''}>code-review</option></select></label>${action==='code-review'?`<label>比较基线（必填）<input data-baseline value="${esc(baseline)}" placeholder="请明确填写分支、标签或提交"></label><button data-cancel>取消补充动作</button>`:''}<button data-old>复制旧草稿原文</button></div>`:''}`;}
function feedback(){let message=messages[phase];if(phase==='idle'&&action==='code-review'&&!baseline.trim())message='请先填写比较基线，再选择填入目标。';return `<div role="status" class="feedback" data-state="${phase}">${message?`<strong>#76 · ${esc(action)} · ${target==='new'?'新聊天':'当前聊天'}</strong><br>${message}`:''}${phase==='source'?'<br><button data-source>按最新来源重新生成并填入</button>':''}${['failed','unknown','after'].includes(phase)?'<br><button data-retry>重新核验并重试</button>':''}${copied?'<br>已模拟复制；未写入真实剪贴板。':''}</div>`;}
function VariantA(){return `<div class="row"><strong>推荐：$prototype</strong></div><div class="row">${buttons()}</div>${feedback()}${extras()}`;}
function VariantB(){return `<div class="hint">#76 · 推荐 $prototype · 填入后自行发送</div><div class="targets">${buttons()}</div>${feedback()}${extras()}`;}
function VariantC(){const parts=buttons().split('</button>');return `<div class="target-row"><div><strong>当前聊天</strong><div class="hint">保留原文，空一行追加</div></div>${parts[0]}</button></div><div class="target-row"><div><strong>新聊天</strong><div class="hint">沿用来源项目及实际目录</div></div>${parts[1]}</button></div><div class="tail">${feedback()}${extras()}</div>`;}
function renderAll(){
 $('#switcher span').textContent=variant+' · '+names[variant];
 for(const slot of document.querySelectorAll('[data-prototype-actions]')){
  slot.className='prototype-actions variant-'+variant;
  slot.innerHTML=({A:VariantA,B:VariantB,C:VariantC}[variant])();
  for(const b of slot.querySelectorAll('[data-target]'))b.onclick=()=>request(b.dataset.target);
  slot.querySelector('[data-more]').onclick=()=>{menu=!menu;renderAll();};
  slot.querySelector('[data-copy]').onclick=()=>{generated ||= makeText();copied=true;renderAll();};
  slot.querySelector('[data-old]')?.addEventListener('click',()=>{copied=true;inspect();slot.querySelector('[role=status]').textContent='已模拟复制旧草稿原文；未核验为最新请求。';console.info('Historical text only',oldDraft);});
  slot.querySelector('[data-action]')?.addEventListener('change',e=>{action=e.target.value;phase='idle';renderAll();});
  slot.querySelector('[data-baseline]')?.addEventListener('input',e=>{baseline=e.target.value;slot.querySelectorAll('[data-target]').forEach(b=>b.disabled=!baseline.trim()||phase==='pending');inspect();});
  slot.querySelector('[data-cancel]')?.addEventListener('click',()=>{action='prototype';phase='idle';renderAll();});
  slot.querySelector('[data-source]')?.addEventListener('click',()=>request(target,true));
  slot.querySelector('[data-retry]')?.addEventListener('click',()=>{
   if(['unknown','after'].includes(phase)){
    const d=document.createElement('dialog');d.innerHTML='<p>请先检查输入框，避免重复追加或重复创建聊天。</p><button data-go>已检查，重新核验并重试</button> <button data-stop>取消</button>';document.body.append(d);d.showModal();d.querySelector('[data-go]').onclick=()=>{d.remove();request(target,true);};d.querySelector('[data-stop]').onclick=()=>d.remove();
   }else request(target,true);
  });
 }
 inspect();
}
function makeText(){return `$${action}\n目标：通过原型确认移除草稿面板后的简洁 UI 与状态反馈\nIssue：https://github.com/wozhendeshifwa/matt_pocock_plugin/issues/76${action==='code-review'?'\n比较基线：'+baseline:''}\n抛弃式演示；由用户检查输入框后自行发送。`;}
function request(to,fresh=false){
 if(phase==='pending')return;target=to;copied=false;generated=makeText();
 const scenario=fresh?'requested':selectedScenario;
 if(['source','missing','labels','before'].includes(scenario)){phase=scenario;renderAll();return;}
 if(scenario==='disabled'&&to==='new'){phase='disabled';renderAll();return;}
 const id=++generation;phase='pending';renderAll();
 if(scenario==='pending')return;
 setTimeout(()=>{if(id!==generation)return;phase=scenario==='idle'||scenario==='disabled'?'requested':scenario;renderAll();},850);
}
window.MattSkillsCodex.mount($('#root'),{
 sessions:{list:{getSnapshot:()=>sessions,subscribe:()=>()=>{}},get:()=>session},
 codexActions:{async prefill(){request('active');return {status:'requested'};}},
 connection:{rpc:{async call(c,e,r){
  if(['snapshot','refresh'].includes(r.method))return snapshot;
  if(r.method==='cwd')return {ok:true,value:{ok:true,cwd:project,workspaceRoot:project}};
  if(r.method==='issueDetail')return {ok:true,value:{ok:true,issue:{...row,body,comments:{nodes:[]}}}};
  if(r.method==='gitStatus')return {ok:true,value:{ok:true,screen,tier:'full',gitVersion:'2.50.0',readAtMs:Date.now()}};
  if(r.method==='gitLog')return {ok:true,value:{ok:true,commits:[commit],skip:0,requested:50,returned:1,hasMore:false}};
  if(r.method==='gitDiff')return {ok:true,value:{ok:true,path:file.path,lines:['diff --git a/theme.css b/theme.css','--- a/theme.css','+++ b/theme.css','@@ -1 +1 @@','-  color: #221d15;','+  color: var(--dsw-alias-label-primary);'],truncated:false,reason:''}};
  return {ok:true,value:{ok:false,error:{kind:'prototype',message:'此操作仅为视觉占位，未连接实际服务。'}}};
 }}}
},{sessionId:session.id,session,useSessions:sel=>typeof sel==='function'?sel(sessions):sessions});
function openIssue(){document.querySelector('[aria-label="#76 '+row.title+'"]')?.click();}
const observer=new MutationObserver(()=>{
 for(const b of document.querySelectorAll('#root button'))if(['原型','新会话'].includes(b.textContent.trim()) && b.style.display!=='none')b.style.display='none';
 for(const slot of document.querySelectorAll('[data-prototype-actions]:not(.prototype-actions)'))renderAll();
});observer.observe($('#root'),{subtree:true,childList:true});
// Preview actions elsewhere on the real page must not reopen the removed editor.
$('#root').addEventListener('click',e=>{const b=e.target.closest('button');if(!b||b.closest('[data-prototype-actions]'))return;if(/执行|预览动作|新会话/.test(b.textContent)){e.preventDefault();e.stopImmediatePropagation();request(/新会话/.test(b.textContent)?'new':'active');}},true);
setTimeout(openIssue,350);renderAll();
