(async function () {
  const root = document.documentElement;
  const colorScheme = window.matchMedia?.("(prefers-color-scheme: dark)");
  let hostTheme = null;
  let appliedVariables = new Set();

  function normalizeTheme(value) {
    const theme = String(value ?? "").toLowerCase();
    return theme === "light" || theme === "dark" ? theme : null;
  }

  function variableSource(context) {
    const globals = context?.globals ?? {};
    return context?.styles?.variables ??
      context?.styles?.cssVariables ??
      context?.styleVariables ??
      context?.themeVariables ??
      globals.visualizationStyleVariables ??
      globals.themeVariables ??
      globals.styles?.variables;
  }

  function applyTheme(context = {}) {
    const globals = context.globals ?? {};
    const theme = normalizeTheme(context.theme) ??
      normalizeTheme(context.colorScheme) ??
      normalizeTheme(globals.theme) ??
      normalizeTheme(globals.visualizationTheme) ??
      normalizeTheme(window.openai?.theme);
    if (theme) {
      hostTheme = theme;
      root.dataset.theme = theme;
    } else if (!hostTheme && colorScheme) {
      root.dataset.theme = colorScheme.matches ? "dark" : "light";
    }
    if (window.MattSkillsCodex) window.MattSkillsCodex.hostTheme = root.dataset.theme ?? null;

    const variables = variableSource(context);
    if (variables && typeof variables === "object" && !Array.isArray(variables)) {
      const nextVariables = new Set();
      for (const [name, value] of Object.entries(variables)) {
        if (!name.startsWith("--") || (typeof value !== "string" && typeof value !== "number")) continue;
        root.style.setProperty(name, String(value));
        nextVariables.add(name);
      }
      for (const name of appliedVariables) {
        if (!nextVariables.has(name)) root.style.removeProperty(name);
      }
      appliedVariables = nextVariables;
    } else if (theme && appliedVariables.size) {
      for (const name of appliedVariables) root.style.removeProperty(name);
      appliedVariables = new Set();
    }
  }

  const initialOpenAi = window.openai;
  if (initialOpenAi) applyTheme({ theme: initialOpenAi.theme, styles: { variables: initialOpenAi.visualizationStyleVariables } });
  else applyTheme();

  const pending = new Map();
  let sequence = 0;
  let lastHostContextCapture = "";
  const send = message => parent.postMessage({ jsonrpc: "2.0", ...message }, "*");
  function rpc(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error("Codex host request timed out: " + method)); }, 60000);
      pending.set(id, { resolve, reject, timer });
      send({ id, method, params });
    });
  }
  async function reportHostContext(source, context) {
    const summarize = window.MattSkillsCodex?.summarizeHostContext;
    if (typeof summarize !== "function") return;
    const capture = summarize(source, context);
    const signature = JSON.stringify({ source: capture.source, keys: capture.keys, candidates: capture.candidates });
    if (signature === lastHostContextCapture) return;
    lastHostContextCapture = signature;
    try {
      await rpc("tools/call", { name: "deck_host_context_probe", arguments: { capture } });
    } catch {
      // Host-context diagnostics must never prevent the board from loading.
    }
  }
  window.addEventListener("message", event => {
    if (event.source !== parent) return;
    if (event.data?.method === "ui/notifications/host-context-changed") {
      const context = event.data.params?.hostContext ?? event.data.params ?? {};
      applyTheme(context);
      void reportHostContext("ui/notifications/host-context-changed", context);
      return;
    }
    if (event.data?.jsonrpc !== "2.0") return;
    const reply = event.data;
    const item = pending.get(reply.id);
    if (!item) return;
    clearTimeout(item.timer);
    pending.delete(reply.id);
    if (reply.error) item.reject(new Error(reply.error.message));
    else item.resolve(reply.result);
  });
  window.addEventListener("openai:set_globals", event => {
    const globals = event.detail?.globals ?? {};
    applyTheme({ globals, styles: { variables: globals.visualizationStyleVariables } });
    void reportHostContext("openai:set_globals", globals);
  });
  colorScheme?.addEventListener?.("change", () => {
    if (!hostTheme) applyTheme();
  });
  try {
    const initialization = await rpc("ui/initialize", {
      appInfo: { name: "mattskills-original-port", version: "0.2.2" },
      appCapabilities: {}, protocolVersion: "2026-01-26",
    });
    const hostContext = initialization.hostContext ?? initialization.context ?? {};
    applyTheme(hostContext);
    window.MattSkillsCodex.hostInitialization = initialization;
    window.MattSkillsCodex.hostTheme = root.dataset.theme ?? null;
    window.MattSkillsCodex.refreshHostTheme = applyTheme;
    send({ method: "ui/notifications/initialized", params: {} });
    void reportHostContext("ui/initialize", {
      initialization,
      hostContext,
      openai: window.openai ?? null,
    });
    // No verified panel-to-project association is implemented yet.
    // Keep diagnostics active without displaying the global server's repository.
    document.getElementById("root").textContent =
      "MattSkillsDeck 尚未关联当前聊天的项目。项目自动跟随适配尚未完成，暂时无法显示任务或派发草稿。";
    let current = null;
    let dispose = null;
    let checking = false;
    async function readProject() {
      const reply = await rpc("tools/call", { name: "deck_current_project", arguments: {} });
      if (reply.isError) throw new Error(reply.content?.[0]?.text ?? "项目关联失败。");
      if (!reply.structuredContent?.threadId || !reply.structuredContent?.cwd) throw new Error("项目身份不完整。");
      return reply.structuredContent;
    }
    function clearPanel(message) {
      current = null;
      dispose?.();
      dispose = null;
      document.getElementById("root").textContent = message;
    }
    async function synchronizeProject() {
      if (checking) return;
      checking = true;
      try {
        const project = await readProject();
        if (current?.threadId === project.threadId && current.cwd === project.cwd) return;
        clearPanel("");
        current = project;
        const session = { id: project.threadId, cwd: project.cwd };
        dispose = window.MattSkillsCodex.mount(document.getElementById("root"), {
          sessions: {
            list: { getSnapshot: () => ({ current: session.id, byId: { [session.id]: session }, items: [session] }), subscribe: () => () => {} },
            get: id => id === session.id ? session : undefined,
          },
          codexActions: { async prefill(target, text) {
            const active = await readProject();
            if (current !== project || active.threadId !== project.threadId || active.cwd !== project.cwd) {
              clearPanel("聊天已切换，正在重新加载项目。");
              throw new Error("聊天已切换，请在重新加载后操作。");
            }
            if (!initialization.hostCapabilities?.experimental?.["openai/message"]) throw new Error("宿主未提供聊天草稿接口。");
            return rpc("ui/message", { role: "user", content: [{ type: "text", text: String(text) }], _meta: { "openai/message": { target, send: false } } });
          } },
          connection: { rpc: { async call(channel, endpoint, request) {
            if (channel !== "/api" || endpoint !== "dsws") throw new Error("Unknown upstream channel");
            const reply = await rpc("tools/call", { name: "deck_upstream_read", arguments: { ...request, payload: { ...request.payload, expectedThreadId: project.threadId } } });
            if (current !== project) throw new Error("项目已切换，旧请求已丢弃。");
            if (reply.isError) throw new Error(reply.content?.[0]?.text ?? "项目数据读取失败。");
            return reply.structuredContent ?? JSON.parse(reply.content[0].text);
          } } },
        }, { sessionId: session.id });
      } catch (error) { clearPanel(error.message); }
      finally { checking = false; }
    }
    await synchronizeProject();
    const projectTimer = setInterval(synchronizeProject, 2000);
    window.addEventListener("pagehide", () => { clearInterval(projectTimer); clearPanel(""); }, { once: true });
  } catch (error) {
    document.getElementById("root").textContent = error.message;
  }
})();
