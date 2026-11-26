import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readdir, readFile, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";
import { createTestCodexHome } from "./test-codex-home.mjs";
import { parseSkillMarkdown } from "./skills-service.mjs";

// Ticket #10: the panel's skills page. Codex has no skills service, so the check
// chain used to wait forever and the panel showed "核心技能套件未安装". This check
// drives the real MCP server + panel and reads the same vendored files the page
// must display, so a green run means the catalog, the docs and the chain agree.

const projectRoot = await realpath(fileURLToPath(new URL("../../", import.meta.url)));
const bundledDir = path.join(projectRoot, "vendor", "mattskills-1.8.0-rc.7", "bundled-skills");
const skillNames = (await readdir(bundledDir, { withFileTypes: true }))
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)
  .sort();
assert.equal(skillNames.length, 27, "vendored bundled-skills must contain 27 skills");

const threadId = "10101010-1010-4010-8010-101010101010";
const { home: codexHome } = await createTestCodexHome({
  prefix: "mattskills-skills-page-",
  threads: [{ id: threadId, cwd: projectRoot }],
  projectRoots: [projectRoot],
  rollouts: [{ id: threadId, cwd: projectRoot }],
});

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
function rpc(method, params = {}, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { requests.delete(id); reject(new Error("MCP timeout: " + method + "\n" + diagnostics)); }, timeoutMs);
    requests.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}
const metadata = { thread_id: threadId, threadId };
async function upstream(method, payload = {}) {
  const result = await rpc("tools/call", {
    name: "deck_upstream_read",
    arguments: { method, payload: { ...payload, expectedThreadId: threadId } },
    _meta: metadata,
  });
  if (result.isError) throw new Error(result.content?.[0]?.text ?? method + " failed");
  const body = result.structuredContent ?? JSON.parse(result.content[0].text);
  return body?.value ?? body;
}

let dom;
try {
  await rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "skills-page-check", version: "1" } });

  // --- 1. chain reports the skills as installed (this is what drives the banner)
  const chain = await upstream("chain", {});
  const resolved = chain?.resolved ?? {};
  for (const name of ["wayfinder", "setup-matt-pocock-skills", "ask-matt"]) {
    const check = resolved["skill:" + name];
    assert.equal(check?.status, "pending", "readable reference does not prove host skill availability: " + name);
    assert.match(check.detail, /随包参考/);
    assert.match(String(check.detail), /bundled-skills/, "chain detail points at the vendored skills");
  }
  assert.notEqual(chain?.snapshot?.chainState, "allDone", "unknown host skill source must stay pending");
  console.log("PASS check chain distinguishes readable references from host skills");

  const deniedPrepare = await rpc('tools/call', {
    name: 'deck_upstream_read', arguments: { method: 'skill.prepare', payload: { name: 'tdd', expectedThreadId: threadId } }, _meta: metadata,
  });
  assert.equal(deniedPrepare.isError, true, 'maintenance must not run through read-only RPC');
  const prepared = await rpc('tools/call', {
    name: 'deck_upstream_write', arguments: { method: 'skill.prepare', payload: { name: 'tdd', expectedThreadId: threadId } }, _meta: metadata,
  });
  assert.ok(!prepared.isError);
  const prepareValue = prepared.structuredContent?.value ?? prepared.structuredContent;
  assert.equal(prepareValue.status, 'source-unbound', 'production lacks trusted source binding and must not guess');
  const injectedTarget = await rpc('tools/call', {
    name: 'deck_upstream_write', arguments: { method: 'skill.prepare', payload: { name: 'tdd', targetRoot: projectRoot, expectedThreadId: threadId } }, _meta: metadata,
  });
  assert.equal(injectedTarget.isError, true, 'ordinary UI cannot select a maintenance target');
  console.log('PASS skill.prepare is a write, rejects arbitrary targets and reports unbound production sources');

  // --- 2. the doc endpoint returns the vendored body, not a copy
  for (const name of ["wayfinder", "tdd", "writing-for-agents"]) {
    const doc = await upstream("skill.readDoc", { name });
    assert.equal(doc?.ok, true, "skill.readDoc must find " + name);
    const vendorText = await readFile(path.join(bundledDir, name, "SKILL.md"), "utf8");
    const parsed = parseSkillMarkdown(vendorText);
    assert.ok(parsed, "vendored SKILL.md parses: " + name);
    assert.ok(String(doc.md).endsWith(parsed.content), "detail preserves selected rules: " + name);
    assert.equal(doc.source.kind, 'bundled-reference');
    assert.equal(doc.source.actualLoad, 'unknown');
    assert.equal(doc.execution.allowed, false);
    assert.match(doc.md, /随包参考/);
    assert.equal(doc.update.status, 'source-unbound');
    assert.ok(String(doc.path || "").includes(path.join("bundled-skills", name)), "doc path is the vendored file: " + name);
  }
  console.log("PASS skill.readDoc returns the vendored body for 3 skills");

  // --- 3. the panel shows all 27 and no "not installed" banner
  const resource = await rpc("resources/read", { uri: "ui://deck-sidebar/board.html" });
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", error => errors.push(error.message));
  dom = new JSDOM(resource.contents[0].text, { url: "https://mattskills-adapter.invalid/", runScripts: "outside-only", pretendToBeVisual: true, virtualConsole });
  const { window } = dom;
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  const calls = [];
  window.postMessage = async message => {
    if (message.id === undefined) return;
    let result;
    if (message.method === "ui/initialize") {
      result = {
        protocolVersion: "2026-01-26",
        hostCapabilities: {},
        hostContext: { theme: "light", threadId, cwd: projectRoot },
      };
    } else {
      assert.equal(message.method, "tools/call");
      calls.push(message.params?.arguments?.method);
      message.params._meta = metadata;
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
    assert.fail("UI timeout (" + what + "): " + window.document.getElementById("root").textContent.slice(0, 1800));
  }
  const rootText = () => window.document.getElementById("root").textContent;
  await until(() => [...window.document.querySelectorAll("button")].some(button => button.textContent.trim() === "技能"), "skills nav");
  assert.ok(!rootText().includes("未检测到核心技能套件"), "skills banner must be gone");
  const skillsNav = [...window.document.querySelectorAll("button")].find(button => button.textContent.trim() === "技能");
  skillsNav.click();
  await until(() => rootText().includes("wayfinder"), "skills catalog");
  for (const name of skillNames) {
    assert.ok(rootText().includes(name), "skills page lists " + name);
  }
  console.log("PASS panel skills page lists all 27 vendored skills");
  assert.ok(!rootText().includes("未检测到核心技能套件"), "skills banner stays gone after opening the page");

  // Opening a skill must fetch its doc through the endpoint (not a hardcoded copy).
  const nameElement = [...window.document.querySelectorAll(".pixel-sname")]
    .find(element => element.textContent.trim() === "/wayfinder");
  let row = nameElement?.parentElement ?? null;
  while (row && !(row.querySelector("button") && row.querySelectorAll(".pixel-sname").length === 1)) row = row.parentElement;
  const open = [...(row?.querySelectorAll("button") ?? [])].find(button => /详情|detail/i.test(button.textContent)) ?? row?.querySelector("button") ?? null;
  if (open) {
    open.click();
    await until(() => calls.includes("skill.readDoc"), "skill readDoc call");
    await until(() => rootText().includes("A loose idea has arrived"), "skill detail rendered");
    assert.ok(rootText().includes("A loose idea has arrived"), "skill detail shows the vendored body");
    console.log("PASS clicking 详情 opens the vendored doc through skill.readDoc");
  } else assert.fail('Skill detail action must remain reachable');
  assert.deepEqual(errors, []);
  console.log("PASS skills page -> MCP -> vendored bundled-skills");
} finally {
  dom?.window.close();
  for (const { timer } of requests.values()) clearTimeout(timer);
  child.stdin.end();
  child.kill();
  await rm(codexHome, { recursive: true, force: true }).catch(() => {});
}
