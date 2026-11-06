import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const dom = new JSDOM('<main id="root"></main>', {runScripts:'outside-only'});
const w=dom.window;
let mounted=false;
w.MattSkillsCodex={mount(){mounted=true;}};
w.postMessage=message=>{
  if(message.method==='ui/initialize') queueMicrotask(()=>w.dispatchEvent(new w.MessageEvent('message',{source:w,data:{jsonrpc:'2.0',id:message.id,result:{hostCapabilities:{},hostContext:{}}}})));
  if(message.method==='tools/call') queueMicrotask(()=>w.dispatchEvent(new w.MessageEvent('message',{source:w,data:{jsonrpc:'2.0',id:message.id,result:{isError:true,content:[{type:'text',text:'当前请求无法关联项目'}]}}})));
};
w.eval(await readFile(new URL('sidebar-bridge.js',import.meta.url),'utf8'));
await new Promise(resolve=>setTimeout(resolve,20));
assert.equal(mounted,false,'Unassociated sidebar must not mount fixed-repository data or actions');
assert.match(w.document.getElementById('root').textContent,/项目/);
dom.window.close();
console.log('PASS unassociated sidebar blocks fixed-repository data and actions');
