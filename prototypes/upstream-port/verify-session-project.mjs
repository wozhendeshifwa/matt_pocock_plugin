import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createSessionProjectResolver } from "./session-project.mjs";
import { createTestCodexHome } from "./test-codex-home.mjs";

const MOVED = "01a1b107-afb9-7882-8180-32322734bdc5";
const TEMP = "01a1b1d5-5e8b-7c2d-9f3a-111111111111";
const base = await mkdtemp(path.join(tmpdir(), "mattskills-resolver-"));
const cleanup = [];
const project = async (name) => {
  const directory = path.join(base, name);
  await mkdir(directory, { recursive: true });
  return directory;
};
const resolverFor = home => createSessionProjectResolver({ codexHome: home });
async function homeFor(options) {
  const home = await createTestCodexHome({ prefix: "mattskills-resolver-home-", ...options });
  cleanup.push(home.home);
  return home;
}
function updateThread(dbPath, id, cwd) {
  const database = new DatabaseSync(dbPath);
  database.prepare("UPDATE threads SET cwd = ? WHERE id = ?").run(cwd, id);
  database.close();
}

async function test(name, fn) {
  try {
    await fn();
    console.log("PASS " + name);
  } catch (error) {
    console.error("FAIL " + name + "\n" + (error?.stack ?? error));
    process.exitCode = 1;
  }
}

try {
  const rootA = await project("project-a");
  const rootB = await project("project-b");
  const taskDir = await project("task/new-chat");
  const dufu = await project("dufu");
  const dufuTemp = await project("dufu/temp");
  const dufuSub = await project("dufu/temp/sub");

  await test("moved session uses state_5 cwd and reports the stale rollout instead of returning the old project", async () => {
    const home = await homeFor({
      threads: [{ id: MOVED, cwd: taskDir }],
      projectRoots: [rootA],
      rollouts: [{ id: MOVED, cwd: rootA }],
    });
    const result = await resolverFor(home.home)({ thread_id: MOVED, threadId: MOVED });
    assert.equal(result.cwd.toLowerCase(), taskDir.toLowerCase());
    assert.equal(result.source, "state_5");
    assert.equal(result.projectRoot, null);
    assert.equal(result.associated, false);
    assert.equal(result.sourceConflict, true);
  });

  await test("state_5 beats a rollout that still points at another project", async () => {
    const home = await homeFor({
      threads: [{ id: MOVED, cwd: rootA }],
      projectRoots: [rootA, rootB],
      rollouts: [{ id: MOVED, cwd: rootB }],
    });
    const result = await resolverFor(home.home)({ threadId: MOVED });
    assert.equal(result.cwd.toLowerCase(), rootA.toLowerCase());
    assert.equal(result.projectRoot.toLowerCase(), rootA.toLowerCase());
    assert.equal(result.sourceConflict, true);
  });

  await test("state_5 cwd that is a subdirectory maps to the nearest project root", async () => {
    const home = await homeFor({
      threads: [{ id: MOVED, cwd: dufuSub }],
      projectRoots: [dufu, dufuTemp],
      rollouts: [{ id: MOVED, cwd: dufuSub }],
    });
    const result = await resolverFor(home.home)({ threadId: MOVED });
    assert.equal(result.projectRoot.toLowerCase(), dufuTemp.toLowerCase());
    assert.equal(result.cwd.toLowerCase(), dufuSub.toLowerCase());
  });

  await test("nested project roots do not use naive prefix containment", async () => {
    const home = await homeFor({
      threads: [{ id: MOVED, cwd: dufuSub }],
      projectRoots: [dufu, dufuTemp],
    });
    const result = await resolverFor(home.home)({ threadId: MOVED });
    assert.equal(result.projectRoot.toLowerCase(), dufuTemp.toLowerCase());
  });

  await test("archived .jsonl rollout resolves when state_5 has no row", async () => {
    const home = await homeFor({
      threads: [],
      projectRoots: [rootA],
      rollouts: [{ id: MOVED, cwd: rootA, dir: "archived_sessions" }],
    });
    const result = await resolverFor(home.home)({ threadId: MOVED });
    assert.equal(result.cwd.toLowerCase(), rootA.toLowerCase());
    assert.equal(result.projectRoot.toLowerCase(), rootA.toLowerCase());
    assert.equal(result.source, "rollout");
  });

  await test("archived .jsonl.zst rollout resolves when state_5 has no row", async () => {
    const home = await homeFor({
      threads: [],
      projectRoots: [rootA],
      rollouts: [{ id: MOVED, cwd: rootA, dir: "archived_sessions", zst: true }],
    });
    const result = await resolverFor(home.home)({ threadId: MOVED });
    assert.equal(result.cwd.toLowerCase(), rootA.toLowerCase());
    assert.equal(result.source, "rollout");
  });

  await test("state row whose rollout_path is .jsonl but only .jsonl.zst exists still resolves", async () => {
    const home = await homeFor({
      threads: [{ id: MOVED, cwd: null }],
      projectRoots: [rootA],
      rollouts: [{ id: MOVED, cwd: rootA, zst: true }],
    });
    const database = new DatabaseSync(home.dbPath);
    const row = database.prepare("SELECT rollout_path FROM threads WHERE id = ?").get(MOVED);
    database.prepare("UPDATE threads SET rollout_path = ? WHERE id = ?").run(row.rollout_path.replace(/\.zst$/i, ""), MOVED);
    database.close();
    const result = await resolverFor(home.home)({ threadId: MOVED });
    assert.equal(result.cwd.toLowerCase(), rootA.toLowerCase());
    assert.equal(result.source, "rollout");
  });

  await test("unpersisted/ephemeral chat fails closed", async () => {
    const home = await homeFor({ threads: [], projectRoots: [rootA], rollouts: [] });
    await assert.rejects(resolverFor(home.home)({ threadId: TEMP }), /无法从当前聊天的会话记录确定唯一项目目录/);
  });

  await test("two rollout files with different cwds fail closed as ambiguous", async () => {
    const home = await homeFor({
      threads: [],
      projectRoots: [rootA, rootB],
      rollouts: [
        { id: MOVED, cwd: rootA },
        { id: MOVED, cwd: rootB, dir: "archived_sessions" },
      ],
    });
    await assert.rejects(resolverFor(home.home)({ threadId: MOVED }), /指向多个不同的项目目录/);
  });

  await test("missing, malformed, and inconsistent thread identities fail closed", async () => {
    const home = await homeFor({ threads: [], projectRoots: [rootA], rollouts: [] });
    const resolver = resolverFor(home.home);
    await assert.rejects(resolver({}), /没有可验证的聊天身份/);
    await assert.rejects(resolver({ threadId: "not-a-uuid" }), /没有可验证的聊天身份/);
    await assert.rejects(resolver({ threadId: MOVED, thread_id: TEMP }), /不一致的聊天身份/);
  });

  await test("cwd outside every project root resolves but is not associated", async () => {
    const home = await homeFor({
      threads: [{ id: MOVED, cwd: taskDir }],
      projectRoots: [rootA, rootB],
      rollouts: [{ id: MOVED, cwd: taskDir }],
    });
    const result = await resolverFor(home.home)({ threadId: MOVED });
    assert.equal(result.cwd.toLowerCase(), taskDir.toLowerCase());
    assert.equal(result.projectRoot, null);
    assert.equal(result.associated, false);
  });

  await test("a deleted cwd fails closed", async () => {
    const missing = path.join(base, "deleted-project");
    const home = await homeFor({
      threads: [{ id: MOVED, cwd: missing }],
      projectRoots: [rootA],
    });
    await assert.rejects(resolverFor(home.home)({ threadId: MOVED }), /项目目录不存在或不可访问/);
  });

  await test("a changed state_5 row invalidates the cached resolution", async () => {
    const home = await homeFor({
      threads: [{ id: MOVED, cwd: rootA }],
      projectRoots: [rootA, rootB],
      rollouts: [{ id: MOVED, cwd: rootA }],
    });
    const resolver = resolverFor(home.home);
    const first = await resolver({ threadId: MOVED });
    assert.equal(first.projectRoot.toLowerCase(), rootA.toLowerCase());
    updateThread(home.dbPath, MOVED, rootB);
    const second = await resolver({ threadId: MOVED });
    assert.equal(second.cwd.toLowerCase(), rootB.toLowerCase());
    assert.equal(second.projectRoot.toLowerCase(), rootB.toLowerCase());
  });

  await test("local-projects.rootPaths is used when state_5 has no project_roots rows", async () => {
    const home = await homeFor({
      threads: [{ id: MOVED, cwd: rootA }],
      projectRoots: [],
    });
    await writeFile(path.join(home.home, ".codex-global-state.json"), JSON.stringify({
      "local-projects": { "legacy-project": { rootPaths: [rootA] } },
    }));
    const result = await resolverFor(home.home)({ threadId: MOVED });
    assert.equal(result.projectRoot.toLowerCase(), rootA.toLowerCase());
    assert.equal(result.projectId, "legacy-project");
  });
} finally {
  for (const home of cleanup) await rm(home, { recursive: true, force: true }).catch(() => {});
  await rm(base, { recursive: true, force: true }).catch(() => {});
}

if (!process.exitCode) console.log("PASS resolver covers state_5 priority, rollout/zstd fallback, project roots, fail-closed identity, and caching");
