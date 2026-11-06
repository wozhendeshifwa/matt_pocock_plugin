const SENSITIVE_KEY = /(?:token|secret|password|authorization|cookie|credential|api.?key)/i;
const IDENTIFIER_KEY = /^(?:thread|session|conversation|project|workspace)?_?(?:id|cwd|root|rootpath|path|name)$/i;
const KNOWN_CONTEXT_KEY = /^(?:threadId|sessionId|conversationId|chatGptThreadId|subjectId|projectId|workspaceId|cwd|workspaceRoot|projectRoot|projectPath|workingDirectory|currentProjectId)$/i;
const CONTEXT_OWNER = /(?:thread|session|conversation|project|workspace)/i;
const MAX_KEYS = 160;
const MAX_CANDIDATES = 48;
const MAX_VALUE_LENGTH = 512;
const MAX_DEPTH = 6;

function primitive(value) {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function candidatePath(path) {
  const segment = path.split(".").at(-1)?.replace(/\[\d+\]$/, "") ?? "";
  if (SENSITIVE_KEY.test(path)) return false;
  if (KNOWN_CONTEXT_KEY.test(segment)) return true;
  if (!IDENTIFIER_KEY.test(segment)) return false;
  return CONTEXT_OWNER.test(path);
}

/**
 * Keep host diagnostics useful without persisting an unrestricted copy of the
 * host context. Candidate values are limited to project/session identity
 * fields; all other field names are retained only in the key index.
 */
export function summarizeHostContext(source, value) {
  const keys = [];
  const candidates = {};
  const seen = new WeakSet();

  function walk(current, path, depth) {
    // Theme variables can consume the entire key budget before identity fields.
    if (depth > MAX_DEPTH || keys.length >= MAX_KEYS || /(?:^|\.)styles\.variables$/.test(path)) return;
    if (primitive(current)) {
      if (path && candidatePath(path) && Object.keys(candidates).length < MAX_CANDIDATES) {
        candidates[path] = typeof current === "string"
          ? current.slice(0, MAX_VALUE_LENGTH)
          : current;
      }
      return;
    }
    if (typeof current !== "object" || current === null || seen.has(current)) return;
    seen.add(current);

    let entries;
    try {
      entries = Object.entries(current);
    } catch {
      return;
    }
    for (const [name, child] of entries) {
      if (keys.length >= MAX_KEYS) break;
      if (SENSITIVE_KEY.test(name)) continue;
      const childPath = path ? `${path}.${name}` : name;
      keys.push(Array.isArray(current) ? `${path}[${name}]` : childPath);
      walk(child, Array.isArray(current) ? `${path}[${name}]` : childPath, depth + 1);
    }
  }

  walk(value, "", 0);
  return {
    capturedAt: new Date().toISOString(),
    source: String(source ?? "unknown").slice(0, 160),
    keys,
    candidates,
  };
}
