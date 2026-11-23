// Read-only integration check using the caller's existing gh authentication.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createSidebarServer } from '../../prototypes/upstream-port/sidebar-server.mjs';
import { createCloudApp } from './app.mjs';
import { createRepositoryStore, parseRepositories } from './repositories.mjs';
import { resolveCloudProject } from './context.mjs';

const repositories = parseRepositories(process.argv[2]);
assert.equal(repositories.length, 1, 'Pass exactly one owner/repo.');
const directory = await mkdtemp(path.join(tmpdir(), 'mattskills-cloud-smoke-'));
const token = randomBytes(32).toString('hex');
const core = await createSidebarServer({ resolveProject: resolveCloudProject, dataDirectory: path.join(directory, 'state'), changeDirectory: false });
const cloud = await createCloudApp({ core, repositoryStore: createRepositoryStore({ repositories, directory: path.join(directory, 'repositories') }), accessToken: token });
const http = createServer(cloud.app);
const client = new Client({ name: 'cloud-read-only-smoke', version: '1' });
try {
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${http.address().port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  const selected = await client.callTool({ name: 'deck_repository_select', arguments: { repository: repositories[0] } });
  assert.ok(!selected.isError, JSON.stringify(selected));
  console.log('PASS repository selection through authenticated MCP HTTP');
  for (const [name, args] of [['deck_context', {}], ['deck_issue_list', { limit: 2 }]]) {
    const reply = await client.callTool({ name, arguments: args }, undefined, { timeout: 180000 });
    assert.ok(!reply.isError, JSON.stringify(reply));
    assert.equal(reply.structuredContent?.status, 'ok', JSON.stringify(reply.structuredContent));
    console.log(`PASS ${name}: real GitHub read`);
  }
} finally {
  await client.close();
  await cloud.close();
  http.closeAllConnections();
  await new Promise(resolve => http.close(resolve));
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
