import assert from "node:assert/strict";
import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createPublishFlow } from "../../vendor/mattskills-1.8.0-rc.7/lib/publishFlow.js";
import { classifyGitWriteCommand, safeRepoUrl } from "./git-write-gate.mjs";
import { classifyReadCommand } from "./read-command.mjs";

// Exercise vendor publication with real local git and an explicit fake GitHub
// transport. No online repository is created; do not call this GitHub E2E.
const root = await mkdtemp(path.join(tmpdir(), "deck-publish-flow-"));
const project = path.join(root, "project"), remote = path.join(root, "remote.git");
await mkdir(project);
const run = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.test", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.test", GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "commit.gpgsign", GIT_CONFIG_VALUE_0: "false" } }).trim();
run(root, ["init", "--bare", remote]);
await writeFile(path.join(project, "seed.txt"), "publish fixture\n");
let method = "initPublish", pushes = 0, creates = 0;
const events = [];
const flow = createPublishFlow({
  DEFAULT_CWD: project, resolveGit: async () => "git", resolveGh: async () => "gh", getGhLastError: () => "",
  async execProc(argv, cwd) {
    const write = classifyGitWriteCommand(argv, { method, cwd, workspaceRoot: project });
    assert.ok(write || classifyReadCommand(argv), "unexpected publication argv: " + argv.join(" "));
    events.push(argv.slice(1));
    if (argv[1] === "push") {
      pushes++;
      if (pushes === 1) return { ok: false, error: "fatal: connection refused" };
    }
    try { return { ok: true, text: run(cwd, argv.slice(1)) }; }
    catch (error) { return { ok: false, error: String(error.stderr || error.message) }; }
  },
  async runGh(args, cwd) {
    if (args[0] === "auth") return { ok: true, text: "authenticated fake transport" };
    if (args[0] === "api") return { ok: true, text: "fixture-owner" };
    assert.ok(classifyGitWriteCommand(["gh", ...args], { method, cwd, workspaceRoot: project }));
    creates++;
    run(cwd, ["remote", "add", "origin", remote]);
    return { ok: false, text: "https://github.com/fixture-owner/fixture-publish", error: "network connection refused", kind: "network" };
  },
  canonicalKey: async cwd => cwd, getRepoKey: async () => ({ owner: "fixture-owner", name: "fixture-publish" }),
  repoKeys: {}, repoRoots: {}, setCache() {},
});
const bad = await flow.handleInitPublish({ name: "" });
assert.equal(bad.ok, false);
assert.equal(events.length, 0);
const half = await flow.handleInitPublish({ name: "fixture-publish", visibility: "private" });
assert.equal(half.ok, false); assert.equal(half.halfCreated, true); assert.ok(safeRepoUrl(half.repoUrl));
assert.equal(run(project, ["log", "-1", "--format=%s"]), "initial commit");
method = "retryPush";
const failed = await flow.handleRetryPush({ name: "fixture-publish", owner: "fixture-owner", repoUrl: half.repoUrl });
assert.equal(failed.ok, false); assert.equal(failed.halfCreated, true);
const retry = await flow.handleRetryPush({ name: "fixture-publish", owner: "fixture-owner", repoUrl: half.repoUrl });
assert.equal(retry.ok, true);
assert.equal(creates, 1, "retry must never recreate a repository");
assert.equal(run(root, ["--git-dir", remote, "rev-parse", "HEAD"]), run(project, ["rev-parse", "HEAD"]));
assert.equal(classifyGitWriteCommand(["git", "config", "--global", "--add", "safe.directory", project], { method: "initPublish", cwd: project, workspaceRoot: project }), null);
assert.equal(safeRepoUrl("https://token@github.com/owner/repo"), false);
console.log("PASS vendor publish -> half-created -> failed retry -> successful retry; real git + fake GitHub transport; no duplicate create");
