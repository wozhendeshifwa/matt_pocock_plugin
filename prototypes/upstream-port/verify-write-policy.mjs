import assert from "node:assert/strict";
import { WRITE_ENDPOINTS } from "./rpc-endpoints.mjs";
import {
  CATEGORIES,
  CONFIRMATION,
  DECK_TOOL_POLICY,
  WRITE_POLICY,
  isDestructive,
  policyFor,
  policySummary,
} from "./write-policy.mjs";

const policyKeys = new Set(Object.keys(WRITE_POLICY));
for (const method of WRITE_ENDPOINTS) {
  assert.ok(policyKeys.has(method), `write endpoint ${method} has no policy`);
}
assert.ok(policyKeys.has("setupLayout"), "setupLayout needs a conditional read/write policy");
for (const key of policyKeys) {
  assert.ok(WRITE_ENDPOINTS.has(key) || key === "setupLayout", `policy key ${key} is not a write endpoint`);
}
assert.equal(policyKeys.size, WRITE_ENDPOINTS.size + 1);

const unsupported = [];
for (const [method, policy] of Object.entries(WRITE_POLICY)) {
  assert.ok(CATEGORIES.includes(policy.category), `${method}: invalid category ${policy.category}`);
  assert.equal(typeof policy.confirmation, "string", `${method}: confirmation missing`);
  assert.equal(typeof policy.destructive, "boolean", `${method}: destructive missing`);
  if (policy.destructive) {
    assert.notEqual(policy.confirmation, CONFIRMATION.none, `${method}: destructive write needs confirmation`);
    assert.equal(policy.audit, true, `${method}: destructive write needs audit`);
  }
  if (policy.category === "unsupported") {
    assert.ok(policy.reason, `${method}: unsupported needs a reason`);
    unsupported.push(method);
  }
  if (["external-github-write", "git-write", "project-write"].includes(policy.category)) {
    assert.ok((policy.commands?.length ?? 0) > 0 || (policy.fsTargets?.length ?? 0) > 0,
      `${method}: write needs a command or filesystem target allowlist`);
  }
  for (const command of policy.commands ?? []) {
    assert.ok(!/[;|&<>`]|\$\(/.test(command), `${method}: command contains a shell metacharacter: ${command}`);
  }
  assert.equal(policyFor(method), policy);
}
assert.equal(policyFor("not-a-write"), null);
assert.equal(isDestructive("gitPush"), true);
assert.equal(isDestructive("gitStage"), false);
assert.equal(isDestructive("commentIssue"), false);
assert.equal(policyFor("setupLayout").conditional.includes("layout"), true);

const expectedDeckTools = [
  "deck_context", "deck_issue_get", "deck_map_snapshot", "deck_issue_list",
  "deck_issue_create", "deck_map_plan_create", "deck_map_link", "deck_issue_patch", "deck_issue_report",
];
assert.deepEqual(Object.keys(DECK_TOOL_POLICY).sort(), [...expectedDeckTools].sort());
for (const name of expectedDeckTools) {
  const policy = DECK_TOOL_POLICY[name];
  assert.ok(policy, `${name}: missing deck tool policy`);
  if (["deck_issue_create", "deck_map_plan_create", "deck_map_link", "deck_issue_patch"].includes(name)) {
    assert.equal(policy.category, "external-github-write");
    assert.ok((policy.commands?.length ?? 0) > 0, `${name}: needs command allowlist`);
  }
  if (policy.destructive) assert.notEqual(policy.confirmation, CONFIRMATION.none, `${name}: destructive needs confirmation`);
}
assert.deepEqual(policySummary().unsupported.sort(), ["deckExec", "updateInstall"]);
assert.equal(unsupported.length, 2);

console.log(`PASS write policy covers ${WRITE_ENDPOINTS.size} write endpoints + conditional setupLayout`);
console.log(`PASS ${policyKeys.size} write policies, ${expectedDeckTools.length} deck tool policies, ${unsupported.length} unsupported paths`);
