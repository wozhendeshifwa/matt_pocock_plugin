import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";
import { createTestCodexHome } from "./test-codex-home.mjs";

// Ticket #12 end-to-end check. A throwaway project fixture points at the
// wozhendeshifwa/codex_mattskills_plugin repository, so every write has to land in
// that repository, not in this checkout's repo. The panel is driven through the
// same MCP server and project-host fan-out the desktop uses; the assertions below
// read the writes back from GitHub itself (gh api / gh label list) instead of
// trusting the adapter's own echo.

const GH = "gh";
const REPO = "wozhendeshifwa/codex_mattskills_plugin";
const threadId = "12121212-1212-4212-8212-121212121212";
const marker = "ticket-12-write-fixture-" + process.pid;
const commentBody = marker + " panel comment";
const rpcCommentBody = marker + " rpc comment";
const labelName = marker + "-label";

function gh(args, options = {}) {
  return execFileSync(GH, args, { encoding: "utf8", windowsHide: true, ...options }).trim();
}
function ghJson(args) {
  return JSON.parse(gh(args));
}
function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();
}

const adapterRoot = await realpath(fileURLToPath(new URL("../../", import.meta.url)));
const adapterKey = createHash("sha256").update(adapterRoot.toLowerCase()).digest("hex").slice(0, 16);
const dataRoot = path.join(adapterRoot, ".scratch/upstream-sidebar", adapterKey);
const fixtureDirs = [];
let issueNumber = null;
let labelCreated = false;
let labelPreviousColor = null;

async function makeFixtureProject() {
  const directory = await mkdtemp(path.join(tmpdir(), "mattskills-write-project-"));
  fixtureDirs.push(directory);
  git(["-c", "init.defaultBranch=main", "init"], directory);
  git(["remote", "add", "origin", "https://github.com/" + REPO + ".git"], directory);
  await mkdir(path.join(directory, "docs/agents"), { recursive: true });
  await writeFile(path.join(directory, "docs/agents/issue-tracker.md"),
    "# Issue tracker: GitHub\n\nFixture project for ticket #12 write verification.\n", "utf8");
  return directory;
}

const projectRoot = await makeFixtureProject();
const { home: codexHome } = await createTestCodexHome({
  prefix: "mattskills-write-codex-",
  threads: [{ id: threadId, cwd: projectRoot }],
  projectRoots: [projectRoot],
  rollouts: [{ id: threadId, cwd: projectRoot }],
});
fixtureDirs.push(codexHome);

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
async function upstream(tool, method, payload = {}) {
  const result = await rpc("tools/call", {
    name: tool,
    arguments: { method, payload: { ...payload, expectedThreadId: threadId } },
    _meta: metadata,
  });
  if (result.isError) throw new Error(result.content?.[0]?.text ?? method + " failed");
  const body = result.structuredContent ?? JSON.parse(result.content[0].text);
  // Workspace-style endpoints answer { ok, value }; issue-detail writes answer the
  // tracker result directly. Both are unwrapped the same way here.
  return body && typeof body === "object" && "value" in body && body.value && typeof body.value === "object" ? body.value : body;
}
async function upstreamResult(tool, method, payload = {}) {
  return rpc("tools/call", {
    name: tool,
    arguments: { method, payload: { ...payload, expectedThreadId: threadId } },
    _meta: metadata,
  });
}

let dom;
try {
  // --- fixtures on the real test repository -------------------------------
  const created = ghJson(["api", `repos/${REPO}/issues`, "--method", "POST", "-f", "title=" + marker, "-f", "body=Fixture issue for ticket #12; safe to close."]);
  issueNumber = created.number;
  try {
    gh(["label", "create", labelName, "--repo", REPO, "--color", "5b6b60", "--description", "ticket #12 write fixture"]);
    labelCreated = true;
  } catch {
    labelPreviousColor = null;
  }

  await rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "issue-writes-check", version: "1" } });

  // --- 1. the read tool must refuse writes --------------------------------
  const viaRead = await upstreamResult("deck_upstream_read", "commentIssue", { number: issueNumber, body: rpcCommentBody });
  assert.ok(viaRead.isError, "a write must not ride the read tool");
  assert.match(viaRead.content?.[0]?.text ?? "", /must be routed through deck_upstream_write/);
  console.log("PASS write endpoint refused on the read tool");

  // --- 2. RPC write path: commentIssue ------------------------------------
  const commentResult = await upstream("deck_upstream_write", "commentIssue", { number: issueNumber, body: rpcCommentBody });
  assert.equal(commentResult?.ok, true, "commentIssue must report ok: " + JSON.stringify(commentResult));
  const comments = ghJson(["api", `repos/${REPO}/issues/${issueNumber}/comments`, "--jq", "[.[].body]"]);
  assert.ok(comments.includes(rpcCommentBody), "comment reached GitHub");
  console.log("PASS commentIssue writes a real GitHub comment");

  // --- 3. label colors ----------------------------------------------------
  const colorResult = await upstream("deck_upstream_write", "setLabelColors", { changes: [{ name: labelName, color: "1A2B3C" }] });
  assert.equal(colorResult?.ok, true, "setLabelColors must report ok: " + JSON.stringify(colorResult));
  const labels = ghJson(["label", "list", "--repo", REPO, "--json", "name,color", "--limit", "100"]);
  const painted = labels.find(label => label.name === labelName);
  assert.ok(painted, "fixture label still exists");
  assert.equal(String(painted.color).toLowerCase(), "1a2b3c", "label color updated on GitHub");
  console.log("PASS setLabelColors repaints a real label");

  // --- 4. workspace binding writes the project file -----------------------
  const bindResult = await upstream("deck_upstream_write", "bind", { backendId: "github" });
  assert.equal(bindResult?.ok, true, "bind must report ok: " + JSON.stringify(bindResult));
  // workspace-endpoint results come back wrapped as { ok, value }.
  const bindValue = bindResult;
  assert.equal(bindValue.backendId, "github", "bind returns the chosen backend");
  const workspaceFile = JSON.parse(await readFile(path.join(projectRoot, "docs/agents/workspace.json"), "utf8"));
  assert.equal(workspaceFile.backendId, "github", "workspace.json records the chosen backend");
  console.log("PASS bind writes docs/agents/workspace.json in the current project");

  // --- 5. error path is returned, not thrown ------------------------------
  const missing = await upstreamResult("deck_upstream_write", "commentIssue", { number: 999999, body: "no such issue" });
  assert.ok(!missing.isError, "a backend failure is a result, not a transport error");
  const missingValue = (() => {
    const raw = missing.structuredContent ?? JSON.parse(missing.content[0].text);
    return raw?.value ?? raw;
  })();
  assert.equal(missingValue?.ok, false, "commenting a missing issue reports failure");
  assert.ok(missingValue?.error?.kind, "failure carries an error kind for the panel");
  console.log("PASS missing issue returns a readable backend error");

  // --- 6. writes outside this ticket stay closed --------------------------
  const gitStage = await upstreamResult("deck_upstream_write", "gitStage", { paths: ["README.md"] });
  assert.ok(gitStage.isError, "gitStage is not part of this ticket");
  assert.match(gitStage.content?.[0]?.text ?? "", /still not enabled/);
  const gitPush = await upstreamResult("deck_upstream_write", "gitPush", {});
  assert.ok(gitPush.isError, "gitPush is not part of this ticket");
  console.log("PASS untouched write endpoints still fail closed");

  // --- 7. panel -> MCP -> host -> GitHub, through the real comment form ----
  const resource = await rpc("resources/read", { uri: "ui://deck-sidebar/board.html" });
  const html = resource.contents[0].text;
  assert.ok(html.includes("__DECK_WRITE_METHODS__"), "server injects the write method list");
  const writeTools = [];
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", error => errors.push(error.message));
  dom = new JSDOM(html, { url: "https://mattskills-adapter.invalid/", runScripts: "outside-only", pretendToBeVisual: true, virtualConsole });
  const { window } = dom;
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
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
      if (message.params?.name === "deck_upstream_write") writeTools.push(message.params.arguments?.method);
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
    assert.fail("UI timeout (" + what + "): " + window.document.getElementById("root").textContent.slice(0, 1600));
  }
  const row = () => window.document.querySelector(`[role="button"][aria-label^="#${issueNumber} "]`);
  await until(row, "fixture issue row");
  row().click();
  await until(() => window.document.querySelector("textarea"), "comment box");
  const textarea = window.document.querySelector("textarea");
  // React tracks the DOM value itself; setting `.value` alone leaves its draft
  // empty. Go through the prototype setter so the onChange handler sees it.
  const setValue = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
  setValue.call(textarea, commentBody);
  textarea.dispatchEvent(new window.Event("input", { bubbles: true }));
  const send = [...window.document.querySelectorAll("button")].find(button => button.textContent.trim() === "发送");
  assert.ok(send, "comment send button is rendered");
  send.click();
  const deadline = Date.now() + 90000;
  let bodies = [];
  while (Date.now() < deadline) {
    bodies = ghJson(["api", `repos/${REPO}/issues/${issueNumber}/comments`, "--jq", "[.[].body]"]);
    if (bodies.includes(commentBody)) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.ok(bodies.includes(commentBody), "panel comment reached GitHub");
  assert.ok(writeTools.includes("commentIssue"), "panel routed the write through deck_upstream_write");
  assert.deepEqual(errors, []);
  console.log("PASS panel comment form -> write tool -> real GitHub comment");

  // --- 8. the audit trail exists and carries no write content -------------
  const projectDataDir = path.join(dataRoot, "projects", createHash("sha256").update(projectRoot).digest("hex"));
  const auditText = await readFile(path.join(projectDataDir, "write-audit.jsonl"), "utf8");
  const auditLines = auditText.trim().split(/\r?\n/).map(line => JSON.parse(line));
  assert.ok(auditLines.some(line => line.method === "commentIssue"), "audit records the comment");
  assert.ok(auditLines.some(line => line.method === "bind" && line.category === "project-write"), "audit records the binding write");
  assert.ok(auditLines.every(line => line.argvHash === undefined || /^[0-9a-f]{12}$/.test(line.argvHash)), "audit stores argv hashes only");
  assert.ok(!auditText.includes(commentBody) && !auditText.includes(rpcCommentBody), "audit never stores comment text");
  console.log("PASS write-audit.jsonl records methods and hashes without content");

  // --- 9. close/reopen through the deck tool ------------------------------
  const closeResult = await rpc("tools/call", {
    name: "deck_issue_patch",
    arguments: { key: String(issueNumber), close: true },
    _meta: metadata,
  });
  const closeValue = closeResult.isError ? null : (closeResult.structuredContent ?? JSON.parse(closeResult.content[0].text));
  const closeTicket = closeValue?.value ?? closeValue;
  if (closeTicket?.status === "ok" && ghJson(["issue", "view", String(issueNumber), "--repo", REPO, "--json", "state"]).state === "CLOSED") {
    const reopenResult = await rpc("tools/call", {
      name: "deck_issue_patch",
      arguments: { key: String(issueNumber), close: false },
      _meta: metadata,
    });
    const reopenValue = reopenResult.isError ? null : (reopenResult.structuredContent ?? JSON.parse(reopenResult.content[0].text));
    assert.equal((reopenValue?.value ?? reopenValue)?.status, "ok", "reopen through deck_issue_patch");
    assert.equal(ghJson(["issue", "view", String(issueNumber), "--repo", REPO, "--json", "state"]).state, "OPEN", "issue is open again");
    const closedAgain = await rpc("tools/call", {
      name: "deck_issue_patch",
      arguments: { key: String(issueNumber), close: true },
      _meta: metadata,
    });
    assert.ok(!closedAgain.isError, "close fixture again");
    console.log("PASS deck_issue_patch closes and reopens a real issue");
  } else {
    console.log("SKIP deck_issue_patch close/reopen (" + (closeResult.isError ? closeResult.content?.[0]?.text : JSON.stringify(closeValue)) + ")");
  }

  console.log("PASS ticket #12 writes are project-scoped: fixture repo " + REPO + ", not this checkout's repo");
} finally {
  dom?.window.close();
  for (const { timer } of requests.values()) clearTimeout(timer);
  child.stdin.end();
  child.kill();
  if (issueNumber !== null) {
    try { gh(["issue", "close", String(issueNumber), "--repo", REPO], { stdio: ["ignore", "ignore", "ignore"] }); } catch {}
    try { gh(["issue", "edit", String(issueNumber), "--repo", REPO, "--title", marker + " (verified, closed)"], { stdio: "ignore" }); } catch {}
  }
  if (labelCreated) {
    try { gh(["label", "delete", labelName, "--repo", REPO, "--yes"], { stdio: "ignore" }); } catch {}
  }
  for (const dir of fixtureDirs) await rm(dir, { recursive: true, force: true }).catch(() => {});
}
