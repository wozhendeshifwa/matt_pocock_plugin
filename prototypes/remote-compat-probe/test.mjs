import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createProbe } from './server.mjs';
test('real HTTP MCP protocol, authorization, session isolation and metadata minimization', async () => {
  const token='isolated-test-token-not-a-real-credential';
  const app=await createProbe({token,origin:'https://probe.example'});
  const url=new URL(`http://127.0.0.1:${app.port}/mcp`);
  const clients=[];
  try {
    assert.equal((await fetch(url)).status,401);
    assert.equal((await fetch(url,{headers:{authorization:`Bearer ${token}`,origin:'https://evil.example'}})).status,403);
    assert.equal((await fetch(url,{headers:{authorization:`Bearer ${token}`,'mcp-session-id':'nonexistent'}})).status,404);
    const transports=[];
    for(let i=0;i<2;i++){const transport=new StreamableHTTPClientTransport(url,{requestInit:{headers:{authorization:`Bearer ${token}`}}});const client=new Client({name:'isolated-test',version:'1'});clients.push(client);await client.connect(transport);transports.push(transport);}
    assert.notEqual(transports[0].sessionId,transports[1].sessionId);
    assert.equal((await clients[0].listTools()).tools.length,2);
    const resources=await clients[0].listResources();
    const html=await clients[0].readResource({uri:resources.resources[0].uri});
    assert.match(html.contents[0].text,/ui\/initialize/);
    const result=await clients[0].callTool({name:'remote_compat_identity',arguments:{},_meta:{threadId:'test-thread',cwd:'private-path',secret:'test-secret'}});
    assert.equal(result.structuredContent.hasThreadId,true);
    assert.equal(result.structuredContent.hasCwd,true);
    assert.equal(JSON.stringify(result).includes('private-path'),false);
    assert.equal(JSON.stringify(result).includes('test-thread'),false);
    assert.equal(JSON.stringify(result).includes('test-secret'),false);
    const separate=await clients[1].callTool({name:'remote_compat_identity',arguments:{}});
    assert.equal(separate.structuredContent.hasThreadId,false);
    await assert.rejects(clients[0].callTool({name:'remote_compat_identity',arguments:{path:'x'}}), /Probe accepts no arguments/);
  } finally {await Promise.allSettled(clients.map(c=>c.close()));await app.close();}
});
