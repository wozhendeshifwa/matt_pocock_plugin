import assert from "node:assert/strict";
import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";
import { repoRoot, serverScript } from "./install.mjs";
import { createTestCodexHome } from "./test-codex-home.mjs";

const threadId = "66666666-6666-4666-8666-666666666666";
const { home: codexHome } = await createTestCodexHome({
  prefix: "mattskills-locale-",
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
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`MCP timeout: ${method}\n${stderr}`)); }, 60000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}
let dom;
try {
  await rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "locale-check", version: "1" } });
  const resource = await rpc("resources/read", { uri: "ui://deck-sidebar/board.html" });
  const html = resource.contents[0].text;
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", error => errors.push(error.message));
  dom = new JSDOM(html, {
    url: "https://mattskills-adapter.invalid/",
    runScripts: "outside-only",
    pretendToBeVisual: true,
    virtualConsole,
  });
  const { window } = dom;
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.postMessage = async message => {
    if (message.id === undefined) return;
    let result;
    if (message.method === "ui/initialize") {
      result = {
        protocolVersion: "2026-01-26",
        hostCapabilities: { experimental: { "openai/message": {} } },
        hostContext: { theme: "light", locale: "en-US" },
      };
    } else {
      assert.equal(message.method, "tools/call");
      message.params._meta = { thread_id: threadId, threadId };
      result = await rpc(message.method, message.params);
    }
    window.dispatchEvent(new window.MessageEvent("message", {
      source: window,
      data: { jsonrpc: "2.0", id: message.id, result },
    }));
  };
  for (const script of window.document.scripts) window.eval(script.textContent);
  async function until(check, label) {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      if (check()) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.fail(`Timed out waiting for ${label}: ${window.document.body.textContent.slice(0, 1200)}`);
  }
  await until(() => window.document.querySelector('[role="button"][aria-label^="#"]'), "the issue list");
  await until(() => window.MattSkillsCodex.hostLocale === "en", "English locale");
  assert.equal(window.document.documentElement.lang, "en");
  const englishText = window.document.body.textContent;
  for (const label of ["List", "Skills", "Checks"]) {
    assert.ok(englishText.includes(label), `English label missing: ${label}`);
  }
  console.log("PASS host locale en-US -> locale service active=en and English tab labels");

  window.dispatchEvent(new window.MessageEvent("message", {
    source: window,
    data: {
      jsonrpc: "2.0",
      method: "ui/notifications/host-context-changed",
      params: { theme: "dark", locale: "zh-CN" },
    },
  }));
  await until(() => window.MattSkillsCodex.hostLocale === "zh", "Chinese locale update");
  assert.equal(window.document.documentElement.lang, "zh-CN");
  console.log("PASS host-context-changed zh-CN updates locale snapshot and document lang");
  assert.deepEqual(errors, []);
} finally {
  if (dom) dom.window.close();
  for (const { timer } of pending.values()) clearTimeout(timer);
  child.stdin.end();
  child.kill();
  await new Promise(resolve => setTimeout(resolve, 500));
  await rm(codexHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
}
