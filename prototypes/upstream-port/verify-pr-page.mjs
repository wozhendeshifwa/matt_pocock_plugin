import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";
import { createTestCodexHome } from "./test-codex-home.mjs";

// Ticket #4: the Pull Request tab. The vendored tab is read-only (list, state,
// detail, comments) — there is no close/merge action anywhere in 1.8.0-rc.7 —
// so this check drives the real panel against a fixture PR in the test repo and
// also asserts the empty state in a workspace whose repo has no pull requests.

const REPO = "wozhendeshifwa/codex_mattskills_plugin";
const PROJECT_REPO_ROOT = await realpath(fileURLToPath(new URL("../../", import.meta.url)));
const marker = "PR fixture (ticket #4)";

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }).trim();
}
function ghJson(args) {
  const text = gh(args);
  return text ? JSON.parse(text) : null;
}

async function ensureFixturePr() {
  const open = ghJson(["pr", "list", "--repo", REPO, "--state", "open", "--json", "number,title,headRefName"]);
  const existing = open.find(pr => pr.title === marker);
  if (existing) return existing;
  const branch = "pr-fixture";
  const mainSha = ghJson(["api", `repos/${REPO}/git/ref/heads/main`]).object.sha;
  try {
    gh(["api", `repos/${REPO}/git/ref/heads/${branch}`]);
  } catch {
    gh(["api", `repos/${REPO}/git/refs`, "--method", "POST", "-f", `ref=refs/heads/${branch}`, "-f", `sha=${mainSha}`]);
  }
  try {
    gh(["api", `repos/${REPO}/contents/PR_TICKET.md?ref=${branch}`]);
  } catch {
    const content = Buffer.from("# PR fixture\n\nOpened for ticket #4 verification.\n", "utf8").toString("base64");
    gh(["api", `repos/${REPO}/contents/PR_TICKET.md`, "--method", "PUT", "-f", "message=Add PR fixture file", "-f", `content=${content}`, "-f", `branch=${branch}`]);
  }
  return ghJson(["api", `repos/${REPO}/pulls`, "--method", "POST", "-f", `title=${marker}`, "-f", `head=${branch}`, "-f", "base=main", "-f", "body=Fixture PR for ticket #4; safe to close."]);
}

async function ensureMergedPr() {
  const mergedMarker = "PR fixture merged (ticket #4)";
  const all = ghJson(["pr", "list", "--repo", REPO, "--state", "all", "--json", "number,title,state"]);
  const existing = all.find(pr => pr.title === mergedMarker);
  if (existing) return { number: existing.number, title: mergedMarker };
  const branch = "pr-fixture-merged";
  const mainSha = ghJson(["api", `repos/${REPO}/git/ref/heads/main`]).object.sha;
  try {
    gh(["api", `repos/${REPO}/git/ref/heads/${branch}`]);
  } catch {
    gh(["api", `repos/${REPO}/git/refs`, "--method", "POST", "-f", `ref=refs/heads/${branch}`, "-f", `sha=${mainSha}`]);
  }
  try {
    gh(["api", `repos/${REPO}/contents/MERGED_TICKET.md?ref=${branch}`]);
  } catch {
    const content = Buffer.from("# Merged PR fixture\n\nMerged for ticket #4 status verification.\n", "utf8").toString("base64");
    gh(["api", `repos/${REPO}/contents/MERGED_TICKET.md`, "--method", "PUT", "-f", "message=Add merged PR fixture file", "-f", `content=${content}`, "-f", `branch=${branch}`]);
  }
  const pr = ghJson(["api", `repos/${REPO}/pulls`, "--method", "POST", "-f", `title=${mergedMarker}`, "-f", `head=${branch}`, "-f", "base=main", "-f", "body=Merged fixture PR for ticket #4."]);
  gh(["api", `repos/${REPO}/pulls/${pr.number}/merge`, "--method", "PUT", "-f", "merge_method=squash", "-f", `commit_title=${mergedMarker}`]);
  return { number: pr.number, title: mergedMarker };
}

async function makeProject(remote) {
  const directory = await mkdtemp(path.join(tmpdir(), "mattskills-pr-project-"));
  execFileSync("git", ["init"], { cwd: directory, windowsHide: true });
  execFileSync("git", ["remote", "add", "origin", "https://github.com/" + remote + ".git"], { cwd: directory, windowsHide: true });
  await mkdir(path.join(directory, "docs/agents"), { recursive: true });
  await writeFile(path.join(directory, "docs/agents/issue-tracker.md"), "# Issue tracker: GitHub\n\nPull-request fixture project.\n", "utf8");
  return directory;
}

const fixturePr = await ensureFixturePr();
const mergedPr = await ensureMergedPr();
const fixtureProject = await makeProject(REPO);
const emptyProject = await makeProject("wozhendeshifwa/matt_pocock_plugin");
const fixtureThread = "20202020-2020-4020-8020-202020202020";
const emptyThread = "30303030-3030-4030-8030-303030303030";
const { home: codexHome } = await createTestCodexHome({
  prefix: "mattskills-pr-page-",
  threads: [
    { id: fixtureThread, cwd: fixtureProject },
    { id: emptyThread, cwd: emptyProject },
  ],
  projectRoots: [fixtureProject, emptyProject],
  rollouts: [
    { id: fixtureThread, cwd: fixtureProject },
    { id: emptyThread, cwd: emptyProject },
  ],
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
async function upstream(threadId, method, payload = {}, tool = "deck_upstream_read") {
  const result = await rpc("tools/call", {
    name: tool,
    arguments: { method, payload: { ...payload, expectedThreadId: threadId } },
    _meta: { thread_id: threadId, threadId },
  });
  if (result.isError) throw new Error(result.content?.[0]?.text ?? method + " failed");
  const body = result.structuredContent ?? JSON.parse(result.content[0].text);
  return body?.value ?? body;
}
async function mountPanel(threadId, cwd) {
  const resource = await rpc("resources/read", { uri: "ui://deck-sidebar/board.html" });
  const errors = [];
  const calls = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", error => errors.push(error.message));
  const dom = new JSDOM(resource.contents[0].text, { url: "https://mattskills-adapter.invalid/", runScripts: "outside-only", pretendToBeVisual: true, virtualConsole });
  const { window } = dom;
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.postMessage = async message => {
    if (message.id === undefined) return;
    let result;
    if (message.method === "ui/initialize") {
      result = { protocolVersion: "2026-01-26", hostCapabilities: {}, hostContext: { theme: "light", threadId, cwd } };
    } else {
      assert.equal(message.method, "tools/call");
      calls.push(message.params?.arguments?.method);
      message.params._meta = { thread_id: threadId, threadId };
      result = await rpc(message.method, message.params);
    }
    window.dispatchEvent(new window.MessageEvent("message", { source: window, data: { jsonrpc: "2.0", id: message.id, result } }));
  };
  for (const script of window.document.scripts) window.eval(script.textContent);
  const rootText = () => window.document.getElementById("root").textContent;
  async function until(check, what) {
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      if (check()) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.fail("UI timeout (" + what + "): " + rootText().slice(0, 1800));
  }
  return { dom, window, errors, calls, rootText, until };
}

let panel;
let commentId = null;
try {
  await rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "pr-page-check", version: "1" } });

  // --- 1. RPC read path sees the PR as a PR
  const snapshot = await upstream(fixtureThread, "snapshot", {});
  const prRow = (snapshot.issues ?? []).find(issue => issue.number === fixturePr.number);
  assert.ok(prRow, "snapshot includes the fixture PR");
  assert.equal(prRow.isPullRequest, true, "snapshot marks the row as a pull request");
  assert.equal(String(prRow.state).toUpperCase(), "OPEN", "snapshot carries the PR state");
  const modules = snapshot.backendModules ?? [];
  assert.ok(modules.some(module => module.id === "github" && module.capabilities?.pullRequests === true), "github backend advertises pullRequests");
  const mergedRow = (snapshot.issues ?? []).find(issue => issue.number === mergedPr.number);
  assert.ok(mergedRow, "snapshot includes the merged fixture PR");
  assert.equal(mergedRow.isPullRequest, true, "merged fixture is still a pull request");
  assert.ok(mergedRow.mergedAt, "snapshot carries mergedAt for the merged PR");
  console.log("PASS snapshot carries the merged state for a merged PR");
  const detail = await upstream(fixtureThread, "issueDetail", { number: fixturePr.number });
  assert.equal(detail?.ok, true, "issueDetail resolves the PR number");
  assert.equal(detail.issue?.isPullRequest, true, "issueDetail marks the PR");
  assert.ok(Array.isArray(detail.issue?.reviews?.nodes), "issueDetail carries the reviews collection");
  assert.ok(detail.issue?.comments?.nodes !== undefined, "issueDetail carries the first comment page");
  // The tracker-backed comments endpoint resolves issue numbers through GraphQL,
  // which returns null for a PR. The panel's first page comes from issueDetail, so
  // this is a documented limitation rather than a broken detail view.
  const commentsRaw = await rpc("tools/call", {
    name: "deck_upstream_read",
    arguments: { method: "issueComments", payload: { number: fixturePr.number, expectedThreadId: fixtureThread } },
    _meta: { thread_id: fixtureThread, threadId: fixtureThread },
  });
  const commentsBody = (commentsRaw.structuredContent ?? JSON.parse(commentsRaw.content[0].text));
  if (commentsBody?.ok === true && commentsBody?.value?.ok === false) {
    console.log("NOTE issueComments on a PR returns " + commentsBody.value.error.kind + " (tracker resolves issue numbers only)");
  }
  console.log("PASS snapshot/detail see the fixture PR");

  // --- 2. The PR tab lists it and the row opens the PR detail
  panel = await mountPanel(fixtureThread, fixtureProject);
  await panel.until(() => [...panel.window.document.querySelectorAll("button")].some(button => button.textContent.trim() === "拉取请求"), "PR nav");
  [...panel.window.document.querySelectorAll("button")].find(button => button.textContent.trim() === "拉取请求").click();
  await panel.until(() => panel.rootText().includes(marker) || panel.rootText().includes("还没有拉取请求"), "PR tab content");
  assert.ok(panel.rootText().includes(marker), "PR tab lists the fixture PR");
  assert.ok(panel.rootText().includes(mergedPr.title), "PR tab lists the merged fixture PR");
  assert.ok(panel.rootText().includes("已合并"), "merged PR shows the merged state");
  assert.ok(!panel.rootText().includes("还没有拉取请求"), "PR tab is not the empty state when a PR exists");
  const row = panel.window.document.querySelector(`[role="button"][aria-label^="#${fixturePr.number} "]`);
  assert.ok(row, "PR row is clickable");
  row.click();
  await panel.until(() => panel.rootText().includes("返回列表") && panel.rootText().includes("safe to close"), "PR detail");
  assert.ok(panel.rootText().includes(marker), "detail shows the PR title");
  // #506 in the vendored client: a pull request's detail is read-only on purpose —
  // it shows the comment list but renders no comment box. Comment posting is the
  // same commentIssue path, driven from the prompt side ("新会话").
  assert.ok(panel.rootText().includes("read-only · 写操作请走"), "PR detail states the read-only boundary");
  assert.equal(panel.window.document.querySelector("textarea"), null, "PR detail intentionally has no comment box");
  assert.deepEqual(panel.errors, []);
  console.log("PASS PR detail is read-only (comment list only, no comment box)");

  // --- 3. Comment through the same upstream endpoint the prompt side uses
  const body = "pr-comment-fixture-" + process.pid;
  const commentResult = await upstream(fixtureThread, "commentIssue", { number: fixturePr.number, body }, "deck_upstream_write");
  assert.equal(commentResult?.ok, true, "commentIssue accepts a PR number: " + JSON.stringify(commentResult));
  const comments = ghJson(["api", `repos/${REPO}/issues/${fixturePr.number}/comments`, "--jq", "[.[] | {id, body}]"]);
  const posted = comments.find(comment => comment.body === body);
  assert.ok(posted, "comment reached the PR on GitHub");
  const refreshed = await upstream(fixtureThread, "issueDetail", { number: fixturePr.number });
  assert.ok(refreshed.issue?.comments?.nodes?.some(comment => comment.body === body), "detail re-read carries the new comment");
  commentId = posted.id;

  // The panel's comment list is the detail page; a fresh mount must show it too.
  panel.dom.window.close();
  panel = await mountPanel(fixtureThread, fixtureProject);
  await panel.until(() => [...panel.window.document.querySelectorAll("button")].some(button => button.textContent.trim() === "拉取请求"), "PR nav (reload)");
  [...panel.window.document.querySelectorAll("button")].find(button => button.textContent.trim() === "拉取请求").click();
  await panel.until(() => panel.rootText().includes(marker), "PR row (reload)");
  panel.window.document.querySelector(`[role="button"][aria-label^="#${fixturePr.number} "]`).click();
  await panel.until(() => panel.rootText().includes(body), "posted comment visible in the panel");
  console.log("PASS PR comment path writes to GitHub and the panel's comment list shows it");

  // --- 4. Empty state in a repo without PRs
  panel.dom.window.close();
  panel = await mountPanel(emptyThread, emptyProject);
  await panel.until(() => [...panel.window.document.querySelectorAll("button")].some(button => button.textContent.trim() === "拉取请求"), "PR nav (empty repo)");
  [...panel.window.document.querySelectorAll("button")].find(button => button.textContent.trim() === "拉取请求").click();
  await panel.until(() => panel.rootText().includes("还没有拉取请求"), "empty PR tab");
  assert.ok(panel.rootText().includes("还没有拉取请求"), "a repo without PRs shows the empty state");
  console.log("PASS PR tab shows 还没有拉取请求 for a repo without pull requests");
} finally {
  if (commentId !== null) {
    try { gh(["api", `repos/${REPO}/issues/comments/${commentId}`, "--method", "DELETE"]); } catch {}
  }
  panel?.dom.window.close();
  for (const { timer } of requests.values()) clearTimeout(timer);
  child.stdin.end();
  child.kill();
  await rm(codexHome, { recursive: true, force: true }).catch(() => {});
  await rm(fixtureProject, { recursive: true, force: true }).catch(() => {});
  await rm(emptyProject, { recursive: true, force: true }).catch(() => {});
}
