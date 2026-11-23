import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { bridgeUrl } from './protocol.mjs';

// Credential-free compatibility package. The caller credential is independent
// from the device credential and the local adapter/GitHub environment.
export async function buildClient(output, relayOrigin) {
  const origin = bridgeUrl(relayOrigin);
  const root = path.resolve(output);
  await mkdir(root); // never overwrite an existing package/installation
  const plugin = path.join(root, 'plugins', 'deck-remote-companion');
  await mkdir(path.join(root, '.agents', 'plugins'), { recursive: true });
  await mkdir(path.join(plugin, '.codex-plugin'), { recursive: true });
  const writeJson = (file, data) => writeFile(file, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
  await writeJson(path.join(root, '.agents', 'plugins', 'marketplace.json'), {
    name: 'deck-remote-companion-44', plugins: [{ name: 'deck-remote-companion',
      source: { source: 'local', path: './plugins/deck-remote-companion' },
      policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' } }],
  });
  await writeJson(path.join(plugin, '.codex-plugin', 'plugin.json'), {
    name: 'deck-remote-companion', version: '0.1.0',
    description: 'Deck remote connection candidate. Local companion required; remote writes pending acceptance.',
    mcpServers: './.mcp.json', interface: { displayName: 'Deck Remote Companion', shortDescription: 'Render and local Deck connection' },
  });
  await writeJson(path.join(plugin, '.mcp.json'), { mcpServers: { 'deck-remote-companion': {
    url: origin + '/mcp', bearer_token_env_var: 'DECK_COMPANION_CALLER_TOKEN',
  } } });
  return { root, pluginId: 'deck-remote-companion@deck-remote-companion-44', protocol: 1, writesEnabled: false };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 4) throw new Error('Usage: node build-client.mjs <new-output-directory> <https-relay-origin>');
  console.log(JSON.stringify(await buildClient(process.argv[2], process.argv[3])));
}
