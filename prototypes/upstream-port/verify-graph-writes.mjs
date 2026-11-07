import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { createTestCodexHome } from "./test-codex-home.mjs";

// Ticket #24 native graph end-to-end check. A throwaway project fixture points at the
// wozhendeshifwa/codex_mattskills_plugin repository, so every write has to land in
// that repository, not in this checkout's repo. The tools are driven through the
// same MCP server and project-host fan-out the desktop uses; the assertions below
// read the writes back from GitHub itself (gh api / gh label list) instead of
// trusting the adapter's own echo.

const GH = "gh";
const REPO = "wozhendeshifwa/codex_mattskills_plugin";
const threadId = "12121212-1212-4212-8212-121212121212";
const marker = "ticket-24-graph-fixture-" + process.pid;

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

async function makeFixtureProject() {
  const directory = await mkdtemp(path.join(tmpdir(), "mattskills-write-project-"));
  fixtureDirs.push(directory);
  git(["-c", "init.defaultBranch=main", "init"], directory);
  git(["remote", "add", "origin", "https://github.com/" + REPO + ".git"], directory);
  await mkdir(path.join(directory, "docs/agents"), { recursive: true });
  await writeFile(path.join(directory, "docs/agents/issue-tracker.md"),
    "# Issue tracker: GitHub\n\nFixture project for native relationship verification.\n", "utf8");
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
const keys = [];
async function deck(name, args = {}) {
  const result = await rpc("tools/call", { name, arguments: args, _meta: metadata }, 180000);
  assert.ok(!result.isError, JSON.stringify(result));
  return result.structuredContent ?? JSON.parse(result.content[0].text);
}
function rest(suffix) { return ghJson(["api", `repos/${REPO}/issues/${suffix}`]); }
function ok(result) { assert.equal(result.status,"ok",JSON.stringify(result)); return result; }
function fixtures(state="all") {return ghJson(["issue","list","--repo",REPO,"--state",state,"--limit","100","--json","number,title"]).filter(x=>x.title.startsWith(marker));}
try {
  await rpc("initialize", {protocolVersion:"2025-11-25",capabilities:{},clientInfo:{name:"graph-writes-check",version:"1"}});
  ok(await deck("deck_context"));
  const plan=await deck("deck_map_plan_create",{
    title:marker,planId:marker,
    children:[{key:"blocker",title:marker+" blocker"},{key:"dependent",title:marker+" dependent"}],
    edges:[{from:"dependent",to:"blocker",type:"blocked-by"}]
  });
  console.log("PLAN",JSON.stringify(plan));
  ok(plan);
  const all=fixtures();
  keys.push(...all.map(x=>x.number));
  const map=all.find(x=>x.title===marker).number;
  const blocker=all.find(x=>x.title===marker+" blocker").number;
  const dependent=all.find(x=>x.title===marker+" dependent").number;
  assert.deepEqual(rest(`${map}/sub_issues`).map(x=>x.number).sort(),[blocker,dependent].sort());
  assert.deepEqual(rest(`${dependent}/dependencies/blocked_by`).map(x=>x.number),[blocker]);
  console.log("PASS plan creates real native parent and blocked_by edges");
  const before=ok(await deck("deck_map_snapshot",{key:String(map),detail:"thin",frontierOnly:true}));
  assert.ok(before.data.children.some(x=>x.key===String(blocker)));
  assert.ok(!before.data.children.some(x=>x.key===String(dependent)));
  ok(await deck("deck_issue_patch",{key:String(blocker),close:true}));
  const after=ok(await deck("deck_map_snapshot",{key:String(map),detail:"thin",frontierOnly:true}));
  assert.ok(after.data.children.some(x=>x.key===String(dependent)));
  console.log("PASS frontier changes after native blocker closes");
  ok(await deck("deck_issue_create",{title:marker+" extra",parentKey:String(map),idempotencyKey:marker+"-extra"}));
  const extra=fixtures().find(x=>x.title===marker+" extra").number;
  keys.push(extra);
  assert.ok(rest(`${map}/sub_issues`).some(x=>x.number===extra));
  ok(await deck("deck_map_link",{key:String(dependent),parentKey:String(extra),blockedBy:[String(extra)]}));
  assert.ok(rest(`${extra}/sub_issues`).some(x=>x.number===dependent));
  assert.deepEqual(rest(`${dependent}/dependencies/blocked_by`).map(x=>x.number),[extra]);
  ok(await deck("deck_map_link",{key:String(dependent),parentKey:String(extra),blockedBy:[String(extra)]}));
  assert.equal(rest(`${extra}/sub_issues`).filter(x=>x.number===dependent).length,1);
  ok(await deck("deck_map_link",{key:String(dependent),blockedBy:[]}));
  assert.deepEqual(rest(`${dependent}/dependencies/blocked_by`),[]);
  console.log("PASS issue-create parent, map-link reparent/replacement/removal and idempotent retry");
  const failure=await deck("deck_map_link",{key:String(dependent),blockedBy:["99999999"]});
  assert.notEqual(failure.status,"ok");
  assert.deepEqual(rest(`${dependent}/dependencies/blocked_by`),[]);
  console.log("PASS invalid blocker fails honestly without inventing edges");
  const audit=await readFile(path.join(dataRoot,"projects",createHash("sha256").update(projectRoot).digest("hex"),"write-audit.jsonl"),"utf8");
  assert.ok(audit.includes('"method":"deck_map_link"'));
  assert.ok(!audit.includes(marker));
  assert.ok(!audit.includes('issue_id='));
  console.log("PASS hashed relationship audit without title/body/raw argv; fixtures",keys.join(","));
} finally {
  for (const x of fixtures("open")) gh(["issue","close",String(x.number),"--repo",REPO]);
  for (const {timer} of requests.values()) clearTimeout(timer);
  child.stdin.end(); child.kill();
  await new Promise(resolve=>setTimeout(resolve,500));
  for (const dir of fixtureDirs) await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:200}).catch(()=>{});
}
