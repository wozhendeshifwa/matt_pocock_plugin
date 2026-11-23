import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { createSidebarServer } from '../../prototypes/upstream-port/sidebar-server.mjs';
import { createCloudApp } from './app.mjs';
import { createRepositoryStore, parseRepositories } from './repositories.mjs';
import { resolveCloudProject } from './context.mjs';

if (!process.env.GH_TOKEN) throw new Error('Set GH_TOKEN in the Render service Environment settings.');
const dataDirectory = resolve(process.env.DECK_DATA_ROOT ?? '/tmp/mattskills-cloud');
const repositories = parseRepositories(process.env.DECK_REPOSITORIES);
const origin = process.env.PUBLIC_BASE_URL ?? (process.env.RENDER_EXTERNAL_URL ? new URL(process.env.RENDER_EXTERNAL_URL).origin : undefined);
const core = await createSidebarServer({ resolveProject: resolveCloudProject, dataDirectory: resolve(dataDirectory, 'state'), changeDirectory: false });
const cloud = await createCloudApp({
  core, repositoryStore: createRepositoryStore({ repositories, directory: resolve(dataDirectory, 'repositories') }),
  accessToken: process.env.MCP_ACCESS_TOKEN, publicOrigin: origin,
  allowWrites: process.env.DECK_GITHUB_WRITES === 'true',
});
const http = createServer(cloud.app);
http.listen(Number(process.env.PORT ?? 10000), '0.0.0.0', () => console.log('MattSkillsDeck cloud MCP listening on /mcp'));
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  const deadline = setTimeout(() => process.exit(1), 20000);
  deadline.unref();
  http.close();
  await cloud.close();
  http.closeAllConnections();
  clearTimeout(deadline);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
