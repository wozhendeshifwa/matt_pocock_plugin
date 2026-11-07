import { createReadStream } from "node:fs";
import { glob, readFile, realpath, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import path from "node:path";
import { createZstdDecompress } from "node:zlib";
import { DatabaseSync } from "node:sqlite";

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const UUID_LIKE = "当前侧栏请求没有可验证的聊天身份。";
const MISMATCH = "宿主传入了不一致的聊天身份。";
const NO_RECORD = "无法从当前聊天的会话记录确定唯一项目目录，临时聊天可能尚未创建本地记录。";
const AMBIGUOUS = "当前聊天的会话记录指向多个不同的项目目录。";
const MISSING_DIRECTORY = "当前聊天的项目目录不存在或不可访问。";
const OUTSIDE_PROJECT = "此聊天不属于 Codex 项目。";

function defaultCodexHome() {
  return process.env.CODEX_HOME || path.join(homedir(), ".codex");
}

function threadIdFrom(metadata) {
  const threadId = metadata?.threadId ?? metadata?.thread_id;
  if (metadata?.threadId && metadata?.thread_id && metadata.threadId !== metadata.thread_id) {
    throw new Error(MISMATCH);
  }
  if (typeof threadId !== "string" || !UUID.test(threadId)) throw new Error(UUID_LIKE);
  return threadId;
}

function normalizeCwd(value) {
  let cwd = String(value ?? "").trim();
  if (!cwd) return "";
  if (cwd.startsWith("\\\\?\\")) cwd = cwd.slice(4);
  if (cwd.startsWith("\\??\\")) cwd = cwd.slice(4);
  cwd = cwd.replace(/\//g, "\\");
  cwd = path.win32.normalize(cwd);
  if (cwd.length > 3 && cwd.endsWith("\\")) cwd = cwd.slice(0, -1);
  return cwd;
}

function comparable(value) {
  return normalizeCwd(value).toLowerCase();
}

function isWithin(cwd, root) {
  const child = comparable(cwd).replace(/\\+$/, "");
  const parent = comparable(root).replace(/\\+$/, "");
  if (!child || !parent) return false;
  if (child === parent) return true;
  if (parent === "c:" || /^[a-z]:$/.test(parent)) return child.startsWith(parent + "\\");
  return child.startsWith(parent + "\\");
}

function isSamePath(left, right) {
  return Boolean(left) && Boolean(right) && comparable(left) === comparable(right);
}

async function isDirectory(file) {
  try { return (await stat(file)).isDirectory(); } catch { return false; }
}

async function fileSignature(file) {
  try {
    const info = await stat(file);
    return info.mtimeMs + ":" + info.size;
  } catch {
    return "-";
  }
}

async function databaseSignature(codexHome) {
  const database = path.join(codexHome, "state_5.sqlite");
  return (await fileSignature(database)) + "|" + (await fileSignature(database + "-wal"));
}

async function openStateDatabase(codexHome) {
  const file = path.join(codexHome, "state_5.sqlite");
  try {
    const database = new DatabaseSync(file, { readOnly: true });
    try { database.exec("PRAGMA busy_timeout = 2000"); } catch {}
    return database;
  } catch {
    return null;
  }
}

function readStateRow(database, threadId) {
  if (!database) return { row: null, failed: false };
  try {
    const row = database.prepare("SELECT id, cwd, rollout_path FROM threads WHERE id = ?").get(threadId);
    return { row: row ?? null, failed: false };
  } catch {
    return { row: null, failed: true };
  }
}

async function globalProjectRoots(codexHome) {
  const roots = [];
  try {
    const state = JSON.parse(await readFile(path.join(codexHome, ".codex-global-state.json"), "utf8"));
    for (const [projectId, project] of Object.entries(state["local-projects"] ?? {})) {
      for (const rootPath of project?.rootPaths ?? []) roots.push({ projectId, path: normalizeCwd(rootPath) });
    }
  } catch {}
  return roots;
}

async function loadProjectRoots(database, codexHome) {
  const roots = [];
  let fromDatabase = false;
  if (database) {
    try {
      for (const row of database.prepare("SELECT project_id, path FROM project_roots").all()) {
        fromDatabase = true;
        if (row.path) roots.push({ projectId: row.project_id ?? null, path: normalizeCwd(row.path) });
      }
    } catch {}
  }
  if (roots.length === 0) {
    // The private desktop state is only a fallback: state_5.project_roots is the
    // public, durable index when Codex has written one.
    roots.push(...await globalProjectRoots(codexHome));
  }
  const seen = new Set();
  const resolved = [];
  for (const root of roots) {
    if (!root.path) continue;
    const key = comparable(root.path);
    if (seen.has(key)) continue;
    seen.add(key);
    let normalized = root.path;
    try { normalized = normalizeCwd(await realpath(root.path)); } catch {}
    resolved.push({ projectId: root.projectId ?? null, path: normalized });
  }
  return { roots: resolved, fromDatabase };
}

function projectRootFor(cwd, roots) {
  let best = null;
  for (const root of roots) {
    if (!isWithin(cwd, root.path)) continue;
    if (!best || comparable(root.path).length > comparable(best.path).length) best = root;
  }
  return best;
}

async function existingRolloutPath(candidate) {
  if (!candidate) return null;
  const normalized = normalizeCwd(candidate);
  const attempts = normalized.toLowerCase().endsWith(".zst") ? [normalized] : [normalized, normalized + ".zst"];
  for (const file of attempts) {
    try {
      const info = await stat(file);
      if (info.isFile()) return file;
    } catch {}
  }
  return null;
}

async function findRolloutFiles(codexHome, threadId) {
  const files = [];
  for (const root of [path.join(codexHome, "sessions"), path.join(codexHome, "archived_sessions")]) {
    try {
      for await (const relative of glob("**/*" + threadId + "*.jsonl*", { cwd: root })) {
        if (/\.jsonl(\.zst)?$/i.test(relative)) files.push(path.join(root, relative));
      }
    } catch {}
  }
  return [...new Set(files)];
}

async function readRolloutCwd(file, threadId) {
  if (!file) return { cwd: null, id: null };
  const input = createReadStream(file);
  const decompressed = /.zst$/i.test(file) ? createZstdDecompress() : null;
  const source = decompressed ?? input;
  if (decompressed) input.pipe(decompressed);
  const lines = createInterface({ input: source, crlfDelay: Infinity });
  try {
    let count = 0;
    for await (const line of lines) {
      if (++count > 20) break;
      if (!line.trim()) continue;
      let record;
      try { record = JSON.parse(line); } catch { continue; }
      if (record.type !== "session_meta") continue;
      const id = record.payload?.id ?? null;
      const cwd = record.payload?.cwd;
      if (id !== threadId) return { cwd: null, id };
      if (typeof cwd === "string" && path.isAbsolute(cwd)) return { cwd, id };
      return { cwd: null, id };
    }
    return { cwd: null, id: null };
  } finally {
    lines.close();
    input.destroy();
    if (decompressed) decompressed.destroy();
  }
}

async function resolveDirectory(value) {
  const normalized = normalizeCwd(value);
  if (!normalized || !path.isAbsolute(normalized)) throw new Error(MISSING_DIRECTORY);
  try {
    const real = await realpath(normalized);
    const info = await stat(real);
    if (!info.isDirectory()) throw new Error(MISSING_DIRECTORY);
    return normalizeCwd(real);
  } catch {
    throw new Error(MISSING_DIRECTORY);
  }
}

async function collectRolloutCwds(codexHome, threadId, row) {
  const candidates = [];
  const indexed = await existingRolloutPath(row?.rollout_path);
  if (indexed) candidates.push(indexed);
  // state_5 has no usable cwd: the rollout is the only evidence, so scan both
  // the live and archived roots for every matching file and surface ambiguity.
  candidates.push(...await findRolloutFiles(codexHome, threadId));
  const found = [];
  for (const file of [...new Set(candidates)]) {
    let result;
    try { result = await readRolloutCwd(file, threadId); } catch { continue; }
    if (!result.cwd) continue;
    found.push({ file, cwd: normalizeCwd(result.cwd) });
  }
  return found;
}

export function createSessionProjectResolver(options = {}) {
  const cache = new Map();
  let rootsCache = { signature: "", roots: null };

  async function rootsFor(database, codexHome, signature) {
    const globalSignature = await fileSignature(path.join(codexHome, ".codex-global-state.json"));
    const combined = signature + "|" + globalSignature;
    if (rootsCache.signature === combined && rootsCache.roots) return rootsCache.roots;
    const loaded = await loadProjectRoots(database, codexHome);
    rootsCache = { signature: combined, roots: loaded.roots };
    return loaded.roots;
  }

  return async function resolve(metadata) {
    const threadId = threadIdFrom(metadata);
    const codexHome = options.codexHome ?? defaultCodexHome();
    const signature = await databaseSignature(codexHome);
    const cached = cache.get(threadId);
    if (cached && cached.signature === signature) {
      const fileStillSame = !cached.rolloutFile || (await fileSignature(cached.rolloutFile)) === cached.rolloutFileSignature;
      const directoryStillSame = !cached.value || await isDirectory(cached.value.cwd);
      const fresh = !cached.error || Date.now() < cached.expiresAt;
      if (fileStillSame && directoryStillSame && fresh) {
        if (cached.error) throw new Error(cached.error);
        return cached.value;
      }
    }

    let database = null;
    let databaseFailed = false;
    let row = null;
    try {
      database = await openStateDatabase(codexHome);
      if (!database) databaseFailed = true;
      const state = readStateRow(database, threadId);
      row = state.row;
      databaseFailed ||= state.failed;
      const roots = await rootsFor(database, codexHome, signature);
      const stateCwd = row?.cwd ? normalizeCwd(row.cwd) : null;
      let rolloutCwds = [];
      let rolloutConflict = false;
      if (stateCwd) {
        // state_5 is the durable, current index. A rollout first line records the
        // cwd at creation and goes stale when a chat is moved; read it only as a
        // diagnostic, never to override or reject the state row.
        const indexed = await existingRolloutPath(row?.rollout_path);
        if (indexed) {
          try {
            const rollout = await readRolloutCwd(indexed, threadId);
            if (rollout.cwd) {
              const cwd = normalizeCwd(rollout.cwd);
              if (!isSamePath(cwd, stateCwd)) rolloutConflict = true;
              rolloutCwds = [{ file: indexed, cwd }];
            }
          } catch {}
        }
      } else {
        rolloutCwds = await collectRolloutCwds(codexHome, threadId, row);
      }

      let chosen = null;
      let source = null;
      if (stateCwd) {
        chosen = stateCwd;
        source = "state_5";
      } else if (rolloutCwds.length === 0) {
        const error = new Error(NO_RECORD);
        cache.set(threadId, { signature, error: error.message, expiresAt: Date.now() + 5000 });
        throw error;
      } else {
        const distinct = new Set(rolloutCwds.map(item => comparable(item.cwd)));
        if (distinct.size > 1) {
          const error = new Error(AMBIGUOUS);
          cache.set(threadId, { signature, error: error.message, expiresAt: Date.now() + 5000 });
          throw error;
        }
        chosen = rolloutCwds[0].cwd;
        source = "rollout";
      }

      const cwd = await resolveDirectory(chosen);
      const project = projectRootFor(cwd, roots);
      const value = {
        threadId,
        cwd,
        projectRoot: project?.path ?? null,
        projectId: project?.projectId ?? null,
        associated: Boolean(project),
        source,
        sourceConflict: rolloutConflict,
        message: project ? null : OUTSIDE_PROJECT,
      };
      if (!databaseFailed) {
        const rolloutFile = source === "state_5" ? rolloutCwds[0]?.file ?? null : null;
        cache.set(threadId, {
          signature,
          value,
          rolloutFile,
          rolloutFileSignature: rolloutFile ? await fileSignature(rolloutFile) : "",
        });
        if (cache.size > 500) cache.delete(cache.keys().next().value);
      }
      return value;
    } finally {
      try { database?.close(); } catch {}
    }
  };
}

export const resolveSessionProject = createSessionProjectResolver();
export { OUTSIDE_PROJECT };