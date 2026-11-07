import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createOriginalHost } from "./node-host.mjs";
import { createSessionStore } from "./session-store.mjs";

// Real filesystem + original backend. Fixtures remain available under temp for
// inspection; no user handoff documents or session records are modified.
const root = await mkdtemp(path.join(tmpdir(), "deck-handoff-"));
const project = path.join(root, "project");
const other = path.join(root, "other");
const data = path.join(root, "data");
for (const dir of [project, other, data]) await mkdir(dir);
const before = process.cwd();
process.chdir(data);
const host = await createOriginalHost({ dataRoot: data, workspaceRoot: project });
try {
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
  for (const method of ["namingRegister", "registerNewSessionWatcher", "namingSignal", "namingResult", "cancelNewSessionWatcher"]) {
    const result = await call(method, { sessionId: "missing" });
    assert.equal(result.ok, false);
    assert.equal(result.error.kind, "unsupported");
  }
  const store = createSessionStore({ codexHome: root });
  assert.equal(store.get("missing"), null);
  store.close();
  console.log("PASS original handoff scan: absent/latest/exact/prefix/missing/project isolation");
  console.log("PASS naming explicitly disabled, no phantom watcher/session");
} finally {
  host.dispose();
  process.chdir(before);
}
