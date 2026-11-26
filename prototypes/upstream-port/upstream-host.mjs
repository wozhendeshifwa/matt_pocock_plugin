import { registerHooks } from "node:module";

const upstreamEntry = new URL("../../vendor/mattskills-1.8.0-rc.7/lib/index.js", import.meta.url).href;
const disabledGuardian = new URL("disabled-naming-guardian.mjs", import.meta.url).href;
const snapshotComposer = new URL("../../vendor/mattskills-1.8.0-rc.7/lib/tracker/snapshot.js", import.meta.url).href;
const githubPreflight = new URL("../../vendor/mattskills-1.8.0-rc.7/lib/tracker/backends/github/preflight.js", import.meta.url).href;

// Replace only the host's naming service dependency, not the vendor source.
// Keep this hook for the worker lifetime: index.js imports the service lazily
// from startup, refresh wiring and tools, not only through the public RPC.
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url !== snapshotComposer && url !== githubPreflight) return result;
  let source = typeof result.source === 'string' ? result.source : Buffer.from(result.source).toString('utf8');
  if (url === githubPreflight) {
    const start = '  // 2) 登录态：gh auth status';
    const lookup = "await c.execGh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], { cwd })";
    if (source.split(start).length !== 2 || source.split(lookup).length !== 2) throw new Error('Upstream preflight concurrency boundary changed');
    // Start only repository identity resolution alongside auth. Access checks
    // remain behind successful authentication; explicit refs bypass the lookup.
    // Consume even early failures when auth returns before the lookup finishes.
    source = source.replace(start, `  const portRepoLookup = parseRepoRef(handle, opCtx) ? null : Promise.resolve()
    .then(() => ghClient(opCtx).execGh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], { cwd }))
    .catch(() => ({ ok: false }));
${start}`);
    source = source.replace(lookup, 'await portRepoLookup');
    return { ...result, source };
  }
  const start = '      let all = null';
  const counts = '      const counts = await countsFromBackend(tracker, ref, ctx)';
  if (source.split(start).length !== 2 || source.split(counts).length !== 2) throw new Error('Upstream snapshot concurrency boundary changed');
  // Both reads use the same immutable request context. Only GitHub opts into
  // overlap; retain serial behavior for other backend implementations.
  // countsFromBackend handles rejection and preserves partial-data semantics.
  source = source.replace(start, "      const portCounts = backendId === 'github' ? countsFromBackend(tracker, ref, ctx) : null\n" + start);
  source = source.replace(counts, '      const counts = await (portCounts || countsFromBackend(tracker, ref, ctx))');
  return { ...result, source };
}, resolve(specifier, context, nextResolve) {
  if (context.parentURL === upstreamEntry && specifier === "./namingGuardian.js") {
    return { url: disabledGuardian, shortCircuit: true };
  }
  return nextResolve(specifier, context);
} });

export default (await import(upstreamEntry)).default;
