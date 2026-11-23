import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createProbe } from './server.mjs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

// Reuse the existing development harness, including from this isolated worktree.
// The deployed probe has no jsdom runtime dependency.
function installedJsdom() {
  const locations = ['../upstream-port/package.json', '../../../../prototypes/upstream-port/package.json'];
  for (const location of locations) {
    try { return createRequire(new URL(location, import.meta.url))('jsdom'); } catch {}
  }
  throw new Error('UI tests require the existing upstream-port jsdom installation');
}
const { JSDOM } = installedJsdom();
const probeHtml = await readFile(new URL('probe.html', import.meta.url), 'utf8');
const nextTurn = () => new Promise(resolve => setImmediate(resolve));

async function probeUi(t, { hostContext = {}, hostCapabilities = { experimental: { 'openai/message': { draft: {} } } }, deferInitialization = false } = {}) {
  const dom = new JSDOM(probeHtml, { runScripts: 'outside-only', url: 'https://probe-ui.invalid/' });
  t.after(() => dom.window.close());
  const window = dom.window;
  const requests = [];
  const identityRequests = [];
  function deliver(data, source = window) {
    window.dispatchEvent(new window.MessageEvent('message', { source, data }));
  }
  function reply(request, result) {
    deliver({ jsonrpc: '2.0', id: request.id, result });
  }
  window.postMessage = message => {
    requests.push(message);
    if (message.method === 'ui/initialize' && !deferInitialization) {
      queueMicrotask(() => reply(message, { hostContext, hostCapabilities }));
    } else if (message.method === 'ui/message') {
      queueMicrotask(() => reply(message, {}));
    } else if (message.method === 'tools/call') {
      identityRequests.push(message);
    }
  };
  for (const script of window.document.scripts) window.eval(script.textContent);
  await nextTurn();
  return {
    window, requests, identityRequests, deliver, reply,
    element: id => window.document.getElementById(id),
    summary: () => JSON.parse(window.document.getElementById('host').textContent),
    context(context) {
      deliver({ jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: { hostContext: context } });
    },
  };
}

const identityResult = fingerprint => ({ structuredContent: {
  probe: true, keys: ['threadId', 'cwd'], hasThreadId: true,
  threadFingerprint: fingerprint, hasCwd: true,
} });

test('probe UI keeps both draft targets gated and requests send:false without sending', async t => {
  const ui = await probeUi(t, { deferInitialization: true });
  for (const id of ['identity', 'draft', 'new-draft']) assert.equal(ui.element(id).disabled, true);
  assert.equal(ui.requests.filter(request => request.method === 'ui/message').length, 0);
  ui.reply(ui.requests[0], { hostContext: {}, hostCapabilities: { experimental: { 'openai/message': { draft: {} } } } });
  await nextTurn();
  assert.equal(ui.summary().messageCapability, true);
  assert.equal(ui.summary().draftCapability, true);
  assert.equal(ui.requests.filter(request => request.method === 'ui/notifications/initialized').length, 1);
  for (const id of ['identity', 'draft', 'new-draft']) assert.equal(ui.element(id).disabled, false);
  await ui.element('draft').onclick();
  await ui.element('new-draft').onclick();
  const messages = ui.requests.filter(request => request.method === 'ui/message');
  assert.equal(messages.length, 2);
  assert.deepEqual(messages.map(message => message.params._meta['openai/message'].target), ['active', 'new']);
  for (const message of messages) {
    assert.equal(message.params._meta['openai/message'].send, false);
    assert.equal(message.params.role, 'user');
    assert.equal(message.params.content.length, 1);
    assert.equal(message.params.content[0].type, 'text');
    assert.match(message.params.content[0].text, /请勿发送/);
  }
  assert.match(messages[0].params.content[0].text, /当前聊天/);
  assert.match(messages[1].params.content[0].text, /新聊天/);
  assert.match(ui.element('status').textContent, /请人工确认落点、可编辑且未发送/);
});

test('probe UI does not request drafts when the host does not advertise the extension', async t => {
  const ui = await probeUi(t, { hostCapabilities: {} });
  assert.equal(ui.element('identity').disabled, false);
  for (const id of ['draft', 'new-draft']) {
    assert.equal(ui.element(id).disabled, true);
    await ui.element(id).onclick();
  }
  assert.equal(ui.requests.filter(request => request.method === 'ui/message').length, 0);
  assert.equal(ui.summary().messageCapability, false);
  assert.match(ui.element('status').textContent, /未声明/);
});

test('probe UI reports only host theme signals and applies a finite color whitelist', async t => {
  const ui = await probeUi(t, { hostContext: {
    theme: 'dark', arbitrary: 'private-context-value',
    styles: { variables: { '--background': '#112233', '--foreground': '#eeeeee', '--border': '#445566', '--unlisted': 'private-style-value' } },
  } });
  const rootStyle = ui.window.document.documentElement.style;
  assert.equal(ui.summary().theme, 'dark');
  assert.equal(ui.summary().themeSource, 'initialize');
  assert.equal(ui.summary().hostContextChangeCount, 0);
  assert.equal(rootStyle.colorScheme, 'dark');
  assert.equal(rootStyle.getPropertyValue('--background'), 'rgb(17, 34, 51)');
  assert.equal(rootStyle.getPropertyValue('--unlisted'), '');
  assert.equal(ui.element('host').textContent.includes('private-'), false);
  assert.equal(ui.element('host').textContent.includes('#112233'), false);
  ui.context({ theme: 'light', styles: { variables: {
    '--background': '#fafafa', '--foreground': '#111111', '--border': 'url(https://untrusted.invalid/color)', '--unlisted': 'private-next-value',
  } }, extra: 'private-next-context' });
  const summary = ui.summary();
  assert.equal(summary.theme, 'light');
  assert.equal(summary.themeSource, 'host-context-changed');
  assert.equal(summary.hostContextChangeCount, 1);
  assert.equal(summary.generation, 1);
  assert.equal(summary.lastSignalHasTheme, true);
  assert.deepEqual(summary.styleVariablePresence, { '--background': true, '--foreground': true, '--border': true });
  assert.deepEqual(summary.appliedStyleVariables, ['--background', '--foreground']);
  assert.equal(rootStyle.colorScheme, 'light');
  assert.equal(rootStyle.getPropertyValue('--background'), 'rgb(250, 250, 250)');
  assert.equal(rootStyle.getPropertyValue('--border'), '');
  assert.equal(ui.element('host').textContent.includes('private-'), false);
  assert.equal(ui.element('host').textContent.includes('untrusted.invalid'), false);
  ui.context({ theme: 'unsupported-private-theme', viewport: { width: 123 } });
  assert.equal(ui.summary().theme, 'light');
  assert.equal(ui.summary().lastSignalHasTheme, false);
  assert.equal(ui.summary().hostContextChangeCount, 2);
  assert.equal(ui.element('host').textContent.includes('unsupported-private-theme'), false);
  ui.context({ theme: 'dark' });
  assert.equal(rootStyle.colorScheme, 'dark');
  assert.equal(rootStyle.getPropertyValue('--background'), '', 'theme-only change clears colors from the previous theme');
});

test('probe UI does not claim an operating-system/default theme as a host signal', async t => {
  const ui = await probeUi(t);
  assert.equal(ui.summary().theme, null);
  assert.equal(ui.summary().themeSource, null);
  assert.equal(ui.window.document.documentElement.style.colorScheme, '');
  ui.deliver({ jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: { theme: 'dark' } }, null);
  assert.equal(ui.summary().hostContextChangeCount, 0, 'non-parent messages cannot create host evidence');
});

test('probe UI accepts trusted parent context notifications without jsonrpc and rejects other windows', async t => {
  const ui = await probeUi(t, { hostContext: { theme: 'light' } });
  const notification = { method: 'ui/notifications/host-context-changed', params: { hostContext: { theme: 'dark', extra: 'private-context' } } };
  ui.deliver(notification, null);
  assert.equal(ui.summary().theme, 'light');
  assert.equal(ui.summary().hostContextChangeCount, 0);
  ui.deliver(notification);
  assert.equal(ui.summary().theme, 'dark');
  assert.equal(ui.window.document.documentElement.style.colorScheme, 'dark');
  assert.equal(ui.summary().hostContextChangeCount, 1);
  assert.equal(ui.summary().generation, 1);
  assert.equal(ui.summary().lastSignalChannel, 'ui/notifications/host-context-changed');
  assert.deepEqual(ui.summary().signalChannelCounts, { 'ui/notifications/host-context-changed': 1, 'openai:set_globals': 0 });
  assert.equal(ui.element('host').textContent.includes('private-context'), false);
});

test('probe UI follows openai:set_globals theme signals without exposing arbitrary globals', async t => {
  const ui = await probeUi(t, { hostContext: { theme: 'light' } });
  for (const [field, theme] of [['theme', 'dark'], ['visualizationTheme', 'light']]) {
    ui.window.dispatchEvent(new ui.window.CustomEvent('openai:set_globals', { detail: { globals: {
      [field]: theme, privateValue: 'private-global-value',
      visualizationStyleVariables: { '--background': '#112233', '--unlisted': 'private-style' },
    } } }));
    assert.equal(ui.summary().theme, theme);
    assert.equal(ui.window.document.documentElement.style.colorScheme, theme);
    assert.equal(ui.summary().themeSource, 'openai:set_globals');
    assert.equal(ui.summary().lastSignalChannel, 'openai:set_globals');
    assert.equal(ui.window.document.documentElement.style.getPropertyValue('--background'), 'rgb(17, 34, 51)');
    assert.equal(ui.window.document.documentElement.style.getPropertyValue('--unlisted'), '');
    assert.equal(ui.element('host').textContent.includes('private-'), false);
  }
  assert.equal(ui.summary().generation, 2);
  assert.deepEqual(ui.summary().signalChannelCounts, { 'ui/notifications/host-context-changed': 0, 'openai:set_globals': 2 });
});

test('probe UI discards identity responses and errors from before a host-context change', async t => {
  const ui = await probeUi(t);
  const oldResult = ui.element('identity').onclick();
  const oldError = ui.element('identity').onclick();
  ui.context({ theme: 'dark' });
  const fresh = ui.element('identity').onclick();
  ui.reply(ui.identityRequests[2], identityResult('bbbbbbbbbbbbbbbb'));
  await fresh;
  const freshDisplay = ui.element('output').textContent;
  assert.equal(JSON.parse(freshDisplay).threadFingerprint, 'bbbbbbbbbbbbbbbb');
  ui.reply(ui.identityRequests[0], identityResult('aaaaaaaaaaaaaaaa'));
  ui.deliver({ jsonrpc: '2.0', id: ui.identityRequests[1].id, error: { message: 'late old error' } });
  await Promise.all([oldResult, oldError]);
  assert.equal(ui.element('output').textContent, freshDisplay);
  assert.equal(ui.summary().staleIdentityResponsesDiscarded, 2);
  assert.equal(ui.summary().hostContextChangeCount, 1);
  assert.match(ui.window.document.body.textContent, /仅保护本探针，不验证业务桥接/);
});

test('probe UI does not present a tool error as successful identity evidence', async t => {
  const ui = await probeUi(t);
  const request = ui.element('identity').onclick();
  ui.reply(ui.identityRequests[0], { isError: true, content: [{ type: 'text', text: 'private-error-detail' }] });
  await request;
  assert.match(ui.element('output').textContent, /不作为身份支持证据/);
  assert.equal(ui.element('output').textContent.includes('private-error-detail'), false);
});

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
