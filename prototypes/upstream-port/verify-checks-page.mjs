import assert from "node:assert/strict";
import { fork, execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveExecutable } from "./executables.mjs";

// Exercise the unchanged upstream checks through the production project worker.
// Credentials/configuration are overridden only in child environments.
const root = fileURLToPath(new URL("../../", import.meta.url));
const temporary = await mkdtemp(path.join(os.tmpdir(), "deck-checks-"));
const children = [];
let sequence = 0;
async function worker(name, workspace, environment = {}) {
  const data = path.join(temporary, name);
  await mkdir(data, { recursive: true });
  const child = fork(new URL("project-worker.mjs", import.meta.url), [workspace], {
    cwd: data, env: { ...process.env, ...environment }, execArgv: [],
    windowsHide: true, stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  children.push(child);
  child.stderr.resume();
  return (method, payload = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { child.off("message", receive); reject(new Error(name + ": timeout " + method)); }, 55000);
    function receive(reply) {
      if (reply.id !== id) return;
      clearTimeout(timer); child.off("message", receive);
      if (reply.error) reject(new Error(reply.error)); else resolve(reply.result?.value ?? reply.result);
    }
    child.on("message", receive);
    child.send({ id, method, payload: { cwd: workspace, ...payload } });
  });
}
try {
  const healthy = await worker("healthy", root);
  const chain = await healthy("chain", { force: true, trigger: "user-recheck", backendId: "github" });
  assert.equal(chain.ok, true);
  assert.equal(chain.fullSnapshot.chainState, "allDone", "healthy real environment must pass all checks");
  assert.equal(chain.fullSnapshot.doneCount, 10);
  console.log("PASS real environment 10/10 (gh, auth, repository, skills)");
  const detect = await healthy("detect", { force: true });
  assert.equal(detect.selection.backendId, "github");

  const noLogin = await worker("no-login", root, {
    GH_CONFIG_DIR: path.join(temporary, "empty-gh"), GH_TOKEN: "", GITHUB_TOKEN: "",
  });
  const failed = await noLogin("chain", { force: true, trigger: "user-recheck", backendId: "github" });
  const login = failed.fullSnapshot.steps.find(step => step.id === "gh:authed");
  assert.notEqual(login.status, "done");
  assert.ok(login.show.desc);
  assert.ok(login.actions.some(action => action.type === "inject-prompt" && /gh auth login/.test(action.prompt)));
  assert.notEqual(failed.fullSnapshot.chainState, "allDone");
  console.log("PASS isolated empty gh config exposes login failure and login guide");

  const workspace = path.join(temporary, "wrong-repo");
  await mkdir(path.join(workspace, "docs", "agents"), { recursive: true });
  await writeFile(path.join(workspace, "docs", "agents", "issue-tracker.md"),
    "# Issue tracker: GitHub\n\nhttps://github.com/wozhendeshifwa/deck-check-nonexistent-repository-20261107\n");
  const git = await resolveExecutable("git");
  execFileSync(git, ["init", workspace], { windowsHide: true, stdio: "ignore" });
  execFileSync(git, ["-C", workspace, "remote", "add", "origin", "https://github.com/wozhendeshifwa/deck-check-nonexistent-repository-20261107.git"], { windowsHide: true });
  const wrongRepo = await worker("wrong-repo-data", workspace);
  const wrong = await wrongRepo("chain", { force: true, trigger: "user-recheck", backendId: "github" });
  assert.equal(wrong.backendChain.resolved["gh:remote"].status, "pass");
  assert.equal(wrong.backendChain.resolved["gh:repoAccess"].status, "fail");
  const repoFailure = wrong.fullSnapshot.steps.find(step => step.id === "gh:repoAccess");
  assert.ok(repoFailure.show.desc);
  assert.ok(repoFailure.actions.length > 0);
  assert.notEqual(wrong.fullSnapshot.chainState, "allDone");
  console.log("PASS nonexistent remote reports repository access failure with repair actions");

  const offline = await worker("offline", root, { HTTPS_PROXY: "http://127.0.0.1:1", HTTP_PROXY: "http://127.0.0.1:1", NO_PROXY: "" });
  const waiting = await offline("chain", { force: true, trigger: "user-recheck", backendId: "github" });
  const access = waiting.fullSnapshot.steps.find(step => step.id === "gh:repoAccess");
  assert.equal(access.status, "pending", "transport failure is unknown, never repaired");
  assert.deepEqual(access.actions, []);
  assert.ok(access.show.desc);
  const recheck = await offline("chain", { force: true, trigger: "user-recheck", backendId: "github" });
  assert.equal(recheck.fullSnapshot.steps.find(step => step.id === "gh:repoAccess").status, "pending");
  const unchanged = await healthy("chain", { force: true, trigger: "user-recheck", backendId: "github" });
  assert.equal(unchanged.fullSnapshot.chainState, "allDone", "other project worker cannot poison the healthy cache");
  console.log("PASS network error and recheck stay pending; project worker caches remain isolated");
} finally {
  await Promise.all(children.map(child => new Promise(resolve => { child.once("exit", resolve); child.kill(); })));
  await rm(temporary, { recursive: true, force: true });
}
