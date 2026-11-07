import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { JSDOM, VirtualConsole } from "jsdom";

// Ticket #20 end-to-end check: open the real panel against this repository with
// one throwaway untracked file, click the version-control tab, and wait for that
// file and the latest commit to appear. This exercises the same path the desktop
// uses: panel -> MCP -> project host -> git. The repository is used because the
// panel only renders its tabs for a workspace that already has a tracker binding;
// the one file this test creates is removed again in the finally block.

const GIT = process.platform === "win32" ? "git.exe" : "git";
const projectRoot = await realpath(fileURLToPath(new URL("../../", import.meta.url)));
const codexHome = await mkdtemp(path.join(tmpdir(), "mattskills-vc-view-codex-"));
const fixtureDirs = [codexHome];
const threadId = "22222222-2222-4222-8222-222222222222";
const probeName = "vc-view-check-" + process.pid + ".txt";
const probePath = path.join(projectRoot, probeName);
const commitCount = Number(execFileSync(GIT, ["rev-list", "--count", "HEAD"], { cwd: projectRoot, encoding: "utf8" }).trim());
await writeFile(probePath, "version control view probe\n", "utf8");

const sessionDir = path.join(codexHome, "sessions", "2026", "11", "07");
await mkdir(sessionDir, { recursive: true });
await writeFile(path.join(sessionDir, "rollout-test-" + threadId + ".jsonl"), JSON.stringify({
  type: "session_meta",
  payload: { id: threadId, cwd: projectRoot },
}) + "\n");

const child = spawn(process.execPath, [fileURLToPath(new URL("sidebar-server.mjs", import.meta.url))], {
  env: { ...process.env, CODEX_HOME: codexHome }, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
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
    const timer = setTimeout(() => { requests.delete(id); reject(new Error("MCP timeout: " + method + " " + diagnostics)); }, 90000);
    requests.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}
let dom;
try {
  await rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "version-control-view-check", version: "1" } });
  const resource = await rpc("resources/read", { uri: "ui://deck-sidebar/board.html" });
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", error => errors.push(error.message));
  dom = new JSDOM(resource.contents[0].text, { url: "https://mattskills-adapter.invalid/", runScripts: "outside-only", pretendToBeVisual: true, virtualConsole });
  const { window } = dom;
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.postMessage = async message => {
    if (message.id === undefined) return;
    let result;
    if (message.method === "ui/initialize") result = {
      protocolVersion: "2026-01-26",
      hostCapabilities: {},
      hostContext: { theme: "light", threadId, cwd: projectRoot },
    };
    else {
      assert.equal(message.method, "tools/call");
      message.params._meta = { thread_id: threadId, threadId };
      result = await rpc(message.method, message.params);
    }
    window.dispatchEvent(new window.MessageEvent("message", { source: window, data: { jsonrpc: "2.0", id: message.id, result } }));
  };
  for (const script of window.document.scripts) window.eval(script.textContent);
  async function until(check, what) {
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      if (check()) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.fail("UI timeout (" + what + "): " + window.document.getElementById("root").textContent.slice(0, 1600));
  }
  const tab = () => [...window.document.querySelectorAll("button")].find(button => button.textContent.trim() === "版本管理");
  await until(() => tab(), "version-control tab");
  tab().click();
  const rootText = () => window.document.getElementById("root").textContent;
  await until(() => rootText().includes(probeName), "changed file in version-control view");
  const text = rootText();
  // The commit rows are a windowed list; jsdom cannot measure a viewport, so the
  // readable evidence is the history count the view takes from the same screen.
  assert.ok(text.includes("提交历史 " + commitCount), "version-control view shows the real commit count");
  assert.ok(!text.includes("Command is outside read-only port verification"), "read gate failure must not surface");
  assert.ok(!text.includes("起不了 git 进程"), "host must not report a spawn failure");
  assert.deepEqual(errors, []);
  console.log("PASS panel -> MCP -> git: version-control tab shows the changed file list and the real commit count");
  console.log("Visual layout in the native Codex sidebar is still the user's acceptance step (#15).");
} finally {
  dom?.window.close();
  for (const { timer } of requests.values()) clearTimeout(timer);
  child.stdin.end();
  child.kill();
  await rm(probePath, { force: true }).catch(() => {});
  for (const dir of fixtureDirs) await rm(dir, { recursive: true, force: true }).catch(() => {});
}