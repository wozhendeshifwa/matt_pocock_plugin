import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM, VirtualConsole } from "jsdom";

const snapshot = JSON.parse(await readFile(process.argv[2], "utf8"));
const detail = JSON.parse(await readFile(process.argv[3], "utf8"));
const errors = [];
const consoleBridge = new VirtualConsole();
consoleBridge.on("jsdomError", error => errors.push(error.message));
const dom = new JSDOM('<!doctype html><html><body><main id="root"></main></body></html>', {
  url: "https://mattskills-adapter.invalid/", runScripts: "outside-only",
  pretendToBeVisual: true, virtualConsole: consoleBridge,
});
const { window } = dom;
window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
const session = { id: "build-test-only", cwd: snapshot.value.workspaceRoot };
const calls = [];
const actions = [];
window.eval(await readFile(new URL("dist/client.js", import.meta.url), "utf8"));
const useSessions = selector => {
  const snapshot = { current: session.id, byId: { [session.id]: session }, items: [session] };
  return typeof selector === "function" ? selector(snapshot) : snapshot;
};
const dispose = window.MattSkillsCodex.mount(window.document.getElementById("root"), {
  codexActions: { capabilities: { reliableDraft: true }, async prefill(target, text) { actions.push({ target, text }); return { status: "filled", target }; } },
  sessions: process.env.DECK_TEST_NO_SESSION ? undefined : {
    list: { getSnapshot: () => ({ current: session.id, byId: { [session.id]: session }, items: [session] }), subscribe: () => () => {} },
    get: id => id === session.id ? session : undefined,
  },
  connection: { rpc: { async call(channel, endpoint, request) {
    assert.equal(channel, "/api");
    assert.equal(endpoint, "dsws");
    calls.push(request.method);
    if (["snapshot", "refresh"].includes(request.method)) return snapshot;
    if (request.method === "issueDetail") return detail;
    if (request.method === "cwd") return { ok: true, value: { ok: true, cwd: session.cwd, workspaceRoot: session.cwd } };
    return { ok: true, value: { ok: false, error: { kind: "unsupported", message: "Build verification" } } };
  } } },
}, process.env.DECK_TEST_NO_SESSION ? {} : { sessionId: session.id, session, useSessions });
async function until(check) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail("Timed out waiting for original UI");
}
try {
  const title = snapshot.value.issues.find(issue => issue.number === 2).title;
  const row = () => [...window.document.querySelectorAll('[role="button"]')]
    .find(element => element.getAttribute("aria-label") === "#2 " + title);
  await until(row);
  assert.ok(window.document.body.textContent.includes(snapshot.value.repository.name));
  row().click();
  await until(() => window.document.body.textContent.includes("验收证据"));
  for (const text of [title, "返回列表", "目标", "已定决策", "验收", "新会话"]) {
    assert.ok(window.document.body.textContent.includes(text), "Missing original content: " + text);
  }
  assert.ok(calls.includes("issueDetail"));
  const toggle = window.document.querySelector('[data-bottom-action-toggle]');
  assert.ok(toggle, "Accepted detail bottom action bar must be present");
  toggle.click();
  await until(() => window.document.querySelector('[data-issue-action-draft]'));
  for (const target of ["active", "new"]) {
    window.document.querySelector(`[data-issue-action-export="${target}"]`).click();
    await until(() => actions.some(action => action.target === target));
  }
  assert.equal(actions[0].text, actions[1].text, "Original action prompt must be preserved across targets");
  assert.match(actions[0].text, /^\$[a-z-]+/, "Both host targets must receive the selected Codex skill prefix");
  assert.ok(actions[0].text.includes("2"));
  for (const id of ["board", "status", "run"]) {
    assert.ok(window.document.querySelector(`[data-mattskills-tab="${id}"]`), `Panel tab ${id} must render`);
  }
  for (const id of ["status", "run"]) {
    window.document.querySelector(`[data-mattskills-tab="${id}"]`).click();
    await until(() => {
      const panel = window.document.querySelector(`[data-mattskills-panel="${id}"]`);
      return panel && !panel.hidden && panel.textContent.trim().length > 0;
    });
    assert.ok(window.document.body.textContent.length > 0);
  }
  assert.deepEqual(errors, []);
  console.log("PASS bundled production React, original list, row interaction, full detail and comments");
  console.log("PASS accepted bottom action bar produces the same reviewed prompt with separate host targets");
  console.log("PASS panel-internal board/status/run tabs render from the original slot components");
} finally {
  dispose();
  window.close();
}
