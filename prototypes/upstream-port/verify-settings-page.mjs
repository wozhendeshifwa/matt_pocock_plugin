import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { readFile, rm, stat, glob } from "node:fs/promises";
import path from "node:path";
import { JSDOM, VirtualConsole } from "jsdom";
import { repoRoot } from "./install.mjs";
import { createTestCodexHome } from "./test-codex-home.mjs";
import { classifyOpenCommand } from "./open-command.mjs";
import { resolveExecutable } from "./executables.mjs";

const threadId = "66666666-6666-4666-8666-666666666666";
const { home: codexHome } = await createTestCodexHome({
  prefix: "mattskills-settings-",
  threads: [{ id: threadId, cwd: repoRoot }],
  projectRoots: [repoRoot],
  rollouts: [{ id: threadId, cwd: repoRoot }],
});

// This script drives the real MCP server and the real panel document. It does
// not claim native pane placement or visuals: those stay with the desktop user.
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
      reject(new Error("MCP timeout: " + method + "\n" + diagnostics));
    }, 90000);
    requests.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}
const metadata = { thread_id: threadId, threadId };
const callTool = (name, method, payload = {}) => rpc("tools/call", {
  name,
  arguments: { method, payload: { ...payload, expectedThreadId: threadId } },
  _meta: metadata,
});
const unwrap = reply => reply.structuredContent?.value ?? reply.structuredContent;

let dom;
const messages = [];
try {
  const initialized = await rpc("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "mattskills-settings-verify", version: "1" },
  });
  assert.equal(initialized.serverInfo?.name, "deck-sidebar-probe");

  const before = unwrap(await callTool("deck_upstream_read", "logGetSwitch", {}));
  assert.equal(before?.ok, true, "logGetSwitch must answer");
  const wantEnabled = before.enabled !== true;

  const resource = await rpc("resources/read", { uri: "ui://deck-sidebar/board.html" });
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", error => errors.push(error.message));
  virtualConsole.on("error", (...args) => errors.push(args.join(" ")));
  dom = new JSDOM(resource.contents[0].text, {
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
        hostCapabilities: {},
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
    assert.fail("Timed out waiting for " + label + ": " + window.document.body.textContent.slice(0, 1200));
  }
  const tab = id => window.document.querySelector('[data-mattskills-tab="' + id + '"]');
  const panel = id => window.document.querySelector('[data-mattskills-panel="' + id + '"]');

  await until(() => tab("board"), "board tab");
  assert.ok(tab("settings"), "Settings tab must render (#18)");
  assert.equal(tab("settings").textContent.trim(), "设置", "Settings tab label follows the host locale");
  tab("settings").click();
  await until(() => panel("settings") && !panel("settings").hidden && panel("settings").textContent.includes("调试"), "settings page content");

  const note = window.document.querySelector('[data-mattskills-settings-note="update"]');
  assert.ok(note, "Settings tab states that updates are not bundled");
  assert.match(note.textContent, /dsh-plugin-update/, "note names the missing package");
  assert.match(note.textContent, /install\.mjs --apply/, "note tells the user how the port updates");

  const settings = panel("settings");
  const checkbox = settings.querySelector('input[type="checkbox"]');
  assert.ok(checkbox, "Debug log switch must render");
  assert.equal(checkbox.checked, before.enabled === true, "switch reflects the host value");
  checkbox.click();
  await until(() => !checkbox.disabled, "switch write settles");
  const after = unwrap(await callTool("deck_upstream_read", "logGetSwitch", {}));
  assert.equal(after.enabled, wantEnabled, "switch write reaches the host");

  // The switch file lives under this project's own data directory, so two
  // Codex projects do not share it.
  const switchFiles = [];
  for await (const file of glob(".scratch/upstream-sidebar/**/projects/**/.dsh-mattskillsdeck-cache/log-switch.json", { cwd: repoRoot })) {
    switchFiles.push(path.join(repoRoot, file));
  }
  const stamped = [];
  for (const file of switchFiles) stamped.push({ file, at: (await stat(file)).mtimeMs });
  stamped.sort((a, b) => b.at - a.at);
  assert.ok(stamped.length, "log-switch.json must exist under the project data directory");
  const saved = JSON.parse(await readFile(stamped[0].file, "utf8"));
  assert.equal(saved.enabled, wantEnabled, "settings persist per project");

  // Export is a read: it must return the day's log, not a refusal.
  const exported = unwrap(await callTool("deck_upstream_read", "logExport", {}));
  assert.equal(exported?.ok, true, "logExport must answer as a read endpoint");
  assert.ok(exported.bytes > 0, "logExport returns the day's log text");

  // The vendored port has no dsh-plugin-update package. updateStatus must fail
  // as a value (no hang, no crash) and the note above says why.
  const updateStatus = unwrap(await callTool("deck_upstream_read", "updateStatus", {}));
  assert.equal(updateStatus?.ok, false, "updateStatus reports unavailable instead of pretending");
  assert.match(JSON.stringify(updateStatus), /dsh-plugin-update/, "updateStatus names the missing package");

  const dataDir = path.dirname(path.dirname(stamped[0].file));

  // Every settings write lands in the project's write-audit.jsonl.
  const auditLines = (await readFile(path.join(dataDir, "write-audit.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
  assert.ok(auditLines.some(line => line.method === "logSetSwitch"),
    "logSetSwitch must be audited");

  // The endpoint reaches the spawn gate: a path outside the owned roots is
  // refused there (a positive path would open a real Explorer window).
  const refusedOpen = unwrap(await callTool("deck_upstream_write", "openFolder", { cwd: "C:\\Windows" }));
  assert.equal(refusedOpen?.ok, false, "openFolder outside the project is refused");
  assert.match(JSON.stringify(refusedOpen), /allowlisted/, "refusal comes from the spawn gate, not from a missing opener");
  assert.ok(await resolveExecutable("cmd.exe"), "the Windows opener resolves");

  // Opening a folder is allowed only for a root this port owns, and only for
  // the exact cmd /c start shape the vendored platform layer builds.
  const roots = [repoRoot, path.join(repoRoot, ".scratch", "upstream-sidebar")];
  assert.equal(classifyOpenCommand(["C:\\Windows\\System32\\cmd.exe", "/c", "start", "", "/max", dataDir], roots)?.kind, "folder");
  assert.equal(classifyOpenCommand(["C:\\Windows\\System32\\cmd.exe", "/c", "start", "", "/max", "C:\\Windows"], roots), null, "outside root refused");
  assert.equal(classifyOpenCommand(["C:\\Windows\\System32\\cmd.exe", "/c", "start", "", "/max", dataDir + " & calc"], roots), null, "shell metacharacters refused");
  assert.equal(classifyOpenCommand(["powershell.exe", "-c", "calc"], roots), null, "non-cmd program refused");
  assert.equal(classifyOpenCommand(["C:\\Windows\\System32\\cmd.exe", "/c", "del", "/max", dataDir], roots), null, "non-start verb refused");
  assert.equal(classifyOpenCommand(["C:\\Windows\\System32\\cmd.exe", "/c", "start", "", "/max", repoRoot], roots)?.kind, "folder", "project root is openable");

  // Leave the debug switch exactly as this project had it before the check.
  await callTool("deck_upstream_write", "logSetSwitch", { enabled: before.enabled === true, sampleRate: before.sampleRate });

  // The panel must not have thrown while rendering the page, and the settings
  // page must not inject a prompt.
  assert.deepEqual(errors, []);
  assert.equal(messages.length, 0, "settings page must not inject prompts");
  console.log("PASS settings tab renders the original SettingsPage in-panel");
  console.log("PASS debug log switch writes through the host and persists per project");
  console.log("PASS logExport answers as a read; update is explicitly unavailable with a named reason");
  console.log("PASS openFolder is limited to the vendored cmd /c start shape inside owned roots");
  console.log("NOTE native pane placement and visual acceptance still require the desktop user");
} finally {
  if (dom) dom.window.close();
  for (const { timer } of requests.values()) clearTimeout(timer);
  child.stdin.end();
  child.kill();
  await rm(codexHome, { recursive: true, force: true }).catch(() => {});
}
