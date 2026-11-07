import { registerHooks } from "node:module";

const upstreamEntry = new URL("../../vendor/mattskills-1.8.0-rc.7/lib/index.js", import.meta.url).href;
const disabledGuardian = new URL("disabled-naming-guardian.mjs", import.meta.url).href;

// Replace only the host's naming service dependency, not the vendor source.
// Keep this hook for the worker lifetime: index.js imports the service lazily
// from startup, refresh wiring and tools, not only through the public RPC.
registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL === upstreamEntry && specifier === "./namingGuardian.js") {
    return { url: disabledGuardian, shortCircuit: true };
  }
  return nextResolve(specifier, context);
} });

export default (await import(upstreamEntry)).default;
