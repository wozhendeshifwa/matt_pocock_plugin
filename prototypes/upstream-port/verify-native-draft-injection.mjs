import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<main id="root"></main>', { runScripts:'outside-only' });
const w = dom.window;
w.eval(await readFile(new URL('dist/client.js', import.meta.url), 'utf8'));
let identity = { threadId:'thread-a', projectId:'project-a', projectRoot:'C:/project', cwd:'C:/project' };
const mounts = [], messages = [];
w.setInterval = () => 1;
w.MattSkillsCodex.mount = (element, services) => { mounts.push(services); return () => {}; };
w.postMessage = request => {
  if (!request.id) return;
  if (['ui/message','ui/open-link'].includes(request.method)) messages.push(request.params);
  const result = request.method === 'ui/initialize' ? {hostCapabilities:{openLinks:{},experimental:{'openai/message':{draft:{}}}}} : request.params.name === 'deck_current_project' ? {structuredContent:identity} : {};
  queueMicrotask(() => w.dispatchEvent(new w.MessageEvent('message', {source:w,data:{jsonrpc:'2.0',id:request.id,result}})));
};
w.eval(await readFile(new URL('sidebar-bridge.js', import.meta.url), 'utf8'));
try {
  for (let i=0; !mounts.length && i<100; i++) await new Promise(r=>setTimeout(r,10));
  assert.equal(mounts.length,1);
  assert.equal(mounts[0].codexActions.capabilities.active,true,'advertised native draft transport must enable original append injection');
  for (const target of ['active','new']) {
    const result = await mounts[0].codexActions.prefill(target,'exact edited draft');
    assert.equal(result.status,'requested','empty host ACK must never be called verified fill');
    assert.equal(result.target,target);
    if (target === 'active') {
      assert.equal(messages.at(-1)._meta['openai/message'].send,false);
      assert.equal(messages.at(-1)._meta['openai/message'].target,target);
      assert.equal(messages.at(-1).content[0].text,'exact edited draft');
    } else {
      const url = new URL(messages.at(-1).url);
      assert.equal(url.searchParams.get('projectId'),identity.projectId);
      assert.equal(url.searchParams.get('path'),identity.projectRoot);
      assert.equal(url.searchParams.get('prompt'),'exact edited draft');
    }
  }
  assert.equal(messages.length,2);
  identity = {...identity, threadId:'thread-b'};
  await assert.rejects(mounts[0].codexActions.prefill('active','stale draft'), /切换/);
  assert.equal(messages.length,2,'identity change must stop the stale operation');
  console.log('PASS production bridge restores native active/new unsent draft requests and rejects stale targets');
} finally { w.close(); }
