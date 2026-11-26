import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM, VirtualConsole } from "jsdom";

const snapshot = JSON.parse(await readFile(process.argv[2], "utf8"));
const dom = new JSDOM('<main id="root"></main>', { url: "https://handoff-test.invalid/", runScripts: "outside-only", pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
const { window } = dom;
window.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
window.eval(await readFile(new URL("dist/client.js", import.meta.url), "utf8"));
const session = { id: "handoff-view-fixture", cwd: snapshot.value.workspaceRoot };
const state = { current: session.id, byId: { [session.id]: session }, items: [session] };
const actions = [];
let file = null;
let cancelled = false;
const clipboard = [];
Object.defineProperty(window.navigator, "clipboard", { value: { async writeText(text) { clipboard.push(text); } } });
let language = "en";
const listeners = new Set();
const dispose = window.MattSkillsCodex.mount(window.document.getElementById("root"), {
  locale: {
    getSnapshot: () => ({ active: language }),
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
  },
  codexActions: { async prefill(target, text) { actions.push({ target, text }); } },
  sessions: { get: () => session, list: { getSnapshot: () => state, subscribe: () => () => {} } },
  connection: { rpc: { async call(channel, endpoint, request) {
    const method = request.method;
    if (["snapshot", "refresh"].includes(method)) return snapshot;
    if (method === "cwd") return { ok: true, value: { ok: true, cwd: session.cwd, workspaceRoot: session.cwd } };
    if (["handoffLatest", "handoffResolve"].includes(method)) return { ok: true, value: { ok: true, file } };
    if (method === "namingPlan") return { ok: true, value: { ok: true, orders: [], tracked: [], failures: [], suggestions: cancelled ? [] : [{ id: "suggestion", title: "[#7] 恢复接手与命名流程", issueKey: "7" }] } };
    if (method === "cancelNewSessionWatcher") { cancelled = true; return { ok: true, value: { ok: true, cancelled: true } }; }
    return { ok: true, value: { ok: false, error: { kind: "unsupported" } } };
  } } },
}, { session, sessionId: session.id, useSessions: selector => selector(state) });
async function until(check) {
  for (let i = 0; i < 150; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 20)); }
  assert.fail("Handoff UI timeout");
}
const find = pattern => [...window.document.querySelectorAll('[aria-label]')].find(el => pattern.test(el.getAttribute("aria-label")));
try {
  const boardAction = name => window.document.querySelector('[data-mattskills-panel="board"] [data-board-action="' + name + '"]');
  await until(() => boardAction('handoff'));
  const header = boardAction('handoff').closest('[data-head-tier]');
  assert.ok(header, "Chat actions must be in the repository toolbar");
  const toolbarItems = [...header.children];
  const actionGroup = boardAction('handoff').parentElement;
  assert.ok(toolbarItems.indexOf(header.querySelector('[data-head-icon="palette"]')) < toolbarItems.indexOf(actionGroup));
  assert.ok(header.querySelector('[data-head-refresh]'));
  assert.equal(window.document.querySelector('[data-mattskills-panel="board"]').hidden, false);
  boardAction('handoff').click();
  await until(() => actions.length === 1);
  assert.equal(actions[0].target, "active");
  assert.match(actions[0].text, /handoff/);
  file = "20261107-120000-000-test.md";
  boardAction('new').click();
  await until(() => actions.length === 2);
  assert.equal(actions[1].target, "new");
  assert.ok(actions[1].text.includes(file));
  assert.ok(actions[1].text.replaceAll("\\", "/").includes(".scratch/handoff"));
  boardAction('fixate').click();
  await until(() => actions.length === 3);
  assert.equal(actions[2].target, "active");
  assert.ok(actions[2].text.length > 100, "Consolidation must inject the full upstream template");
  window.document.querySelector('[data-mattskills-tab="status"]').click();
  const note = () => window.document.querySelector('[data-mattskills-naming-note]').textContent;
  await until(() => note().includes("watchers are disabled"));
  const button = text => [...window.document.querySelectorAll('[data-manual-naming] button')].find(el => el.textContent === text);
  button("View naming suggestions").click();
  await until(() => window.document.querySelector('[aria-label="Suggested chat name"]'));
  await until(() => !button("Copy name").disabled);
  clipboard.length = 0;
  button("Copy name").click();
  await until(() => clipboard.length === 1);
  assert.equal(clipboard[0], "[#7] 恢复接手与命名流程");
  await until(() => !button("Cancel suggestion").disabled);
  button("Cancel suggestion").click();
  await until(() => cancelled && !window.document.querySelector('[aria-label="Suggested chat name"]'));
  language = "zh";
  for (const listener of listeners) listener();
  await until(() => note().includes("watcher 已关闭"));
  console.log("PASS board handoff/new/consolidation buttons generate drafts; naming limitation visible");
} finally { dispose(); window.close(); }
