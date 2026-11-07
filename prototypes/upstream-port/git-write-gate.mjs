// Exact vendor command recipes, bound to the active RPC and project. No shell.
import path from "node:path";
import { fixedPrefix, REMOTE_PATTERN, BRANCH_PATTERN } from "../../vendor/mattskills-1.8.0-rc.7/shared/version-control/commands.js";

export const GIT_WRITES = ["gitStage", "gitUnstage", "gitCommit", "gitPull", "gitFetch", "gitPush", "initPublish", "retryPush"];
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clean = s => typeof s === "string" && !/[\u0000-\u001f\u007f]/.test(s);
export function safeRepoUrl(s) {
  return typeof s === "string" && /^https:\/\/github\.com\/[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}(?:\.git)?$/.test(s);
}
function safePath(s) {
  return clean(s) && s.length > 0 && !path.isAbsolute(s) && !/^[\\/]|^[A-Za-z]:/.test(s) &&
    !s.split(/[\\/]/).some(p => p === ".." || p.toLowerCase() === ".git");
}
export function classifyGitWriteCommand(argv, { method, cwd, workspaceRoot } = {}) {
  if (!GIT_WRITES.includes(method) || !Array.isArray(argv) || !workspaceRoot || !cwd) return null;
  if (path.resolve(cwd) !== path.resolve(workspaceRoot)) return null;
  const program = path.basename(String(argv[0])).replace(/\.exe$/i, "").toLowerCase();
  let a = argv.slice(1);
  if (program === "gh") {
    if (method !== "initPublish" || a[0] !== "repo" || a[1] !== "create" ||
        !/^[A-Za-z0-9._-]{1,100}$/.test(a[2] ?? "") || a[2].startsWith("-") ||
        !["--private", "--public"].includes(a[3])) return null;
    if (!equal(a.slice(4), []) && !equal(a.slice(4), ["--source=.", "--push"])) return null;
    return { method, category: "git-write", configChange: true };
  }
  if (program !== "git") return null;
  if (a[0] === "-C") {
    if (path.resolve(a[1] ?? "") !== path.resolve(workspaceRoot)) return null;
    a = a.slice(2);
  }
  const publish = method === "initPublish" || method === "retryPush";
  if (!publish) {
    if (equal(a.slice(0, 2), ["-c", "credential.interactive=false"])) a = a.slice(2);
    const prefix = fixedPrefix();
    if (!equal(a.slice(0, prefix.length), prefix)) return null;
    a = a.slice(prefix.length);
  }
  let ok = false, configChange = false, identity;
  if (method === "gitStage") ok = a[0] === "add" && a[1] === "--" && a.length > 2 && a.slice(2).every(safePath);
  if (method === "gitUnstage") ok = equal(a.slice(0, 3), ["reset", "HEAD", "--"]) && a.length > 3 && a.slice(3).every(safePath);
  if (method === "gitCommit") ok = a.length === 3 && a[0] === "commit" && a[1] === "-m" && clean(a[2].replace(/[\r\n\t]/g, "")) && a[2].trim().length > 0 && a[2].length <= 60000;
  if (method === "gitPull") ok = equal(a, ["pull", "--ff-only"]);
  if (method === "gitFetch") ok = a.length === 2 && a[0] === "fetch" && REMOTE_PATTERN.test(a[1]);
  if (method === "gitPush") {
    configChange = a[1] === "-u";
    const p = configChange ? a.slice(2) : a.slice(1);
    const spec = String(p[2] ?? "").split(":");
    ok = a[0] === "push" && p.length === 3 && p[0] === "--no-follow-tags" && REMOTE_PATTERN.test(p[1]) &&
      spec.length === 2 && spec.every(s => BRANCH_PATTERN.test(s) && s.length > 0);
  }
  if (publish) {
    if (method === "initPublish") {
      ok = equal(a, ["init"]) || equal(a, ["add", "."]) || equal(a, ["commit", "-m", "initial commit", "--allow-empty"]);
      // Vendor fallback identities are request-local env, never config writes.
      if (equal(a, ["config", "user.email", "dsh@local"])) identity = { GIT_AUTHOR_EMAIL: "dsh@local", GIT_COMMITTER_EMAIL: "dsh@local" };
      if (equal(a, ["config", "user.name", "DSH User"])) identity = { GIT_AUTHOR_NAME: "DSH User", GIT_COMMITTER_NAME: "DSH User" };
      if (identity) ok = true;
      if (equal(a.slice(0, 3), ["remote", "set-url", "origin"]) && a.length === 4 && safeRepoUrl(a[3])) ok = configChange = true;
    }
    if (equal(a, ["push", "-u", "origin", "HEAD"])) ok = configChange = true;
    if (method === "retryPush" && equal(a.slice(0, 3), ["remote", "add", "origin"]) && a.length === 4 && safeRepoUrl(a[3])) ok = configChange = true;
  }
  return ok ? { method, category: "git-write", configChange, identity, paths: ["gitStage", "gitUnstage"].includes(method) ? a.slice(method === "gitStage" ? 2 : 3) : [] } : null;
}
