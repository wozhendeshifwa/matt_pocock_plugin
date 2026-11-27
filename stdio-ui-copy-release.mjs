import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createSidebarServer } from './prototypes/upstream-port/sidebar-server.mjs';

// Pinned UI/Copy release; preserve this connection's existing isolated state.
const dataDirectory = fileURLToPath(new URL('../../.scratch/issue82/context/candidate/state/', import.meta.url));
const server = await createSidebarServer({ dataDirectory, changeDirectory: false });
const pending = new Set();
for await (const line of createInterface({ input: process.stdin })) {
  let request;
  try { request = JSON.parse(line); } catch { continue; }
  if (request.id === undefined) continue;
  const work = (async () => {
    let response;
    try { response = { result: await server.handle(request) }; }
    catch (error) { response = { error: { code: -32603, message: error.message } }; }
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, ...response }) + '\n');
  })();
  pending.add(work);
  work.finally(() => pending.delete(work));
}
await Promise.allSettled(pending);
await server.dispose();
process.exit(0);
