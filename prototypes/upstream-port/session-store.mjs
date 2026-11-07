import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";

function normalizeCwd(value) {
  let cwd = String(value ?? "");
  if (cwd.startsWith("\\\\?\\")) cwd = cwd.slice(4);
  return cwd;
}

// Minimal read-only view of Codex's own session index. It gives the host's
// sessions/sessionQuery services a real record instead of inventing one; the
// resolver rewrite in #11 can build on the same store.
export function createSessionStore({ codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex") } = {}) {
  let database = null;
  let unavailable = false;
  function open() {
    if (database || unavailable) return database;
    const file = path.join(codexHome, "state_5.sqlite");
    if (!existsSync(file)) {
      unavailable = true;
      return null;
    }
    try {
      database = new DatabaseSync(file, { readOnly: true });
      database.exec("PRAGMA query_only = ON");
    } catch {
      unavailable = true;
      database = null;
    }
    return database;
  }
  function get(sessionId) {
    const db = open();
    if (!db || sessionId == null) return null;
    try {
      const row = db.prepare("SELECT id, cwd, title FROM threads WHERE id = ?").get(String(sessionId));
      if (!row) return null;
      const cwd = normalizeCwd(row.cwd);
      return { id: row.id, cwd, header: { cwd }, title: row.title ?? "" };
    } catch {
      return null;
    }
  }
  async function filterSessions(filters = []) {
    const ids = [];
    for (const filter of filters) {
      if (filter?.kind === "id" && Array.isArray(filter.values)) {
        for (const value of filter.values) ids.push(String(value));
      }
    }
    const records = [];
    for (const id of [...new Set(ids)]) {
      const record = get(id);
      if (record) records.push(record);
    }
    return records;
  }
  async function readSession() {
    return { events: [] };
  }
  async function listEvents() {
    return { events: [] };
  }
  function close() {
    try { database?.close(); } catch {}
    database = null;
  }
  return { get, filterSessions, readSession, listEvents, close, codexHome };
}
