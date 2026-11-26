// Measure the real bridge's project-detection timer with a controlled host.
// This isolates detection latency; it does not measure native desktop switching.
import { JSDOM } from 'jsdom';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const dom=new JSDOM('<main id="root"></main>',{runScripts:'outside-only'});
const w=dom.window;
let active={threadId:'a1',projectRoot:'C:/baseline-a',cwd:'C:/baseline-a'};
const mounts=[], polls=[], samples=[];
w.MattSkillsCodex={mount(element,services,props){mounts.push({at:performance.now(),project:props.sessionId});return ()=>{};}};
w.postMessage=message=>{
  if(!message.id)return;
  if(message.params?.name==='deck_current_project')polls.push(performance.now());
  const result=message.method==='ui/initialize'?{hostContext:{},hostCapabilities:{}}:
    message.params.name==='deck_current_project'?{structuredContent:active}:{structuredContent:{ok:true,value:{}}};
  queueMicrotask(()=>w.dispatchEvent(new w.MessageEvent('message',{source:w,data:{jsonrpc:'2.0',id:message.id,result}})));
};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){const end=performance.now()+5000;while(!fn()){if(performance.now()>end)throw Error('bridge timeout');await sleep(5);}}
try {
  w.eval(await readFile(new URL('sidebar-bridge.js',import.meta.url),'utf8'));
  await until(()=>mounts.length===1);
  for(const offset of [100,1000,1800]){
    const n=polls.length;await until(()=>polls.length>n);await sleep(offset);
    const before=mounts.length,start=performance.now();
    const suffix=String(before);
    active={threadId:'thread-'+suffix,projectRoot:'C:/baseline-'+suffix,cwd:'C:/baseline-'+suffix};
    await until(()=>mounts.length>before);
    samples.push({offsetAfterPollMs:offset,detectionMs:mounts.at(-1).at-start});
  }
  const previous=mounts.length,n=polls.length;
  active={...active,threadId:'same-project-new-thread'};
  await until(()=>polls.length>n);
  if(mounts.length!==previous)throw Error('Same-project chat remounted');
  const result={at:new Date().toISOString(),samples,pollIntervalsMs:polls.slice(1).map((p,i)=>p-polls[i]),sameProjectRemounted:false,scope:'Actual sidebar-bridge.js, simulated host identity and stub mount; no desktop rendering or network.'};
  await mkdir(new URL('../../.scratch/performance-baseline/',import.meta.url),{recursive:true});
  await writeFile(new URL('../../.scratch/performance-baseline/project-poll.json',import.meta.url),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
} finally {dom.window.close();}
