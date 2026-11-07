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

// Codex has no host slot for the DSH status bar, run panel, or settings page.
// They live in the same panel as board tabs instead; the original components
// are unchanged, and the settings page is the same SettingsPage the host's
// settings.plugins.tab / settings.section slots would have carried.
const DEFAULT_LABELS = { board: "看板", settings: "设置", status: "状态", run: "运行" };

function PanelShell({ Panel, Settings, Status, Run, panelProps, labels = DEFAULT_LABELS }) {
  const tabs = [{ id: "board", label: labels.board, component: Panel }];
  if (Settings) tabs.push({ id: "settings", label: labels.settings ?? DEFAULT_LABELS.settings, component: Settings });
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
    }, [
      // Codex has no update host package; say so where the page's update entry
      // lives instead of leaving the user with a bare "check failed" toast.
      tab.id === "settings" && panelProps.labels?.settingsNote
        ? React.createElement("div", {
            key: "settings-note",
            className: "mattskills-note",
            "data-mattskills-settings-note": "update",
          }, panelProps.labels.settingsNote)
        : null,
      React.createElement(tab.component, { key: "panel", ...panelProps }),
    ]))
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
    // Codex has no settings.plugins.tab / settings.section host slot (#8), so the
    // page upstream registered for it becomes one more in-panel tab.
    const Settings = slots.get("settings.plugins.tab") ?? slots.get("settings.section") ?? null;
    const Status = slots.get("conversation.input.dock") ?? null;
    const Run = slots.get("tool.view.cordis") ?? null;
    const root = createRoot(element);
    root.render(React.createElement(PanelShell, {
      Panel,
      Settings,
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
