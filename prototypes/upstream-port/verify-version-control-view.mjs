import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { readFile, realpath, rm, writeFile, lstat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { JSDOM, VirtualConsole } from "jsdom";
import { createTestCodexHome } from "./test-codex-home.mjs";

// Ticket #20 end-to-end check: open the real panel against this repository with
// one throwaway untracked file, click the version-control tab, and wait for that
// file and the latest commit to appear. This exercises the same path the desktop
// uses: panel -> MCP -> project host -> git. The repository is used because the
// panel only renders its tabs for a workspace that already has a tracker binding;
// the one file this test creates is removed again in the finally block.

const GIT = process.platform === "win32" ? "git.exe" : "git";
const projectRoot = await realpath(fileURLToPath(new URL("../../", import.meta.url)));
const threadId = "22222222-2222-4222-8222-222222222222";
const probeName = "vc-view-check-" + process.pid + ".txt";
const probePath = path.join(projectRoot, probeName);
const commitCount = Number(execFileSync(GIT, ["rev-list", "--count", "HEAD"], { cwd: projectRoot, encoding: "utf8" }).trim());
function git(args) {
  return execFileSync(GIT, args, { cwd: projectRoot, encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } });
}
async function fingerprint(file) {
  try {
    const info = await lstat(file);
    return [info.mode, createHash("sha256").update(await readFile(file)).digest("hex")];
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
async function repositoryState() {
  const names = [...new Set(git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"]).split("\0").filter(Boolean))].sort();
  return {
    head: git(["rev-parse", "HEAD"]),
    index: await fingerprint(path.resolve(projectRoot, git(["rev-parse", "--git-path", "index"]).trim())),
    status: git(["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
    files: await Promise.all(names.map(async name => [name, await fingerprint(path.join(projectRoot, name))])),
  };
}

async function verifyView(registered) {
  const { home: codexHome } = await createTestCodexHome({
    prefix: "mattskills-vc-view-codex-",
    threads: [{ id: threadId, cwd: projectRoot }],
    projectRoots: registered ? [projectRoot] : [],
    rollouts: [{ id: threadId, cwd: projectRoot }],
  });
  const child = spawn(process.execPath, [fileURLToPath(new URL("sidebar-server.mjs", import.meta.url))], {
    env: { ...process.env, CODEX_HOME: codexHome }, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
  });
  const stopped = new Promise(resolve => child.once("close", resolve));
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
    const metadata = { thread_id: threadId, threadId };
    const project = (await rpc("tools/call", { name: "deck_current_project", arguments: {}, _meta: metadata })).structuredContent;
    assert.equal(project.associated, registered);
    assert.equal(project.projectRoot, registered ? projectRoot : null);
    assert.equal(project.source, "state_5");
    console.log("Identity verified: " + (registered ? "registered project" : "missing project registration"));
    if (!registered) {
      const denied = await rpc("tools/call", { name: "deck_upstream_read", arguments: {
        method: "gitStatus", payload: { expectedThreadId: threadId },
      }, _meta: metadata });
      assert.equal(denied.isError, true);
      assert.match(denied.content[0].text, /不属于 Codex 项目/);
    }
    const resource = await rpc("resources/read", { uri: "ui://deck-sidebar/board.html" });
    const errors = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on("jsdomError", error => errors.push(error.message));
    dom = new JSDOM(resource.contents[0].text, { url: "https://mattskills-adapter.invalid/", runScripts: "outside-only", pretendToBeVisual: true, virtualConsole });
    const { window } = dom;
    window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    // jsdom has no viewport. Deliver the browser visibility signal so the real
    // view can reveal file rows beyond its first batch in a dirty working tree.
    window.IntersectionObserver = class {
      constructor(callback) { this.callback = callback; this.targets = new Set(); }
      observe(target) {
        this.targets.add(target);
        window.setTimeout(() => {
          if (this.targets.has(target)) this.callback([{ target, isIntersecting: true }]);
        }, 0);
      }
      unobserve(target) { this.targets.delete(target); }
      disconnect() { this.targets.clear(); }
    };
    window.postMessage = async message => {
      if (message.id === undefined) return;
      let result;
      if (message.method === "ui/initialize") result = {
        protocolVersion: "2026-01-26",
        hostCapabilities: {},
        hostContext: { theme: "light", locale: "zh-CN", threadId, cwd: projectRoot },
      };
      else {
        assert.equal(message.method, "tools/call");
        assert.notEqual(message.params.name, "deck_upstream_write", "view must never call a product write");
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
    const rootText = () => window.document.getElementById("root").textContent;
    if (!registered) {
      await until(() => rootText().includes("不属于 Codex 项目"), "projectless rejection");
      assert.equal(tab(), undefined, "unregistered project must not mount version control");
      assert.ok(!rootText().includes(probeName), "unregistered project must not expose Git data");
      assert.deepEqual(errors, []);
      console.log("PASS missing project registration: identity is unassociated, MCP Git read denied, panel stays closed");
      return;
    }
    await until(() => tab(), "version-control tab");
    tab().click();
    await until(() => rootText().includes(probeName), "changed file in version-control view");
    const text = rootText();
    // The commit rows are a windowed list; jsdom cannot measure a viewport, so the
    // readable evidence is the history count the view takes from the same screen.
    assert.ok(text.includes("提交历史 " + commitCount), "version-control view shows the real commit count");
    assert.ok(!text.includes("Command is outside read-only port verification"), "read gate failure must not surface");
    assert.ok(!text.includes("起不了 git 进程"), "host must not report a spawn failure");
    assert.ok(!text.includes("不属于 Codex 项目"), "registered project must not report identity failure");
    assert.deepEqual(errors, []);
    console.log("PASS panel -> MCP -> git: version-control tab shows the changed file list and the real commit count");
  } finally {
    dom?.window.close();
    for (const { timer } of requests.values()) clearTimeout(timer);
    child.stdin.end();
    const killTimer = setTimeout(() => child.kill(), 10000);
    try { await stopped; } finally { clearTimeout(killTimer); }
    await rm(codexHome, { recursive: true, force: true });
    await assert.rejects(lstat(codexHome), { code: "ENOENT" });
  }
}

const before = await repositoryState();
let probeCreated = false;
let failure;
try {
  await writeFile(probePath, "version control view probe\n", { encoding: "utf8", flag: "wx" });
  probeCreated = true;
  await verifyView(true);
  await verifyView(false);
} catch (error) {
  failure = error;
} finally {
  if (probeCreated) await rm(probePath);
  const after = await repositoryState();
  const changedFiles = [...new Set([...before.files, ...after.files].map(([name]) => name))]
    .filter(name => JSON.stringify(before.files.find(([key]) => key === name)) !== JSON.stringify(after.files.find(([key]) => key === name)));
  try {
    assert.equal(after.head, before.head, "HEAD must remain unchanged");
    assert.deepEqual(after.index, before.index, "Git index must remain unchanged");
    assert.deepEqual(changedFiles, [], "Working tree files changed during verification (check concurrent edits)");
    assert.equal(after.status, before.status, "Working tree status must remain unchanged");
  } catch (error) {
    failure = failure ? new AggregateError([failure, error], "View verification and repository preservation both failed") : error;
  }
}
if (failure) throw failure;
console.log("PASS fixture cleanup and unchanged HEAD, Git index, working tree status and file hashes");
