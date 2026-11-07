// Endpoint names registered by vendor/mattskills-1.8.0-rc.7/lib/index.js.
// `harness.handle` strips the `wf.` prefix before the RPC channel sees it.
// Keep this list in sync with the vendor file; verify-rpc-manifest.mjs checks it.

export const READ_ENDPOINTS = new Set([
  "detect",
  "chain",
  "skill.readDoc",
  "cwd",
  "snapshot",
  "mapTickets",
  "gitStatus",
  "gitDiff",
  "gitLog",
  "gitWriteCheck",
  "refresh",
  "focus",
  "gateStats",
  "issuesPage",
  "bindings",
  "registry",
  "selection",
  "setupLayout",
  "listLabels",
  "issueDetail",
  "issueComments",
  "probe",
  "handoffLatest",
  "namingPlan",
  "awaitCreatedIssue",
  "logBatch",
  "logExport",
  "logGetSwitch",
  "updateStatus",
  "updateCheck",
  "updateChangelog",
]);

export const WRITE_ENDPOINTS = new Set([
  "deckExec",
  "gitStage",
  "gitUnstage",
  "gitCommit",
  "gitPull",
  "gitFetch",
  "gitPush",
  "bind",
  "setLabelColors",
  "commentIssue",
  "handoffResolve",
  "namingRegister",
  "registerNewSessionWatcher",
  "namingSignal",
  "namingResult",
  "cancelNewSessionWatcher",
  "openFolder",
  "initPublish",
  "retryPush",
  "pickDirectory",
  "pickFile",
  "openPath",
  "logClear",
  "logSetSwitch",
  "updateInstall",
]);

export const UPSTREAM_ENDPOINTS = new Set([...READ_ENDPOINTS, ...WRITE_ENDPOINTS]);

// logExport only reads the day's log and returns its text, so #18 moved it to
// the read set (write-policy already classified it "read-only-export").
// setupLayout is a read when it has no layout value and a write when a layout
// is supplied.
export function classifyEndpoint(method, payload = {}) {
  if (method === "setupLayout") return payload?.layout == null ? "read" : "write";
  if (READ_ENDPOINTS.has(method)) return "read";
  if (WRITE_ENDPOINTS.has(method)) return "write";
  return "unknown";
}

export function rpcManifest() {
  return {
    read: [...READ_ENDPOINTS].sort(),
    write: [...WRITE_ENDPOINTS].sort(),
    upstream: [...UPSTREAM_ENDPOINTS].sort(),
    conditional: ["setupLayout"],
  };
}
