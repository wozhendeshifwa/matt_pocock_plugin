import { cp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const pluginSelector = 'deck-remote-compat-probe@deck-remote-probe-43';
export const serverName = 'deck-remote-compat-probe';
export async function buildPlugin(output, { endpoint = 'https://deck-compat-probe-43.onrender.com/mcp', allowLoopback = false } = {}) {
  const url = new URL(endpoint);
  if (url.username || url.password || url.search || url.hash ||
      (url.protocol !== 'https:' && !(allowLoopback && url.protocol === 'http:' && url.hostname === '127.0.0.1'))) {
    throw new Error('Use an HTTPS endpoint without credentials/query, or explicit loopback test mode');
  }
  const root = path.resolve(output);
  // Refuse to overwrite even a generated directory: it might contain a local
  // credential or unrelated files from an earlier installation.
  await mkdir(path.dirname(root), { recursive: true });
  await mkdir(root);
  const source = new URL('./plugin-template/', import.meta.url);
  for (const name of await readdir(source)) {
    await cp(new URL(name, source), path.join(root, name), { recursive: true, errorOnExist: true, force: false });
  }
  const configFile = path.join(root, 'plugins', 'deck-remote-compat-probe', '.mcp.json');
  const config = JSON.parse(await readFile(configFile, 'utf8'));
  config.mcpServers[serverName].url = url.href;
  await writeFile(configFile, JSON.stringify(config, null, 2) + '\n', 'utf8');
  return root;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (!args[0] || args.length > 2) throw new Error('Usage: node build-plugin.mjs <new-output-directory> [https-mcp-endpoint]');
  const root = await buildPlugin(args[0], args[1] ? { endpoint: args[1] } : {});
  console.log(`Built credential-free plugin: ${root}`);
  console.log(`Plugin selector: ${pluginSelector}`);
}
