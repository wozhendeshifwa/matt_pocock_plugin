import * as React from "react";
import * as ReactDOM from "react-dom";
import { createRoot } from "react-dom/client";
import { summarizeHostContext } from "./host-context.mjs";

let plugin;
window.__ModuleLoader__ = {
  load({ id, factory }) {
    if (id !== "dsh-mattpocock-skills-deck") throw new Error("Unexpected plugin: " + id);
    plugin = factory(name => {
      if (name === "react") return React;
      if (name === "react-dom") return ReactDOM;
      throw new Error("Unmapped upstream dependency: " + name);
    });
  },
};

// Codex has no host slot for the DSH status bar or run panel. They live in the
// same panel as board tabs instead; the original components are unchanged.
const DEFAULT_LABELS = { board: "看板", status: "状态", run: "运行" };

function PanelShell({ Panel, Status, Run, panelProps, labels = DEFAULT_LABELS }) {
  const tabs = [{ id: "board", label: labels.board, component: Panel }];
  if (Status) tabs.push({ id: "status", label: labels.status, component: Status });
  if (Run) tabs.push({ id: "run", label: labels.run, component: Run });
  const [active, setActive] = React.useState("board");
  return React.createElement("div", { className: "mattskills-shell" },
    tabs.length > 1
      ? React.createElement("div", { className: "mattskills-tabs", role: "tablist" },
          tabs.map(tab => React.createElement("button", {
            key: tab.id,
            type: "button",
            role: "tab",
            "data-mattskills-tab": tab.id,
            "aria-selected": active === tab.id,
            className: active === tab.id ? "is-active" : "",
            onClick: () => setActive(tab.id),
          }, tab.label)))
      : null,
    tabs.map(tab => React.createElement("div", {
      key: tab.id,
      className: "mattskills-tabpanel",
      "data-mattskills-panel": tab.id,
      hidden: active !== tab.id,
    }, React.createElement(tab.component, panelProps)))
  );
}

// The caller provides real host services. This layer does not manufacture
// native session IDs, repository bindings, or successful action responses.
window.MattSkillsCodex = {
  summarizeHostContext,
  mount(element, hostServices, panelProps = {}) {
    if (!plugin) throw new Error("Original MattSkills client has not loaded");
    const slots = new Map();
    const disposers = [];
    const services = {
      ...hostServices,
      slots: {
        inject(name, factory) { factory(); },
        register(options, component) {
          slots.set(options.name, component);
          return () => slots.delete(options.name);
        },
      },
      sidebarRightTabs: { register() { return () => {}; } },
    };
    const context = {
      get: name => services[name],
      inject(dependencies, callback) {
        if (dependencies.every(name => services[name])) callback(context);
      },
      effect(factory) {
        const dispose = factory();
        if (typeof dispose === "function") disposers.push(dispose);
        return dispose;
      },
      on: hostServices.on ?? (() => () => {}),
    };
    plugin.apply(context);
    const Panel = slots.get("sidebar.right.pane.tab");
    if (!Panel) throw new Error("Original sidebar did not register");
    const Status = slots.get("conversation.input.dock") ?? null;
    const Run = slots.get("tool.view.cordis") ?? null;
    const root = createRoot(element);
    root.render(React.createElement(PanelShell, {
      Panel,
      Status,
      Run,
      panelProps,
      labels: panelProps.labels ?? DEFAULT_LABELS,
    }));
    return () => {
      root.unmount();
      for (const dispose of disposers.reverse()) dispose();
    };
  },
};
