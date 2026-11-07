// Write authority model for the Codex port. This module is the single source
// of truth for which upstream writes are allowed, how they are confirmed, and
// where their argv / filesystem targets are allowlisted. It does not execute
// writes; #12/#18/#9/#4/#7 consume it when they implement the actual surfaces.

export const WRITE_AUDIT_FILE = "write-audit.jsonl";

// The upstream write endpoints this port has actually opened. One list so the
// node host and the panel bridge injected by the server cannot drift apart.
// #12 opened the issue surface; #18 opened the settings surface (log switch,
// log clear, and opening a folder/file that already lives under an allowed
// root). #9 opens the Git write/publication family. Other endpoints fail closed.
export const ENABLED_WRITE_ENDPOINTS = Object.freeze([
  "commentIssue",
  "setLabelColors",
  "bind",
  "handoffResolve",
  "cancelNewSessionWatcher",
  "logSetSwitch",
  "logClear",
  "openFolder",
  "openPath",
  "gitStage", "gitUnstage", "gitCommit", "gitPull", "gitFetch", "gitPush", "initPublish", "retryPush",
]);

export const CATEGORIES = Object.freeze([
  "project-write",
  "external-github-write",
  "git-write",
  "local-state-write",
  "read-only-export",
  "host-side-effect",
  "unsupported",
]);

export const CONFIRMATION = Object.freeze({
  upstreamDialog: "upstream-dialog",
  toolApproval: "codex-tool-approval",
  explicitPath: "explicit-path",
  none: "none",
  unsupported: "unsupported",
});

const GIT_PREFIX = "git --no-optional-locks --literal-pathspecs -c push.followTags=false -c push.default=nothing -c core.quotepath=false -c color.ui=false -c i18n.logOutputEncoding=UTF-8";

export const WRITE_POLICY = Object.freeze({
  commentIssue: {
    category: "external-github-write",
    confirmation: CONFIRMATION.upstreamDialog,
    destructive: false,
    commands: [
      "gh api repos/{owner}/{repo}/issues/{n}/comments --method POST -f body={body} --jq .",
      "gh issue comment {n} --repo {owner}/{repo} --body {body}",
    ],
    fsTargets: [],
    audit: true,
  },
  bind: {
    category: "project-write",
    confirmation: CONFIRMATION.upstreamDialog,
    destructive: false,
    commands: [],
    fsTargets: [
      "<project>/docs/agents/workspace.json",
      "<project>/docs/agents/label-colors.json",
      "<data-root>/.dsh/mattskillsdeck/choices.json",
    ],
    audit: true,
  },
  setupLayout: {
    category: "local-state-write",
    confirmation: CONFIRMATION.upstreamDialog,
    destructive: false,
    commands: [],
    fsTargets: ["<data-root>/.dsh/mattskillsdeck/choices.json"],
    conditional: "read when layout is null; write only when layout is supplied",
    audit: true,
  },
  setLabelColors: {
    category: "external-github-write",
    confirmation: CONFIRMATION.upstreamDialog,
    destructive: false,
    commands: ["gh label edit {name} --repo {owner}/{repo} --color {6hex}"],
    fsTargets: ["<project>/docs/agents/label-colors.json (markdown backend)"],
    audit: true,
  },
  handoffResolve: {
    category: "read-only-export",
    confirmation: CONFIRMATION.none,
    destructive: false,
    commands: [],
    fsTargets: [],
    audit: true,
  },
  namingRegister: {
    category: "local-state-write",
    confirmation: CONFIRMATION.none,
    destructive: false,
    commands: [],
    fsTargets: ["<data-root>/.dsh-mattskillsdeck-cache/naming-guardian.json"],
    audit: true,
  },
  registerNewSessionWatcher: {
    category: "local-state-write",
    confirmation: CONFIRMATION.none,
    destructive: false,
    commands: [],
    fsTargets: ["<data-root>/.dsh-mattskillsdeck-cache/naming-guardian.json"],
    audit: true,
  },
  namingSignal: {
    category: "local-state-write",
    confirmation: CONFIRMATION.none,
    destructive: false,
    commands: [],
    fsTargets: ["<data-root>/.dsh-mattskillsdeck-cache/naming-guardian.json"],
    audit: true,
  },
  namingResult: {
    category: "local-state-write",
    confirmation: CONFIRMATION.none,
    destructive: false,
    commands: [],
    fsTargets: ["<data-root>/.dsh-mattskillsdeck-cache/naming-guardian.json"],
    audit: true,
  },
  cancelNewSessionWatcher: {
    category: "local-state-write",
    confirmation: CONFIRMATION.none,
    destructive: false,
    commands: [],
    fsTargets: ["<data-root>/manual-naming.json (cancel current manual suggestion only)"],
    audit: true,
  },
  gitStage: {
    category: "git-write",
    confirmation: CONFIRMATION.upstreamDialog,
    destructive: false,
    commands: [`${GIT_PREFIX} add -- {paths}`],
    fsTargets: [],
    audit: true,
  },
  gitUnstage: {
    category: "git-write",
    confirmation: CONFIRMATION.upstreamDialog,
    destructive: false,
    commands: [`${GIT_PREFIX} reset HEAD -- {paths}`],
    fsTargets: [],
    audit: true,
  },
  gitCommit: {
    category: "git-write",
    confirmation: CONFIRMATION.upstreamDialog,
    destructive: false,
    commands: [`${GIT_PREFIX} commit -m {message}`],
    fsTargets: [],
    audit: true,
  },
  gitPull: {
    category: "git-write",
    confirmation: CONFIRMATION.upstreamDialog,
    destructive: false,
    commands: [`${GIT_PREFIX} pull --ff-only`],
    fsTargets: [],
    audit: true,
  },
  gitFetch: {
    category: "git-write",
    confirmation: CONFIRMATION.upstreamDialog,
    destructive: false,
    commands: [`${GIT_PREFIX} fetch {remote?}`],
    fsTargets: [],
    audit: true,
  },
  gitPush: {
    category: "git-write",
    confirmation: CONFIRMATION.toolApproval,
    destructive: true,
    commands: [`${GIT_PREFIX} push --no-follow-tags {remote} {localBranch}:{remoteBranch}`],
    fsTargets: [],
    audit: true,
    notes: "No force push; refspec must not start with '+'; first push may add -u.",
  },
  initPublish: {
    category: "git-write",
    confirmation: CONFIRMATION.toolApproval,
    destructive: true,
    commands: [
      "git init",
      "git add .",
      "git commit --allow-empty -m {message} (with request-local identity env fallback)",
      "gh repo create {name} {visibility} --source=. --push",
      "git remote set-url origin {remoteUrl}",
      "git push -u origin HEAD",
    ],
    fsTargets: [],
    audit: true,
    notes: "Git config is backed up before remote/upstream changes. No global safe.directory writes; identity fallback uses environment only.",
  },
  retryPush: {
    category: "git-write",
    confirmation: CONFIRMATION.toolApproval,
    destructive: true,
    commands: ["git push -u origin HEAD"],
    fsTargets: [],
    audit: true,
  },
  logSetSwitch: {
    category: "local-state-write",
    confirmation: CONFIRMATION.none,
    destructive: false,
    commands: [],
    fsTargets: ["<data-root>/.dsh-mattskillsdeck-cache/log-switch.json"],
    audit: true,
  },
  logClear: {
    category: "local-state-write",
    confirmation: CONFIRMATION.upstreamDialog,
    destructive: true,
    commands: [],
    fsTargets: ["<data-root>/.dsh-mattskillsdeck-cache/logs/YYYY-MM-DD.log"],
    audit: true,
  },
  openFolder: {
    category: "host-side-effect",
    confirmation: CONFIRMATION.upstreamDialog,
    destructive: false,
    commands: [],
    fsTargets: [],
    audit: true,
    supported: "deferred to #18; may map to openai/files/open",
  },
  openPath: {
    category: "host-side-effect",
    confirmation: CONFIRMATION.upstreamDialog,
    destructive: false,
    commands: [],
    fsTargets: [],
    audit: true,
    supported: "deferred to #18; may map to openai/files/open",
  },
  pickDirectory: {
    category: "host-side-effect",
    confirmation: CONFIRMATION.explicitPath,
    destructive: false,
    commands: [],
    fsTargets: [],
    audit: true,
    supported: "unsupported unless Codex exposes a picker; use explicit path input",
  },
  pickFile: {
    category: "host-side-effect",
    confirmation: CONFIRMATION.explicitPath,
    destructive: false,
    commands: [],
    fsTargets: [],
    audit: true,
    supported: "unsupported unless Codex exposes a picker; use explicit path input",
  },
  updateInstall: {
    category: "unsupported",
    confirmation: CONFIRMATION.unsupported,
    destructive: true,
    reason: "dsh-plugin-update is not vendored; the port updates from its repo checkout, not from inside the MCP server.",
    audit: true,
  },
  deckExec: {
    category: "unsupported",
    confirmation: CONFIRMATION.unsupported,
    destructive: true,
    reason: "ADR-0002 keeps the prefill boundary; the port has no independent task engine.",
    audit: true,
  },
});

export const DECK_TOOL_POLICY = Object.freeze({
  deck_context: { category: "read", confirmation: CONFIRMATION.none, destructive: false },
  deck_issue_get: { category: "read", confirmation: CONFIRMATION.none, destructive: false },
  deck_map_snapshot: { category: "read", confirmation: CONFIRMATION.none, destructive: false },
  deck_issue_list: { category: "read", confirmation: CONFIRMATION.none, destructive: false },
  deck_issue_create: {
    category: "external-github-write",
    confirmation: CONFIRMATION.toolApproval,
    destructive: false,
    commands: ["gh api repos/{owner}/{repo}/issues --method POST -f title={title} -f body={body}", "gh issue edit {n} --add-label/--remove-label", "gh issue edit {n} --add-assignee/--remove-assignee", "gh issue edit {n} --parent {parent}"],
  },
  deck_map_plan_create: {
    category: "external-github-write",
    confirmation: CONFIRMATION.toolApproval,
    destructive: false,
    commands: ["gh api repos/{owner}/{repo}/issues --method POST ...", "gh issue edit {n} --parent {parent}", "gh api repos/{owner}/{repo}/issues/{n}/dependencies/blocked_by --method POST -F issue_id={dbId}"],
  },
  deck_map_link: {
    category: "external-github-write",
    confirmation: CONFIRMATION.toolApproval,
    destructive: false,
    commands: [
      "gh issue edit {n} --repo {owner}/{repo} --parent {parent}|--remove-parent",
      "gh api repos/{owner}/{repo}/issues/{parent}/sub_issues --method POST/DELETE -F sub_issue_id={dbId}",
      "gh api repos/{owner}/{repo}/issues/{n}/dependencies/blocked_by --method POST -F issue_id={dbId}",
      "gh api repos/{owner}/{repo}/issues/{n}/dependencies/blocked_by/{dbId} --method DELETE",
    ],
  },
  deck_issue_patch: {
    category: "external-github-write",
    confirmation: CONFIRMATION.toolApproval,
    destructive: true,
    commands: ["gh issue edit {n} --title/--body/--add-label/--remove-label/--add-assignee/--remove-assignee", "gh issue close/reopen {n} --repo {owner}/{repo}"],
  },
  deck_issue_report: {
    category: "local-state-write",
    confirmation: CONFIRMATION.none,
    destructive: false,
    commands: [],
    fsTargets: ["<data-root>/.dsh-mattskillsdeck-cache/session-tickets.json"],
  },
});

export function policyFor(method) {
  return WRITE_POLICY[method] ?? null;
}

export function isDestructive(method) {
  return WRITE_POLICY[method]?.destructive === true;
}

export function policySummary() {
  return {
    writes: Object.keys(WRITE_POLICY).sort(),
    deckTools: Object.keys(DECK_TOOL_POLICY).sort(),
    unsupported: Object.entries(WRITE_POLICY)
      .filter(([, policy]) => policy.category === "unsupported")
      .map(([method]) => method),
  };
}
