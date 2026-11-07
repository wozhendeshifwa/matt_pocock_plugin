import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { rm } from "node:fs/promises";
import { JSDOM, VirtualConsole } from "jsdom";
import { createTestCodexHome } from "./test-codex-home.mjs";

// The service no longer starts with a project. Give it a throwaway Codex home
// whose state_5 row and project root map this simulated chat to the requested
// project, then supply the same host metadata a real Codex panel attaches.
const projectRoot = process.argv[2];
assert.ok(projectRoot, "project directory argument is required");
const threadId = "11111111-1111-4111-8111-111111111111";
const { home: codexHome } = await createTestCodexHome({
  prefix: "codex-sidebar-check-",
  threads: [{ id: threadId, cwd: projectRoot }],
  projectRoots: [projectRoot],
  rollouts: [{ id: threadId, cwd: projectRoot }],
});
const child = spawn(process.execPath, [fileURLToPath(new URL("sidebar-server.mjs", import.meta.url))], {
  env: { ...process.env, CODEX_HOME: codexHome }, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
});
const issueNumber = Number(process.argv[3] ?? 2);
const expectedRepository = process.argv[4] ?? null;
const expectedDetailText = process.argv[5] ?? null;
let diagnostics = "";
child.stderr.on("data", chunk => { diagnostics += chunk; });
const requests = new Map();
let sequence = 0;
createInterface({ input: child.stdout }).on("line", line => {
  const response = JSON.parse(line);
  const item = requests.get(response.id);
  if (!item) return;
  requests.delete(response.id);
  clearTimeout(item.timer);
  if (response.error) item.reject(new Error(response.error.message));
  else item.resolve(response.result);
});
function rpc(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { requests.delete(id); reject(new Error("MCP timeout: " + method + " " + diagnostics)); }, 60000);
    requests.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}
let dom;
try {
  await rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "isolated-port-check", version: "1" } });
  const hostMeta = { thread_id: threadId, threadId };
  const snapshotResult = await rpc("tools/call", {
    name: "deck_upstream_read",
    arguments: { method: "snapshot", payload: { expectedThreadId: threadId } },
    _meta: hostMeta,
  });
  if (snapshotResult.isError) throw new Error(snapshotResult.content?.[0]?.text ?? "Snapshot failed");
  const snapshot = JSON.parse(snapshotResult.content[0].text);
  if (expectedRepository) assert.equal(snapshot.value.repository?.name, expectedRepository);
  const expectedIssue = snapshot.value.issues.find(issue => issue.number === issueNumber);
  assert.ok(expectedIssue, `Issue #${issueNumber} missing from ${snapshot.value.repository?.name}`);
  const resources = await Promise.all(["board.html", "board-v3.html", "board-v4.html"].map(name => rpc("resources/read", { uri: "ui://deck-sidebar/" + name })));
  assert.ok(resources.every(result => result.contents[0].text === resources[0].contents[0].text));
  const errors = [];
  const hostContextCaptures = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", error => errors.push(error.message));
  dom = new JSDOM(resources[0].contents[0].text, { url: "https://mattskills-adapter.invalid/", runScripts: "outside-only", pretendToBeVisual: true, virtualConsole });
  const { window } = dom;
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.postMessage = async message => {
    if (message.id === undefined) return;
    let result;
    if (message.method === "ui/initialize") result = {
      protocolVersion: "2026-01-26",
      hostCapabilities: {},
      hostContext: {
        theme: "light",
        threadId,
        cwd: process.argv[2],
        project: { id: "project-test-1", root: process.argv[2] },
        styles: { variables: { "--background": "rgb(248, 250, 252)", "--foreground": "rgb(17, 24, 39)" } },
      },
    };
    else {
      assert.equal(message.method, "tools/call");
      if (message.params?.name === "deck_host_context_probe") hostContextCaptures.push(message.params.arguments?.capture);
      message.params._meta = { thread_id: threadId, threadId };
      result = await rpc(message.method, message.params);
    }
    window.dispatchEvent(new window.MessageEvent("message", { source: window, data: { jsonrpc: "2.0", id: message.id, result } }));
  };
  for (const script of window.document.scripts) window.eval(script.textContent);
  async function until(check) {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      if (check()) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.fail("UI timeout: " + window.document.body.textContent.slice(0, 1600));
  }
  const row = () => window.document.querySelector(`[role="button"][aria-label^="#${issueNumber} "]`);
  await until(row);
  const candidateEntry = (capture, suffix) => Object.entries(capture?.candidates ?? {}).find(([name]) => name.endsWith(suffix));
  await until(() => hostContextCaptures.some(capture => candidateEntry(capture, ".threadId")?.[1] === threadId));
  const initialCapture = hostContextCaptures.find(capture => candidateEntry(capture, ".threadId")?.[1] === threadId);
  assert.equal(candidateEntry(initialCapture, ".project.root")?.[1], process.argv[2]);
  assert.ok(initialCapture.keys.some(name => name.endsWith(".project.id")));
  assert.equal(window.document.documentElement.dataset.theme, "light");
  assert.equal(window.document.documentElement.style.getPropertyValue("--background"), "rgb(248, 250, 252)");
  window.dispatchEvent(new window.MessageEvent("message", {
    source: window,
    data: {
      jsonrpc: "2.0",
      method: "ui/notifications/host-context-changed",
      params: {
        theme: "dark",
        styles: { variables: { "--background": "rgb(16, 19, 26)", "--foreground": "rgb(230, 237, 243)" } },
      },
    },
  }));
  await until(() => window.document.documentElement.dataset.theme === "dark");
  assert.equal(window.document.documentElement.style.getPropertyValue("--background"), "rgb(16, 19, 26)");
  window.dispatchEvent(new window.CustomEvent("openai:set_globals", {
    detail: {
      globals: {
        theme: "light",
        visualizationStyleVariables: { "--background": "rgb(250, 250, 250)" },
      },
    },
  }));
  await until(() => window.document.documentElement.dataset.theme === "light");
  assert.equal(window.document.documentElement.style.getPropertyValue("--background"), "rgb(250, 250, 250)");
  window.dispatchEvent(new window.MessageEvent("message", {
    source: window,
    data: {
      jsonrpc: "2.0",
      method: "ui/notifications/host-context-changed",
      params: { theme: "dark" },
    },
  }));
  await until(() => window.document.documentElement.dataset.theme === "dark");
  assert.equal(window.document.documentElement.style.getPropertyValue("--background"), "");
  assert.match(resources[0].contents[0].text, /--dsw-alias-bg-base:/);
  assert.match(resources[0].contents[0].text, /color-scheme: light dark/);
  assert.ok(window.document.body.textContent.includes(expectedIssue.title));
  row().click();
  await until(() => window.document.body.textContent.includes("返回列表") && (!expectedDetailText || window.document.body.textContent.includes(expectedDetailText)));
  assert.deepEqual(errors, []);
  console.log("PASS MCP resources including legacy aliases and live host theme updates");
  console.log("PASS original sidebar -> MCP -> upstream backend -> real GitHub list/detail");
  console.log("Host handshake is simulated; native desktop rendering and project tracking are not asserted.");
} finally {
  dom?.window.close();
  for (const { timer } of requests.values()) clearTimeout(timer);
  child.stdin.end();
  child.kill();
  await rm(codexHome, { recursive: true, force: true });
}
