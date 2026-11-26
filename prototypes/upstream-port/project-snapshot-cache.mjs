import { readFile, writeFile, rename, stat, readdir, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

// A project-local startup cache, never an authority for project selection or
// writes. The caller must resolve the real project before reaching this layer.
export function createProjectSnapshotCache({ directory, workspaceRoot, identity, call, now = Date.now, maxAgeMs = 300000 }) {
  const file = path.join(directory, 'panel-startup-snapshot.json');
  const generationFile = path.join(directory, 'panel-startup-generation');
  let epoch = 0;
  const canonical = value => path.resolve(String(value)).toLowerCase();
  const project = canonical(workspaceRoot);
  async function generation() {
    try { return await readFile(generationFile, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
  }
  async function stamp() {
    if ((await readdir(directory)).some(name => name.startsWith('.panel-cache-mutation-'))) return null;
    const key = await identity();
    return key ? JSON.stringify([key, await generation()]) : null;
  }
  function validReply(reply) {
    return reply?.ok === true && reply.value?.ok === true &&
      typeof reply.value.workspaceRoot === 'string' && canonical(reply.value.workspaceRoot) === project &&
      reply.value.selection?.backendId === 'github' &&
      Array.isArray(reply.value.issues) && Array.isArray(reply.value.maps);
  }
  async function cached(key) {
    try {
      if (!key || (await stat(file)).size > 8 * 1024 * 1024) return null;
      const entry = JSON.parse(await readFile(file, 'utf8'));
      const age = now() - entry.savedAt;
      const dataAge = now() - entry.reply?.value?.generatedMs;
      if (entry.version !== 1 || entry.project !== project || entry.identity !== key ||
          !Number.isFinite(age) || age < 0 || age > maxAgeMs ||
          !Number.isFinite(dataAge) || dataAge < 0 || dataAge > maxAgeMs || !validReply(entry.reply)) return null;
      const reply = structuredClone(entry.reply);
      reply.value.fromCache = true;
      // Keep original generatedMs/updatedAt: cached data must not look freshly fetched.
      return reply;
    } catch { return null; }
  }
  async function fetch(method, payload) {
    const requestEpoch = epoch;
    const before = await stamp().catch(() => null);
    const result = await call(method, payload);
    if (requestEpoch !== epoch) return result;
    if (validReply(result) && before) {
      // A mutation/config change during the read invalidates its result for
      // future startup reuse. Readers also check this stamp, covering races
      // between this comparison and the atomic rename in other processes.
      if (before === await stamp().catch(() => null) && requestEpoch === epoch) {
        const temporary = file + '.' + randomUUID() + '.tmp';
        const entry = { version: 1, project, identity: before, savedAt: now(), reply: result };
        try {
          await writeFile(temporary, JSON.stringify(entry), { mode: 0o600 });
          await rename(temporary, file);
        } catch { /* Optional cache must not turn a successful read into failure. */ }
      }
    }
    return result;
  }
  return {
    async peek() {
      const before = await stamp().catch(() => null);
      const reply = await cached(before);
      return reply && before === await stamp().catch(() => null) ? reply : null;
    },
    async read(method, payload = {}) {
      if (method !== 'snapshot' && method !== 'refresh') return call(method, payload);
      // Cache hydration is a separate frontend step. Never replace this reply:
      // the original client's pending network request must still deliver fresh
      // data to the already visible panel (without remounting or losing state).
      return fetch(method, payload);
    },
    async invalidate() {
      epoch++;
      // Invalidating is required before a mutation. Fail closed if this write
      // fails; do not allow a write that other workers could keep hiding.
      await writeFile(generationFile, randomUUID(), { mode: 0o600 });
    },
    async beginMutation() {
      const marker = path.join(directory, '.panel-cache-mutation-' + randomUUID());
      await writeFile(marker, '', { flag: 'wx', mode: 0o600 });
      await this.invalidate();
      return async () => {
        // Each writer owns one marker. Overlapping writers and crashed workers
        // cannot accidentally enable cache reuse while a mutation is pending.
        await this.invalidate();
        await unlink(marker);
      };
    },
  };
}
