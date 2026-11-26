// Read-only baseline: real MCP reads, then isolated Chromium replay of the
// installed production bundle. Never rebuilds dist or edits user configuration.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir, cpus, totalmem } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createTestCodexHome } from './test-codex-home.mjs';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const out = path.join(root, '.scratch/performance-baseline');
await mkdir(out, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const report = { at: new Date().toISOString(), environment: { node: process.version, cpu: cpus()[0].model, memoryGiB: totalmem()/2**30 }, network: [], browser: [] };
let bundle = await readFile(path.join(here, 'dist/client.js'), 'utf8');
if (process.argv.includes('--memo-probe')) {
  const options={bundle:true,write:false,format:'iife',platform:'browser',define:{'process.env.NODE_ENV':'"production"'},minify:true,legalComments:'inline'};
  const baseline=await build({...options,entryPoints:[path.join(here,'browser-runtime.mjs')]});
  if(!bundle.startsWith(baseline.outputFiles[0].text))throw Error('Source runtime differs from installed bundle; refusing confounded comparison');
  const source=await readFile(path.join(here,'browser-runtime.mjs'),'utf8');
  const marker='React.createElement(tab.component, { key: "panel", ...panelProps })';
  if(source.split(marker).length!==2)throw Error('Memo probe anchor changed');
  const modified=source.replace(marker,'React.createElement(memoComponent(tab.component), { key: "panel", ...panelProps })')+'\nconst memoComponents = new WeakMap(); function memoComponent(component) { if (!memoComponents.has(component)) memoComponents.set(component, React.memo(component)); return memoComponents.get(component); }\n';
  const probe=await build({...options,stdin:{contents:modified,resolveDir:here,sourcefile:'browser-runtime.mjs'}});
  bundle=probe.outputFiles[0].text+bundle.slice(baseline.outputFiles[0].text.length);
  report.experimentalMemoProbe=true;
}
report.bundleSha256 = createHash('sha256').update(bundle).digest('hex');
const threadId = '88888888-8888-4888-8888-888888888888';
const { home } = await createTestCodexHome({ threads: [{ id: threadId, cwd: root }], projectRoots: [root] });
const child = spawn(process.execPath, [path.join(here, 'sidebar-server.mjs')], { cwd: here, env: { ...process.env, CODEX_HOME: home }, windowsHide: true, stdio: ['pipe','pipe','pipe'] });
child.stderr.resume();
let seq = 0;
const pending = new Map();
createInterface({ input: child.stdout }).on('line', line => {
  let data; try { data = JSON.parse(line); } catch { return; }
  const item = pending.get(data.id); if (!item) return;
  pending.delete(data.id); clearTimeout(item.timer);
  data.error ? item.reject(new Error(data.error.message)) : item.resolve(data.result);
});
function rpc(method, params) {
  return new Promise((resolve,reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('MCP timeout: '+method)); }, 60000);
    pending.set(id, { resolve,reject,timer });
    child.stdin.write(JSON.stringify({ jsonrpc:'2.0',id,method,params })+'\n');
  });
}
async function read(method, payload = {}) {
  const start = performance.now();
  const result = await rpc('tools/call', { name:'deck_upstream_read', arguments:{ method,payload:{ ...payload,expectedThreadId:threadId } }, _meta:{ thread_id:threadId,threadId } });
  const data = JSON.parse(result.content[0].text);
  report.network.push({ method, ms: performance.now()-start, ok: !result.isError && data.ok && data.value?.ok !== false });
  if (result.isError || !data.ok || data.value?.ok === false) throw new Error('Read failed: '+method+' '+JSON.stringify(data).slice(0,500));
  return structuredClone(data);
}
let edge, ws, server;
try {
  const start = performance.now();
  await rpc('initialize', { protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'performance-baseline',version:'1'} });
  report.initializeMs = performance.now()-start;
  const replay = process.argv.includes('--replay');
  const snapshot = replay ? JSON.parse(await readFile(path.join(out,'snapshot.json'),'utf8')) : await read('snapshot');
  if (!replay) { await read('snapshot'); await read('snapshot'); await read('refresh'); }
  report.replayOnly = replay;
  report.issueCount = snapshot.value.issues.length;
  await writeFile(path.join(out,'snapshot.json'),JSON.stringify(snapshot));
  console.log('MCP baseline', JSON.stringify(report.network));
  const css = await readFile(path.join(here,'theme.css'),'utf8');
  const boot = `
    window.metrics={calls:[],longTasks:[]};
    new PerformanceObserver(l=>metrics.longTasks.push(...l.getEntries().map(e=>({start:e.startTime,ms:e.duration})))).observe({type:'longtask',buffered:true});
    const base=${JSON.stringify(snapshot)};
    window.delay=0; window.fail=false;
    window.frame=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    window.waitFor=async(fn)=>{const end=performance.now()+10000;while(!fn()){if(performance.now()>end)throw Error('DOM timeout: '+document.body.textContent.slice(0,1500));await new Promise(r=>setTimeout(r,5));}};
    window.openPanel=async(count)=>{
      window.dispose?.(); document.getElementById('root').replaceChildren();
      const data=structuredClone(base);
      if(count!==base.value.issues.length){const sample=data.value.issues.find(x=>x.type==='issue' && x.state.toLowerCase()==='open')||data.value.issues[0];data.value.issues=Array.from({length:count},(_,i)=>({...sample,key:String(1000+i),number:1000+i,title:'性能夹具 '+(i+1),state:'open',labels:[],assignees:[],parentKey:null,blockedBy:[],body:'## Question\\n可复现性能基线。'}));data.value.maps=[];}
      const session={id:'baseline-'+count,cwd:data.value.workspaceRoot};
      const sessions={current:session.id,byId:{[session.id]:session},items:[session]};
      const started=performance.now();
      window.dispose=MattSkillsCodex.mount(document.getElementById('root'),{
        sessions:{get:()=>session,list:{getSnapshot:()=>sessions,subscribe:()=>()=>{}}},
        connection:{rpc:{call:async(c,e,r)=>{
          const call={method:r.method,start:performance.now()};metrics.calls.push(call);
          try{
            if(['snapshot','refresh','issueDetail'].includes(r.method)){
              if(window.delay)await new Promise(res=>setTimeout(res,window.delay));
              if(window.fail)return {ok:true,value:{ok:false,error:'Injected baseline network failure'}};
              if(r.method==='issueDetail'){const issue=data.value.issues.find(i=>String(i.key)===String(r.payload?.key??r.key))||data.value.issues.find(x=>x.type==='issue');return {ok:true,value:{ok:true,issue:{...issue,comments:{nodes:[],pageInfo:{}},labels:{nodes:[]},assignees:{nodes:[]},subIssues:{nodes:[],totalCount:0},blockedBy:{nodes:[]},blocking:{nodes:[]}}}};}
              return structuredClone(data);
            }
            if(r.method==='cwd')return {ok:true,value:{ok:true,cwd:session.cwd,workspaceRoot:session.cwd}};
            return {ok:true,value:{ok:false,error:{kind:'unsupported',message:'Baseline fixture: '+r.method}}};
          }finally{call.ms=performance.now()-call.start;}
        }}},codexActions:{prefill:async()=>{throw Error('Not part of baseline')}}
      },{sessionId:session.id,session,useSessions:s=>typeof s==='function'?s(sessions):sessions});
      await waitFor(()=>document.querySelector('[role="button"][aria-label^="#"]')); await frame();
      return {ms:performance.now()-started,rows:document.querySelectorAll('[role="button"][aria-label^="#"]').length};
    };`;
  server = createServer((req,res) => {
    const assets={'/client.js':['application/javascript',bundle],'/boot.js':['application/javascript',boot],'/theme.css':['text/css',css]};
    const asset=assets[req.url]||['text/html','<!doctype html><html><meta charset="utf-8"><link rel="stylesheet" href="/theme.css"><body><main id="root"></main><script src="/client.js"></script><script src="/boot.js"></script></body></html>'];
    res.writeHead(200,{'Content-Type':asset[0]+'; charset=utf-8'});res.end(asset[1]);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const profile=await mkdtemp(path.join(tmpdir(),'mattskills-perf-edge-'));
  edge=spawn(process.env.DECK_PERF_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
  let port;
  for(let i=0;i<100;i++){try{port=(await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await sleep(100);}}
  if(!port)throw Error('Isolated Edge did not expose CDP');
  const targets=await (await fetch('http://127.0.0.1:'+port+'/json')).json();
  ws=new WebSocket(targets.find(x=>x.type==='page').webSocketDebuggerUrl);
  await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  const waiting=new Map();let id=0;
  ws.onmessage=e=>{const d=JSON.parse(e.data),p=waiting.get(d.id);if(d.method==='Runtime.consoleAPICalled')console.log('browser:',d.params.args.map(a=>a.value).join(' '));if(p){waiting.delete(d.id);clearTimeout(p.timer);d.error?p.reject(Error(d.error.message)):p.resolve(d.result);}};
  const cdp=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;const timer=setTimeout(()=>{waiting.delete(key);reject(Error('CDP timeout '+method));},120000);waiting.set(key,{resolve,reject,timer});ws.send(JSON.stringify({id:key,method,params}));});
  const evaluate=async expression=>{const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  report.browserVersion=await cdp('Browser.getVersion');
  await cdp('Runtime.enable');
  await cdp('Emulation.setDeviceMetricsOverride',{width:480,height:900,deviceScaleFactor:1,mobile:false});
  await cdp('Page.navigate',{url:'http://127.0.0.1:'+server.address().port});
  for(let i=0;i<100;i++){if(await evaluate('typeof openPanel==="function"'))break;await sleep(50);}
  const countsArg = process.argv.find(x=>x.startsWith('--counts='));
  for(const count of countsArg ? countsArg.split('=')[1].split(',').map(Number) : [report.issueCount,500]) {
    await evaluate('localStorage.clear();sessionStorage.clear()');
    await cdp('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/?count='+count});
    await sleep(200);
    for(let i=0;i<100;i++){if(await evaluate('typeof openPanel==="function"'))break;await sleep(50);}
    const measurements=await evaluate(`(async()=>{
      const result={count,mounts:[],tabs:[],details:[],scroll:[],calls:[]};
      for(let n=0;n<${process.argv.includes('--mount-only')||process.argv.includes('--refresh-only')?1:5};n++){result.mounts.push(await openPanel(${count}));console.log('mount',${count},n,JSON.stringify(result.mounts.at(-1)));}
      ${process.argv.includes('--mount-only')?'return result;':''}
      ${process.argv.includes('--refresh-only')?'/*':''}
      for(let n=0;n<10;n++)for(const tab of ['status','settings','run','board']){
        const start=performance.now();document.querySelector('[data-mattskills-tab="'+tab+'"]').click();
        await waitFor(()=>!document.querySelector('[data-mattskills-panel="'+tab+'"]').hidden);await frame();
        result.tabs.push({tab,ms:performance.now()-start});
      }
      console.log('tabs done',${count});
      for(let n=0;n<5;n++){
        const start=performance.now();const row=document.querySelector('[role="button"][aria-label^="#${count !== report.issueCount ? 1000 : 27} "]');if(!row)throw Error('Measurement issue row missing');row.click();
        await waitFor(()=>document.body.textContent.includes('返回列表'));await frame();result.details.push(performance.now()-start);
        const back=[...document.querySelectorAll('button')].find(e=>(e.title||'').includes('返回列表')||e.textContent.includes('返回列表'));if(!back)throw Error('No back button');back.click();await waitFor(()=>document.querySelector('[role="button"][aria-label^="#"]'));await frame();
      }
      console.log('details done',${count});
      const scroller=[...document.querySelectorAll('*')].find(e=>e.scrollHeight>e.clientHeight+100&&['auto','scroll'].includes(getComputedStyle(e).overflowY));
      if(scroller){let last=performance.now();for(let n=0;n<120;n++){await new Promise(r=>requestAnimationFrame(r));const now=performance.now();result.scroll.push(now-last);last=now;scroller.scrollTop+=40;}result.scrollExtent={height:scroller.scrollHeight,viewport:scroller.clientHeight};}
      ${process.argv.includes('--refresh-only')?'*/':''}
      result.mounted=[...document.querySelectorAll('[data-mattskills-panel]')].map(e=>({id:e.dataset.mattskillsPanel,hidden:e.hidden,nodes:e.querySelectorAll('*').length}));
      ${process.argv.includes('--no-refresh')?'/*':''}
      window.delay=1500;
      const refresh=document.querySelector('[data-head-refresh]');
      if(!refresh)throw Error('Refresh control missing');
      let start=performance.now();refresh.click();await frame();
      result.refresh={feedbackMs:performance.now()-start,button:refresh.textContent,spinning:!!refresh.querySelector('.dsws-spin'),disabled:refresh.disabled};
      console.log('refresh feedback',JSON.stringify(result.refresh));
      start=performance.now();document.querySelector('[data-mattskills-tab="settings"]').click();await waitFor(()=>!document.querySelector('[data-mattskills-panel="settings"]').hidden);await frame();result.refresh.switchDuringWaitMs=performance.now()-start;
      await new Promise(r=>setTimeout(r,3500));
      document.querySelector('[data-mattskills-tab="board"]').click();await frame();
      window.fail=true;document.querySelector('[data-head-refresh]').click();await new Promise(r=>setTimeout(r,3500));await frame();
      result.refresh.errorVisible=/刷新失败，正在重试/.test(document.querySelector('[data-mattskills-panel=board]').innerText);
      console.log('refresh failure',result.refresh.errorVisible);
      result.refresh.errorText=document.querySelector('[data-mattskills-panel=board]').innerText.slice(0,2000);
      window.fail=false;window.delay=0;document.querySelector('[data-head-refresh]')?.click();await new Promise(r=>setTimeout(r,500));await frame();
      result.refresh.recovered=!/刷新失败，正在重试/.test(document.querySelector('[data-mattskills-panel=board]').innerText)&&!!document.querySelector('[role="button"][aria-label^="#"]');
      if(!result.refresh.errorVisible||!result.refresh.recovered)throw Error('Refresh failure/recovery state not verified');
      ${process.argv.includes('--no-refresh')?'*/':''}
      const index=metrics.calls.length;await new Promise(r=>setTimeout(r,6000));result.idleCalls=metrics.calls.slice(index);
      result.calls=metrics.calls;result.longTasks=metrics.longTasks;return result;
    })()`.replace('const result={count,','const result={count:'+count+','));
    report.browser.push(measurements);
    await writeFile(path.join(out,'results.json'),JSON.stringify(report,null,2));
    console.log('Measured',count,'issues');
  }
} catch(error) {
  report.error=error.message;console.error(error.message);process.exitCode=1;
} finally {
  await writeFile(path.join(out,'results.json'),JSON.stringify(report,null,2));
  await writeFile(path.join(out,'run-'+report.at.replace(/[:.]/g,'-')+'.json'),JSON.stringify(report,null,2));
  ws?.close();edge?.kill();server?.close();child.stdin.end();child.kill();
  for(const p of pending.values())clearTimeout(p.timer);
}
