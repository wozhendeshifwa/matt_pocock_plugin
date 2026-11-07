import assert from "node:assert/strict";
import { classifyGraphWriteCommand as gate, observeGraphIssueId } from "./graph-write-gate.mjs";
import { classifyReadCommand } from "./read-command.mjs";

const repo = "wozhendeshifwa/codex_mattskills_plugin";
const scope = { method: "deck_map_link", repo, issueIds: new Set() };
const parent = ["gh", "issue", "edit", "1", "--repo", repo, "--parent", "2"];
const sub = ["gh", "api", `repos/${repo}/issues/2/sub_issues`, "--method", "POST", "-F", "sub_issue_id=123"];
const block = ["gh", "api", `repos/${repo}/issues/1/dependencies/blocked_by`, "--method", "POST", "-F", "issue_id=123"];
assert.ok(gate(parent, scope));
assert.equal(gate(block, scope), null, "unproven ID refused");
observeGraphIssueId(["gh", "api", `repos/other/repo/issues/1`, "--jq", ".id"], "123", scope);
assert.equal(gate(block, scope), null, "foreign ID read grants nothing");
observeGraphIssueId(["gh", "api", `repos/${repo}/issues/3`, "--jq", ".id"], "123\n", scope);
for (const method of ["deck_issue_create", "deck_map_plan_create", "deck_map_link"]) {
  const s = { ...scope, method };
  for (const argv of [parent, parent.slice(0, 7).with(6, "--remove-parent"), sub,
    sub.with(4, "DELETE"), block,
    ["gh", "api", `repos/${repo}/issues/1/dependencies/blocked_by/123`, "--method", "DELETE"]]) {
    assert.equal(gate(argv, s)?.method, method);
    assert.equal(classifyReadCommand(argv), false, "relationship writes never classify as reads");
  }
}
for (const s of [{}, { ...scope, method: "registry" }, { ...scope, repo: "other/repo" }, { ...scope, issueIds: new Set() }]) {
  assert.equal(gate(block, s), null);
}
for (const argv of [parent.with(7, "--help"), parent.with(7, "1"), [...parent, "--body", "x"],
  sub.with(5, "-f"), block.with(6, "issue_id=456"), block.with(6, "issue_id=123&x=1"),
  [...block, "--hostname", "evil.example"], block.with(2, "repos/other/repo/issues/1/dependencies/blocked_by"),
  ["gh", "api", "graphql", "-f", "query=mutation { addSubIssue {} }"],
  ["gh", "api", `repos/${repo}/issues/1/dependencies/blocked_by`, "--method", "DELETE"],
]) assert.equal(gate(argv, scope), null, JSON.stringify(argv));
console.log("PASS native relationship templates, per-operation ID provenance, repo/tool boundaries and mutation/flag refusals");
