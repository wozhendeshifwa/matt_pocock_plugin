import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { createSessionStore } from "./session-store.mjs";

const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const database = path.join(codexHome, "state_5.sqlite");
if (!existsSync(database)) {
  console.log("SKIP no state_5.sqlite in " + codexHome);
  process.exit(0);
}
const read = new DatabaseSync(database, { readOnly: true });
const row = read.prepare("SELECT id, cwd FROM threads ORDER BY updated_at DESC LIMIT 1").get();
read.close();
assert.ok(row?.id, "state_5.sqlite must contain at least one thread");

const store = createSessionStore({ codexHome });
try {
  const record = store.get(row.id);
  assert.equal(record?.id, row.id);
  assert.ok(typeof record.cwd === "string" && record.cwd.length > 0, "session cwd");
  assert.equal(record.header.cwd, record.cwd);
  const filtered = await store.filterSessions([{ kind: "id", values: [row.id] }]);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, row.id);
  const events = await store.readSession(row.id);
  assert.ok(Array.isArray(events.events));
  const listed = await store.listEvents(row.id);
  assert.ok(Array.isArray(listed.events));
  console.log("PASS session-store maps a real Codex thread to its cwd");
  console.log(`PASS filterSessions/readSession/listEvents return shapes without inventing records (${record.cwd})`);
} finally {
  store.close();
}
