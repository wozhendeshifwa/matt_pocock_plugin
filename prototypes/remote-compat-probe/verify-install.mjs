import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, writeFile, copyFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { buildPlugin, pluginSelector, serverName } from './build-plugin.mjs';
import { createProbe } from './server.mjs';

const run = promisify(execFile);
const scratch = fileURLToPath(new URL('../../.scratch/', import.meta.url));
await mkdir(scratch, { recursive: true });
const root = await mkdtemp(path.join(scratch, 'probe-install-'));
const marketplace = path.join(root, 'marketplace');
const home = path.join(root, 'codex-home');
await mkdir(home);
const sentinel = '[model_providers.DeepSeek]\nname = "DeepSeek test fallback"\nbase_url = "https://deepseek.example.invalid"\nwire_api = "responses"\n\n[model_providers.OpenAI]\nname = "OpenAI test provider"\nbase_url = "https://openai.example.invalid"\nwire_api = "responses"\n';
await writeFile(path.join(home, 'config.toml'), sentinel, 'utf8');
await copyFile(path.join(home, 'config.toml'), path.join(home, 'config.before-install.toml'));
const fakeToken = randomBytes(32).toString('hex');
const env = { ...process.env, CODEX_HOME: home, DECK_PROBE_ACCESS_TOKEN: fakeToken };
async function cli(...args) {
  const { stdout } = await run(process.env.CODEX_TEST_EXECUTABLE || 'codex', args, { env, windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 });
  return args.includes('--json') ? JSON.parse(stdout) : stdout.trim();
}
const probe = await createProbe({ token: fakeToken });
let client;
try {
  await buildPlugin(marketplace, { endpoint: `http://127.0.0.1:${probe.port}/mcp`, allowLoopback: true });
  await assert.rejects(buildPlugin(marketplace), { code: 'EEXIST' });
  await cli('plugin', 'marketplace', 'add', marketplace, '--json');
  const installed = await cli('plugin', 'add', pluginSelector, '--json');
  assert.equal(installed.pluginId, pluginSelector);
  assert.equal(installed.version, '0.1.0');
  assert.ok(path.resolve(installed.installedPath).startsWith(path.resolve(home) + path.sep));
  const listed = await cli('plugin', 'list', '--marketplace', 'deck-remote-probe-43', '--json');
  assert.equal(listed.installed.length, 1);
  assert.equal(listed.installed[0].enabled, true);
  const servers = await cli('mcp', 'list', '--json');
  assert.equal(servers.length, 1);
  assert.equal(servers[0].transport.type, 'streamable_http');
  assert.equal(servers[0].transport.bearer_token_env_var, 'DECK_PROBE_ACCESS_TOKEN');
  assert.equal(servers[0].transport.http_headers, null);
  assert.equal(servers[0].auth_status, 'bearer_token');
  const cachedText = await readFile(path.join(installed.installedPath, '.mcp.json'), 'utf8');
  const cached = JSON.parse(cachedText).mcpServers[serverName];
  assert.equal(cached.bearer_token_env_var, 'DECK_PROBE_ACCESS_TOKEN');
  assert.equal(cachedText.includes(fakeToken), false);
  assert.equal((await readFile(path.join(home, 'config.toml'), 'utf8')).includes(sentinel), true);
  assert.equal(await readFile(path.join(home, 'config.before-install.toml'), 'utf8'), sentinel);

  // Exercise the generated cached declaration with the SDK. This is HTTP/auth
  // coverage, not an assertion that a real Codex desktop UI was operated here.
  assert.equal((await fetch(cached.url)).status, 401);
  assert.equal((await fetch(cached.url, { headers: { authorization: 'Bearer deliberately-invalid-test-token' } })).status, 401);
  client = new Client({ name: 'plugin-install-reproduction', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(cached.url), {
    requestInit: { headers: { authorization: `Bearer ${env[cached.bearer_token_env_var]}` } },
  }));
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map(t => t.name).sort(), ['open_remote_compat_probe', 'remote_compat_identity']);
  const identity = await client.callTool({ name: 'remote_compat_identity', arguments: {} });
  assert.equal(identity.structuredContent.probe, true);
  assert.equal(identity.structuredContent.hasThreadId, false);
  const resources = await client.listResources();
  const html = await client.readResource({ uri: resources.resources[0].uri });
  assert.match(html.contents[0].text, /send: false/);
  console.log(JSON.stringify({ status: 'passed', cli: await cli('--version'), pluginId: installed.pluginId,
    version: installed.version, auth: 'environment-reference', realConfigurationModified: false,
    providerSentinelsPreserved: true, secretWrittenToPlugin: false,
    checks: ['fresh-home-install', 'plugin-enabled', 'CLI-parsed-remote-auth', 'generated-cache-has-no-token', 'provider-backup', 'overwrite-refused', 'HTTP-auth-tools-resource'],
    evidenceDirectory: root }, null, 2));
} finally {
  await client?.close();
  await probe.close();
}
