import path from "node:path";

// Only the three approved map tools may change native relationships. IDs are
// capabilities learned from successful repo-scoped reads in THIS operation;
// neither caller-supplied IDs nor a previous tool call's IDs are trusted.
const METHODS = new Set(["deck_issue_create", "deck_map_plan_create", "deck_map_link"]);
const KEY = /^[1-9][0-9]{0,9}$/;
const ID = /^[1-9][0-9]{0,15}$/;
const REPO = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;

function argsOf(argv) {
  if (!Array.isArray(argv) || path.basename(String(argv[0])).replace(/\.exe$/i, "").toLowerCase() !== "gh") return null;
  return argv.slice(1);
}

export function classifyGraphWriteCommand(argv, scope = {}) {
  const a = argsOf(argv);
  if (!a || !METHODS.has(scope.method) || !REPO.test(scope.repo ?? "")) return null;
  const yes = () => ({ method: scope.method, category: "external-github-write" });
  if (a[0] === "issue" && a[1] === "edit" && KEY.test(a[2]) && a[3] === "--repo" && a[4] === scope.repo) {
    if (a.length === 7 && a[5] === "--parent" && KEY.test(a[6]) && a[2] !== a[6]) return yes();
    if (a.length === 6 && a[5] === "--remove-parent") return yes();
    return null;
  }
  if (a[0] !== "api" || a[2] !== "--method") return null;
  const prefix = `repos/${scope.repo}/issues/`;
  if (typeof a[1] !== "string" || !a[1].startsWith(prefix)) return null;
  const m = /^([1-9][0-9]{0,9})\/(sub_issues|dependencies\/blocked_by)(?:\/([1-9][0-9]{0,15}))?$/.exec(a[1].slice(prefix.length));
  if (!m) return null;
  let id;
  if (m[2] === "dependencies/blocked_by" && m[3]) {
    if (a.length !== 4 || a[3] !== "DELETE") return null;
    id = m[3];
  } else {
    if (m[3] || a.length !== 6 || a[4] !== "-F") return null;
    if (!(a[3] === "POST" || (m[2] === "sub_issues" && a[3] === "DELETE"))) return null;
    const field = m[2] === "sub_issues" ? "sub_issue_id=" : "issue_id=";
    if (typeof a[5] !== "string" || !a[5].startsWith(field)) return null;
    id = a[5].slice(field.length);
  }
  if (!ID.test(id) || !Number.isSafeInteger(Number(id)) || !scope.issueIds?.has(id)) return null;
  return yes();
}

export function observeGraphIssueId(argv, stdout, scope = {}) {
  const a = argsOf(argv);
  if (!a || !METHODS.has(scope.method) || !REPO.test(scope.repo ?? "")) return;
  const prefix = `repos/${scope.repo}/issues/`;
  if (a.length !== 4 || a[0] !== "api" || !String(a[1]).startsWith(prefix) ||
      !KEY.test(String(a[1]).slice(prefix.length)) || a[2] !== "--jq" || a[3] !== ".id") return;
  const id = String(stdout).trim();
  if (ID.test(id) && Number.isSafeInteger(Number(id))) scope.issueIds?.add(id);
}
