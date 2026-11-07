import assert from "node:assert/strict";
import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { repoRoot, serverScript } from "./install.mjs";

const expected = [
  "deck_context", "deck_issue_get", "deck_map_snapshot", "deck_issue_list",
  "deck_issue_create", "deck_map_plan_create", "deck_map_link", "deck_issue_patch", "deck_issue_report",
];
const threadId = "55555555-5555-4555-8555-555555555555";
const codexHome = await mkdtemp(path.join(tmpdir(), "mattskills-tools-"));
const sessionDir = path.join(codexHome, "sessions", "2026", "11", "07");
await mkdir(sessionDir, { recursive: true });
await writeFile(path.join(sessionDir, "rollout-test-" + threadId + ".jsonl"), JSON.stringify({
  type: "session_meta",
  payload: { id: threadId, cwd: repoRoot },
}) + "\n");

const child = spawn(process.execPath, [serverScript], {
  cwd: fileURLToPath(new URL(".", import.meta.url)),
  env: { ...process.env, CODEX_HOME: codexHome },
  windowsHide: true,
  stdio: ["pipe", "pipe", "pipe"],
});
let stderr = "";
child.stderr.on("data", chunk => { stderr += chunk; });
const pending = new Map();
let sequence = 0;
createInterface({ input: child.stdout }).on("line", line => {
  let response;
  try { response = JSON.parse(line); } catch { return; }
  const entry = pending.get(response.id);
  if (!entry) return;
  pending.delete(response.id);
  clearTimeout(entry.timer);
  if (response.error) entry.reject(new Error(response.error.message));
  else entry.resolve(response.result);
});
function rpc(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`MCP timeout: ${method}\n${stderr}`)); }, 120000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}
const metadata = { thread_id: threadId, threadId };
async function tool(name, args) {
  return rpc("tools/call", { name, arguments: args, _meta: metadata });
}
try {
  await rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "deck-tools-check", version: "1" } });
  const listed = await rpc("tools/list", {});
  const names = new Set(listed.tools.map(tool => tool.name));
  for (const name of expected) {
    assert.ok(names.has(name), `Missing MCP tool ${name}`);
    const definition = listed.tools.find(tool => tool.name === name);
    assert.equal(definition.inputSchema?.type, "object", `${name} inputSchema must be an object`);
  }
  const issueGet = listed.tools.find(tool => tool.name === "deck_issue_get");
  assert.ok(issueGet.inputSchema.properties?.key, "deck_issue_get must expose key");
  console.log(`PASS MCP tools/list exposes all ${expected.length} deck_* tools with JSON schemas`);

  for (const [name, args] of [
    ["deck_context", {}],
    ["deck_issue_list", { limit: 5 }],
    ["deck_issue_get", { key: "21", blocking: false }],
    ["deck_map_snapshot", { key: "3", detail: "thin" }],
  ]) {
    const result = await tool(name, args);
    assert.ok(!result.isError, `${name} returned isError: ${result.content?.[0]?.text}`);
    assert.equal(typeof result.structuredContent?.status, "string", `${name} must return a tool envelope`);
    assert.equal(typeof result.structuredContent?.text, "string", `${name} must return text`);
    console.log(`PASS ${name}: ${result.structuredContent.status} ${String(result.structuredContent.text).slice(0, 80)}`);
  }
} finally {
  for (const { timer } of pending.values()) clearTimeout(timer);
  child.stdin.end();
  child.kill();
  await new Promise(resolve => setTimeout(resolve, 500));
  await rm(codexHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
}
