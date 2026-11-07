// Read-only subprocess gate for the Codex adapter.
//
// The upstream version-control host runs every git command through the DSH
// subprocess service with one fixed global-option prefix (the source of truth is
// vendor/mattskills-1.8.0-rc.7/shared/version-control/commands.js):
//
//   git -C <dir> --no-optional-locks --literal-pathspecs \
//       -c push.followTags=false -c push.default=nothing -c core.quotepath=false \
//       -c color.ui=false -c i18n.logOutputEncoding=UTF-8 <subcommand> ...
//
// The gate used to look only at the token right after "-C", so the first token it
// saw was "--no-optional-locks" and every version-control read was refused with
// "Command is outside read-only port verification." The panel then showed its
// error page. Parsing the global options first and classifying the subcommand
// afterwards keeps the gate closed for writes while letting the read-only
// commands the upstream host actually runs through.
import path from "node:path";

// Global git options the upstream host puts before the subcommand. Anything not
// in this list stops the option scan, which means it has to be a subcommand; an
// unrecognised global option therefore fails closed instead of being skipped.
const SAFE_GLOBAL_FLAGS = new Set([
  "--no-optional-locks",
  "--literal-pathspecs",
  "--no-pager",
  "--no-replace-objects",
  "-P",
]);

// The upstream prefix sets exactly these config keys. An arbitrary "-c" could
// change git's behaviour (pagers, diff drivers, credential helpers), so the gate
// accepts only the keys the host itself writes.
const SAFE_CONFIG_KEYS = new Set([
  "push.followTags",
  "push.default",
  "core.quotepath",
  "color.ui",
  "i18n.logOutputEncoding",
]);

// Read-only subcommands used by the version-control reads. Each one either
// prints repository state or asks git a question; none of them writes.
const READ_SUBCOMMANDS = new Set([
  "status",
  "log",
  "show",
  "diff",
  "rev-parse",
  "rev-list",
  "for-each-ref",
  "ls-files",
  "check-ref-format",
]);

// Options that turn an otherwise read-only subcommand into a write or an
// arbitrary process launch. The upstream host never passes them; refusing them
// keeps "reads never write" true for the whole channel, not just for today's
// call sites.
const FORBIDDEN_ARG = /^(?:--output(?:=|$)|--ext-diff(?:=|$)|--open-files-in-pager(?:=|$)|--exec(?:=|$)|--upload-pack(?:=|$)|--receive-pack(?:=|$)|-O(?:=|$))/;

function stripGitGlobalOptions(args) {
  const rest = args.slice();
  while (rest.length > 0) {
    const arg = rest[0];
    if (arg === "-C") {
      if (rest.length < 2) return null;
      rest.splice(0, 2);
      continue;
    }
    if (arg === "-c") {
      const value = rest[1];
      if (typeof value !== "string" || value.indexOf("=") <= 0) return null;
      if (!SAFE_CONFIG_KEYS.has(value.slice(0, value.indexOf("=")))) return null;
      rest.splice(0, 2);
      continue;
    }
    if (SAFE_GLOBAL_FLAGS.has(arg)) {
      rest.shift();
      continue;
    }
    break;
  }
  return rest;
}

function isReadSubcommand(rest) {
  const subcommand = rest[0];
  if (subcommand === "--version") return true;
  if (READ_SUBCOMMANDS.has(subcommand)) return true;
  switch (subcommand) {
    case "reflog":
      return rest[1] === "show";
    case "worktree":
      return rest[1] === "list";
    case "remote":
      return rest[1] === "get-url" || rest[1] === "-v";
    case "config":
      return rest.some(arg => ["--get", "--get-all", "--get-regexp", "--list"].includes(arg));
    default:
      return false;
  }
}

function classifyGh(args) {
  if (args[0] === "--version") return true;
  if (args[0] === "auth") return args[1] === "status";
  if (["repo", "issue", "pr"].includes(args[0])) return ["view", "list"].includes(args[1]);
  if (args[0] !== "api") return false;
  const method = args.findIndex(arg => arg === "-X" || arg === "--method");
  if (method !== -1 && args[method + 1] !== "GET") return false;
  if (args[1] === "graphql") {
    const query = args.find(arg => arg.startsWith("query="));
    return Boolean(query) && !/\bmutation\b/i.test(query);
  }
  return !args.some(arg => ["-f", "-F", "--field", "--raw-field", "--input"].includes(arg));
}

/** True when argv is a read-only git/gh invocation this host may spawn. */
export function classifyReadCommand(argv) {
  if (!Array.isArray(argv) || argv.length === 0) return false;
  const program = path.basename(String(argv[0])).replace(/\.exe$/i, "").toLowerCase();
  const args = argv.slice(1).map(String);
  if (program === "gh") return classifyGh(args);
  if (program !== "git") return false;
  const rest = stripGitGlobalOptions(args);
  if (!rest || rest.length === 0) return false;
  if (rest.some(arg => FORBIDDEN_ARG.test(arg))) return false;
  return isReadSubcommand(rest);
}

/**
 * Collect a subprocess stream under a byte ceiling.
 *
 * The upstream host treats a lost byte as a failed read: it refuses to parse
 * half a status report or half a patch. So the collector has to say when it
 * dropped data. It keeps the tail (that is what the upstream contract documents)
 * and reports lossy: true; readFrom/finalize are the two shapes the upstream
 * collector reader accepts.
 */
export function createBoundedCollector(maxBytes) {
  const limit = (typeof maxBytes === "number" && Number.isFinite(maxBytes) && maxBytes > 0)
    ? Math.floor(maxBytes)
    : 4 * 1024 * 1024;
  const chunks = [];
  let kept = 0;
  let lossy = false;
  function push(chunk) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
    if (buffer.length === 0) return;
    chunks.push(buffer);
    kept += buffer.length;
    if (kept <= limit) return;
    lossy = true;
    while (kept > limit && chunks.length > 0) {
      const excess = kept - limit;
      const first = chunks[0];
      if (first.length <= excess) {
        chunks.shift();
        kept -= first.length;
      } else {
        chunks[0] = first.subarray(excess);
        kept -= excess;
      }
    }
  }
  function text() {
    return Buffer.concat(chunks).toString("utf8");
  }
  return {
    push,
    get lossy() { return lossy; },
    get bytes() { return kept; },
    readFrom(offset = 0) {
      return { text: text().slice(offset), lossy };
    },
    finalize() {
      return { text: text(), truncated: lossy };
    },
  };
}
