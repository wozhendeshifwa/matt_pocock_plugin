import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTestCodexHome } from "./test-codex-home.mjs";

const repository = "wozhendeshifwa/codex_mattskills_plugin";
const project = await mkdtemp(path.join(tmpdir(), "manual-naming-mcp-"));
const threadId = "99999999-9999-4999-8999-999999999999";
execFileSync("git", ["init", "-q"], { cwd: project, windowsHide: true });
execFileSync("git", ["remote", "add", "origin", "https://github.com/" + repository + ".git"], { cwd: project, windowsHide: true });
await mkdir(path.join(project, "docs/agents"), { recursive: true });
await writeFile(path.join(project, "docs/agents/issue-tracker.md"), "# Issue tracker: GitHub\n");
const { home } = await createTestCodexHome({ threads: [{ id: threadId, cwd: project, title: "Manual naming integration" }], projectRoots: [project] });
const child = spawn(process.execPath, [fileURLToPath(new URL("sidebar-server.mjs", import.meta.url))], {
  env: { ...process.env, CODEX_HOME: home }, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
});
const pending = new Map();
let sequence = 0;
let issueKey;
let diagnostics = "";
child.stderr.on("data", chunk => { diagnostics += chunk; });
createInterface({ input: child.stdout }).on("line", line => {
  let reply; try { reply = JSON.parse(line); } catch { return; }
  const item = pending.get(reply.id);
  if (!item) return;
  clearTimeout(item.timer); pending.delete(reply.id);
  if (reply.error) item.reject(new Error(reply.error.message)); else item.resolve(reply.result);
});
function rpc(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("MCP timeout: " + method + " " + diagnostics)); }, 60000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}
async function tool(name, args) {
  const result = await rpc("tools/call", { name, arguments: args, _meta: { threadId, thread_id: threadId } });
  if (result.isError) throw new Error(result.content?.[0]?.text);
  const value = result.structuredContent ?? JSON.parse(result.content[0].text);
  return value?.value ?? value;
}
async function upstream(method, payload = {}) {
  return tool(method === "cancelNewSessionWatcher" ? "deck_upstream_write" : "deck_upstream_read", {
    method, payload: { ...payload, sessionId: "spoofed", expectedThreadId: threadId },
  });
}
try {
  await rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "manual-naming-check", version: "1" } });
  const plan = await upstream("namingPlan");
  assert.equal(plan.suggestions.length, 1, "MCP uses verified thread identity, not payload sessionId");
  assert.equal((await upstream("cancelNewSessionWatcher", { suggestionId: plan.suggestions[0].id })).cancelled, true);
  assert.deepEqual((await upstream("namingPlan")).suggestions, []);
  console.log("PASS MCP identity binding + manual plan/cancel/readback");
  if (process.argv.includes("--github")) {
    const title = "manual-naming-integration-" + Date.now();
    const created = await tool("deck_issue_create", { title, body: "Temporary integration fixture for manual naming; close after verification.", idempotencyKey: title });
    issueKey = created?.data?.ticket?.key;
    assert.ok(issueKey, "Real deck_issue_create returned a ticket: " + JSON.stringify(created));
    const after = await upstream("namingPlan");
    assert.equal(after.suggestions[0].issueKey, String(issueKey));
    assert.ok(after.suggestions[0].title.includes("[#" + issueKey + "]"));
    assert.ok(after.suggestions[0].title.includes("manual-naming-integration"));
    console.log("PASS real deck_issue_create maps returned issue to the verified existing chat");
  }
} finally {
  if (issueKey) {
    try {
      const closed = await tool("deck_issue_patch", { key: String(issueKey), close: true });
      assert.equal(closed.status, "ok");
      console.log("PASS closed temporary GitHub fixture " + issueKey);
    } catch (error) { process.stderr.write("Fixture cleanup required: " + issueKey + " " + error.message + "\n"); process.exitCode = 1; }
  }
  for (const item of pending.values()) clearTimeout(item.timer);
  child.stdin.end(); child.kill();
}
