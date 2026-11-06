import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const dom=new JSDOM('<main id="root"></main>',{runScripts:'outside-only'});
const w=dom.window;
let active={threadId:'project-a',cwd:'C:/a'};
let poll;
let disposed=0;
const mounts=[];
w.setInterval=fn=>{poll=fn;return 1};
w.MattSkillsCodex={mount(element,services,props){mounts.push({services,props});return ()=>disposed++}};
w.postMessage=message=>{
 if(!message.id)return;
 const result=message.method==='ui/initialize'?{hostContext:{},hostCapabilities:{}}:
 message.params.name==='deck_current_project'?{structuredContent:active}:
 {structuredContent:{ok:true,value:{}}};
 queueMicrotask(()=>w.dispatchEvent(new w.MessageEvent('message',{source:w,data:{jsonrpc:'2.0',id:message.id,result}})));
};
w.eval(await readFile(new URL('sidebar-bridge.js',import.meta.url),'utf8'));
await new Promise(r=>setTimeout(r,20));
assert.equal(mounts[0].props.sessionId,'project-a');
active={threadId:'project-b',cwd:'C:/b'};
await poll();
assert.equal(disposed,1);
assert.equal(mounts[1].props.sessionId,'project-b');
await assert.rejects(mounts[0].services.connection.rpc.call('/api','dsws',{method:'snapshot'}));
active=null;
await poll();
assert.equal(disposed,2);
assert.match(w.document.getElementById('root').textContent,/项目/);
dom.window.close();
console.log('PASS project switch remounts original panel, rejects stale requests and clears missing identity');
