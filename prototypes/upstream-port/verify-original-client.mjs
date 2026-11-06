import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM, VirtualConsole } from "jsdom";

// Load the original client unchanged. The isolated host rejects all data and
// action calls so this check cannot execute tasks or modify a tracker.
const errors = [];
const snapshot = process.argv[2] ? JSON.parse(await readFile(process.argv[2], "utf8")) : null;
const detail = process.argv[3] ? JSON.parse(await readFile(process.argv[3], "utf8")) : null;
const virtualConsole = new VirtualConsole();
virtualConsole.on("jsdomError", error => errors.push(error.message));
const dom = new JSDOM("<!doctype html><html><head></head><body><main id='root'></main></body></html>", {
  url: "https://mattskills-adapter.invalid/",
  runScripts: "outside-only",
  pretendToBeVisual: true,
  virtualConsole,
});
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
globalThis.HTMLElement = window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.ResizeObserver = class {
  observe() {}
  disconnect() {}
  unobserve() {}
};
const React = await import("react");
const ReactDOM = await import("react-dom");
const { createRoot } = await import("react-dom/client");
const slots = new Map();
const calls = new Set();
const disposers = [];
const sessionId = "isolated-render-check";
const session = { id: sessionId, cwd: snapshot?.value.workspaceRoot ?? "C:/mattskills-render-check", title: "Render check" };
const sessionSnapshot = { current: sessionId, byId: { [sessionId]: session }, items: [session] };
const services = {
  slots: {
    inject(name, factory) { factory(); },
    register(options, component) {
      slots.set(options.name, component);
      return () => slots.delete(options.name);
    },
  },
  sidebarRightTabs: { register() { return () => {}; } },
  sessions: {
    list: { getSnapshot: () => sessionSnapshot, subscribe: () => () => {} },
    get: id => id === sessionId ? session : undefined,
  },
  connection: {
    rpc: {
      async call(channel, endpoint, request) {
        assert.equal(channel, "/api");
        assert.equal(endpoint, "dsws");
        calls.add(request.method);
        if (snapshot && ["snapshot", "refresh"].includes(request.method)) return snapshot;
        if (detail && request.method === "issueDetail") return detail;
        if (request.method === "cwd") return { ok: true, value: { ok: true, cwd: session.cwd, workspaceRoot: session.cwd } };
        return { ok: true, value: { ok: false, error: { kind: "unsupported", message: "Isolated render check" } } };
      },
    },
  },
};
const context = {
  get(name) { return services[name]; },
  inject(dependencies, callback) {
    assert.ok(Array.isArray(dependencies));
    if (dependencies.every(name => services[name])) callback(context);
  },
  effect(factory) {
    const dispose = factory();
    if (typeof dispose === "function") disposers.push(dispose);
    return dispose;
  },
  on() { return () => {}; },
};
let plugin;
window.__ModuleLoader__ = {
  load({ id, factory }) {
    assert.equal(id, "dsh-mattpocock-skills-deck");
    plugin = factory(name => {
      if (name === "react") return React;
      if (name === "react-dom") return ReactDOM;
      throw new Error("Unmapped upstream dependency " + name);
    });
  },
};
const client = new URL("../../vendor/mattskills-1.8.0-rc.7/lib/client.js", import.meta.url);
window.eval(await readFile(client, "utf8"));
const root = createRoot(document.getElementById("root"));
try {
  await React.act(async () => {
    plugin.apply(context);
    const Panel = slots.get("sidebar.right.pane.tab");
    assert.ok(Panel, "The original sidebar must register");
    root.render(React.createElement(Panel, { sessionId }));
    await new Promise(resolve => setTimeout(resolve, 100));
  });
  await React.act(async () => {
    await new Promise(resolve => setTimeout(resolve, 100));
  });
  const content = document.body.textContent;
  for (const label of ["列表", "版本管理", "技能", "环境检查"]) {
    assert.ok(content.includes(label), "Original navigation missing " + label);
  }
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log("PASS unchanged upstream sidebar mounts with original navigation");
  if (snapshot) {
    assert.ok(content.includes(snapshot.value.repository.name), "Real repository name must render");
    const issue = snapshot.value.issues.find(item => item.number === 2);
    assert.ok(issue, "Reference fixture must include Issue #2");
    assert.ok(content.includes(issue.title), "Original list must render the real title");
    console.log("PASS original list renders real repository and Issue #2");
    if (detail) {
      const row = [...document.querySelectorAll('[role="button"]')]
        .find(element => element.getAttribute("aria-label") === "#2 " + issue.title);
      assert.ok(row, "Original Issue #2 row must be accessible");
      await React.act(async () => {
        row.click();
        await new Promise(resolve => setTimeout(resolve, 100));
      });
      await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 100)); });
      assert.ok(calls.has("issueDetail"), "Opening the row must request original detail");
      for (const label of ["返回列表", "目标", "已定决策", "验收", "验收证据"]) {
        assert.ok(document.body.textContent.includes(label), "Original detail missing " + label);
      }
      console.log("PASS original row opens full description, acceptance criteria and comments");
    }
  }
  console.log("Observed RPC calls: " + [...calls].sort().join(", "));
} finally {
  await React.act(async () => root.unmount());
  for (const dispose of disposers.reverse()) dispose();
  window.close();
}
