import { createInterface } from "node:readline";
import { boardAction } from "./board.mjs";

const uri = "ui://deck-sidebar/board.html";
const supportedUris = new Set([
  uri,
  "ui://deck-sidebar/board-v3.html",
  "ui://deck-sidebar/board-v4.html",
]);
const mimeType = "text/html;profile=mcp-app";
const panel = { uri, name: "MattSkillsDeck", mimeType };
const previews = new Map();
const html = String.raw`<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>MattSkillsDeck</title>
<style>
  :root {
    color-scheme: light dark;
    --canvas: light-dark(#fafafa, #191919);
    --card: light-dark(#fff, #232323);
    --text: light-dark(#202124, #eee);
    --muted: light-dark(#61656c, #b1b3ba);
    --line: light-dark(#e0e2e6, #3b3d43);
    --accent: light-dark(#3949ab, #b8c3ff);
    --accent-bg: light-dark(#eff1ff, #292f4c);
    --success: light-dark(#16643f, #8fddb1);
    --danger: light-dark(#a12f38, #ffa9af);
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--canvas); color: var(--text); font: 13px/1.5 system-ui, sans-serif; }
  main { max-width: 1000px; margin: auto; padding: clamp(12px, 3vw, 22px); }
  header { padding-bottom: 12px; border-bottom: 1px solid var(--line); }
  h1 { font-size: 21px; line-height: 1.25; margin: 6px 0 4px; letter-spacing: -.025em; }
  h2 { font-size: 14px; margin: 0; }
  p { margin: 0; }
  .repo, .empty { color: var(--muted); overflow-wrap: anywhere; }
  .bar, .row { display: flex; align-items: center; gap: 8px; }
  .bar { justify-content: space-between; margin-bottom: 10px; flex-wrap: wrap; }
  .bar .row { min-width: 0; }
  section { margin-top: 20px; }
  ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
  button { font: inherit; color: inherit; cursor: pointer; border: 1px solid var(--line); border-radius: 8px; background: var(--card); padding: 5px 10px; }
  button:hover:not(:disabled) { border-color: var(--accent); }
  button:disabled { opacity: .6; cursor: default; }
  button:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .pill { border-radius: 99px; background: var(--accent-bg); color: var(--accent); padding: 2px 7px; font-size: 11px; font-weight: 650; flex: none; }
  .issue, .run, .empty, #preview { border: 1px solid var(--line); border-radius: 10px; background: var(--card); padding: 11px; }
  .issue { width: 100%; text-align: left; border: 0; border-bottom: 1px solid var(--line); border-radius: 0; background: transparent; padding: 11px 4px; }
  .issue:hover { background: var(--accent-bg); }
  .issue .issue-title { flex: 1; }
  .issue[data-closed] .issue-title { color: var(--muted); }
  .issue[data-closed] .state { color: var(--muted); }
  .state { color: var(--success); white-space: nowrap; font-size: 12px; }
  .filters { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
  .filters [aria-pressed="true"], #diagnose { background: var(--accent-bg); color: var(--accent); border-color: var(--accent); }
  .issue-body { border-top: 1px solid var(--line); padding-top: 12px; margin-top: 14px; }
  #detail-title { font-size: 17px; }
  #issues { gap: 0; }
  .comment { border-bottom: 1px solid var(--line); padding: 10px 0; overflow-wrap: anywhere; }
  .diagnosis code { background: var(--accent-bg); padding: 1px 3px; border-radius: 3px; }
  .issue-title { min-width: 0; overflow-wrap: anywhere; font-weight: 650; }
  .triage { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
  .run-time { display: block; margin-top: 4px; color: var(--muted); font-size: 12px; }
  dl { margin: 10px 0; display: grid; gap: 8px; }
  dt { font-weight: 650; }
  dd { margin: 2px 0 0; color: var(--muted); overflow-wrap: anywhere; }
  #preview-title { margin-top: 6px; }
  .run[data-status="completed"] .pill { color: var(--success); background: var(--canvas); }
  .run[data-status="failed"] .pill { color: var(--danger); background: var(--canvas); }
  #status { color: var(--danger); margin-top: 10px; overflow-wrap: anywhere; }
  #status:empty { display: none; }
  #start { margin-top: 12px; color: var(--accent); background: var(--accent-bg); border-color: transparent; font-weight: 650; }
  details { margin-top: 8px; }
  summary { cursor: pointer; color: var(--accent); overflow-wrap: anywhere; }
  pre { margin: 8px 0; padding: 9px; background: var(--canvas); border-radius: 6px; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 18rem; overflow: auto; font: inherit; }
  #prompt { font: 12px/1.5 ui-monospace, monospace; }
  .diagnosis { margin-top: 8px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; overflow-wrap: anywhere; }
  .diagnosis h3 { margin: 3px 0 0; font-size: 13px; }
  .diagnosis ul, .diagnosis ol { display: block; list-style: revert; padding-inline-start: 20px; margin: 0; }
  .diagnosis table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 12px; }
  .diagnosis th, .diagnosis td { text-align: left; vertical-align: top; padding: 5px; border: 1px solid var(--line); }
  .diagnosis th { background: var(--canvas); }
</style></head>
<body>
  <main>
    <header>
      <div class="bar"><h1>MattSkillsDeck</h1><button id="refresh" disabled>刷新</button></div>
      <p id="repository" class="repo">正在读取仓库…</p>
    </header>
    <p id="status" role="status"></p>
    <section id="list-view" aria-labelledby="issues-heading">
      <div class="bar"><h2 id="issues-heading">Issue 列表</h2><span class="repo" id="issue-count"></span></div>
      <div class="filters" id="filters" aria-label="筛选 Issue">
        <button data-filter="all" aria-pressed="true">全部</button>
        <button data-filter="OPEN" aria-pressed="false">开放</button>
        <button data-filter="CLOSED" aria-pressed="false">已关闭</button>
      </div>
      <ul id="issues"></ul>
      <details><summary>Wayfinder 地图</summary><ul id="maps"></ul></details>
    </section>
    <div id="detail-view" hidden>
    <section aria-labelledby="detail-title">
      <div class="bar"><button id="back">← 返回列表</button><button id="diagnose" hidden>预览诊断</button></div>
      <p id="detail-state" class="state"></p>
      <h2 id="detail-title" tabindex="-1"></h2>
      <div id="detail-labels" class="triage"></div>
      <div class="issue-body"><h2>描述</h2><div id="detail-body"></div></div>
      <div class="issue-body"><h2 id="comments-heading">评论</h2><div id="comments"></div></div>
    </section>
    <section id="preview" aria-labelledby="preview-heading" hidden>
      <h2 id="preview-heading">派发预览</h2>
      <p id="preview-title" class="issue-title"></p>
      <dl>
        <div><dt>目标</dt><dd>诊断该 Issue，说明可能原因和排查建议。</dd></div>
        <div><dt>范围</dt><dd id="preview-repo"></dd></div>
        <div id="preview-triage" hidden><dt>分诊状态</dt><dd class="triage" id="preview-labels"></dd></div>
        <div><dt>Issue 正文摘录</dt><dd id="issue-excerpt"></dd></div>
        <div><dt>确认后</dt><dd>启动独立 Codex 会话，在这里查看进度和结果。</dd></div>
      </dl>
      <details id="instructions"><summary>查看完整指令</summary><pre id="prompt"></pre></details>
      <button id="start">确认并开始</button>
    </section>
    <section aria-labelledby="runs-heading">
      <div class="bar"><h2 id="runs-heading">诊断记录</h2></div>
      <ul id="runs"></ul>
    </section>
    </div>
  </main>
  <script type="module">
    const status = document.querySelector("#status");
    const send = (message) => parent.postMessage({ jsonrpc: "2.0", ...message }, "*");
    const pending = new Map();
    let nextId = 0;
    function rpc(method, params) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error("Codex 响应超时。"));
        }, 20000);
        pending.set(id, { resolve, reject, timer });
        send({ id, method, params });
      });
    }
    window.addEventListener("message", (event) => {
      const reply = event.data;
      if (event.source !== parent || reply?.jsonrpc !== "2.0") return;
      const item = pending.get(reply.id);
      if (!item) return;
      pending.delete(reply.id);
      clearTimeout(item.timer);
      if (reply.error) item.reject(new Error(reply.error.message));
      else item.resolve(reply.result);
    });
    const call = async (name, args) => {
      const result = await rpc("tools/call", { name, arguments: args });
      if (result.isError) throw new Error(result.content[0]?.text || "操作失败。");
      return result.structuredContent ?? JSON.parse(result.content[0].text);
    };
    const el = (id) => document.getElementById(id);
    let selected = null;
    let selectionVersion = 0;
    let runSnapshot;
    let binding;
    let activeIssue;
    let filter = "all";
    let currentRuns = [];
    function badge(text) {
      const pill = document.createElement("span");
      pill.className = "pill";
      pill.textContent = text;
      return pill;
    }
    function empty(text) {
      const row = document.createElement("li");
      row.className = "empty";
      row.textContent = text;
      return row;
    }
    function node(tag, text) {
      const element = document.createElement(tag);
      element.textContent = text;
      return element;
    }
    function plain(text) {
      return text.replace(/\[([^\]]+)\]\([^\s)]+\)/g, "$1").replace(/\*\*([^*]+)\*\*|\x60([^\x60]+)\x60/g, (_, bold, code) => bold ?? code);
    }
    function excerpt(text, limit) {
      const characters = Array.from(plain(text).replace(/\s+/g, " ").trim());
      return characters.length > limit ? characters.slice(0, limit).join("") + "…" : characters.join("");
    }
    const heading = /^#{1,6}\s+(.+)$/;
    const listItem = /^\s*([-+*]|\d+[.)])\s+(.+)$/;
    function formatted(tag, text) {
      const result = document.createElement(tag);
      let offset = 0;
      for (const match of text.matchAll(/\*\*([^*]+)\*\*|\x60([^\x60]+)\x60/g)) {
        result.append(text.slice(offset, match.index), node(match[1] ? "strong" : "code", match[1] ?? match[2]));
        offset = match.index + match[0].length;
      }
      result.append(text.slice(offset));
      return result;
    }
    function renderDiagnosis(text) {
      const content = document.createElement("div");
      content.className = "diagnosis";
      for (const block of text.trim().split(/\r?\n\s*\r?\n/)) {
        const lines = block.split(/\r?\n/);
        if (lines[0].startsWith("|") && /^\|[\s:|\-]+\|$/.test(lines[1] ?? "") && lines.every(line => line.endsWith("|"))) {
          const table = document.createElement("table");
          const head = table.createTHead();
          const body = table.createTBody();
          for (const [index, line] of lines.entries()) {
            if (index === 1) continue;
            const row = (index === 0 ? head : body).insertRow();
            for (const cell of line.slice(1, -1).split("|")) {
              row.append(node(index === 0 ? "th" : "td", plain(cell.trim())));
            }
          }
          content.append(table);
          continue;
        }
        let list;
        for (const line of lines) {
          const title = line.match(heading);
          const item = line.match(listItem);
          if (item) {
            const tag = /^\d/.test(item[1]) ? "OL" : "UL";
            if (list?.tagName !== tag) {
              list = document.createElement(tag);
              content.append(list);
            }
            const task = item[2].match(/^\[([ xX])\]\s+(.+)$/);
            const entry = formatted("li", task?.[2] ?? item[2]);
            if (task) {
              const checkbox = document.createElement("input");
              checkbox.type = "checkbox";
              checkbox.disabled = true;
              checkbox.checked = task[1].toLowerCase() === "x";
              checkbox.setAttribute("aria-label", checkbox.checked ? "已勾选" : "未勾选");
              entry.prepend(checkbox, " ");
            }
            list.append(entry);
          } else {
            list = null;
            content.append(formatted(title ? "h3" : "p", title?.[1] ?? line));
          }
        }
      }
      return content;
    }
    function resultOverview(result) {
      const blocks = result.trim().split(/\r?\n\s*\r?\n/);
      const paragraph = (name) => result.match(new RegExp("^#{1,6}\\s+" + name + "[ \\t]*\\r?\\n(?:[ \\t]*\\r?\\n)*([^\\r\\n#][^\\r\\n]*)", "m"))?.[1];
      return {
        conclusion: paragraph("结论") ?? blocks.find(block => !/^[#|]/.test(block)) ?? "诊断已完成。",
        next: paragraph("下一步") ?? blocks.find(block => /^(建议|下一步)/.test(block)) ?? "展开诊断详情，查看排查建议。",
      };
    }
    const triageNames = new Map([
      ["needs-triage", "待分诊"],
      ["needs-info", "待补充信息"],
      ["ready-for-agent", "可交给代理"],
      ["ready-for-human", "待人工处理"],
      ["wontfix", "不处理"],
    ]);
    function triageBadges(issue) {
      return (issue.labels ?? []).filter(label => triageNames.has(label.name)).map(label => {
        const pill = badge(triageNames.get(label.name));
        pill.title = label.name;
        return pill;
      });
    }
    function issueButton(issue) {
      const button = document.createElement("button");
      button.className = "issue";
      const label = document.createElement("span");
      label.className = "row";
      const title = node("span", issue.title);
      title.className = "issue-title";
      label.append(badge("#" + issue.number), title);
      if (issue.state) {
        const closed = issue.state === "CLOSED";
        button.toggleAttribute("data-closed", closed);
        const state = node("span", closed ? "已关闭" : "开放");
        state.className = "state";
        label.append(state);
      }
      button.append(label);
      const labels = triageBadges(issue);
      if (labels.length) {
        const tags = document.createElement("span");
        tags.className = "triage";
        tags.append(...labels);
        button.append(tags);
      }
      button.onclick = () => openIssue(issue.number);
      return button;
    }
    function showMaps(maps) {
      const list = el("maps");
      list.replaceChildren();
      if (!maps.length) list.append(empty("当前列表没有打开的 Wayfinder 地图。"));
      for (const map of maps) {
        const row = document.createElement("li");
        row.className = "run";
        const details = document.createElement("details");
        const children = document.createElement("ul");
        details.append(node("summary", "#" + map.number + " " + map.title), children);
        let loaded = false;
        details.ontoggle = async () => {
          if (!details.open || loaded) return;
          loaded = true;
          children.replaceChildren(empty("正在读取子任务…"));
          try {
            const data = await call("deck_board", { action: "map", number: map.number });
            children.replaceChildren();
            if (!data.children.length) children.append(empty("这张地图还没有子任务。"));
            for (const child of data.children) {
              if (child.local) {
                const item = document.createElement("li");
                item.append(issueButton({ ...child, state: child.state.toUpperCase() }));
                children.append(item);
              } else {
                children.append(empty("#" + child.number + " " + child.title + " · 其他仓库"));
              }
            }
          } catch (error) {
            loaded = false;
            children.replaceChildren(empty(error.message + " 收起后重新展开可重试。"));
          }
        };
        row.append(details);
        list.append(row);
      }
    }
    const runTime = new Intl.DateTimeFormat("zh-CN", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    });
    function showRuns(runs) {
      currentRuns = runs;
      if (!activeIssue) return;
      runs = runs.filter(run => run.number === activeIssue.number);
      const snapshot = JSON.stringify([activeIssue.number, runs]);
      if (snapshot === runSnapshot) return;
      runSnapshot = snapshot;
      const expanded = new Set(Array.from(el("runs").querySelectorAll("details[open]"), item => item.dataset.run));
      el("runs").replaceChildren();
      if (!runs.length) el("runs").append(empty("还没有派发任务。"));
      const labels = { queued: "排队中", running: "运行中", completed: "已完成", failed: "失败" };
      for (const run of runs) {
        const row = document.createElement("li");
        row.className = "run";
        row.dataset.status = run.status;
        const label = document.createElement("div");
        label.className = "row";
        label.append(badge(labels[run.status] ?? run.status));
        row.append(label);
        const created = new Date(run.created);
        if (Number.isFinite(created.getTime())) {
          const time = node("time", "派发于 " + runTime.format(created));
          time.className = "run-time";
          time.dateTime = run.created;
          row.append(time);
        }
        if (run.sessionId) row.title = "Codex 会话 " + run.sessionId;
        if (run.result) {
          const { conclusion, next } = resultOverview(run.result);
          const overview = document.createElement("dl");
          overview.append(
            node("dt", "结论"), node("dd", excerpt(conclusion, 160)),
            node("dt", "下一步"), node("dd", run.status === "failed" ? "检查错误后可重新预览并派发。" : excerpt(next, 120)),
          );
          const details = document.createElement("details");
          details.dataset.run = run.id;
          details.open = expanded.has(run.id);
          const summary = document.createElement("summary");
          summary.textContent = run.status === "failed" ? "查看完整错误" : "查看完整诊断";
          const original = document.createElement("details");
          original.dataset.run = run.id + "/original";
          original.open = expanded.has(original.dataset.run);
          original.append(node("summary", "查看诊断原文"), node("pre", run.result));
          details.append(summary, renderDiagnosis(run.result), original);
          row.append(overview, details);
        }
        el("runs").append(row);
      }
    }
    function showList() {
      const issues = binding?.issues ?? [];
      const visible = issues.filter(issue => filter === "all" || issue.state === filter);
      el("issue-count").textContent = "已加载 " + issues.length + " 条";
      for (const button of el("filters").querySelectorAll("button")) {
        const state = button.dataset.filter;
        const count = state === "all" ? issues.length : issues.filter(issue => issue.state === state).length;
        button.textContent = ({ all: "全部", OPEN: "开放", CLOSED: "已关闭" })[state] + " " + count;
        button.setAttribute("aria-pressed", state === filter);
      }
      el("issues").replaceChildren();
      if (!visible.length) el("issues").append(empty("此筛选下没有 Issue。"));
      for (const issue of visible) {
        const row = document.createElement("li");
        row.append(issueButton(issue));
        el("issues").append(row);
      }
    }
    async function openIssue(number) {
      const version = ++selectionVersion;
      status.textContent = "正在读取 #" + number + "…";
      try {
        const { issue } = await call("deck_board", { action: "issue", number });
        if (version !== selectionVersion) return;
        activeIssue = issue;
        selected = null;
        el("preview").hidden = true;
        el("detail-title").textContent = "#" + number + " " + issue.title;
        el("detail-state").textContent = issue.state === "OPEN" ? "开放" : "已关闭";
        el("detail-labels").replaceChildren(...triageBadges(issue));
        el("detail-body").replaceChildren(renderDiagnosis(issue.body || "该 Issue 没有描述。"));
        el("comments-heading").textContent = "评论 (" + issue.comments.length + ")";
        el("comments").replaceChildren();
        for (const comment of issue.comments) {
          const article = document.createElement("article");
          article.className = "comment";
          article.append(node("strong", "@" + (comment.author?.login ?? "未知用户")), renderDiagnosis(comment.body ?? ""));
          el("comments").append(article);
        }
        el("diagnose").hidden = issue.state !== "OPEN";
        el("list-view").hidden = true;
        el("detail-view").hidden = false;
        showRuns(currentRuns);
        el("detail-title").focus();
        status.textContent = "";
      } catch (error) {
        if (version === selectionVersion) status.textContent = error.message;
      }
    }
    async function select(number) {
      const version = ++selectionVersion;
      selected = null;
      el("preview").hidden = true;
      try {
        const preview = await call("deck_board", { action: "preview", number });
        if (version !== selectionVersion) return;
        selected = { number, previewId: preview.previewId };
        el("preview-title").textContent = "#" + number + " " + preview.issue.title;
        el("preview-repo").textContent = [binding.repo, "只读诊断", binding.root].filter(Boolean).join(" · ");
        const labels = triageBadges(preview.issue);
        el("preview-labels").replaceChildren(...labels);
        el("preview-triage").hidden = !labels.length;
        el("issue-excerpt").textContent = excerpt(preview.issue.body ?? "", 200) || "该 Issue 没有正文。";
        el("prompt").textContent = preview.prompt;
        el("instructions").open = false;
        el("preview").hidden = false;
        el("preview").scrollIntoView({ block: "nearest" });
        status.textContent = "";
      } catch (error) {
        if (version === selectionVersion) status.textContent = error.message;
      }
    }
    async function refresh() {
      el("refresh").disabled = true;
      try {
        const data = await call("deck_board", { action: "list" });
        binding = data;
        showMaps(data.maps ?? []);
        el("repository").textContent = data.repo + " · 当前看板仓库";
        showList();
        status.textContent = "";
        showRuns(data.runs);
      } catch (error) {
        status.textContent = error.message;
      } finally {
        el("refresh").disabled = false;
      }
    }
    async function refreshRuns() {
      try { showRuns((await call("deck_board", { action: "status" })).runs); }
      catch (error) { status.textContent = error.message; }
    }
    el("refresh").onclick = refresh;
    el("filters").onclick = (event) => {
      const next = event.target.closest("button")?.dataset.filter;
      if (!next) return;
      filter = next;
      showList();
    };
    el("back").onclick = () => {
      ++selectionVersion;
      selected = null;
      activeIssue = null;
      el("preview").hidden = true;
      el("detail-view").hidden = true;
      el("list-view").hidden = false;
      status.textContent = "";
    };
    el("diagnose").onclick = () => select(activeIssue.number);
    el("start").onclick = async () => {
      if (!selected) return;
      const confirmed = selected;
      selected = null;
      el("preview").hidden = true;
      try {
        await call("deck_dispatch", confirmed);
        await refreshRuns();
      } catch (error) { status.textContent = error.message; }
    };
    try {
      await rpc("ui/initialize", {
        appInfo: { name: "deck-sidebar-probe", version: "0.2.0" },
        appCapabilities: {},
        protocolVersion: "2026-01-26",
      });
      send({ method: "ui/notifications/initialized", params: {} });
      await refresh();
      async function poll() {
        await refreshRuns();
        setTimeout(poll, 4000);
      }
      setTimeout(poll, 4000);
    } catch (error) { status.textContent = error.message; }
  </script>
</body>
</html>`;

for await (const line of createInterface({ input: process.stdin })) {
  let request;
  try { request = JSON.parse(line); } catch { continue; }
  if (request.id === undefined) continue;
  const response = { jsonrpc: "2.0", id: request.id };
  switch (request.method) {
    case "initialize":
      response.result = {
        protocolVersion: request.params.protocolVersion,
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: "deck-sidebar-probe", version: "0.2.0" },
      };
      break;
    case "ping":
      response.result = {};
      break;
    case "tools/list":
      response.result = { tools: [{
        name: "open_deck_sidebar_probe",
        title: "MattSkillsDeck",
        description: "Open the project board in the right sidebar.",
        inputSchema: { type: "object", additionalProperties: false },
        annotations: { readOnlyHint: true },
        _meta: {
          ui: { resourceUri: uri },
          "openai/ui": { entrypoints: [{ type: "thread" }] },
        },
      }, {
        name: "deck_board",
        description: "List issues, read a Wayfinder map, preview a read-only diagnosis, or read task status.",
        inputSchema: {
          type: "object", required: ["action"], additionalProperties: false,
          properties: { action: { enum: ["list", "issue", "map", "preview", "status"] }, number: { type: "integer", minimum: 1 } },
        },
        annotations: { readOnlyHint: true },
        _meta: { ui: { visibility: ["app"] } },
      }, {
        name: "deck_dispatch",
        description: "Start a read-only diagnosis after explicit confirmation in the board.",
        inputSchema: {
          type: "object", required: ["number", "previewId"], additionalProperties: false,
          properties: { number: { type: "integer", minimum: 1 }, previewId: { type: "string" } },
        },
        _meta: { ui: { visibility: ["app"] } },
      }] };
      break;
    case "tools/call":
      if (request.params.name === "open_deck_sidebar_probe") {
        response.result = { content: [{ type: "text", text: "MattSkillsDeck is reachable." }] };
      }
      if (["deck_board", "deck_dispatch"].includes(request.params.name)) {
        try {
          const args = request.params.arguments ?? {};
          const action = request.params.name === "deck_dispatch" ? "dispatch" : args.action;
          if (request.params.name === "deck_board" && !["list", "issue", "map", "preview", "status"].includes(action)) throw new Error("未知操作。");
          const data = await boardAction({ ...args, action }, previews);
          response.result = { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
        } catch (error) {
          const message = error.cmd ? "无法读取 GitHub Issues。请检查 gh 登录和仓库访问权限。" : error.message;
          response.result = { isError: true, content: [{ type: "text", text: message }] };
        }
      }
      break;
    case "resources/list":
      response.result = { resources: [panel] };
      break;
    case "resources/templates/list":
      response.result = { resourceTemplates: [] };
      break;
    case "resources/read":
      if (supportedUris.has(request.params.uri)) {
        response.result = { contents: [{ uri: request.params.uri, mimeType, text: html }] };
      } else {
        response.error = { code: -32002, message: "Sidebar resource not found" };
      }
      break;
  }
  if (response.result === undefined && response.error === undefined) {
    response.error = { code: -32601, message: "Unsupported request" };
  }
  process.stdout.write(JSON.stringify(response) + "\n");
}
