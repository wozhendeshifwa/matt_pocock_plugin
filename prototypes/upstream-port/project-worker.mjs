import { createProductionSkillHost } from './production-skill-host.mjs';
import { createOriginalHost } from "./node-host.mjs";
import { normalizePanelPayload } from "./panel-payload.mjs";
import { createProjectSnapshotCache } from "./project-snapshot-cache.mjs";
import { createSnapshotCacheIdentity } from "./snapshot-cache-identity.mjs";
import { classifyEndpoint } from "./rpc-endpoints.mjs";
import { DECK_TOOL_POLICY } from "./write-policy.mjs";

const host = await createOriginalHost({ dataRoot: process.cwd(), workspaceRoot: process.argv[2], skillHost: createProductionSkillHost({dataRoot: process.cwd(), workspaceRoot: process.argv[2]}) });
const snapshots = createProjectSnapshotCache({
  directory: process.cwd(), workspaceRoot: process.argv[2],
  identity: createSnapshotCacheIdentity(process.argv[2]),
  call: (method, payload) => host.call(method, payload),
});
async function mutate(operation) {
  const finish = await snapshots.beginMutation();
  try { return await operation(); }
  finally {
    // A failed cache cleanup must not report a completed GitHub write as failed
    // and cause a user retry. The remaining marker keeps the cache disabled.
    await finish().catch(() => process.stderr.write('snapshot-cache-invalidation-incomplete\n'));
  }
}
process.on("message", async ({ id, method, payload }) => {
  try {
    if (method === "__deck_tools_list__") {
      process.send({ id, result: host.listTools() });
      return;
    }
    if (method === "__deck_tool_call__") {
      const execute = () => host.callTool(payload.name, payload.arguments, payload.context);
      const result = DECK_TOOL_POLICY[payload.name]?.category === "external-github-write" ? await mutate(execute) : await execute();
      process.send({ id, result });
      return;
    }
    if (method === 'portSnapshotCache') {
      process.send({ id, result: normalizePanelPayload('snapshot', await snapshots.peek() ?? { ok: true, value: null }) });
      return;
    }
    const execute = () => snapshots.read(method, payload);
    const result = classifyEndpoint(method, payload) === 'write' ? await mutate(execute) : await execute();
    process.send({ id, result: normalizePanelPayload(method, result) });
  } catch (error) {
    process.send({ id, error: error.message });
  }
});
process.on("disconnect", () => { host.dispose(); process.exit(0); });
