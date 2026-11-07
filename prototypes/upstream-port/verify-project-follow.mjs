import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createTestCodexHome } from "./test-codex-home.mjs";

const A1 = "01a1b180-89f8-7291-beb2-43f569f3709c";
const A2 = "01a1b180-89f8-7291-beb2-43f569f3709d";
const B = "01a1b1ab-1111-7111-8111-111111111111";
const P = "01a1b107-afb9-7882-8180-32322734bdc5";
const T = "01a1b1d5-5e8b-7c2d-9f3a-111111111111";

const base = await mkdtemp(path.join(tmpdir(), "mattskills-follow-"));
const rootA = path.join(base, "project-a");
const rootB = path.join(base, "project-b");
const taskDir = path.join(base, "task", "new-chat");
await mkdir(rootA, { recursive: true });
await mkdir(rootB, { recursive: true });
await mkdir(taskDir, { recursive: true });

const home = await createTestCodexHome({
  prefix: "mattskills-follow-home-",
  threads: [
    { id: A1, cwd: rootA },
    { id: A2, cwd: rootA },
    { id: B, cwd: rootB },
    { id: P, cwd: taskDir },
  ],
  projectRoots: [rootA, rootB],
  rollouts: [
    { id: A1, cwd: rootA },
    { id: A2, cwd: rootA },
    { id: B, cwd: rootB },
    { id: P, cwd: rootA },
  ],
});

function startServer(codexHome) {
  const child = spawn(process.execPath, [fileURLToPath(new URL("sidebar-server.mjs", import.meta.url))], {
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
    const item = pending.get(response.id);
    if (!item) return;
    pending.delete(response.id);
    clearTimeout(item.timer);
    if (response.error) item.reject(new Error(response.error.message));
    else item.resolve(response.result);
  });
  function rpc(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error("MCP timeout: " + method + " " + diagnostics)); }, 30000);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }
  return {
    rpc,
    async close() {
      for (const { timer } of pending.values()) clearTimeout(timer);
      child.stdin.end();
      child.kill();
      await new Promise(resolve => child.once("exit", resolve));
    },
  };
}

async function projectOf(server, threadId) {
  const result = await server.rpc("tools/call", {
    name: "deck_current_project",
    arguments: {},
    _meta: { thread_id: threadId, threadId },
  });
  if (result.isError) return { error: result.content?.[0]?.text ?? "isError" };
  return result.structuredContent;
}

const servers = [startServer(home.home), startServer(home.home)];
try {
  for (const server of servers) {
    await server.rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "project-follow-check", version: "1" } });
  }
  for (const threadId of [A1, A2]) {
    const project = await projectOf(servers[0], threadId);
    assert.equal(project.projectRoot, rootA);
    assert.equal(project.associated, true);
    assert.equal(project.source, "state_5");
  }
  const projectB = await projectOf(servers[0], B);
  assert.equal(projectB.projectRoot, rootB);
  assert.equal(projectB.associated, true);

  const projectP = await projectOf(servers[0], P);
  assert.equal(projectP.cwd, taskDir);
  assert.equal(projectP.projectRoot, null);
  assert.equal(projectP.associated, false);
  assert.equal(projectP.source, "state_5");

  const projectT = await projectOf(servers[0], T);
  assert.match(projectT.error, /无法从当前聊天的会话记录确定唯一项目目录/);

  const projectlessRead = await servers[0].rpc("tools/call", {
    name: "deck_upstream_read",
    arguments: { method: "snapshot", payload: { expectedThreadId: P } },
    _meta: { thread_id: P, threadId: P },
  });
  assert.equal(projectlessRead.isError, true);
  assert.match(projectlessRead.content?.[0]?.text ?? "", /不属于 Codex 项目/);

  const staleRead = await servers[0].rpc("tools/call", {
    name: "deck_upstream_read",
    arguments: { method: "snapshot", payload: { expectedThreadId: B } },
    _meta: { thread_id: A1, threadId: A1 },
  });
  assert.equal(staleRead.isError, true);
  assert.match(staleRead.content?.[0]?.text ?? "", /聊天已切换/);

  // Two independent panel/server instances in the same project must resolve to
  // the same project key, so the per-project data root is shared by construction.
  const secondA1 = await projectOf(servers[1], A1);
  assert.equal(secondA1.projectRoot, rootA);
  assert.equal(secondA1.projectId, (await projectOf(servers[0], A1)).projectId);

  console.log("PASS two chats in one project resolve to one project root");
  console.log("PASS another project resolves separately");
  console.log("PASS projectless task chat resolves to its state_5 cwd but is not associated");
  console.log("PASS unpersisted chat fails closed");
  console.log("PASS projectless deck reads are rejected before dispatch");
  console.log("PASS stale expectedThreadId is rejected before dispatch");
} finally {
  for (const server of servers) await server.close().catch(() => {});
  await rm(home.home, { recursive: true, force: true }).catch(() => {});
  await rm(base, { recursive: true, force: true }).catch(() => {});
}
