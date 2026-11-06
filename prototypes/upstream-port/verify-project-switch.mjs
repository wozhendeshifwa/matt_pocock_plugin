import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const dom=new JSDOM('<main id="root"></main>',{runScripts:'outside-only'});
const w=dom.window;
let active={threadId:'project-a',cwd:'C:/a'};
let poll;
let disposed=0;
let lastPayload=null;
const mounts=[];
const messages=[];
w.setInterval=fn=>{poll=fn;return 1};
w.MattSkillsCodex={mount(element,services,props){mounts.push({services,props});return ()=>disposed++}};
w.postMessage=message=>{
 if(!message.id)return;
 if(message.method==='ui/message')messages.push(message.params);
 if(message.params?.name==='deck_upstream_read')lastPayload=message.params.arguments?.payload;
 const result=message.method==='ui/initialize'?{hostContext:{},hostCapabilities:{experimental:{'openai/message':true}}}:
 message.params.name==='deck_current_project'?{structuredContent:active}:
 {structuredContent:{ok:true,value:{}}};
 queueMicrotask(()=>w.dispatchEvent(new w.MessageEvent('message',{source:w,data:{jsonrpc:'2.0',id:message.id,result}})));
};
w.eval(await readFile(new URL('sidebar-bridge.js',import.meta.url),'utf8'));
await new Promise(r=>setTimeout(r,20));
assert.equal(mounts[0].props.sessionId,'C:/a');

// A different chat in the same project must keep the mounted board (and its
// state) while moving only the identity used for the next request.
active={threadId:'project-a-2',cwd:'C:/a'};
await poll();
assert.equal(mounts.length,1,'same-project chat switch must not remount');
assert.equal(disposed,0);
assert.equal(mounts[0].services.sessions.list.getSnapshot().current,'C:/a');
assert.equal(mounts[0].services.sessions.get('C:/a').cwd,'C:/a');
const sameProjectResult=await mounts[0].services.connection.rpc.call('/api','dsws',{method:'snapshot'});
assert.deepEqual(sameProjectResult,{ok:true,value:{}});
assert.equal(lastPayload.expectedThreadId,'project-a-2');
await mounts[0].services.codexActions.prefill('new','same-project draft');
assert.equal(messages.length,1);
assert.equal(messages[0]._meta['openai/message'].target,'new');
assert.equal(messages[0]._meta['openai/message'].send,false);

active={threadId:'project-b',cwd:'C:/b'};
await poll();
assert.equal(disposed,1);
assert.equal(mounts[1].props.sessionId,'C:/b');
await assert.rejects(mounts[0].services.connection.rpc.call('/api','dsws',{method:'snapshot'}));
active=null;
await poll();
assert.equal(disposed,2);
assert.match(w.document.getElementById('root').textContent,/项目/);
dom.window.close();
console.log('PASS same-project chat keeps the panel; cross-project remounts; stale requests rejected; missing identity cleared');
