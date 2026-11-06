import { createOriginalHost } from "./node-host.mjs";

const host = await createOriginalHost({ dataRoot: process.cwd(), workspaceRoot: process.argv[2] });
process.on("message", async ({ id, method, payload }) => {
  try { process.send({ id, result: await host.call(method, payload) }); }
  catch (error) { process.send({ id, error: error.message }); }
});
process.on("disconnect", () => { host.dispose(); process.exit(0); });
