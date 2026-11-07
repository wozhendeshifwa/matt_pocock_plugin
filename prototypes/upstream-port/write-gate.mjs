// Write-side argv gate for the Codex adapter.
//
// `read-command.mjs` answers "may this host spawn this read". This module answers
// the same question for the writes ticket #12 enables: the upstream client's own
// issue-detail writes (comment / label colors / backend switch) and the issue-level
// writes the vendored tracker produces for the deck tools (labels, assignees,
// title/body, close/reopen, create). The rule is the model from #5: a fixed argv
// template with every placeholder validated, never a shell string.
//
// The gate is intentionally narrow. Anything not spelled out here (git writes,
// GraphQL mutations, arbitrary `gh api` endpoints, extra gh flags) returns null and
// the host keeps refusing it. Opening the rest is each remaining ticket's job.
import path from "node:path";
// Owner/repo, issue number, label name, 6-digit hex color, assignee login.
const REPO_SLUG = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
const ISSUE_KEY = /^[0-9]{1,10}$/;
// Labels are human names (GitHub allows spaces); control characters and a leading
// flag-looking dash are the two things that could confuse argv parsing.
const LABEL_NAME = /^[^\u0000-\u001f\u007f-][^\u0000-\u001f\u007f]{0,99}$/;
const LABEL_COLOR = /^[0-9a-fA-F]{6}$/;
const ASSIGNEE = /^(@me|[A-Za-z0-9][A-Za-z0-9-]{0,38})$/;
const CLOSE_REASON = /^(completed|not planned|not-planned)$/;
// Text is handed to `gh` as a single argv value, never through a shell. The cap
// keeps one write from turning into a multi-megabyte audit record and matches the
// panel's own 60k comment ceiling.
const TEXT_MAX = 60000;

function textValue(value) {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= TEXT_MAX &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
}

function repoValue(value) {
  return typeof value === "string" && REPO_SLUG.test(value);
}

function labelValue(value) {
  return typeof value === "string" && LABEL_NAME.test(value);
}

function allowed(method, category) {
  return { method, category };
}

/**
 * Classify one `gh api` write.
 * Only two REST writes exist on the issue surface: creating an issue on the
 * current repo, and appending a comment to one issue.
 */
function classifyApiWrite(args) {
  const endpoint = args[1];
  if (typeof endpoint !== "string") return null;
  const methodAt = args.findIndex(arg => arg === "-X" || arg === "--method");
  if (methodAt === -1) return null;
  if (String(args[methodAt + 1] || "").toUpperCase() !== "POST") return null;
  // Collect -f/--raw-field pairs; the only other allowed tokens are the fixed
  // `--jq '.'` the vendor appends and the method flag itself.
  const fields = [];
  for (let index = 2; index < args.length; index += 1) {
    if (index === methodAt || index === methodAt + 1) continue;
    const arg = args[index];
    if (arg === "--jq" || arg === "-q") {
      if (args[index + 1] !== ".") return null;
      index += 1;
      continue;
    }
    if (arg === "-f" || arg === "--raw-field") {
      const pair = String(args[index + 1] || "");
      const split = pair.indexOf("=");
      if (split <= 0) return null;
      fields.push({ name: pair.slice(0, split), value: pair.slice(split + 1) });
      index += 1;
      continue;
    }
    return null;
  }
  const createIssue = /^repos\/([^/]+)\/([^/]+)\/issues$/.exec(endpoint);
  if (createIssue) {
    if (!repoValue(createIssue[1] + "/" + createIssue[2])) return null;
    const title = fields.filter(field => field.name === "title");
    const body = fields.filter(field => field.name === "body");
    if (title.length !== 1 || !textValue(title[0].value)) return null;
    if (body.length > 1 || (body.length === 1 && !textValue(body[0].value))) return null;
    if (fields.length !== title.length + body.length) return null;
    return allowed("deck_issue_create", "external-github-write");
  }
  const comment = /^repos\/([^/]+)\/([^/]+)\/issues\/([0-9]+)\/comments$/.exec(endpoint);
  if (comment) {
    if (!repoValue(comment[1] + "/" + comment[2])) return null;
    if (!ISSUE_KEY.test(comment[3])) return null;
    const body = fields.filter(field => field.name === "body");
    if (body.length !== 1 || !textValue(body[0].value)) return null;
    if (fields.length !== 1) return null;
    return allowed("commentIssue", "external-github-write");
  }
  return null;
}

/** Classify `gh issue comment|close|reopen|edit`. */
function classifyIssueWrite(args) {
  const subcommand = args[1];
  const key = String(args[2] ?? "");
  if (!ISSUE_KEY.test(key)) return null;
  // The vendor always starts with the key then `--repo <slug>`; keep that shape
  // so a stray flag can never be mistaken for a value.
  if (args[3] !== "--repo" || !repoValue(args[4])) return null;
  const rest = args.slice(5);
  if (subcommand === "comment") {
    if (rest.length !== 2 || rest[0] !== "--body" || !textValue(rest[1])) return null;
    return allowed("commentIssue", "external-github-write");
  }
  if (subcommand === "close") {
    if (rest.length === 0) return allowed("deck_issue_patch", "external-github-write");
    if (rest.length !== 2 || rest[0] !== "--reason" || !CLOSE_REASON.test(rest[1])) return null;
    return allowed("deck_issue_patch", "external-github-write");
  }
  if (subcommand === "reopen") {
    if (rest.length !== 0) return null;
    return allowed("deck_issue_patch", "external-github-write");
  }
  if (subcommand !== "edit") return null;
  // `gh issue edit` is a multi-flag surface; only the upstream flags are allowed.
  const flags = new Set(["--title", "--body", "--add-label", "--remove-label", "--add-assignee", "--remove-assignee"]);
  const pairs = [];
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (!flags.has(flag)) return null;
    const value = rest[index + 1];
    if (value === undefined) return null;
    if (flag === "--title" || flag === "--body") {
      if (!textValue(value)) return null;
    } else if (flag === "--add-label" || flag === "--remove-label") {
      if (!labelValue(value)) return null;
    } else if (!ASSIGNEE.test(String(value))) return null;
    pairs.push({ flag, value });
    index += 1;
  }
  if (pairs.length === 0) return null;
  return allowed("deck_issue_patch", "external-github-write");
}

/** Classify `gh label edit <name> --repo <slug> --color <hex>`. */
function classifyLabelWrite(args) {
  if (args[1] !== "edit" || !labelValue(args[2])) return null;
  if (args[3] !== "--repo" || !repoValue(args[4])) return null;
  if (args.length !== 7) return null;
  if (args[5] !== "--color" || !LABEL_COLOR.test(args[6])) return null;
  return allowed("setLabelColors", "external-github-write");
}

/**
 * True when argv is an allowlisted write this host may spawn.
 * Returns `{ method, category }` for an allowed write, else null.
 */
export function classifyWriteCommand(argv) {
  if (!Array.isArray(argv) || argv.length === 0) return null;
  const program = path.basename(String(argv[0])).replace(/\.exe$/i, "").toLowerCase();
  if (program !== "gh") return null;
  const args = argv.slice(1).map(String);
  if (args.length === 0 || /^-/.test(args[0])) return null;
  if (args[0] === "api") return classifyApiWrite(args);
  if (args[0] === "issue") return classifyIssueWrite(args);
  if (args[0] === "label") return classifyLabelWrite(args);
  return null;
}

/** Policy methods this gate can produce (used by doctor/verifies). */
export function writeGateMethods() {
  return ["commentIssue", "deck_issue_create", "deck_issue_patch", "setLabelColors"];
}
