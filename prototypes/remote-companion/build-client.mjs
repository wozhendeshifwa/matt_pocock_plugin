import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { bridgeUrl } from './protocol.mjs';

const REMOTE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256" role="img" aria-label="Deck Remote Companion">
  <title>Deck Remote Companion</title>
  <defs><linearGradient id="remote" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#075985"/><stop offset="1" stop-color="#0f766e"/></linearGradient></defs>
  <rect width="256" height="256" rx="54" fill="url(#remote)"/>
  <path d="M76 155a30 30 0 0 1-5-60 47 47 0 0 1 91-9 35 35 0 0 1 17 69H76Z" fill="#fff"/>
  <path d="M128 157v23M86 180h84" fill="none" stroke="#67e8f9" stroke-width="10" stroke-linecap="round"/>
  <circle cx="86" cy="190" r="12" fill="#67e8f9"/>
  <circle cx="170" cy="190" r="12" fill="#67e8f9"/>
</svg>\n`;

// Credential-free compatibility package. The caller credential is independent
// from the device credential and the local adapter/GitHub environment.
export async function buildClient(output, relayOrigin) {
  const origin = bridgeUrl(relayOrigin);
  const root = path.resolve(output);
  await mkdir(root); // never overwrite an existing package/installation
  const plugin = path.join(root, 'plugins', 'deck-remote-companion');
  await mkdir(path.join(root, '.agents', 'plugins'), { recursive: true });
  await mkdir(path.join(plugin, '.codex-plugin'), { recursive: true });
  await mkdir(path.join(plugin, 'assets'));
  const writeJson = (file, data) => writeFile(file, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
  await writeJson(path.join(root, '.agents', 'plugins', 'marketplace.json'), {
    name: 'deck-remote-companion-44', plugins: [{ name: 'deck-remote-companion',
      source: { source: 'local', path: './plugins/deck-remote-companion' },
      policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' } }],
  });
  await writeJson(path.join(plugin, '.codex-plugin', 'plugin.json'), {
    name: 'deck-remote-companion', version: '0.1.1',
    description: 'Deck remote connection candidate. Local companion required; remote writes pending acceptance.',
    mcpServers: './.mcp.json', interface: { displayName: 'Deck Remote Companion', shortDescription: 'Deck remote connection',
      logo: './assets/remote-cloud.svg', composerIcon: './assets/remote-cloud.svg' },
  });
  await writeFile(path.join(plugin, 'assets', 'remote-cloud.svg'), REMOTE_ICON, { flag: 'wx' });
  await writeJson(path.join(plugin, '.mcp.json'), { mcpServers: { 'deck-remote-companion': {
    url: origin + '/mcp', bearer_token_env_var: 'DECK_COMPANION_CALLER_TOKEN',
  } } });
  return { root, pluginId: 'deck-remote-companion@deck-remote-companion-44', protocol: 1, writesEnabled: false };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 4) throw new Error('Usage: node build-client.mjs <new-output-directory> <https-relay-origin>');
  console.log(JSON.stringify(await buildClient(process.argv[2], process.argv[3])));
}
