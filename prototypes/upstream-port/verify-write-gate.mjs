import assert from "node:assert/strict";
import { classifyWriteCommand, writeGateMethods } from "./write-gate.mjs";
import { DECK_TOOL_POLICY, WRITE_POLICY } from "./write-policy.mjs";

const policyFor = method => WRITE_POLICY[method] ?? DECK_TOOL_POLICY[method] ?? null;

// Ticket #12: the write gate is the single place that decides whether the Codex
// host may spawn a write. These cases pin the two directions: every upstream argv
// template the port now needs passes, and everything else keeps failing closed.

const repo = "wozhendeshifwa/codex_mattskills_plugin";
const cases = [
  {
    name: "vendor comment via REST (comments.js)",
    argv: ["gh", "api", `repos/${repo}/issues/7/comments`, "--method", "POST", "-f", "body=hello", "--jq", "."],
    method: "commentIssue",
  },
  {
    name: "vendor comment fallback (gh issue comment)",
    argv: ["gh", "issue", "comment", "7", "--repo", repo, "--body", "hello"],
    method: "commentIssue",
  },
  {
    name: "label color save (label-colors-ops.js)",
    argv: ["gh", "label", "edit", "bug", "--repo", repo, "--color", "d73a4a"],
    method: "setLabelColors",
  },
  {
    name: "close (issues-write.js)",
    argv: ["gh", "issue", "close", "7", "--repo", repo],
    method: "deck_issue_patch",
  },
  {
    name: "close with reason",
    argv: ["gh", "issue", "close", "7", "--repo", repo, "--reason", "not planned"],
    method: "deck_issue_patch",
  },
  {
    name: "reopen",
    argv: ["gh", "issue", "reopen", "7", "--repo", repo],
    method: "deck_issue_patch",
  },
  {
    name: "title/body edit (updateIssue)",
    argv: ["gh", "issue", "edit", "7", "--repo", repo, "--title", "new title", "--body", "new body"],
    method: "deck_issue_patch",
  },
  {
    name: "label attach/detach (labels.js)",
    argv: ["gh", "issue", "edit", "7", "--repo", repo, "--add-label", "ready-for-agent", "--remove-label", "needs-triage"],
    method: "deck_issue_patch",
  },
  {
    name: "assignee replacement",
    argv: ["gh", "issue", "edit", "7", "--repo", repo, "--add-assignee", "octocat", "--remove-assignee", "hubot"],
    method: "deck_issue_patch",
  },
  {
    name: "handoff claim (add self only)",
    argv: ["gh", "issue", "edit", "7", "--repo", repo, "--add-assignee", "@me"],
    method: "deck_issue_patch",
  },
  {
    name: "create issue via REST",
    argv: ["gh", "api", `repos/${repo}/issues`, "--method", "POST", "-f", "title=t", "-f", "body=b", "--jq", "."],
    method: "deck_issue_create",
  },
  {
    name: "shell-looking body stays data (no shell is used)",
    argv: ["gh", "issue", "comment", "7", "--repo", repo, "--body", "x && rm -rf /"],
    method: "commentIssue",
  },
];
for (const item of cases) {
  const result = classifyWriteCommand(item.argv);
  assert.ok(result, `expected allow: ${item.name}`);
  assert.equal(result.method, item.method, `wrong method for ${item.name}`);
  const policy = policyFor(result.method);
  assert.ok(policy, `${item.name}: ${result.method} has no write policy`);
  assert.equal(result.category, policy.category, `${item.name}: category must match write-policy`);
  console.log(`PASS allow ${item.name} -> ${result.method}`);
}

const denied = [
  ["git add (git writes belong to #9)", ["git", "add", "--", "README.md"]],
  ["git push", ["git", "push", "origin", "main"]],
  ["arbitrary gh api endpoint", ["gh", "api", `repos/${repo}/labels`, "--method", "POST", "-f", "name=x"]],
  ["graphql mutation", ["gh", "api", "graphql", "-f", "query=mutation { x }"]],
  ["delete method", ["gh", "api", `repos/${repo}/issues/7/comments`, "--method", "DELETE"]],
  ["unknown repo shape", ["gh", "issue", "comment", "7", "--repo", "not-a-repo", "--body", "x"]],
  ["non-numeric issue key", ["gh", "issue", "close", "abc", "--repo", repo]],
  ["flag smuggled as issue key", ["gh", "issue", "close", "--repo", repo, "--reason", "completed"]],
  ["extra gh flag", ["gh", "issue", "close", "7", "--repo", repo, "--comment", "x"]],
  ["unknown edit flag", ["gh", "issue", "edit", "7", "--repo", repo, "--add-project", "board"]],
  ["bad label color", ["gh", "label", "edit", "bug", "--repo", repo, "--color", "red"]],
  ["extra label flag", ["gh", "label", "edit", "bug", "--repo", repo, "--color", "d73a4a", "--force"]],
  ["empty comment body", ["gh", "issue", "comment", "7", "--repo", repo, "--body", ""]],
  ["label name with newline", ["gh", "issue", "edit", "7", "--repo", repo, "--add-label", "a\nb"]],
  ["oversized body", ["gh", "issue", "comment", "7", "--repo", repo, "--body", "x".repeat(60001)]],
  ["missing body flag", ["gh", "issue", "comment", "7", "--repo", repo]],
  ["comment on missing repo flag", ["gh", "issue", "comment", "7", "--body", "x"]],
  ["jq injected filter", ["gh", "api", `repos/${repo}/issues/7/comments`, "--method", "POST", "-f", "body=x", "--jq", ".url"]],
  ["field other than body", ["gh", "api", `repos/${repo}/issues/7/comments`, "--method", "POST", "-f", "body=x", "-f", "labels=y"]],
  ["repo delete", ["gh", "repo", "delete", repo, "--yes"]],
  ["non-gh program", ["node", "-e", "1"]],
];
for (const [name, argv] of denied) {
  assert.equal(classifyWriteCommand(argv), null, `expected deny: ${name}`);
  console.log(`PASS deny ${name}`);
}

for (const method of writeGateMethods()) {
  assert.ok(policyFor(method), `gate method ${method} has no policy (write-policy or deck tool policy)`);
}
assert.deepEqual(writeGateMethods().sort(), ["commentIssue", "deck_issue_create", "deck_issue_patch", "setLabelColors"]);
console.log(`PASS write gate: ${cases.length} allowed templates, ${denied.length} refused shapes, ${writeGateMethods().length} policy methods`);
