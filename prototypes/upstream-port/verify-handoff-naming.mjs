import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createOriginalHost } from "./node-host.mjs";
import { createSessionStore } from "./session-store.mjs";
import { registerHooks } from "node:module";
import { createTestCodexHome } from "./test-codex-home.mjs";
import { createManualNaming } from "./manual-naming.mjs";

// Real filesystem + original backend. Fixtures remain available under temp for
// inspection; no user handoff documents or session records are modified.
const root = await mkdtemp(path.join(tmpdir(), "deck-handoff-"));
const project = path.join(root, "project");
const other = path.join(root, "other");
const data = path.join(root, "data");
for (const dir of [project, other, data]) await mkdir(dir);
const before = process.cwd();
const previousHome = process.env.CODEX_HOME;
const sessionId = "77777777-7777-4777-8777-777777777777";
const foreignSessionId = "88888888-8888-4888-8888-888888888888";
const { home } = await createTestCodexHome({ threads: [
  { id: sessionId, cwd: project, title: "恢复接手与命名流程" },
  { id: foreignSessionId, cwd: other, title: "Other project" },
] });
process.env.CODEX_HOME = home;
process.chdir(data);
const oldState = path.join(data, ".dsh-mattskillsdeck-cache/naming-guardian.json");
await mkdir(path.dirname(oldState), { recursive: true });
await writeFile(oldState, JSON.stringify({ version: 1, sessions: { old: { sessionId: "old", repoKey: "owner/repo", stage: "placeholder" } }, indexes: {} }));
const oldContent = await readFile(oldState, "utf8");
let guardianLoaded = false;
const observer = registerHooks({ load(url, context, nextLoad) {
  if (url.endsWith("/vendor/mattskills-1.8.0-rc.7/lib/namingGuardian.js")) guardianLoaded = true;
  return nextLoad(url, context);
} });
const host = await createOriginalHost({ dataRoot: data, workspaceRoot: project });
try {
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(guardianLoaded, false, "Disabled watcher must not load the original guardian, including startup/old-cache paths");
  assert.equal(await readFile(oldState, "utf8"), oldContent, "Old watcher cache stays untouched");
  const call = async (method, args) => (await host.call(method, args)).value;
  assert.equal((await call("handoffLatest")).file, null);
  for (const dir of [project, other]) await mkdir(path.join(dir, ".scratch/handoff"), { recursive: true });
  const old = "20261107-100000-000-old.md";
  const latest = "20261107-110000-000-current.md";
  for (const file of [old, latest]) await writeFile(path.join(project, ".scratch/handoff", file), "# Handoff fixture\n");
  await utimes(path.join(project, ".scratch/handoff", old), new Date(1000), new Date(1000));
  await writeFile(path.join(other, ".scratch/handoff", "other-project.md"), "Other project\n");
  assert.equal((await call("handoffLatest", { cwd: other })).file, latest, "payload cannot change project");
  assert.equal((await call("handoffResolve", { name: old })).file, old);
  assert.equal((await call("handoffResolve", { name: "20261107-110000*" })).file, latest);
  assert.equal((await call("handoffResolve", { name: "missing.md" })).file, null, "never substitute old document");
  const plan = await call("namingPlan");
  assert.equal(plan.enabled, false);
  assert.deepEqual(plan.orders, []);
  assert.equal((await call("awaitCreatedIssue")).watching, false);
  for (const method of ["namingRegister", "registerNewSessionWatcher", "namingSignal", "namingResult"]) {
    const result = await call(method, { sessionId: "missing" });
    assert.equal(result.ok, false);
    assert.equal(result.error.kind, "unsupported");
  }
  const suggestion = (await call("namingPlan", { sessionId })).suggestions[0];
  assert.match(suggestion.title, /恢复接手与命名流程/);
  assert.equal((await call("namingPlan", { sessionId: foreignSessionId })).suggestions.length, 0);
  assert.equal((await call("cancelNewSessionWatcher", { sessionId: foreignSessionId, suggestionId: suggestion.id })).cancelled, false);
  assert.equal((await call("cancelNewSessionWatcher", { sessionId, suggestionId: suggestion.id })).cancelled, true);
  assert.deepEqual((await call("namingPlan", { sessionId })).suggestions, []);
  const verifiedStore = createSessionStore({ codexHome: home });
  const restarted = createManualNaming({ dataRoot: data, workspaceRoot: project, sessionStore: verifiedStore, writeText: writeFile });
  assert.deepEqual((await restarted.plan(sessionId)).suggestions, [], "Cancellation survives restart");
  await restarted.created(sessionId, { key: "7", title: "恢复接手与命名流程" });
  const mapped = (await restarted.plan(sessionId)).suggestions[0];
  assert.equal(mapped.issueKey, "7");
  assert.match(mapped.title, /\[#7\]/);
  await restarted.created("missing", { key: "9", title: "Must not create phantom session" });
  assert.deepEqual((await restarted.plan("missing")).suggestions, []);
  verifiedStore.close();
  const store = createSessionStore({ codexHome: root });
  assert.equal(store.get("missing"), null);
  store.close();
  assert.equal(guardianLoaded, false, "Manual operations must not reactivate the automatic guardian");
  assert.equal(await readFile(oldState, "utf8"), oldContent);
  console.log("PASS original handoff scan: absent/latest/exact/prefix/missing/project isolation");
  console.log("PASS manual suggestions/cancellation/restart/issue mapping; automatic guardian never loaded");
} finally {
  host.dispose();
  observer.deregister();
  process.chdir(before);
  if (previousHome === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = previousHome;
}
