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
    const root = createRoot(element);
    root.render(React.createElement(Panel, panelProps));
    return () => {
      root.unmount();
      for (const dispose of disposers.reverse()) dispose();
    };
  },
};
