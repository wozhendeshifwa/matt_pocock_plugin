import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { JSDOM, VirtualConsole } from "jsdom";

// Proof for #16: the map detail is the original upstream view fed by the Codex
// adapter, and its hierarchy / frontier / blocking state match the repository's
// **native** sub-issue and dependency edges — not lines parsed out of bodies.
//
// The native truth comes from one GraphQL call (subIssues + blockedBy +
// assignees + body). Expected levels and frontier are computed here from those
// edges; the snapshot rows, the map stats and the rendered DOM are each asserted
// against that computation.
//
// Usage: node verify-map-view.mjs <projectDir> [mapNumber] [owner/name]

const projectRoot = process.argv[2];
assert.ok(projectRoot, "project directory argument is required");
const requestedMap = process.argv[3] ? String(process.argv[3]) : null;
const requestedRepo = process.argv[4] ?? null;
const threadId = "16a51f6e-0000-4000-8000-16a51f6e0000";

const codexHome = await mkdtemp(path.join(tmpdir(), "codex-map-check-"));
const sessionDir = path.join(codexHome, "sessions", "2026", "11", "07");
await mkdir(sessionDir, { recursive: true });
await writeFile(path.join(sessionDir, "rollout-test-" + threadId + ".jsonl"), JSON.stringify({
  type: "session_meta",
  payload: { id: threadId, cwd: projectRoot },
}) + "\n");
// The project association is part of the host identity (#11): a chat only reads
// a project it belongs to. Register the fixture project the same way Codex does.
await writeFile(path.join(codexHome, ".codex-global-state.json"), JSON.stringify({
  "local-projects": { "project-map-view-fixture": { rootPaths: [projectRoot] } },
}));

const child = spawn(process.execPath, [fileURLToPath(new URL("sidebar-server.mjs", import.meta.url))], {
  env: { ...process.env, CODEX_HOME: codexHome }, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
});
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
    const timer = setTimeout(() => { requests.delete(id); reject(new Error("MCP timeout: " + method + " " + diagnostics)); }, 90000);
    requests.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}
const hostMeta = { thread_id: threadId, threadId };
async function readUpstream(method, payload = {}) {
  const reply = await rpc("tools/call", {
    name: "deck_upstream_read",
    arguments: { method, payload: { ...payload, expectedThreadId: threadId } },
    _meta: hostMeta,
  });
  if (reply.isError) throw new Error(reply.content?.[0]?.text ?? method + " failed");
  return JSON.parse(reply.content[0].text);
}

function runGh(args) {
  return new Promise((resolve, reject) => {
    execFile("gh", args, { cwd: projectRoot, windowsHide: true, timeout: 90000, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => error ? reject(new Error("gh failed: " + (stderr || error.message))) : resolve(stdout));
  });
}

const NATIVE_QUERY = [
  "query($owner:String!,$name:String!,$number:Int!){",
  "repository(owner:$owner,name:$name){issue(number:$number){",
  "number title state assignees(first:10){nodes{login}}",
  "subIssues(first:100){totalCount nodes{number title state body assignees(first:10){nodes{login}} blockedBy(first:100){nodes{number state}}}}",
  "}}}",
].join("");

function computeLevels(children) {
  const byNumber = new Map(children.map(child => [child.number, child]));
  const memo = new Map();
  const visiting = new Set();
  const levelOf = child => {
    if (memo.has(child.number)) return memo.get(child.number);
    assert.ok(!visiting.has(child.number), "Native dependency graph contains a cycle at #" + child.number);
    visiting.add(child.number);
    const blockers = child.blockedBy.map(key => byNumber.get(key)).filter(Boolean);
    const level = blockers.length ? Math.max(...blockers.map(levelOf)) + 1 : 0;
    visiting.delete(child.number);
    memo.set(child.number, level);
    return level;
  };
  children.forEach(levelOf);
  return memo;
}

function group(children, levelOf) {
  const byNumber = new Map(children.map(child => [child.number, child]));
  const hasOpenBlocker = child => child.blockedBy.some(key => byNumber.get(key)?.state === "OPEN");
  const open = children.filter(child => child.state !== "CLOSED");
  const frontier = open.filter(child => !child.claimedBy && !hasOpenBlocker(child));
  const blocked = open.filter(child => !child.claimedBy && hasOpenBlocker(child));
  const claimed = open.filter(child => child.claimedBy);
  const levels = [];
  children.forEach(child => {
    const level = levelOf.get(child.number);
    if (!levels[level]) levels[level] = { level, numbers: [], open: 0, closed: 0, total: 0, frontier: 0, claimed: 0, blocked: 0 };
    const layer = levels[level];
    layer.numbers.push(child.number);
    layer.total += 1;
    if (child.state === "CLOSED") layer.closed += 1; else layer.open += 1;
  });
  levels.filter(Boolean).forEach(layer => {
    const openInLayer = open.filter(child => levelOf.get(child.number) === layer.level);
    layer.frontier = openInLayer.filter(child => !child.claimedBy && !hasOpenBlocker(child)).length;
    layer.claimed = openInLayer.filter(child => child.claimedBy).length;
    layer.blocked = openInLayer.filter(child => !child.claimedBy && hasOpenBlocker(child)).length;
  });
  return { total: children.length, open: open.length, closed: children.length - open.length, frontier: frontier.length, claimed: claimed.length, blocked: blocked.length, levels: levels.filter(Boolean), frontierSet: frontier, blockedSet: blocked };
}

let dom;
let serverFailure = null;
try {
  await rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "map-view-check", version: "1" } });
  const project = await rpc("tools/call", { name: "deck_current_project", arguments: {}, _meta: hostMeta });
  assert.equal(project.isError, undefined, "The fixture chat must resolve to its project: " + project.content?.[0]?.text);
  assert.equal(project.structuredContent?.cwd, projectRoot.replace(/\//g, "\\"));

  const snapshotEnvelope = await readUpstream("snapshot", { force: true });
  assert.equal(snapshotEnvelope.ok, true, "snapshot must succeed: " + JSON.stringify(snapshotEnvelope.error));
  const snapshot = snapshotEnvelope.value;
  const repositoryName = requestedRepo ?? snapshot.repository?.name ?? (snapshot.repo ? snapshot.repo.owner + "/" + snapshot.repo.name : null);
  assert.ok(repositoryName, "snapshot must name the repository");
  const [owner, name] = repositoryName.split("/");
  const repositoryUrl = snapshot.repository?.url ?? "https://github.com/" + repositoryName;
  const map = requestedMap
    ? snapshot.maps.find(candidate => String(candidate.key ?? candidate.number) === requestedMap)
    : snapshot.maps.find(candidate => (candidate.labels ?? []).some(label => (label.name ?? label) === "wayfinder:map")) ?? snapshot.maps[0];
  assert.ok(map, "The project must contain a wayfinder map");

  const native = JSON.parse(await runGh(["api", "graphql", "-f", "query=" + NATIVE_QUERY, "-f", "owner=" + owner, "-f", "name=" + name, "-F", "number=" + String(map.number)]));
  const issue = native.data.repository.issue;
  assert.equal(issue.number, map.number);
  const children = issue.subIssues.nodes.map(node => ({
    number: node.number,
    title: node.title,
    state: node.state,
    body: node.body ?? "",
    claimedBy: node.assignees.nodes[0]?.login ?? "",
    blockedBy: node.blockedBy.nodes.map(ref => ref.number),
  })).sort((left, right) => left.number - right.number);
  assert.equal(issue.subIssues.totalCount, children.length, "Native query must return every child (100 cap)");
  assert.ok(children.length >= 2, "The map needs at least two children to exercise layering");
  const levelOf = computeLevels(children);
  const expected = group(children, levelOf);

  // --- Snapshot rows -------------------------------------------------------
  assert.equal(map.tickets.length, expected.total, "snapshot carries every native child");
  for (const child of children) {
    const row = map.tickets.find(ticket => ticket.number === child.number);
    assert.ok(row, "snapshot is missing native child #" + child.number);
    assert.equal(row.state, child.state, "#" + child.number + " state");
    assert.equal(row.claimedBy, child.claimedBy, "#" + child.number + " claim");
    assert.equal(row.level, levelOf.get(child.number), "#" + child.number + " level");
    const rowBlockers = [...row.blockedBy].map(Number).sort((left, right) => left - right);
    assert.deepEqual(rowBlockers, [...child.blockedBy].sort((left, right) => left - right), "#" + child.number + " native blockers");
  }
  const layerView = stats => ({
    total: stats.total, open: stats.open, closed: stats.closed,
    frontier: stats.frontier, claimed: stats.claimed, blocked: stats.blocked,
    levels: stats.levels.map(layer => ({
      level: layer.level, numbers: [...layer.numbers].sort((left, right) => left - right),
      open: layer.open, closed: layer.closed, total: layer.total,
      frontier: layer.frontier, claimed: layer.claimed, blocked: layer.blocked,
    })),
  });
  assert.deepEqual(layerView(map.stats), {
    total: expected.total, open: expected.open, closed: expected.closed,
    frontier: expected.frontier, claimed: expected.claimed, blocked: expected.blocked,
    levels: expected.levels.map(layer => ({
      level: layer.level, numbers: [...layer.numbers].sort((left, right) => left - right),
      open: layer.open, closed: layer.closed, total: layer.total,
      frontier: layer.frontier, claimed: layer.claimed, blocked: layer.blocked,
    })),
  }, "snapshot map stats must equal the native dependency computation");
  console.log("PASS snapshot map rows, levels and frontier equal the native dependency graph (" + expected.total + " children, " + expected.levels.length + " layers)");

  // Blocking must come from native edges, never from a body line.
  const blockedByBodyLine = children.filter(child => child.state !== "CLOSED" && /^\s*Blocked by\s*[:：]/im.test(child.body));
  assert.deepEqual(blockedByBodyLine.map(child => child.number), [], "fixture map children must not carry a body-line Blocked by fallback");
  console.log("PASS every blocked child's relation comes from native dependencies (no Blocked by body line on this map)");

  // --- Rendered map detail -------------------------------------------------
  const resources = await rpc("resources/read", { uri: "ui://deck-sidebar/board.html" });
  const html = resources.contents[0].text;
  const errors = [];
  const drafted = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", error => errors.push(error.message));
  dom = new JSDOM(html, { url: "https://mattskills-adapter.invalid/", runScripts: "outside-only", pretendToBeVisual: true, virtualConsole });
  const { window } = dom;
  // The Codex sidebar is narrower than the upstream dock's default; report 320px
  // so the panel renders its narrow layout while the check runs.
  window.ResizeObserver = class {
    constructor(callback) { this.callback = callback; }
    observe(element) { this.callback([{ target: element, contentRect: { width: 320, height: 900 } }]); }
    unobserve() {}
    disconnect() {}
  };
  window.postMessage = async message => {
    if (message.id === undefined) return;
    let result;
    if (message.method === "ui/initialize") {
      result = {
        protocolVersion: "2026-01-26",
        hostCapabilities: { experimental: { "openai/message": true } },
        hostContext: { theme: "light", threadId, cwd: projectRoot, locale: "zh-CN" },
      };
    } else if (message.method === "ui/message") {
      drafted.push(message.params);
      result = {};
    } else {
      message.params._meta = hostMeta;
      result = await rpc(message.method, message.params);
      if (result?.isError) console.log("Panel tool error (" + message.params?.name + "): " + result.content?.[0]?.text);
    }
    window.dispatchEvent(new window.MessageEvent("message", { source: window, data: { jsonrpc: "2.0", id: message.id, result } }));
  };
  for (const script of window.document.scripts) window.eval(script.textContent);
  async function until(check, label) {
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      if (check()) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.fail("UI timeout (" + label + "): " + window.document.body.textContent.slice(0, 1200));
  }
  const numberFrom = element => Number(String(element.querySelector(".no")?.textContent ?? "").replace(/[^0-9]/g, ""));
  await until(() => window.document.body.textContent.includes(map.title), "map list row");
  const mapRow = [...window.document.querySelectorAll('[role="button"]')]
    .find(element => (element.getAttribute("aria-label") ?? "").startsWith("#" + map.number + " "));
  assert.ok(mapRow, "The list must render the wayfinder map as a row");
  mapRow.click();
  await until(() => window.document.querySelectorAll(".dsws-node").length === expected.total, "map detail nodes");
  await new Promise(resolve => setTimeout(resolve, 800));

  const shell = window.document.querySelector("[data-dsws-host]");
  assert.ok(shell, "The panel shell must mount");
  assert.match(shell.className, /dsws-narrow/, "A 320px sidebar must use the narrow layout");
  assert.match(html, /\.dsws-narrow \.dsws-layer\{grid-template-columns:repeat\(auto-fill,minmax\(150px,1fr\)\)\}/, "Narrow layout must relax the layer grid to 150px columns");

  const layerBoxes = [...window.document.querySelectorAll(".dsws-layerbox")];
  assert.equal(layerBoxes.length, expected.levels.length, "One layer block per dependency layer");
  for (const [index, layer] of expected.levels.entries()) {
    const box = layerBoxes[index];
    assert.equal(box.querySelector(".dsws-layerNo")?.textContent, String(index + 1), "layer number");
    const title = box.querySelector(".dsws-layerTitle")?.textContent ?? "";
    assert.ok(title.includes("层 " + (index + 1)), "layer caption: " + title);
    assert.ok(title.includes(String(layer.open) + " open"), "layer open count: " + title);
    const numbers = [...box.querySelectorAll(".dsws-node")].map(numberFrom).sort((left, right) => left - right);
    assert.deepEqual(numbers, [...layer.numbers].sort((left, right) => left - right), "layer " + (index + 1) + " membership");
    const gate = box.nextElementSibling?.querySelector(".g");
    const previousAllClosed = expected.levels.slice(0, index).every(previous => previous.closed === previous.total);
    const gateIsOpen = (layer.closed === layer.total && layer.total > 0) || previousAllClosed;
    assert.ok(gate, "layer " + (index + 1) + " gate");
    assert.ok(gate.className.includes(gateIsOpen ? "g open" : "g lock"), "layer " + (index + 1) + " gate state: " + gate.className);
  }
  const currentLevel = (() => {
    const index = expected.levels.findIndex(layer => layer.open > 0);
    return index === -1 ? Math.max(0, expected.levels.length - 1) : index;
  })();
  const nowNumbers = [...window.document.querySelectorAll(".dsws-node.now")].map(numberFrom).sort((left, right) => left - right);
  const expectedNow = expected.levels[currentLevel].numbers.filter(number => children.find(child => child.number === number).state !== "CLOSED").sort((left, right) => left - right);
  assert.deepEqual(nowNumbers, expectedNow, "Open tickets in the current layer are marked as current");
  console.log("PASS rendered layers, layer membership, open counts and gate/current markers match the native DAG");

  const nodeOf = number => [...window.document.querySelectorAll(".dsws-node")].find(node => numberFrom(node) === number);
  for (const child of children) {
    const node = nodeOf(child.number);
    assert.ok(node, "rendered node for #" + child.number);
    const sub = (node.querySelector(".sub")?.textContent ?? "").trim();
    const buttons = [...node.querySelectorAll(".acts button, .acts a")];
    if (child.state === "CLOSED") {
      assert.match(node.className, /done/, "#" + child.number + " closed styling");
      assert.ok(sub.includes("已关闭"), "#" + child.number + " shows closed");
    } else if (expected.blockedSet.some(ticket => ticket.number === child.number)) {
      assert.match(node.className, /fog/, "#" + child.number + " blocked tickets are fogged");
      assert.ok(sub.includes("被阻塞："), "#" + child.number + " shows its open blockers: " + sub);
      assert.equal(buttons.length, 0, "#" + child.number + " must not offer an action while blocked");
    } else if (child.claimedBy) {
      assert.ok(sub.includes(child.claimedBy), "#" + child.number + " shows the claim: " + sub);
    }
  }
  console.log("PASS blocked children render as blocked (fog + open blocker names, actions suppressed); claims and closed states render");
  assert.deepEqual(errors, [], "The panel renders without host or script errors");

  // --- Single-ticket action reuses the upstream prompt --------------------
  const actionable = expected.frontierSet[0];
  assert.ok(actionable, "The map needs at least one takeable child for a single-ticket action check");
  const actionButton = nodeOf(actionable.number).querySelector(".acts button");
  assert.ok(actionButton, "#" + actionable.number + " is takeable and must offer its row action");
  actionButton.click();
  await until(() => drafted.length === 1, "single-ticket draft");
  assert.equal(drafted[0]._meta?.["openai/message"]?.target, "active", "Row actions prefill the current chat");
  assert.equal(drafted[0]._meta?.["openai/message"]?.send, false, "Row actions only prefill the current chat");
  assert.ok(drafted[0].content[0].text.startsWith("$wayfinder"), "Row action uses the Codex wayfinder prefix: " + drafted[0].content[0].text.slice(0, 60));
  assert.ok(drafted[0].content[0].text.includes(repositoryUrl + "/issues/" + actionable.number), "Row action prompt names ticket #" + actionable.number);
  console.log("PASS a single takeable child keeps its original row action and send:false draft");

  // --- Map actions reuse the upstream prompt and the draft boundary --------
  const sticky = window.document.querySelector(".dsws-stickybar");
  assert.ok(sticky, "Map detail must render its action bar");
  const primaryLabel = expected.total === 0 ? "体检" : (expected.closed === expected.total ? "完成" : "执行");
  const primary = [...sticky.querySelectorAll("button")].find(button => (button.textContent ?? "").trim() === primaryLabel);
  assert.ok(primary, "Map action bar must offer " + primaryLabel);
  primary.click();
  await until(() => drafted.length === 2, "map action draft");
  const newSession = [...sticky.querySelectorAll("button")].find(button => (button.textContent ?? "").trim() === "新会话");
  assert.ok(newSession, "Map action bar must offer a new-session action");
  newSession.click();
  await until(() => drafted.length === 3, "map new-session draft");
  const mapDrafts = drafted.slice(1);
  assert.deepEqual(mapDrafts.map(draft => draft._meta?.["openai/message"]?.target), ["active", "new"], "The two map actions keep the upstream active/new split");
  for (const draft of mapDrafts) assert.equal(draft._meta?.["openai/message"]?.send, false, "Map actions only create a draft");
  assert.equal(mapDrafts[0].content[0].text, mapDrafts[1].content[0].text, "The same upstream prompt feeds both targets");
  const mapUrl = map.url ?? repositoryUrl + "/issues/" + map.number;
  assert.ok(mapDrafts[0].content[0].text.startsWith("$wayfinder " + mapUrl), "Map action prompt starts from the map URL: " + mapDrafts[0].content[0].text.slice(0, 80));
  console.log("PASS map-level execute/new-session reuse the original prompt and the send:false draft boundary");

  // --- Board frontier filter ----------------------------------------------
  [...sticky.querySelectorAll("button")].find(button => (button.textContent ?? "").trim() === "返回列表")?.click();
  await until(() => [...window.document.querySelectorAll(".dsws-chip")].some(chip => (chip.textContent ?? "").trim() === "可接"), "frontier filter chip");
  const frontierChip = [...window.document.querySelectorAll(".dsws-chip")].find(chip => (chip.textContent ?? "").trim() === "可接");
  frontierChip.click();
  await until(() => window.document.querySelectorAll('[role="button"][aria-label^="#"]').length > 0, "frontier rows");
  await new Promise(resolve => setTimeout(resolve, 400));
  const rowNumbers = [...window.document.querySelectorAll('[role="button"][aria-label^="#"]')]
    .map(element => Number((element.getAttribute("aria-label") ?? "").slice(1).split(" ")[0]))
    .sort((left, right) => left - right);
  const universe = new Set([map.number, ...children.map(child => child.number)]);
  const mapIsFrontier = issue.state === "OPEN" && issue.assignees?.nodes?.length === 0;
  const expectedBoardFrontier = [...new Set([...(mapIsFrontier ? [map.number] : []), ...expected.frontierSet.map(ticket => ticket.number)])]
    .sort((left, right) => left - right);
  assert.deepEqual(rowNumbers.filter(number => universe.has(number)), expectedBoardFrontier, "The 可接 filter shows exactly the native frontier");
  for (const ticket of expected.blockedSet) assert.ok(!rowNumbers.includes(ticket.number), "#" + ticket.number + " is blocked and must not appear as takeable");
  for (const ticket of expected.frontierSet) assert.ok(rowNumbers.includes(ticket.number), "#" + ticket.number + " is takeable but missing from the filter");
  console.log("PASS the 可接 filter equals the native frontier (" + expectedBoardFrontier.map(number => "#" + number).join(", ") + ")");

  console.log("Map view verified against native GitHub sub-issue and dependency edges.");
  console.log("Native desktop visuals and click targets still belong to #15.");
} catch (error) {
  serverFailure = error;
} finally {
  for (const { timer } of requests.values()) clearTimeout(timer);
  dom?.window.close();
  child.stdin.end();
  child.kill();
  await rm(codexHome, { recursive: true, force: true });
}
if (serverFailure) throw serverFailure;
