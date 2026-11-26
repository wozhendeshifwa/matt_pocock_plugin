import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { glob, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { JSDOM, VirtualConsole } from "jsdom";
import { repoRoot } from "./install.mjs";
import { createTestCodexHome } from "./test-codex-home.mjs";

// This harness replays the real desktop handshake's capability key set. It does
// not claim native pane placement or visual acceptance: those require separate
// observation of the actual desktop client.

const args = process.argv.slice(2);
const options = { capture: null, issue: 14, help: false };
for (let index = 0; index < args.length; index++) {
  if (args[index] === "--capture") options.capture = args[++index];
  else if (args[index] === "--issue") options.issue = Number(args[++index]);
  else if (args[index] === "--help" || args[index] === "-h") options.help = true;
  else throw new Error("Unknown argument: " + args[index]);
}
if (options.help) {
  console.log("Usage: node verify-host-harness.mjs [--capture <host-context-captures.json>] [--issue <number>]");
  process.exit(0);
}

async function findCapture() {
  if (options.capture) return path.resolve(options.capture);
  const matches = [];
  for await (const file of glob(".scratch/upstream-sidebar/**/host-context-captures.json", { cwd: repoRoot })) {
    const full = path.join(repoRoot, file);
    const parsed = JSON.parse(await readFile(full, "utf8"));
    const captures = Array.isArray(parsed.captures) ? parsed.captures : [];
    const candidates = captures.filter(capture =>
      capture.source === "ui/initialize" &&
      Array.isArray(capture.keys) &&
      capture.keys.some(key => key.endsWith("hostCapabilities.experimental.openai/message")));
    if (candidates.length) matches.push({ file: full, count: candidates.length, at: candidates.at(-1)?.capturedAt ?? "" });
  }
  matches.sort((a, b) => b.at.localeCompare(a.at));
  return matches[0]?.file ?? null;
}

function capabilitiesFrom(keys) {
  const prefix = "initialization.hostCapabilities.";
  const has = name => keys.some(key => key === prefix + name || key.startsWith(prefix + name + "."));
  const capabilities = {};
  if (has("experimental")) {
    capabilities.experimental = {};
    if (has("experimental.openai/modelContext")) capabilities.experimental["openai/modelContext"] = {};
    if (has("experimental.openai/message")) {
      capabilities.experimental["openai/message"] = has("experimental.openai/message.draft") ? { draft: {} } : {};
    }
    if (has("experimental.openai/files")) capabilities.experimental["openai/files"] = {};
    if (has("experimental.openai/find")) capabilities.experimental["openai/find"] = {};
    if (has("experimental.openai/skillsDeepLinks")) capabilities.experimental["openai/skillsDeepLinks"] = {};
  }
  if (has("message")) capabilities.message = { text: {}, image: {}, resourceLink: {}, resource: {} };
  if (has("updateModelContext")) {
    capabilities.updateModelContext = { text: {}, image: {}, resourceLink: {}, structuredContent: {} };
  }
  if (has("sandbox")) capabilities.sandbox = { permissions: {}, csp: {} };
  if (has("logging")) capabilities.logging = {};
  if (has("openLinks")) capabilities.openLinks = {};
  if (has("serverResources")) capabilities.serverResources = {};
  if (has("serverTools")) capabilities.serverTools = {};
  return capabilities;
}

const capturePath = await findCapture();
assert.ok(capturePath, "No real ui/initialize capture found under .scratch/upstream-sidebar");
const captureFile = JSON.parse(await readFile(capturePath, "utf8"));
const handshake = [...(captureFile.captures ?? [])]
  .filter(capture => capture.source === "ui/initialize" &&
    capture.keys?.some(key => key.endsWith("hostCapabilities.experimental.openai/message")))
  .sort((a, b) => String(a.capturedAt).localeCompare(String(b.capturedAt)))
  .at(-1);
assert.ok(handshake, "Capture does not contain a real openai/message ui/initialize record");
const capabilities = capabilitiesFrom(handshake.keys);
assert.ok(capabilities.experimental?.["openai/message"], "Replayed handshake must advertise openai/message");

const threadId = "33333333-3333-4333-8333-333333333333";
const { home: codexHome } = await createTestCodexHome({
  prefix: "mattskills-harness-",
  threads: [{ id: threadId, cwd: repoRoot }],
  projectRoots: [repoRoot],
  rollouts: [{ id: threadId, cwd: repoRoot }],
});

const child = spawn(process.execPath, [fileURLToPath(new URL("sidebar-server.mjs", import.meta.url))], {
  cwd: fileURLToPath(new URL(".", import.meta.url)),
  env: { ...process.env, CODEX_HOME: codexHome },
  windowsHide: true,
  stdio: ["pipe", "pipe", "pipe"],
});
let diagnostics = "";
child.stderr.on("data", chunk => { diagnostics += chunk; });
const requests = new Map();
let sequence = 0;
createInterface({ input: child.stdout }).on("line", line => {
  let response;
  try { response = JSON.parse(line); } catch { return; }
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
    const timer = setTimeout(() => {
      requests.delete(id);
      reject(new Error(`MCP timeout: ${method}\n${diagnostics}`));
    }, 60000);
    requests.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

let dom;
const messages = [];
try {
  const initialized = await rpc("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "mattskills-host-harness", version: "1" },
  });
  assert.equal(initialized.serverInfo?.name, "deck-sidebar-probe");
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
        hostCapabilities: capabilities,
        hostContext: {
          theme: "light",
          styles: { variables: { "--background": "rgb(248, 250, 252)", "--foreground": "rgb(17, 24, 39)" } },
        },
      };
    } else if (message.method === "ui/message") {
      messages.push(message.params);
      result = {};
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
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      if (check()) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.fail(`Timed out waiting for ${label}: ${window.document.body.textContent.slice(0, 1200)}`);
  }
  const issueRows = () => [...window.document.querySelectorAll('[role="button"][aria-label^="#"]')];
  const row = () => issueRows().find(element =>
    element.getAttribute("aria-label")?.startsWith(`#${options.issue} `)) ?? issueRows()[0];
  await until(row, `the real GitHub issue #${options.issue} row`);
  const listText = window.document.body.textContent;
  assert.ok(listText.length > 0, "Panel must render repository data");
  row().click();
  await until(() => window.document.body.textContent.includes("返回列表"), "issue detail");
  const toggle = window.document.querySelector('[data-bottom-action-toggle]');
  assert.ok(toggle, 'the actual built detail offers its action preview');
  toggle.click();
  await until(() => window.document.querySelector('[data-issue-action-draft]'), 'visible editable preview');
  for (const target of ['active', 'new']) {
    const button = window.document.querySelector(`[data-issue-action-export="${target}"]`);
    assert.ok(button, `Explicit ${target} output must be discoverable`);
    assert.equal(button.disabled, !nativeDraft, `${target} follows the advertised native draft capability`);
    assert.match(window.document.querySelector('[data-issue-action-preview]').textContent, /暂不可用.*宿主/);
    button.click();
  }
  assert.equal(messages.length, 0, 'opening a preview never automatically mutates a host draft');
  for (const id of ["board", "status", "run"]) {
    assert.ok(window.document.querySelector(`[data-mattskills-tab="${id}"]`), `Panel tab ${id} must render`);
  }
  for (const id of ["status", "run"]) {
    window.document.querySelector(`[data-mattskills-tab="${id}"]`).click();
    await until(() => {
      const panel = window.document.querySelector(`[data-mattskills-panel="${id}"]`);
      return panel && !panel.hidden && panel.textContent.trim().length > 0;
    }, `${id} tab content`);
  }
  for (const message of messages) {
    assert.equal(message._meta?.["openai/message"]?.send, false, "Prefill must not send");
  }
  assert.deepEqual(errors, []);
  console.log("PASS replayed real desktop capabilities include experimental.openai/message");
  console.log("PASS panel -> real MCP server -> real GitHub list/detail");
  console.log("PASS active/new availability matches native capability and opening the preview performs no implicit write");
  console.log("PASS panel-internal status/run tabs render with real session data");
  console.log("NOTE replay is not native draft success or visual acceptance; native composer readback and project inheritance require separate observation");
} finally {
  if (dom) dom.window.close();
  for (const { timer } of requests.values()) clearTimeout(timer);
  child.stdin.end();
  child.kill();
  await rm(codexHome, { recursive: true, force: true }).catch(() => {});
}
