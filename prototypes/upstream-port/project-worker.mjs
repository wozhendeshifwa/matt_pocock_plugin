import { createOriginalHost } from "./node-host.mjs";
import { normalizePanelPayload } from "./panel-payload.mjs";

import { createProductionSkillHost } from './production-skill-host.mjs';
const host = await createOriginalHost({ dataRoot: process.cwd(), workspaceRoot: process.argv[2], skillHost: createProductionSkillHost({ dataRoot: process.cwd(), workspaceRoot: process.argv[2] }) });
process.on("message", async ({ id, method, payload }) => {
  try {
    if (method === "__deck_tools_list__") {
      process.send({ id, result: host.listTools() });
      return;
    }
    if (method === "__deck_tool_call__") {
      process.send({ id, result: await host.callTool(payload.name, payload.arguments, payload.context) });
      return;
    }
    process.send({ id, result: normalizePanelPayload(method, await host.call(method, payload)) });
  } catch (error) {
    process.send({ id, error: error.message });
  }
});
process.on("disconnect", () => { host.dispose(); process.exit(0); });
