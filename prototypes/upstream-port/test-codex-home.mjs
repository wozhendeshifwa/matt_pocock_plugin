import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { zstdCompressSync } from "node:zlib";
import { DatabaseSync } from "node:sqlite";

// A throwaway Codex home for adapter tests. The resolver treats state_5 as the
// durable project index, so fixtures write a real (minimal) database instead of
// relying on session_meta alone.
export async function createTestCodexHome({
  prefix = "mattskills-test-",
  threads = [],
  projectRoots = [],
  rollouts = [],
  withState = true,
} = {}) {
  const home = await mkdtemp(path.join(tmpdir(), prefix));
  const rolloutPaths = new Map();
  for (const rollout of rollouts) {
    const directory = path.join(home, rollout.dir ?? "sessions", "2026", "11", "07");
    await mkdir(directory, { recursive: true });
    const file = rollout.file ?? path.join(directory, "rollout-test-" + rollout.id + ".jsonl" + (rollout.zst ? ".zst" : ""));
    const line = JSON.stringify({ type: "session_meta", payload: { id: rollout.id, cwd: rollout.cwd } }) + "\n";
    await writeFile(file, rollout.zst ? zstdCompressSync(Buffer.from(line, "utf8")) : line);
    rolloutPaths.set(rollout.id, file);
  }
  const dbPath = path.join(home, "state_5.sqlite");
  if (withState) {
    const database = new DatabaseSync(dbPath);
    database.exec("CREATE TABLE threads (id TEXT PRIMARY KEY, cwd TEXT, rollout_path TEXT, archived INTEGER DEFAULT 0, title TEXT, updated_at_ms INTEGER);" +
      "CREATE TABLE project_roots (project_id TEXT, position INTEGER, path TEXT);");
    const insertThread = database.prepare("INSERT INTO threads (id, cwd, rollout_path, archived, title, updated_at_ms) VALUES (?,?,?,?,?,?)");
    for (const thread of threads) {
      const rolloutPath = Object.hasOwn(thread, "rolloutPath") ? thread.rolloutPath : rolloutPaths.get(thread.id) ?? null;
      insertThread.run(thread.id, thread.cwd ?? null, rolloutPath, thread.archived ? 1 : 0, thread.title ?? "test", Date.now());
    }
    const insertRoot = database.prepare("INSERT INTO project_roots (project_id, position, path) VALUES (?,?,?)");
    projectRoots.forEach((root, index) => {
      const value = typeof root === "string" ? { path: root } : root;
      insertRoot.run(value.projectId ?? "project-" + index, 0, value.path);
    });
    database.close();
  }
  return { home, dbPath, rolloutPaths };
}
