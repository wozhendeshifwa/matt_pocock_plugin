import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { realpath, rm } from "node:fs/promises";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";
import { createTestCodexHome } from "./test-codex-home.mjs";

// Ticket #19: exercise the original checks page and repair draft boundary.

const projectRoot = await realpath(fileURLToPath(new URL("../../", import.meta.url)));

const threadId = "10101010-1010-4010-8010-101010101010";
const { home: codexHome } = await createTestCodexHome({
  prefix: "mattskills-checks-ui-",
  threads: [{ id: threadId, cwd: projectRoot }],
  projectRoots: [projectRoot],
  rollouts: [{ id: threadId, cwd: projectRoot }],
});

const child = spawn(process.execPath, [fileURLToPath(new URL("sidebar-server.mjs", import.meta.url))], {
  env: { ...process.env, CODEX_HOME: codexHome, GH_CONFIG_DIR: codexHome, GH_TOKEN: "", GITHUB_TOKEN: "" }, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
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
function rpc(method, params = {}, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { requests.delete(id); reject(new Error("MCP timeout: " + method + "\n" + diagnostics)); }, timeoutMs);
    requests.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}
const metadata = { thread_id: threadId, threadId };

let dom;
const drafts = [];
try {
  await rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "checks-ui-check", version: "1" } });

  const resource = await rpc("resources/read", { uri: "ui://deck-sidebar/board.html" });
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", error => errors.push(error.message));
  dom = new JSDOM(resource.contents[0].text, { url: "https://mattskills-adapter.invalid/", runScripts: "outside-only", pretendToBeVisual: true, virtualConsole });
  const { window } = dom;
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  let nextRecheck = null;
  window.postMessage = async message => {
    if (message.id === undefined) return;
    let result;
    if (message.method === "ui/initialize") {
      result = {
        protocolVersion: "2026-01-26",
        hostCapabilities: { experimental: { "openai/message": {} } },
        hostContext: { theme: "light", threadId, cwd: projectRoot },
      };
    } else if (message.method === "ui/message") {
      drafts.push(message.params);
      result = {};
    } else {
      assert.equal(message.method, "tools/call");
      const isRecheck = message.params?.arguments?.method === "chain"
        && message.params.arguments.payload?.trigger === "user-recheck";
      const recheck = isRecheck ? nextRecheck : null;
      if (recheck) nextRecheck = null;
      message.params._meta = metadata;
      result = await rpc(message.method, message.params);
      if (recheck) {
        assert.ok(!result.isError, "recheck must return a successful RPC envelope");
        result = structuredClone(result);
        const envelope = result.structuredContent ?? JSON.parse(result.content[0].text);
        const chain = envelope.value ?? envelope;
        assert.equal(chain.ok, true);
        const snapshot = chain.fullSnapshot;
        assert.ok(snapshot?.steps?.length);
        if (recheck.green) {
          // Deliberately wrong success response: the same failure assertion
          // below must reject it after the panel actually renders it.
          for (const step of snapshot.steps) {
            step.status = "done";
            step.actions = [];
            step.isBlocking = false;
            step.isCurrent = false;
          }
          snapshot.chainState = "allDone";
          snapshot.doneCount = snapshot.applicableCount;
          snapshot.currentIndex = null;
        }
        const loginStep = snapshot.steps.find(step => step.id === "gh:authed");
        assert.ok(loginStep);
        loginStep.show = { ...loginStep.show, desc: recheck.marker };
        result.structuredContent = envelope;
        result.content = [{ type: "text", text: JSON.stringify(envelope) }];
        recheck.completed = true;
      }
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
    assert.fail("UI timeout (" + what + "): " + window.document.getElementById("root").textContent.slice(0, 1800));
  }
  const rootText = () => window.document.getElementById("root").textContent;
  await until(() => [...window.document.querySelectorAll("button")].some(button => button.textContent.trim() === "环境检查"), "checks nav");
  const checks = [...window.document.querySelectorAll("button")].find(button => button.textContent.trim() === "环境检查");
  checks.click();
  await until(() => rootText().includes("登录指引"), "login failure row");
  const guide = [...window.document.querySelectorAll("button")].find(button => button.textContent.includes("登录指引"));
  guide.click();
  await until(() => drafts.length > 0, "login guide draft");
  assert.equal(drafts[0]._meta["openai/message"].send, false);
  assert.match(JSON.stringify(drafts[0]), /gh auth login/);
  await until(() => rootText().includes("重新检查"), "checks page");
  assert.ok(rootText().includes("已登录 GitHub"));
  assert.ok(!rootText().includes("链条已全部通过"));
  function assertLoginStillFailed() {
    assert.ok(rootText().includes("登录指引"), "recheck must retain the login failure guide");
    assert.ok(!rootText().includes("链条已全部通过"), "recheck must not report all checks passed");
  }
  async function recheckAndWaitForRender(green, marker) {
    const check = { green, marker, completed: false };
    nextRecheck = check;
    [...window.document.querySelectorAll("button")].find(button => button.textContent.includes("重新检查")).click();
    await until(() => check.completed, "matching manual recheck response");
    // This unique detail exists only in the new response, so stale DOM cannot
    // satisfy the predicate even while the real network request is in flight.
    await until(() => rootText().includes(marker), "matching response rendered");
  }
  await recheckAndWaitForRender(false, "recheck-failure-response-rendered");
  assertLoginStillFailed();
  await recheckAndWaitForRender(true, "recheck-adversarial-green-rendered");
  assert.throws(assertLoginStillFailed, { code: "ERR_ASSERTION" }, "false green regression must be caught");
  assert.deepEqual(errors, []);
  console.log("PASS real recheck response renders failure; adversarial false-green response is caught; guide uses send:false draft");

} finally {
  dom?.window.close();
  for (const { timer } of requests.values()) clearTimeout(timer);
  child.stdin.end();
  child.kill();
  await rm(codexHome, { recursive: true, force: true }).catch(() => {});
}
