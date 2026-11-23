import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createSidebarServer } from '../../prototypes/upstream-port/sidebar-server.mjs';
import { createCloudApp } from './app.mjs';
import { resolveCloudProject } from './context.mjs';
import { createRepositoryStore, parseRepositories } from './repositories.mjs';

const token = 'test-only-access-token-00000000000000000000';

test('GitHub repository bindings enforce the allowlist before running commands', async () => {
  assert.throws(() => parseRepositories(''), /DECK_REPOSITORIES/);
  assert.throws(() => parseRepositories('https://github.com/a/b'), /DECK_REPOSITORIES/);
  const directory = await mkdtemp(path.join(tmpdir(), 'cloud-bindings-test-'));
  const commands = [];
  const store = createRepositoryStore({ repositories: ['owner/one'], directory, execute: async (program, args) => { commands.push([program, args]); } });
  try {
    await assert.rejects(store.select('owner/outside'), /not in/);
    assert.equal(commands.length, 0);
    const selected = await store.select('OWNER/ONE');
    assert.equal(selected.repository, 'owner/one');
    assert.equal(commands[0][0], 'gh');
    assert.equal(commands[1][1][0], 'init');
    assert.equal(commands.some(([, args]) => args.includes('clone')), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('real MCP HTTP protocol: authentication, resources, repository isolation and stale panel protection', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'cloud-mcp-test-'));
  const core = await createSidebarServer({ dataDirectory: directory, changeDirectory: false, resolveProject: resolveCloudProject });
  const repositoryStore = {
    list: () => ['owner/one', 'owner/two'],
    async select(repository) {
      if (!this.list().includes(repository)) throw new Error('Repository is not allowed.');
      return { repository, root: path.join(directory, repository.split('/')[1]) };
    },
  };
  const cloud = await createCloudApp({ core, repositoryStore, accessToken: token, publicOrigin: 'https://example.test' });
  const http = createServer(cloud.app);
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${http.address().port}`;
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  let id = 0;
  async function rpc(session, method, params = {}) {
    const response = await fetch(base + '/mcp', { method: 'POST', headers: { ...headers, ...(session ? { 'mcp-session-id': session } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
    assert.equal(response.status, 200, await response.clone().text());
    const data = await response.json();
    assert.equal(data.error, undefined, JSON.stringify(data.error));
    return { response, result: data.result };
  }
  async function initialize() {
    const { response } = await rpc(null, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    return response.headers.get('mcp-session-id');
  }
  async function tool(session, name, args = {}) { return (await rpc(session, 'tools/call', { name, arguments: args })).result; }
  try {
    assert.equal((await fetch(base + '/healthz')).status, 200);
    assert.equal((await fetch(base + '/mcp')).status, 401);
    assert.equal((await fetch(base + '/mcp', { headers: { ...headers, origin: 'https://evil.test' } })).status, 403);
    assert.equal((await fetch(base + '/mcp', { headers: { ...headers, 'mcp-session-id': 'expired' } })).status, 404);
    assert.equal((await fetch(base + '/mcp', { method: 'POST', headers, body: '{' })).status, 400);
    const a = await initialize();
    const b = await initialize();
    assert.ok(a && b && a !== b);
    const tools = (await rpc(a, 'tools/list')).result.tools.map(tool => tool.name);
    assert.ok(tools.includes('deck_repository_select'));
    assert.ok(tools.includes('open_deck_sidebar_probe'));
    assert.ok(!tools.includes('deck_issue_patch'));
    assert.equal((await tool(a, 'deck_current_project')).isError, true);
    await tool(a, 'deck_repository_select', { repository: 'owner/one' });
    await tool(b, 'deck_repository_select', { repository: 'owner/two' });
    const [first, second] = await Promise.all([tool(a, 'deck_current_project'), tool(b, 'deck_current_project')]);
    assert.equal(first.structuredContent.projectId, 'owner/one');
    assert.equal(second.structuredContent.projectId, 'owner/two');
    assert.notEqual(first.structuredContent.threadId, second.structuredContent.threadId);
    assert.equal((await tool(a, 'deck_repository_select', { repository: 'other/private' })).isError, true);
    assert.equal((await tool(a, 'deck_repository_list')).structuredContent.selected, 'owner/one');
    await tool(a, 'deck_repository_select', { repository: 'owner/two' });
    const stale = await tool(a, 'deck_upstream_read', { method: 'snapshot', payload: { expectedThreadId: first.structuredContent.threadId } });
    assert.equal(stale.isError, true);
    assert.match(stale.content[0].text, /聊天已切换/);
    assert.equal((await tool(a, 'deck_upstream_read', { method: 'gitStatus' })).isError, true);
    assert.equal((await tool(a, 'deck_issue_patch', {})).isError, true);
    const resources = (await rpc(a, 'resources/list')).result.resources;
    const html = (await rpc(a, 'resources/read', { uri: resources[0].uri })).result.contents[0].text;
    assert.match(html, /cloud-repository-/);
    assert.match(html, /MattSkillsDeck/);
    const deleted = await fetch(base + '/mcp', { method: 'DELETE', headers: { ...headers, 'mcp-session-id': a } });
    assert.equal(deleted.status, 200);
    assert.equal((await fetch(base + '/mcp', { headers: { ...headers, 'mcp-session-id': a } })).status, 404);
  } finally {
    await cloud.close();
    http.closeAllConnections();
    await new Promise(resolve => http.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
