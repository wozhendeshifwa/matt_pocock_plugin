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
const dispose = window.MattSkillsCodex.mount(window.document.getElementById("root"), {
  codexActions: { async prefill(target, text) { actions.push({ target, text }); } },
  sessions: { get: () => session, list: { getSnapshot: () => state, subscribe: () => () => {} } },
  connection: { rpc: { async call(channel, endpoint, request) {
    const method = request.method;
    if (["snapshot", "refresh"].includes(method)) return snapshot;
    if (method === "cwd") return { ok: true, value: { ok: true, cwd: session.cwd, workspaceRoot: session.cwd } };
    if (["handoffLatest", "handoffResolve"].includes(method)) return { ok: true, value: { ok: true, file } };
    return { ok: true, value: { ok: false, error: { kind: "unsupported" } } };
  } } },
}, { session, sessionId: session.id, useSessions: selector => selector(state) });
async function until(check) {
  for (let i = 0; i < 150; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 20)); }
  assert.fail("Handoff UI timeout");
}
const find = pattern => [...window.document.querySelectorAll('[aria-label]')].find(el => pattern.test(el.getAttribute("aria-label")));
try {
  await until(() => find(/交接：发送|Handoff: send/));
  find(/交接：发送|Handoff: send/).click();
  await until(() => actions.length === 1);
  assert.equal(actions[0].target, "active");
  assert.match(actions[0].text, /handoff/);
  file = "20261107-120000-000-test.md";
  find(/尚未生成交接文档|No handoff doc yet|开新会话并预填|Open a new session with/).click();
  await until(() => actions.length === 2);
  assert.equal(actions[1].target, "new");
  assert.ok(actions[1].text.includes(file));
  assert.ok(actions[1].text.replaceAll("\\", "/").includes(".scratch/handoff"));
  window.document.querySelector('[data-mattskills-tab="status"]').click();
  assert.match(window.document.querySelector('[data-mattskills-naming-note]').textContent, /watcher 已关闭/);
  console.log("PASS original handoff buttons generate active/new drafts; naming limitation visible");
} finally { dispose(); window.close(); }


