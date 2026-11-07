import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createOriginalHost } from "./node-host.mjs";
import { classifyReadCommand, createBoundedCollector } from "./read-command.mjs";

// Ticket #20: the version-control read view (gitStatus / gitDiff / gitLog) must
// reach real git through the Codex host. Before this check the read gate only
// looked at the token after "-C", so the upstream host's fixed global-option
// prefix made every read fail with "Command is outside read-only port
// verification" and the panel showed its error page.

const GIT = process.platform === "win32" ? "git.exe" : "git";
const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_DATE: "2020-01-01T00:00:00Z",
  GIT_COMMITTER_DATE: "2020-01-01T00:00:00Z",
};

function git(cwd, ...args) {
  return execFileSync(GIT, args, { cwd, encoding: "utf8", env: GIT_ENV, stdio: ["ignore", "pipe", "pipe"] });
}

const fixtures = [];
async function fixture(prefix) {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  fixtures.push(dir);
  return dir;
}

async function makeRepo(commits = 1) {
  const dir = await fixture("mattskills-vc-repo-");
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.name", "VC Test");
  git(dir, "config", "user.email", "vc@example.test");
  git(dir, "config", "commit.gpgsign", "false");
  await writeFile(path.join(dir, "tracked.txt"), "one\n");
  git(dir, "add", "tracked.txt");
  git(dir, "commit", "-q", "-m", "initial");
  for (let n = 2; n <= commits; n += 1) {
    await writeFile(path.join(dir, "tracked.txt"), "one\n" + n + "\n");
    git(dir, "commit", "-q", "-am", "commit " + n);
  }
  return dir;
}

async function withHost(workspaceRoot, run) {
  const dataRoot = await fixture("mattskills-vc-data-");
  const previous = process.cwd();
  process.chdir(dataRoot);
  const host = await createOriginalHost({ dataRoot, workspaceRoot });
  try {
    return await run(host);
  } finally {
    host.dispose();
    process.chdir(previous);
  }
}

async function call(host, method, payload) {
  const reply = await host.call(method, payload);
  return reply && typeof reply === "object" && "value" in reply ? reply.value : reply;
}

async function gitState(dir) {
  const gitDir = path.join(dir, ".git");
  const index = await readFile(path.join(gitDir, "index")).then(bytes => createHash("sha256").update(bytes).digest("hex"));
  return { index, entries: (await readdir(gitDir)).sort() };
}

function normalize(p) {
  return String(p).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function checkGate() {
  const prefix = [
    "git", "-C", "C:/repo", "--no-optional-locks", "--literal-pathspecs",
    "-c", "push.followTags=false", "-c", "push.default=nothing", "-c", "core.quotepath=false",
    "-c", "color.ui=false", "-c", "i18n.logOutputEncoding=UTF-8",
  ];
  const allowed = [
    ["status", "--porcelain=v2", "--branch", "-z"],
    ["for-each-ref", "--format=%(refname)", "refs/heads/"],
    ["log", "--no-decorate", "-n", "50"],
    ["rev-parse", "--absolute-git-dir"],
    ["rev-list", "--parents", "-n", "1", "HEAD"],
    ["reflog", "show", "--date=iso-strict", "--format=%gD", "-1", "origin/main"],
    ["show", "--numstat", "-z", "HEAD"],
    ["diff", "--numstat", "-z", "HEAD"],
    ["worktree", "list", "--porcelain"],
    ["config", "--get", "core.autocrlf"],
    ["--version"],
  ];
  for (const args of allowed) {
    assert.equal(classifyReadCommand(prefix.concat(args)), true, "read gate must allow git " + args.join(" "));
  }
  const denied = [
    ["add", "--", "tracked.txt"],
    ["reset", "HEAD", "--", "tracked.txt"],
    ["commit", "-m", "x"],
    ["push", "origin", "main"],
    ["pull", "--ff-only"],
    ["fetch"],
    ["diff", "--output=C:/tmp/half.patch"],
    ["diff", "--ext-diff"],
    ["show", "-O", "pager"],
  ];
  for (const args of denied) {
    assert.equal(classifyReadCommand(prefix.concat(args)), false, "read gate must refuse git " + args.join(" "));
  }
  assert.equal(classifyReadCommand(["git", "-C", "C:/repo", "-c", "core.pager=calc.exe", "log"]), false, "unknown -c key refused");
  assert.equal(classifyReadCommand(["git", "--exec-path=C:/tmp", "log"]), false, "unknown global option refused");
  assert.equal(classifyReadCommand(["gh", "issue", "create", "--title", "x"]), false, "write gh refused");
  assert.equal(classifyReadCommand(["gh", "api", "-X", "POST", "repos/x/y/issues"]), false, "POST gh api refused");
  assert.equal(classifyReadCommand(["gh", "api", "graphql", "-f", "query=mutation{addStar(input:{})}"]), false, "graphql mutation refused");
  assert.equal(classifyReadCommand(["gh", "issue", "view", "20"]), true, "read gh allowed");
  console.log("PASS read gate parses the upstream git prefix and still refuses writes");
}

function checkCollector() {
  const small = createBoundedCollector(8);
  small.push(Buffer.from("abc"));
  small.push(Buffer.from("de"));
  assert.deepEqual(small.finalize(), { text: "abcde", truncated: false });
  const lossy = createBoundedCollector(8);
  lossy.push(Buffer.from("0123456789"));
  assert.equal(lossy.lossy, true);
  assert.deepEqual(lossy.finalize(), { text: "23456789", truncated: true });
  assert.deepEqual(lossy.readFrom(0), { text: "23456789", lossy: true });
  console.log("PASS bounded collector reports dropped bytes instead of hiding them");
}

async function checkDirtyRepo() {
  const dir = await makeRepo(3);
  await writeFile(path.join(dir, "tracked.txt"), "one\ntwo changed\n");
  await writeFile(path.join(dir, "untracked.txt"), "new file\n");
  await writeFile(path.join(dir, "staged.txt"), "staged\n");
  git(dir, "add", "staged.txt");
  const before = await gitState(dir);
  const trackedBefore = await readFile(path.join(dir, "tracked.txt"), "utf8");

  await withHost(dir, async host => {
    const status = await call(host, "gitStatus");
    assert.equal(status.ok, true, "gitStatus must succeed: " + JSON.stringify(status.error));
    const screen = status.screen;
    assert.ok(Array.isArray(screen.commits) && screen.commits.length > 0, "first screen carries recent commits");
    const stagedPaths = screen.staged.map(file => file.path);
    const unstagedPaths = screen.unstaged.map(file => file.path);
    assert.ok(stagedPaths.includes("staged.txt"), "staged file is listed");
    assert.ok(unstagedPaths.includes("tracked.txt"), "modified file is listed");
    assert.ok(unstagedPaths.includes("untracked.txt"), "untracked file is listed");

    const diff = await call(host, "gitDiff", { path: "tracked.txt" });
    assert.equal(diff.ok, true, "gitDiff must succeed: " + JSON.stringify(diff.error));
    assert.equal(diff.reason, "ok");
    assert.ok(diff.lines.length > 0, "modified file has a patch");

    const untrackedDiff = await call(host, "gitDiff", { path: "untracked.txt", untracked: true });
    assert.equal(untrackedDiff.ok, true);
    assert.equal(untrackedDiff.reason, "untracked-no-diff");

    const firstBatch = await call(host, "gitLog", { count: 2 });
    assert.equal(firstBatch.ok, true);
    assert.equal(firstBatch.commits.length, 2);
    assert.equal(firstBatch.hasMore, true);
    const secondBatch = await call(host, "gitLog", { count: 2, skip: 2 });
    assert.equal(secondBatch.ok, true);
    assert.equal(secondBatch.commits.length, 1);
    assert.equal(secondBatch.hasMore, false);

    const commitDiff = await call(host, "gitDiff", { rev: firstBatch.commits[0].oid });
    assert.equal(commitDiff.ok, true, "commit diff must succeed: " + JSON.stringify(commitDiff.error));
    assert.ok(Array.isArray(commitDiff.files) && commitDiff.files.length > 0, "commit diff lists changed files");

    // The host pins every read to the project cwd it started with; a payload cwd
    // from the panel must not redirect the read to another directory.
    const pinned = await call(host, "gitStatus", { cwd: path.join(dir, "..") });
    assert.equal(pinned.ok, true);
    assert.equal(normalize(pinned.screen.identity.worktreePath), normalize(await realpath(dir)), "reads stay on the project cwd");

    await assert.rejects(
      () => host.call("gitStage", { paths: ["tracked.txt"] }),
      /write and is not enabled/,
      "write endpoints stay blocked",
    );
  });

  const after = await gitState(dir);
  assert.deepEqual(after, before, "read-only paths must not touch the index or .git");
  assert.equal(await readFile(path.join(dir, "tracked.txt"), "utf8"), trackedBefore, "read-only paths must not touch working files");
  console.log("PASS dirty repo: file list, patch, commit history, paging, commit diff; no index write");
}

async function checkCleanRepo() {
  const dir = await makeRepo(2);
  await withHost(dir, async host => {
    const status = await call(host, "gitStatus");
    assert.equal(status.ok, true, "clean gitStatus must succeed: " + JSON.stringify(status.error));
    assert.equal(status.screen.stagedCount, 0, "clean repo has no staged entries");
    assert.equal(status.screen.unstagedCount, 0, "clean repo has no unstaged entries");
    assert.equal(status.screen.commits.length, 2, "clean repo still lists commits");
  });
  console.log("PASS clean repo: explicit empty state with commit history");
}

async function checkNotRepo() {
  const dir = await fixture("mattskills-vc-plain-");
  await writeFile(path.join(dir, "readme.txt"), "not a repository\n");
  await withHost(dir, async host => {
    const status = await call(host, "gitStatus");
    assert.equal(status.ok, false, "non-git directory must fail explicitly");
    assert.equal(status.error.kind, "not-repo", "non-git directory reports not-repo: " + JSON.stringify(status.error));
    assert.ok(status.error.message.trim().length > 0, "non-git directory has a readable message");
  });
  console.log("PASS non-git directory: readable not-repo envelope");
}

async function checkLargeDiff() {
  const dir = await makeRepo(1);
  const line = "x".repeat(96);
  const lines = 42000;
  const original = Array.from({ length: lines }, () => line).join("\n") + "\n";
  await writeFile(path.join(dir, "big.txt"), original);
  git(dir, "add", "big.txt");
  git(dir, "commit", "-q", "-m", "big file");
  await writeFile(path.join(dir, "big.txt"), Array.from({ length: lines }, (_, i) => line.slice(0, 90) + String(i % 1000).padStart(3, "0") + "y").join("\n") + "\n");
  await withHost(dir, async host => {
    const diff = await call(host, "gitDiff", { path: "big.txt" });
    assert.equal(diff.ok, true, "truncated patch is still a valid envelope: " + JSON.stringify(diff.error));
    assert.equal(diff.truncated, true, "patch beyond the byte ceiling reports truncated");
    assert.equal(diff.reason, "truncated");
    assert.deepEqual(diff.lines, [], "half a patch is never returned");
  });
  console.log("PASS large patch: truncation reported, no half patch");
}

try {
  checkGate();
  checkCollector();
  await checkDirtyRepo();
  await checkCleanRepo();
  await checkNotRepo();
  await checkLargeDiff();
  console.log("PASS version-control read view reaches real git through the Codex host");
} finally {
  for (const dir of fixtures) await rm(dir, { recursive: true, force: true }).catch(() => {});
}