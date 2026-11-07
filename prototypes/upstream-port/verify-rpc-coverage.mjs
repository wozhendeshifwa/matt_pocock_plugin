import assert from "node:assert/strict";
import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { repoRoot, serverScript } from "./install.mjs";
import { createTestCodexHome } from "./test-codex-home.mjs";

const threadId = "44444444-4444-4444-8444-444444444444";
const { home: codexHome } = await createTestCodexHome({
  prefix: "mattskills-rpc-",
  threads: [{ id: threadId, cwd: repoRoot }],
  projectRoots: [repoRoot],
  rollouts: [{ id: threadId, cwd: repoRoot }],
});

const child = spawn(process.execPath, [serverScript], {
  cwd: fileURLToPath(new URL(".", import.meta.url)),
  env: { ...process.env, CODEX_HOME: codexHome },
  windowsHide: true,
  stdio: ["pipe", "pipe", "pipe"],
});
let diagnostics = "";
child.stderr.on("data", chunk => { diagnostics += chunk; });
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
function rpc(method, params = {}, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`MCP timeout: ${method}`)); }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}
const metadata = { thread_id: threadId, threadId };
async function read(method, payload = {}, timeoutMs = 60000) {
  return rpc("tools/call", {
    name: "deck_upstream_read",
    arguments: { method, payload: { ...payload, expectedThreadId: threadId } },
    _meta: metadata,
  }, timeoutMs);
}
async function write(method, payload = {}, timeoutMs = 60000) {
  return rpc("tools/call", {
    name: "deck_upstream_write",
    arguments: { method, payload: { ...payload, expectedThreadId: threadId } },
    _meta: metadata,
  }, timeoutMs);
}
function adapterError(result) {
  if (!result?.isError) return null;
  const text = result.content?.[0]?.text ?? "";
  return /not been adapted|still not enabled|write and is not enabled|Unknown upstream endpoint/.test(text) ? text : null;
}

try {
  const initialized = await rpc("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "mattskills-rpc-coverage", version: "1" },
  });
  assert.equal(initialized.serverInfo?.name, "deck-sidebar-probe");
  const manifestResult = await rpc("tools/call", {
    name: "deck_rpc_manifest",
    arguments: {},
    _meta: metadata,
  });
  const manifest = manifestResult.structuredContent ?? JSON.parse(manifestResult.content?.[0]?.text ?? "{}");
  assert.equal(manifest.read.length, 31, "read endpoint count");
  assert.equal(manifest.write.length, 25, "write endpoint count");
  assert.equal(manifest.upstream.length, 56, "upstream endpoint count");
  for (const name of ["skill.readDoc", "gitStatus", "gitDiff", "gitLog", "setupLayout", "detect", "logExport"]) {
    assert.ok(manifest.read.includes(name), "read manifest missing " + name);
  }
  for (const name of ["bind", "commentIssue", "gitStage", "updateInstall"]) {
    assert.ok(manifest.write.includes(name), `write manifest missing ${name}`);
  }

  const reads = [
    ["cwd", {}],
    ["snapshot", {}],
    ["registry", {}],
    ["gitStatus", {}],
    ["skill.readDoc", { name: "wayfinder" }],
    ["issueDetail", { number: 14 }],
    ["issueComments", { number: 14 }],
    ["mapTickets", { number: 3 }],
    ["setupLayout", {}],
    ["updateStatus", {}],
    ["logExport", {}],
  ];
  for (const [method, payload] of reads) {
    const result = await read(method, payload);
    const failure = adapterError(result);
    assert.equal(failure, null, `${method} was rejected by the adapter: ${failure}`);
    console.log(`PASS read endpoint reached: ${method}`);
  }

  // Reaching the endpoint is not the same as reading real data. The version
  // control reads used to pass the check above while every git command died at
  // the host's subprocess gate, so the panel showed its error page.
  const statusRead = await read("gitStatus", {});
  const status = statusRead.structuredContent?.value;
  assert.equal(status?.ok, true, "gitStatus must return a first screen: " + JSON.stringify(status?.error));
  assert.ok(Array.isArray(status.screen?.commits), "gitStatus screen carries the commit list");
  const logRead = await read("gitLog", { count: 2 });
  const log = logRead.structuredContent?.value;
  assert.equal(log?.ok, true, "gitLog must return commits: " + JSON.stringify(log?.error));
  assert.ok(log.commits.length > 0, "gitLog returns real commits");
  const diffRead = await read("gitDiff", { path: "AGENTS.md" });
  const diff = diffRead.structuredContent?.value;
  assert.equal(diff?.ok, true, "gitDiff must return a patch envelope: " + JSON.stringify(diff?.error));
  console.log("PASS version-control reads return real git data through MCP");

  // Ticket #12 split the upstream channel in two: a write must never ride the
  // read tool, and the write tool only runs the endpoints this ticket opened.
  for (const [method, payload] of [
    ["bind", { backendId: "github" }],
    ["commentIssue", { number: 14, body: "coverage test" }],
    ["gitStage", { paths: ["README.md"] }],
    ["setupLayout", { layout: "multi" }],
  ]) {
    const result = await read(method, payload);
    assert.ok(result.isError, `${method} must be refused on the read tool`);
    assert.match(result.content?.[0]?.text ?? "", /must be routed through deck_upstream_write/, `${method} routing message`);
    console.log(`PASS read tool refuses write endpoint: ${method}`);
  }
  for (const [method, payload] of [
    ["setupLayout", { layout: "multi" }],
    ["updateInstall", {}],
  ]) {
    const result = await write(method, payload);
    assert.ok(result.isError, `${method} must stay closed until its own ticket`);
    assert.match(result.content?.[0]?.text ?? "", /still not enabled/, `${method} closed message`);
    console.log(`PASS write endpoint still closed: ${method}`);
  }
  // The endpoints this ticket opened must reach the backend. These payloads are
  // rejected before any remote write, so exercising them here is side-effect free.
  for (const [method, payload, pattern] of [
    ["gitStage", { paths: [] }, /paths|path|路径/],
    ["gitPush", {}, /ticket|票据/],
    ["initPublish", { name: "" }, /bad-name|仓库名/],
    ["commentIssue", { number: 14, body: "" }, /评论内容为空|body/],
    ["setLabelColors", { changes: "not-a-list" }, /改动清单|changes/],
    ["bind", { backendId: "no-such-backend" }, /not registered|unknown-backend/],
  ]) {
    const result = await write(method, payload);
    assert.ok(!result.isError, `${method} must reach its backend: ${result.content?.[0]?.text}`);
    const value = result.structuredContent?.value ?? result.structuredContent;
    assert.equal(value?.ok, false, `${method} invalid payload must report a failure`);
    assert.match(JSON.stringify(value), pattern, `${method} failure reason`);
    console.log(`PASS write endpoint reached and refused an invalid payload: ${method}`);
  }

  const unknown = await read("not-an-endpoint", {});
  assert.ok(unknown.isError);
  assert.match(unknown.content?.[0]?.text ?? "", /Unknown upstream endpoint/);
  console.log("PASS unknown endpoint rejected explicitly");
  console.log("PASS deck_rpc_manifest covers read/write/upstream and the MCP routing boundary");
} finally {
  for (const { timer } of pending.values()) clearTimeout(timer);
  child.stdin.end();
  child.kill();
  await rm(codexHome, { recursive: true, force: true }).catch(() => {});
}
