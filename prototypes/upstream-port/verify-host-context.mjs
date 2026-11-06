import assert from "node:assert/strict";
import { summarizeHostContext } from "./host-context.mjs";

const summary = summarizeHostContext("unit-test", {
  threadId: "thread-1",
  subjectId: "session-1",
  session_id: "session-1",
  cwd: "C:/work/project",
  project: { id: "project-1", root: "C:/work/project" },
  workspace: { path: "C:/work/project" },
  unrelated: "not persisted",
  authorization: "Bearer secret",
  nested: { apiKey: "secret", visible: "key-only" },
});

assert.equal(summary.source, "unit-test");
assert.equal(summary.candidates.threadId, "thread-1");
assert.equal(summary.candidates.subjectId, "session-1");
assert.equal(summary.candidates.session_id, "session-1");
assert.equal(summary.candidates.cwd, "C:/work/project");
assert.equal(summary.candidates["project.root"], "C:/work/project");
assert.equal(summary.candidates["workspace.path"], "C:/work/project");
assert.ok(summary.keys.includes("nested.visible"));
assert.ok(!JSON.stringify(summary).includes("Bearer secret"));
assert.ok(!JSON.stringify(summary).includes("not persisted"));
assert.ok(!JSON.stringify(summary).includes('"apiKey":"secret"'.replace(/\s/g, "")));

const initialization = summarizeHostContext("ui/initialize", {
  hostContext: {
    styles: { variables: Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`--color-${i}`, "red"])) },
    threadId: "thread-after-theme",
  },
});
assert.ok(initialization.keys.includes("hostContext.styles.variables"));
assert.equal(initialization.candidates["hostContext.threadId"], "thread-after-theme");
console.log("PASS host-context capture keeps project/thread candidates and drops unrelated sensitive values");
