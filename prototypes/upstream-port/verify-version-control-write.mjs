import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createOriginalHost } from "./node-host.mjs";
import { classifyGitWriteCommand } from "./git-write-gate.mjs";
import { fixedPrefix } from "../../vendor/mattskills-1.8.0-rc.7/shared/version-control/commands.js";
import { verifyGitWriteUi } from "./verify-git-write-ui.mjs";

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim();
const root = await realpath(await mkdtemp(path.join(tmpdir(), "deck-git-write-")));
console.log("Fixture: " + root);
const project = path.join(root, "project"), data = path.join(root, "data"), remote = path.join(root, "remote.git");
const { mkdir } = await import("node:fs/promises");
await Promise.all([project, data].map(p => mkdir(p)));
git(root, "init", "--bare", remote);
git(project, "init", "-b", "test-write");
git(project, "config", "user.name", "Write Fixture");
git(project, "config", "user.email", "fixture@example.test");
git(project, "config", "commit.gpgsign", "false");
await writeFile(path.join(project, "one.txt"), "initial\n");
git(project, "add", "."); git(project, "commit", "-m", "seed");
const originalCwd = process.cwd();
process.chdir(data);
const host = await createOriginalHost({ dataRoot: data, workspaceRoot: project });
async function call(method, payload = {}) {
  const r = await host.call(method, payload);
  return r?.value ?? r;
}
let id = 0;
async function checked(op, payload = {}) {
  const check = await call("gitWriteCheck", { op, ...payload });
  assert.equal(check.ok, true, JSON.stringify(check));
  const result = await call("git" + op[0].toUpperCase() + op.slice(1), { ...payload, ticketId: check.ticket.id, requestId: "fixture-write-" + ++id });
  return { result, check };
}
try {
  const prefix = ["git", "-C", project, ...fixedPrefix()];
  const classify = (method, args) => classifyGitWriteCommand(prefix.concat(args), { method, cwd: project, workspaceRoot: project });
  for (const [method, args] of [
    ["gitPush", ["push", "--force", "origin", "main:main"]],
    ["gitPush", ["push", "--no-follow-tags", "origin", "+main:main"]],
    ["gitPush", ["push", "--no-follow-tags", "origin", ":main"]],
    ["gitStage", ["add", "--", "../outside"]],
    ["gitStage", ["add", "--", "C:/outside"]],
    ["gitUnstage", ["reset", "--hard"]],
    ["gitPull", ["pull", "--rebase"]],
    ["gitFetch", ["fetch", "--all"]],
    ["gitCommit", ["-c", "core.hooksPath=evil", "commit", "-m", "x"]],
  ]) assert.equal(classify(method, args), null, method + " " + args);
  console.log("PASS force/delete push, traversal, reset hard and injected options denied");

  await writeFile(path.join(project, "literal[1].txt"), "new\n");
  await writeFile(path.join(project, "literal1.txt"), "untouched\n");
  const staged = await call("gitStage", { paths: ["literal[1].txt"] });
  assert.equal(staged.ok, true, JSON.stringify(staged));
  assert.equal(git(project, "diff", "--cached", "--name-only"), "literal[1].txt");
  assert.equal((await call("gitUnstage", { paths: ["literal[1].txt"] })).ok, true);
  assert.equal(git(project, "diff", "--cached", "--name-only"), "");
  await call("gitStage", { paths: ["literal[1].txt"] });
  const invalid = await call("gitCommit", { message: "must not commit", ticketId: "not-a-ticket", requestId: "invalid-request-1" });
  assert.equal(invalid.ok, false);
  const { result: committed, check } = await checked("commit", { message: "adapter commit\n\nliteral text $(does-not-run)" });
  assert.equal(committed.ok, true, JSON.stringify(committed));
  assert.equal(git(project, "log", "-1", "--format=%s"), "adapter commit");
  const beforeReplay = git(project, "rev-parse", "HEAD");
  const replay = await call("gitCommit", { message: "different", ticketId: check.ticket.id, requestId: "fixture-write-1" });
  assert.deepEqual(replay, committed);
  assert.equal(git(project, "rev-parse", "HEAD"), beforeReplay);
  console.log("PASS literal stage/unstage, commit ticket and replay protection");

  await call("gitStage", { paths: ["literal1.txt"] });
  const stale = await call("gitWriteCheck", { op: "commit", message: "stale" });
  await writeFile(path.join(project, "one.txt"), "changed index\n");
  await call("gitStage", { paths: ["one.txt"] });
  const staleResult = await call("gitCommit", { message: "stale", ticketId: stale.ticket.id, requestId: "stale-request-1" });
  assert.equal(staleResult.ok, false); assert.equal(git(project, "rev-parse", "HEAD"), beforeReplay);
  assert.equal((await checked("commit", { message: "second adapter commit" })).result.ok, true);
  const noRemote = await call("gitWriteCheck", { op: "push" });
  assert.equal(noRemote.ok, false); assert.match(JSON.stringify(noRemote), /remote/);
  git(project, "remote", "add", "origin", remote);
  const beforeConfig = await readFile(path.join(project, ".git/config"), "utf8");
  const pushed = await checked("push");
  assert.equal(pushed.result.ok, true, JSON.stringify(pushed));
  assert.equal(git(root, "--git-dir", remote, "rev-parse", "refs/heads/test-write"), git(project, "rev-parse", "HEAD"));
  const backups = await readdir(path.join(data, "git-config-backups"));
  assert.ok(backups.length > 0);
  assert.equal(await readFile(path.join(data, "git-config-backups", backups[0]), "utf8"), beforeConfig);
  assert.equal((await checked("fetch")).result.ok, true);
  assert.equal((await checked("pull")).result.ok, true);
  console.log("PASS stale index denied, missing remote readable, first push/fetch/pull and recoverable config backup");
  await verifyGitWriteUi({ host, project, git, remote });

  const peer = path.join(root, "peer");
  git(root, "clone", "-b", "test-write", remote, peer);
  git(peer, "config", "user.name", "Peer"); git(peer, "config", "user.email", "peer@example.test");
  git(peer, "config", "commit.gpgsign", "false");
  await writeFile(path.join(peer, "peer.txt"), "remote\n");
  git(peer, "add", "."); git(peer, "commit", "-m", "peer"); git(peer, "push");
  await writeFile(path.join(project, "local.txt"), "local\n");
  await call("gitStage", { paths: ["local.txt"] });
  assert.equal((await checked("commit", { message: "local diverges" })).result.ok, true);
  const divergedHead = git(project, "rev-parse", "HEAD");
  const pull = await checked("pull");
  assert.equal(pull.result.ok, false); assert.match(JSON.stringify(pull.result), /ff|diverg|fast|快进/i);
  assert.equal(git(project, "rev-parse", "HEAD"), divergedHead);
  const push = await call("gitWriteCheck", { op: "push" });
  assert.equal(push.ok, false); assert.match(JSON.stringify(push), /behind-remote/);
  assert.equal(git(root, "--git-dir", remote, "rev-parse", "refs/heads/test-write"), git(peer, "rev-parse", "HEAD"));
  console.log("PASS divergent pull and rejected push preserve local/remote HEAD");

  const audit = await readFile(path.join(data, "write-audit.jsonl"), "utf8");
  assert.match(audit, /"method":"gitPush"/);
  assert.ok(!audit.includes("adapter commit") && !audit.includes(project) && !audit.includes("$(does-not-run)"));
  console.log("PASS endpoint and command audit excludes raw messages/paths");
} finally {
  host.dispose(); process.chdir(originalCwd);
}
console.log("PASS version-control write integration (local bare remote; no GitHub repository created)");
