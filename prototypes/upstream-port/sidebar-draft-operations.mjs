// A sidebar owns one in-flight injection. The store survives its project
// remounts, but is never shared with a different sidebar element/window.
export function createSidebarDraftOperations() {
  let current = null, revision = 0;
  const listeners = new Set();
  const changed = () => { revision++; for (const listener of listeners) listener(); };
  return {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    getSnapshot() { return revision; },
    get pending() { return current !== null; },
    owns(token) { return token != null && current === token; },
    begin() { if (current) return null; current = {}; changed(); return current; },
    end(token) { if (current === token) { current = null; changed(); } },
    changed,
  };
}
