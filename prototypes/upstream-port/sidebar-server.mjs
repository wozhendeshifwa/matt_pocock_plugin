import { createInterface } from "node:readline";
import { readFile, writeFile, rename, mkdir, realpath, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createProjectHosts } from "./project-hosts.mjs";
import { summarizeHostContext } from "./host-context.mjs";
import { resolveSessionProject } from "./session-project.mjs";

// The service owns no project. Each sidebar instance resolves its project per
// request from the host-provided thread identity, so the data root is keyed by
// this adapter checkout rather than by a startup workspace path.
const adapterRoot = await realpath(fileURLToPath(new URL("../../", import.meta.url)));
const key = createHash("sha256").update(adapterRoot.toLowerCase()).digest("hex").slice(0, 16);
const dataRoot = fileURLToPath(new URL("../../.scratch/upstream-sidebar/" + key + "/", import.meta.url));
await mkdir(dataRoot, { recursive: true });
process.chdir(dataRoot);
const hostContextPath = dataRoot + "host-context-captures.json";
let hostContextWrite = Promise.resolve();
const uri = "ui://deck-sidebar/board.html";
const uris = new Set([uri, "ui://deck-sidebar/board-v3.html", "ui://deck-sidebar/board-v4.html"]);
const mimeType = "text/html;profile=mcp-app";
const [themeCss, ...scripts] = await Promise.all(["theme.css", "dist/client.js", "sidebar-bridge.js"].map(name => readFile(new URL(name, import.meta.url), "utf8")));
const html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>MattSkillsDeck</title><style>' +
  themeCss.replace(/<\/style/gi, '<\\/style') + '</style></head><body><main id="root"></main>' +
  scripts.map(script => '<script>' + script.replace(/<\/script/gi, '<\\/script') + '</script>').join('') + '</body></html>';
async function persistHostContextCapture(capture) {
  const serialized = JSON.stringify(capture);
  if (serialized.length > 100000) throw new Error("Host context capture is too large");
  hostContextWrite = hostContextWrite.then(async () => {
    let current = { captures: [] };
    try { current = JSON.parse(await readFile(hostContextPath, "utf8")); } catch {}
    if (!current || !Array.isArray(current.captures)) current = { captures: [] };
    const signature = JSON.stringify({ source: capture.source, keys: capture.keys, candidates: capture.candidates });
    current.captures = current.captures
      .filter(item => JSON.stringify({ source: item.source, keys: item.keys, candidates: item.candidates }) !== signature)
      .concat(capture)
      .slice(-40);
    const temporary = `${hostContextPath}.tmp-${process.pid}`;
    try {
      await writeFile(temporary, JSON.stringify(current, null, 2), "utf8");
      await rename(temporary, hostContextPath);
      return true;
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }).catch(error => {
    // Diagnostics are optional. A failed write must not poison this queue or
    // reject the resource/data request that triggered the capture.
    process.stderr.write(`Host-context capture skipped (${error.code ?? "write-failed"}).\n`);
    return false;
  });
  return hostContextWrite;
}
const projectHosts = createProjectHosts(dataRoot + "projects");
async function handle(request) {
  if (request.method === "resources/read" ||
      request.method === "tools/call") {
    await persistHostContextCapture(summarizeHostContext(`mcp/${request.method}/${request.params?.name ?? "resource"}`, {
      metadata: request.params?._meta ?? null,
    }));
  }
  switch (request.method) {
    case "initialize": return { protocolVersion: request.params.protocolVersion, capabilities: { tools: {}, resources: {} }, serverInfo: { name: "deck-sidebar-probe", version: "1.8.0-rc.7-codex.1" } };
    case "ping": return {};
    case "tools/list": return { tools: [
      { name: "deck_current_project", description: "Resolve this UI request's host-provided thread identity to its local project.", inputSchema: { type: "object", additionalProperties: false }, annotations: { readOnlyHint: true }, _meta: { ui: { visibility: ["app"] } } },
      { name: "open_deck_sidebar_probe", title: "MattSkillsDeck", description: "Open the original MattSkills sidebar. Each panel follows the active chat's project when the host supplies a trustworthy thread identity.", inputSchema: { type: "object", additionalProperties: false }, annotations: { readOnlyHint: true }, _meta: { ui: { resourceUri: uri }, "openai/ui": { entrypoints: [{ type: "thread" }] } } },
      { name: "deck_upstream_read", description: "Read original MattSkills plugin data through the Codex adapter.", inputSchema: { type: "object", required: ["method"], additionalProperties: false, properties: { method: { type: "string" }, payload: { type: "object" } } }, annotations: { readOnlyHint: true }, _meta: { ui: { visibility: ["app"] } } },
      { name: "deck_host_context_probe", description: "Record sanitized Codex MCP host-context fields for project-follow diagnostics.", inputSchema: { type: "object", required: ["capture"], additionalProperties: false, properties: { capture: { type: "object" } } }, annotations: { readOnlyHint: false }, _meta: { ui: { visibility: ["app"] } } },
    ] };
    case "resources/list": return { resources: [{ uri, name: "MattSkillsDeck", mimeType }] };
    case "resources/templates/list": return { resourceTemplates: [] };
    case "resources/read":
      if (!uris.has(request.params.uri)) throw new Error("Sidebar resource not found");
      return { contents: [{ uri: request.params.uri, mimeType, text: html }] };
    case "tools/call": {
      if (request.params.name === "deck_current_project") {
        try {
          const project = await resolveSessionProject(request.params._meta);
          return { content: [{ type: "text", text: JSON.stringify(project) }], structuredContent: project };
        } catch (error) {
          return { isError: true, content: [{ type: "text", text: error.message }] };
        }
      }
      if (request.params.name === "open_deck_sidebar_probe") return { content: [{ type: "text", text: "Original MattSkills sidebar" }] };
      if (request.params.name === "deck_host_context_probe") {
        const capture = request.params.arguments?.capture;
        if (!capture || typeof capture !== "object" || Array.isArray(capture)) throw new Error("Invalid host context capture");
        const stored = await persistHostContextCapture(capture);
        return { content: [{ type: "text", text: stored ? "Host context captured" : "Host context capture unavailable" }], structuredContent: { stored } };
      }
      if (request.params.name !== "deck_upstream_read") throw new Error("Unknown tool");
      try {
        const project = await resolveSessionProject(request.params._meta);
        const { method, payload } = request.params.arguments ?? {};
        if (payload?.expectedThreadId !== project.threadId) throw new Error("聊天已切换，请等待项目重新加载。");
        const result = await projectHosts.call(project.cwd, method, payload);
        return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: error.message }] };
      }
    }
    default: throw new Error("Unsupported request");
  }
}
const pending = new Set();
for await (const line of createInterface({ input: process.stdin })) {
  let request;
  try { request = JSON.parse(line); } catch { continue; }
  if (request.id === undefined) continue;
  const work = (async () => {
    let response;
    try { response = { result: await handle(request) }; }
    catch (error) { response = { error: { code: -32603, message: error.message } }; }
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, ...response }) + "\n");
  })();
  pending.add(work);
  work.finally(() => pending.delete(work));
}
await Promise.allSettled(pending);
await projectHosts.dispose();
process.exit(0);
