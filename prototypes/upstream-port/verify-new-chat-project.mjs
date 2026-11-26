import assert from 'node:assert/strict';
import { createNativeDraftOutputs } from './native-draft-outputs.mjs';
let identity = { threadId: 'source-thread', projectId: 'project-current', projectRoot: 'C:\\项目 & space\\repo' };
const requests = [];
const outputs = createNativeDraftOutputs({
  capabilities: { openLinks: {}, experimental: { 'openai/message': { draft: {} } } },
  getIdentity: () => identity,
  readIdentity: async () => identity,
  request: async (method, params) => { requests.push({ method, params }); return {}; },
});
const text = '【项目继承验收】\n保持原文 & ? # 中文';
await outputs.prefill('new', text);
assert.equal(requests[0].method, 'ui/open-link', 'new chat must carry the source project atomically instead of relying on global selection');
const url = new URL(requests[0].params.url);
assert.equal(url.protocol, 'codex:');
assert.equal(url.hostname, 'new');
assert.equal(url.searchParams.get('projectId'), identity.projectId);
assert.equal(url.searchParams.get('path'), identity.projectRoot);
assert.equal(url.searchParams.get('prompt'), text);
assert.equal(url.searchParams.get('mode'), 'codex');
assert.equal(url.searchParams.has('send'), false);
await outputs.prefill('active', text);
assert.equal(requests[1].method, 'ui/message');
assert.equal(requests[1].params._meta['openai/message'].send, false);
identity = { ...identity, projectId: null };
await assert.rejects(outputs.prefill('new', text), /项目/);
assert.equal(requests.length, 2, 'unbound project must not fall back to global new chat');
console.log('PASS new draft binds source project/root and exact prompt; active stays unsent; missing project fails closed');

const noLinks = createNativeDraftOutputs({capabilities:{experimental:{'openai/message':{draft:{}}}},getIdentity:()=>identity,readIdentity:async()=>identity,request:async()=>assert.fail('no link must not dispatch')});
assert.equal(noLinks.capabilities.new,false);
await assert.rejects(noLinks.prefill('new',text),/项目/);
identity = {...identity,projectId:'project-current'};
const refused = createNativeDraftOutputs({capabilities:{openLinks:{},experimental:{'openai/message':{draft:{}}}},getIdentity:()=>identity,readIdentity:async()=>identity,request:async()=>({isError:true})});
await assert.rejects(refused.prefill('new',text),/拒绝/);
const changed = createNativeDraftOutputs({capabilities:{openLinks:{},experimental:{'openai/message':{draft:{}}}},getIdentity:()=>identity,readIdentity:async()=>({...identity,projectId:'other-project'}),request:async()=>assert.fail('changed project must not dispatch')});
await assert.rejects(changed.prefill('new',text),/切换/);
console.log('PASS missing link capability, host refusal and changed project all stop without fallback');
