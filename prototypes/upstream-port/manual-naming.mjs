import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { composeDraftTitle, newSessionTitle } from "../../vendor/mattskills-1.8.0-rc.7/shared/naming-titles.js";

// Suggestions belong to verified existing chats. No watcher, thread creation,
// rename API or inferred association with another chat is involved.
export function createManualNaming({ dataRoot, workspaceRoot, sessionStore, writeText }) {
  const file = path.join(dataRoot, "manual-naming.json");
  let queue = Promise.resolve();
  async function state() {
    await queue;
    try { return JSON.parse(await readFile(file, "utf8")); }
    catch (error) { if (error.code === "ENOENT") return {}; throw error; }
  }
  async function verified(sessionId) {
    const session = sessionStore.get(sessionId);
    if (!session) return null;
    const relative = path.relative(workspaceRoot, session.cwd);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)) ? session : null;
  }
  async function update(sessionId, change) {
    const pending = queue.then(async () => {
      let all;
      try { all = JSON.parse(await readFile(file, "utf8")); }
      catch (error) { if (error.code !== "ENOENT") throw error; all = {}; }
      all[sessionId] = change(all[sessionId] ?? {});
      await writeText(file, JSON.stringify(all));
    });
    queue = pending.catch(() => {});
    await pending;
  }
  async function plan(sessionId) {
    const session = await verified(sessionId);
    if (!session) return { ok: true, manual: true, suggestions: [], orders: [], tracked: [], failures: [], enabled: false };
    const entry = (await state())[sessionId] ?? {};
    const issue = entry.issue;
    const title = issue
      ? newSessionTitle({ number: Number(issue.key), numberText: issue.key, title: issue.title })
      : composeDraftTitle({ hint: session.title, lang: /[\u3400-\u9fff]/.test(session.title) ? "zh" : "en", baselineTitle: session.title });
    const id = createHash("sha256").update(sessionId + "\0" + title).digest("hex").slice(0, 24);
    return { ok: true, manual: true, enabled: false, orders: [], tracked: [], failures: [],
      suggestions: entry.cancelled === id ? [] : [{ id, title, issueKey: issue?.key ?? null }] };
  }
  return {
    plan,
    async cancel(sessionId, id) {
      const current = await plan(sessionId);
      if (!current.suggestions.some(item => item.id === id)) return { ok: true, cancelled: false };
      await update(sessionId, entry => ({ ...entry, cancelled: id }));
      return { ok: true, cancelled: true };
    },
    async created(sessionId, issue) {
      if (!await verified(sessionId) || !/^\d+$/.test(String(issue?.key)) || typeof issue.title !== "string") return;
      await update(sessionId, entry => ({ ...entry, issue: { key: String(issue.key), title: issue.title } }));
    },
  };
}
