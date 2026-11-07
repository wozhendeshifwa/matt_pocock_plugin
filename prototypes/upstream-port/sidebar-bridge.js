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

  function normalizeLocale(value) {
    const raw = String(value ?? "").trim().toLowerCase();
    if (!raw) return null;
    if (raw === "zh" || raw.startsWith("zh-") || raw.startsWith("zh_")) return "zh";
    if (raw === "en" || raw.startsWith("en-") || raw.startsWith("en_")) return "en";
    return null;
  }

  function detectLocale(...values) {
    for (const value of values) {
      const locale = normalizeLocale(value);
      if (locale) return locale;
    }
    return null;
  }

  function createLocaleService(initial) {
    let active = normalizeLocale(initial) ?? "zh";
    const tables = new Map();
    const listeners = new Set();
    return {
      register(namespace, dicts) {
        tables.set(namespace, dicts || {});
        return () => tables.delete(namespace);
      },
      bind(namespace) {
        return (key, params) => {
          const dicts = tables.get(namespace) ?? {};
          const dict = dicts[active] ?? dicts.zh ?? {};
          let text = dict[key] !== undefined ? dict[key] : key;
          if (params) text = String(text).replace(/\{(\w+)\}/g, (match, name) => name in params ? String(params[name]) : match);
          return text;
        };
      },
      getSnapshot() { return { active }; },
      setActive(next) {
        const locale = normalizeLocale(next);
        if (!locale || locale === active) return false;
        active = locale;
        for (const listener of listeners) { try { listener(locale); } catch {} }
        return true;
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
  }

  const initialOpenAi = window.openai;
  const localeService = createLocaleService(detectLocale(initialOpenAi?.locale, document.documentElement.lang));
  function applyLocale(context = {}) {
    const globals = context.globals ?? {};
    const next = detectLocale(
      context.locale,
      context.hostContext?.locale,
      globals.locale,
      window.openai?.locale,
      document.documentElement.lang,
    );
    if (!next) return;
    document.documentElement.lang = next === "zh" ? "zh-CN" : "en";
    localeService.setActive(next);
    if (window.MattSkillsCodex) window.MattSkillsCodex.hostLocale = next;
  }

  if (initialOpenAi) applyTheme({ theme: initialOpenAi.theme, styles: { variables: initialOpenAi.visualizationStyleVariables } });
  else applyTheme();
  applyLocale({ locale: initialOpenAi?.locale, globals: { locale: initialOpenAi?.locale } });

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
      applyLocale(context);
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
    applyLocale({ globals });
    void reportHostContext("openai:set_globals", globals);
  });
  colorScheme?.addEventListener?.("change", () => {
    if (!hostTheme) applyTheme();
  });
  try {
    const initialization = await rpc("ui/initialize", {
      appInfo: { name: "mattskills-original-port", version: "0.3.0" },
      appCapabilities: {}, protocolVersion: "2026-01-26",
    });
    const hostContext = initialization.hostContext ?? initialization.context ?? {};
    applyTheme(hostContext);
    applyLocale(hostContext);
    window.MattSkillsCodex.hostInitialization = initialization;
    window.MattSkillsCodex.hostTheme = root.dataset.theme ?? null;
    window.MattSkillsCodex.hostLocale = localeService.getSnapshot().active;
    window.MattSkillsCodex.refreshHostTheme = applyTheme;
    send({ method: "ui/notifications/initialized", params: {} });
    void reportHostContext("ui/initialize", {
      initialization,
      hostContext,
      openai: window.openai ?? null,
    });
    // Show a neutral loading state until the host's thread identity resolves.
    document.getElementById("root").textContent = "正在识别当前聊天的项目…";
    let current = null;
    let dispose = null;
    let checking = false;
    // The board is scoped to the Codex project root, not to an individual chat.
    // Same-project chats share one project key; the thread id is only the
    // identity used for the current request and the stale-request guard.
    const projectKeyOf = project => project.projectRoot;
    const sessionOf = project => ({ id: projectKeyOf(project), cwd: projectKeyOf(project) });
    const sessions = {
      list: {
        getSnapshot: () => {
          const project = current;
          if (!project) return { current: "", byId: {}, items: [] };
          const session = sessionOf(project);
          return { current: session.id, byId: { [session.id]: session }, items: [session] };
        },
        subscribe: () => () => {},
      },
      get: id => {
        const project = current;
        const session = project ? sessionOf(project) : null;
        return session && id === session.id ? session : undefined;
      },
    };
    async function readProject() {
      const reply = await rpc("tools/call", { name: "deck_current_project", arguments: {} });
      if (reply.isError) throw new Error(reply.content?.[0]?.text ?? "项目关联失败。");
      const project = reply.structuredContent;
      if (!project?.threadId || !project?.cwd) throw new Error("项目身份不完整。");
      if (!project.projectRoot) {
        clearPanel(project.message ?? "此聊天不属于 Codex 项目。");
        return null;
      }
      return project;
    }
    function clearPanel(message) {
      const root = document.getElementById("root");
      if (current === null && !dispose) {
        if (message && root.textContent !== message) root.textContent = message;
        return;
      }
      current = null;
      dispose?.();
      dispose = null;
      if (message !== undefined) root.textContent = message;
    }
    async function synchronizeProject() {
      if (checking) return;
      checking = true;
      try {
        const project = await readProject();
        if (!project) return;
        if (current?.projectRoot === project.projectRoot) {
          // Same project, different chat: keep the mounted board and its state.
          // Only the identity used for the next request moves to the new thread.
          current = project;
          return;
        }
        clearPanel("");
        current = project;
        const mountedProject = project;
        const session = sessionOf(project);
        const useSessions = selector => {
          const active = current ? sessionOf(current) : null;
          const snapshot = active
            ? { current: active.id, byId: { [active.id]: active }, items: [active] }
            : { current: "", byId: {}, items: [] };
          return typeof selector === "function" ? selector(snapshot) : snapshot;
        };
        const language = localeService.getSnapshot().active;
        const labels = {
          board: language === "en" ? "Board" : "看板",
          status: language === "en" ? "Status" : "状态",
          run: language === "en" ? "Run" : "运行",
        };
        dispose = window.MattSkillsCodex.mount(document.getElementById("root"), {
          sessions,
          locale: localeService,
          codexActions: { async prefill(target, text) {
            if (!current || current.projectRoot !== mountedProject.projectRoot) throw new Error("项目已切换，旧面板已失效。");
            const active = await readProject();
            if (!active) throw new Error("此聊天不属于 Codex 项目。");
            if (!current || current.projectRoot !== active.projectRoot) {
              clearPanel("聊天已切换，正在重新加载项目。");
              throw new Error("聊天已切换，请在重新加载后操作。");
            }
            if (current.threadId !== active.threadId) current = active;
            if (!initialization.hostCapabilities?.experimental?.["openai/message"]) throw new Error("宿主未提供聊天草稿接口。");
            return rpc("ui/message", { role: "user", content: [{ type: "text", text: String(text) }], _meta: { "openai/message": { target, send: false } } });
          } },
          connection: { rpc: { async call(channel, endpoint, request) {
            if (channel !== "/api" || endpoint !== "dsws") throw new Error("Unknown upstream channel");
            const atCall = current;
            if (!atCall || atCall.projectRoot !== mountedProject.projectRoot) throw new Error("项目已切换，旧请求已丢弃。");
            const reply = await rpc("tools/call", { name: "deck_upstream_read", arguments: { ...request, payload: { ...request.payload, expectedThreadId: atCall.threadId } } });
            if (!current || current.threadId !== atCall.threadId || current.projectRoot !== atCall.projectRoot) throw new Error("项目已切换，旧请求已丢弃。");
            if (reply.isError) throw new Error(reply.content?.[0]?.text ?? "项目数据读取失败。");
            return reply.structuredContent ?? JSON.parse(reply.content[0].text);
          } } },
        }, { sessionId: session.id, session, useSessions, labels });
      } catch (error) { clearPanel("项目未关联：" + error.message); }
      finally { checking = false; }
    }
    await synchronizeProject();
    const projectTimer = setInterval(synchronizeProject, 2000);
    window.addEventListener("pagehide", () => { clearInterval(projectTimer); clearPanel(""); }, { once: true });
  } catch (error) {
    document.getElementById("root").textContent = error.message;
  }
})();
