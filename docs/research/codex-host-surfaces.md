# Codex 可挂载界面与第三方工具/技能注册

核对时间 2026-11-07。对象是 ticket #8 的五个问题：可挂载界面、工具注册、技能提供方、locale、降级方案。

本文把证据分成三类，结论里逐条标注：

- **官方文档**：OpenAI 公开规范与文档（可被外部复核）。
- **本机握手实测**：`.scratch/upstream-sidebar/02a17a8faba7ae80/host-context-captures.json` 中真实 Codex 桌面端 `ui/initialize` 的字段名与能力位（不含值，白名单已过滤）。
- **本机宿主包字符串**：从已安装的 `app.asar`（Codex 26.1103.3517.0）里抽出的压缩后代码片段。这类证据只说明宿主里存在相关代码路径，**不说明该路径对第三方 MCP 服务开放**。

关键区分：**DSH 的 slot 名不是 Codex 已支持的名称**。`sidebar.right.pane.tab`、`conversation.input.dock`、`tool.view.cordis`、`settings.plugins.tab`、`settings.section` 都是 DSH 宿主 `slots`/`sidebarRightTabs` 服务的标识，Codex 没有这套服务。

## 一句话结论

Codex 桌面端对第三方 MCP 服务只开放 **MCP Apps 的三种入口**（`global` / `thread` / `file`）与 **MCP 工具**；没有状态栏、运行面板、设置页的宿主槽位，也没有工具注册或技能注册的宿主服务。当前 port 只用了 `thread` 入口，这个选择是对的；缺的部分必须在应用内自绘或改走「插件 + 技能目录」。

## 1. 可挂载的界面入口

### 1.1 官方支持的入口

MCP Apps 最多可声明三种入口，写在 `tools/list` 条目的 `_meta["openai/ui"]["entrypoints"]` 里：

| 入口 | 位置 | 说明 |
| --- | --- | --- |
| `global` | 主侧边导航，全屏 | 桌面端 `ui/message`、`ui/update-model-context` 使用该入口所在的 thread；服务端必须接受 `{}` 参数 |
| `thread` | 会话内的内容标签页（content tab） | 每个 thread 一个独立实例，参数为 `{}` |
| `file` | 文件扩展名查看器 | 桌面端支持，Web 不支持 |

来源：[OpenAI MCP Extensions Specification](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md#mcp-app-entrypoints)。三种之外没有第四种入口；规范里「侧栏 / 文件查看器 / 更丰富的表单」的推荐去向就是这三类加扩展能力（[Add UI to your MCP server](https://developers.openai.com/plugins/build/chatgpt-ui.md)）。

### 1.2 本机真实握手证明了什么

2026-11-06 16:51:22 的真实 `ui/initialize`（`.scratch/upstream-sidebar/02a17a8faba7ae80/host-context-captures.json:296-415`）返回的 `hostContext` 键包含：

```
availableDisplayModes, displayMode, containerDimensions, deviceCapabilities,
locale, platform, safeAreaInsets, styles.variables, theme, timeZone, userAgent,
toolInfo, openai/modelContext, openai/interactionCursor, openai/viewer-header
```

`hostCapabilities` 键包含：

```
experimental.openai/modelContext, experimental.openai/find,
experimental.openai/message (+ .draft), experimental.openai/skillsDeepLinks,
experimental.openai/files, logging, openLinks, serverResources, serverTools,
message(text/image/resourceLink/resource), updateModelContext(...),
sandbox(permissions/csp.baseUriDomains/connectDomains/frameDomains/resourceDomains)
```

这组字段说明：宿主把自己定位成「会话内的一块内容区」——有 `displayMode`、`containerDimensions`、`isSidebarOpen`、`requestDisplayMode`，但没有 statusbar / dock / settings 一类能力位。

**注意**：`openai/settings`（结构化设置）**没有**出现在这份实测能力表里，尽管宿主包中确实存在该能力的 schema（见 1.4）。

### 1.3 port 当前只挂了一个

`prototypes/upstream-port/browser-runtime.mjs:20-58` 的装配层：

- `slots.register` 只把组件存进 Map，`mount()` 最后只取 `slots.get("sidebar.right.pane.tab")` 渲染（`browser-runtime.mjs:50-53`）。
- `sidebarRightTabs: { register() { return () => {}; } }` 是空桩（`browser-runtime.mjs:35`）——上游「注册原生右栏 tab 类型」的那条路（`vendor/mattskills-1.8.0-rc.7/lib/client.js:30077-30107`）在 Codex 里没有对应服务，只能空转。
- 因此 `StatusBar`（`conversation.input.dock`，`client.js:30052-30054`）、`RunPanel`（`tool.view.cordis`，`client.js:30055-30057`）、`SettingsPage`（`settings.plugins.tab` / `settings.section`，`client.js:30059-30066`）在 Codex 中**没有任何宿主落点**。它们不是「还没接」，而是「不存在可接的对象」。

### 1.4 官方文档里最接近「设置页」的东西

规范定义了 **Structured settings**：服务端在 `initialize` 能力里声明 `openai/settings = { readTool, updateTool }`，宿主用原生控件把它渲染在「插件详情页」上，字段只支持 boolean / string / number / integer，可以用 `layout` 分组，也可以把 tool action 挂进设置组。

- 来源：[Structured settings](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md#structured-settings)；规范正文多处写的是「ChatGPT 会在插件详情页渲染」，没有承诺 Codex 桌面端等价。
- 本机宿主包 `app.asar` 里能抽到这套 schema 的实现（`openai/settings`、`values`、`set` 校验），说明宿主认识这个能力位。
- 但真实握手没把它发给我们的服务。**可能的解释**：该能力只对「以插件形式安装」的 MCP 服务开放，而当前服务是 `~/.codex/config.toml` 里的裸 `mcp_servers` 条目（`.codex/config.toml:110-115`）。这是推断，置信度低。

**结论**：设置页今天**不可用**。即便后续证明 `openai/settings` 可用，它能承载的也只是原生控件表单，承载不了上游 `SettingsPage` 那种自定义 React 页面。

### 1.5 「原生右侧栏 tab 入口」是什么

Codex 里最接近 DSH `sidebarRightTabs` 的东西就是 `thread` 入口本身：官方规范说它「在会话内以新内容标签页打开」，本机 `openai-bundled/browser` 插件文档描述得更直白——「MCP Apps 在当前任务的侧边面板标签页里打开」（`.codex/plugins/cache/openai-bundled/browser/26.1103.31037/docs/mcp-apps.md:3-7`）。

也就是说：**面板的位置由宿主决定，第三方只能声明「我以 thread 入口出现」**，不能自己注册一个 tab 类型、图标、优先级或引导页。上游那套 `kind`/`id`/`priority: 'builtin'`/`guide` 元数据（`client.js:30082-30090`）在 Codex 无意义。

## 2. 工具注册（`tools.register` 的等价物）

### 2.1 可用机制：MCP `tools/list`

Codex 本地客户端（桌面、CLI、IDE）支持 stdio 与 Streamable HTTP 两种 MCP 服务，服务通过 `tools/list` 暴露的工具直接进入模型工具表；配置层提供 `enabled_tools` / `disabled_tools` / `default_tools_approval_mode` / `tool_timeout_sec` / `tools.<tool>.approval_mode` / `tools.<tool>.output_token_limit`。

来源：[Model Context Protocol](https://learn.chatgpt.com/docs/extend/mcp.md)。

本机证据：

- `.codex/config.toml:85-115` 里已有两个 `[mcp_servers.*]` 条目（`node_repl`、`deck-sidebar-probe`），我们的 port 就是靠这一条挂上去的。
- `openai-bundled/codex-app-tools` 插件用 `"mcpServers": "./.mcp.json"` 把 `create_thread` / `list_projects` / `read_thread` 等工具交给 agent（`.../codex-app-tools/26.1103.31037/.mcp.json`），且 `codex-host-contract.md:34` 已记录这些工具在本机助手侧可见。这证明「插件带的 MCP 服务 → 模型可见工具」这条链在本机是通的。

### 2.2 与 `tools.register` 的差异

| 维度 | DSH `tools.register` | Codex MCP |
| --- | --- | --- |
| 名称/描述/参数 | `{name, description, parameters}` | 同构（JSON Schema `inputSchema`） |
| 超时 | `timeoutMs` 每工具（上游用 120000，`shared/deck-tools/agent-register.js:15-16`） | 服务级 `tool_timeout_sec`（默认 60），无每工具粒度 |
| 输出形状 | `output.schema` + `output.render`（自定义渲染函数，见 `agent-register.js:159-190`） | `outputSchema` + `structuredContent` + `content` 文本块；渲染只能走 MCP Apps 模板，不能挂自定义 React 渲染器 |
| 执行入参 | `execute(args, exec)`，`exec.signal` 支持中止（`agent-register.js:275-293`） | 标准 `tools/call`，无 `exec.signal` 语义 |
| 注册时机 | 运行时注册，可重试等待服务就绪（`hookDeckAgentTools`，`agent-register.js:393-437`） | 启动时 `tools/list` 快照，改工具需重启服务/宿主 |

九个工具本身（`deck_context, deck_issue_get, deck_map_snapshot, deck_issue_list, deck_issue_create, deck_map_plan_create, deck_map_link, deck_issue_patch, deck_issue_report`，`shared/deck-tools/plan.js:99-101`）在 MCP 侧逐个映射成 `tools/list` 条目即可，参数模式本来就是编好的 JSON Schema（`agent-register.js:69-80` 只是转成 DSH 注册表的写法，Codex 不需要这一步翻译）。

### 2.3 不支持的部分

- 没有「进程内注册工具」的宿主 API：第三方服务只能通过 MCP 协议暴露工具，不能往宿主的工具表里塞东西。
- `deck_probe` 探的那批服务（`tools/connection/subprocess/timer/fs/sessions/agents/llm/systemPrompt/sandboxPolicy/jobs/approval/shell/profileContext`，`agent-register.js:238`）在 MCP 侧**没有任何对应物**。工具实现必须留在服务进程内——port 现在正是这么做的（`sidebar-server.mjs` + `project-hosts.mjs` + Node 子进程）。
- 没有 `js`/`render` 型工具结果渲染，也没有「工具结果里内嵌一个自有页面」的通路；唯一的内嵌 UI 是给整个工具挂 `_meta.ui.resourceUri`（会话内联卡片）。

## 3. 技能（skills provider）

### 3.1 官方机制：只有文件系统

Codex 的技能是磁盘上的目录：必须有 `name` 与 `description` 的 `SKILL.md`，可选 `scripts/`、`references/`、`assets/`、`agents/openai.yaml`。加载位置（[Build skills](https://learn.chatgpt.com/docs/build-skills.md#where-codex-loads-local-skills)）：

| 作用域 | 位置 |
| --- | --- |
| REPO | `$CWD/.agents/skills`、`$CWD/../.agents/skills`、`$REPO_ROOT/.agents/skills` |
| USER | `$HOME/.agents/skills` |
| ADMIN | `/etc/codex/skills` |
| SYSTEM | Codex 随包内置（`skill-creator`、`skill-installer`） |

插件可以带技能：`plugin.json` 根目录的 `skills/`（portable 布局自动发现）或 `.codex-plugin/plugin.json` 的 `"skills": "./skills/"`（兼容布局），本机 `browser` 插件就是这么声明的（`.../browser/26.1103.31037/.codex-plugin/plugin.json:71`）。

**没有 MCP 侧的技能注册能力。** 官方 MCP 扩展能力表里与技能沾边的只有 `openai/skillsDeepLinks`（本机握手确有此项），它是「技能深链」，不是「技能提供方」。

### 3.2 本机观察到的差异（需要复核）

文档说 USER 技能在 `$HOME/.agents/skills`，本机实际的 `~/.agents` 下只有 `plugins/`，没有 `skills/`；而 `~/.codex/skills/` 里有 32 个技能目录（`wayfinder`、`research`、`grilling`…），格式与文档一致（`~/.codex/skills/wayfinder/SKILL.md` 头部为 `---\nname: wayfinder\ndescription: ...\ndisable-model-invocation: true\n---`）。

两种解释都未被证实：(a) `$CODEX_HOME/skills` 是仍被扫描的兼容位置；(b) 这批技能由别的安装器写入，Codex 另有读取路径。**下一探针**：把某个技能只放在 `$HOME/.agents/skills` 下、重启 Codex，看它是否出现在 `/skills` 列表里。

### 3.3 `bundled-skills` 是什么

`bundled-skills` **不是 Codex 概念**，它是 DSH 插件自己的目录约定。上游 `lib/bootstrap.js:6-13` 用 `ctx.get('skills').registerProvider(...)` 注册一个 rank 350 的 provider：

- `list(opts)` 读 `<bundledDir>/<name>/SKILL.md`，解析 frontmatter，返回 `{name, description, whenToUse, invocation, source:'bundled', provider, rank, locator, resourceBase, path}`。
- `get(candidate, opts)` 按 `locator.path` 读回正文。
- `bundledDir` 是**猜**出来的：cwd/package/bundled-skills、父级、cwd/bundled-skills、祖先 `node_modules/dsh-mattpocock-skills-deck/bundled-skills`，最后扫真实 `os.homedir()/.dsh/profiles/*`（`bootstrap.js:19-67`）。
- 找不到目录就静默跳过（`bootstrap.js:69-72`）。

Codex 对 `bundled-skills` 这个目录**不做任何事**：它既不会扫描，也没有 `registerProvider` 可调。所以上游这一步在 Codex 里必须换实现。

### 3.4 结论

第三方 MCP 服务**不能**提供技能列表/正文。技能只有两条落地路径：

1. 把 27 个技能目录放进 Codex 的扫描位置（`$HOME/.agents/skills/` 或插件 `skills/`），由 Codex 自己展示和加载——这样 Codex 的技能选择器里能看到它们，但面板里的 `SkillsTab` 就与宿主列表重复了。
2. 保留 port 自绘的技能页：`SkillsTab` 通过 `deck_upstream_read` 走宿主进程读 vendored `bundled-skills/`（现状）。这条不依赖宿主，但要自己维护 27 条正文与描述。

本机没有 DSH 的 `skills` 服务可注入，所以 `browser-runtime.mjs` 永远走不到路径 1 的注册逻辑；只能选 2，或额外做一次「把技能写进 `~/.agents/skills`」的安装步骤（属于产品决策，不在本票范围）。

## 4. locale

### 4.1 宿主给什么

三条并行信号，全是官方或实测可见：

1. **`document.documentElement.lang`**：官方明确写「宿主把 locale 镜像到 `document.documentElement.lang`」，示例即 `const locale = document.documentElement.lang || "en-US"`（[Widget localization](https://developers.openai.com/plugins/build/chatgpt-ui.md#widget-localization)）。
2. **`hostContext.locale`**：本机真实 `ui/initialize` 的 `hostContext` 键里确有 `locale`（capture 第 348 行），另有 `timeZone`（第 358 行）。
3. **`window.openai.locale`**：同一份 capture 里 `openai.locale` 存在（第 374 行）。

**值未知**：`prototypes/upstream-port/host-context.mjs:1-20` 只把 `threadId/sessionId/projectId/cwd/...` 这类标识符写进 `candidates`，`locale` 只留在键索引里（capture 第 348 行只有键、没有值）。所以「Codex 发的是 `zh-CN` 还是 `en-US`」目前**未验证**。

### 4.2 当前 port 的问题

- `sidebar-server.mjs:23` 把 HTML 写死成 `<html lang="zh-CN">`，bridge 从不读 `documentElement.lang`。
- `browser-runtime.mjs:26-36` 提供的 services 里没有 `locale`，于是 `client.js:2756-2764` 的 `ctx.get('locale')` 取空，`tr()` 永久退化到中文词典。
- 上游要求的能力形状是 `register(ns, {zh, en})` + `bind(ns) -> (key) => string` + `getSnapshot().active`（`client.js:1106-1110,2756-2764,4577-4580`）。

### 4.3 建议接法

1. `sidebar-bridge.js` 在 `ui/initialize` 返回后读三层：`hostContext.locale` → `document.documentElement.lang` → `window.openai.locale`。
2. 归一化成 `zh` / `en`（BCP-47 取主语言子标签，`zh-*` → `zh`，其余 → `en`）。
3. 在 `ui/notifications/host-context-changed` 里重复第 1-2 步，实现 `getSnapshot()` 与订阅。
4. 以该快照拼一个 DSH 形状的 `locale` 服务传给 `mount()`：`register(ns, dicts)` 存表、`bind(ns)` 返回按当前语言取词的函数、`getSnapshot()` 返回 `{active}`。
5. 兜底顺序：宿主信号 → `navigator.language` → `zh`（保持上游既有默认，别改成 `en`）。

**下一探针**：在 bridge 里把 `document.documentElement.lang`、`hostContext.locale`、`window.openai.locale` 三个值原样落一条 capture（只放宽这一条白名单），重启 Codex 后读 `.scratch` 里的记录，即可确定真实取值与刷新时机。

## 5. 能力矩阵

「结论」一列：**可用** / **不可用** / **需替代方案**。

### 界面

| 能力 | Codex 是否有受支持入口 | 结论 | 证据 | 置信度 |
| --- | --- | --- | --- | --- |
| 会话内侧边面板（thread 入口） | 有，`_meta["openai/ui"].entrypoints: [{type:"thread"}]` | 可用 | 官方规范 thread entrypoint；本机真实挂载与 `ui/initialize` | 高 |
| 全局侧栏入口（global 入口） | 有，主侧边导航 + 全屏 | 需验证 | 官方规范 global entrypoint；本机宿主包有 `mcp-global`/entrypoints 处理代码，但当前服务是裸 `mcp_servers`，导航条目可能只对已安装插件生效 | 中低 |
| 文件查看器（file 入口） | 有，桌面端 | 需验证 | 官方规范 file entrypoint（Web 不支持） | 中 |
| 工具结果内嵌卡片 | 有，`_meta.ui.resourceUri` | 可用 | 官方 MCP Apps；port 未用 | 中高 |
| 状态栏槽位 | 无 | 不可用 | 规范只有三种入口；本机 `hostCapabilities` 无任何 statusbar 能力位；DSH 的 `conversation.input.dock` 是 DSH 专有 | 高 |
| 运行面板 / 工具视图槽位 | 无 | 不可用 | 同上；DSH `tool.view.cordis` 无对应 | 高 |
| 宿主设置页插槽 | 无 | 不可用 | DSH `settings.plugins.tab` / `settings.section` 无对应；本机握手未广告 `openai/settings` | 高 |
| 结构化设置表单（原生控件） | 规范有，宿主包有实现 | 需验证 | 官方 Structured settings；`app.asar` 内 `openai/settings` schema；但未在本机握手出现 | 低 |
| 原生右栏 tab 类型注册（图标/优先级/引导页） | 无 | 不可用 | DSH `sidebarRightTabs`；port 已空桩（`browser-runtime.mjs:35`） | 高 |
| 主题变量（light/dark、CSS 变量） | 有 | 可用 | 本机握手 `hostContext.theme`、`styles.variables`；`sidebar-bridge.js:23-54` 已实现 | 高 |
| 面板显示模式（`displayMode`） | 有 | 可用（未用） | 本机握手 `displayMode`、`availableDisplayModes`、`openai.requestDisplayMode` | 中高 |

### 工具与服务

| 能力 | Codex 机制 | 结论 | 证据 | 置信度 |
| --- | --- | --- | --- | --- |
| 注册 agent 工具（`tools.register`） | MCP `tools/list` | 可用 | 官方 MCP 文档；本机 `config.toml` 的 `mcp_servers`；`codex-app-tools` 插件实证 | 高 |
| 每工具超时 | 服务级 `tool_timeout_sec` | 需替代方案 | 无每工具粒度；上游要 120s，可整服务设 | 高 |
| 工具输出自定义渲染（`output.render`） | `content` 文本块 / `structuredContent` | 需替代方案 | MCP 工具结果只有文本/结构化内容；同 #809 的「摘要 + 提示 + 明细 JSON」可直接搬 | 高 |
| 工具执行中止（`exec.signal`） | 无 | 需替代方案 | MCP `tools/call` 无中止语义 | 中高 |
| 技能提供方（`skills.registerProvider`） | 无 | 不可用 | 官方技能只有文件系统；DSH `skills` 服务在 Codex 不存在 | 高 |
| `bundled-skills` 目录 | 无宿主概念 | 需替代方案 | 上游 `bootstrap.js:19-72` 是 DSH 专有发现逻辑 | 高 |
| locale 服务 | 宿主 locale 信号 | 需替代方案 | 见第 4 节；宿主给信号，不给 `register/bind` 服务 | 高 |
| 宿主 `sessions` / `workspaces` / `connection` / `fs` / `subprocess` / `timer` | 无 | 需替代方案 | port 已在服务进程内自建（`project-hosts.mjs`、`host-context.mjs`） | 高 |
| `deck_probe` 的 agent 侧服务（agents/llm/systemPrompt/sandboxPolicy/jobs/approval/shell/profileContext） | 无 | 不可用 | MCP 协议无对应物 | 高 |
| 会话/项目身份（threadId、cwd） | `tools/call` 的 `_meta.thread_id`/`threadId` | 可用 | `mcp-thread-identity-evidence.md`；capture 多条 `metadata.thread_id` | 高 |
| 向当前/新会话发消息 | `ui/message` + `_meta["openai/message"]` | 可用 | 官方规范；capability 实测存在（`openai/message`，含 `.draft`） | 高 |
| 模型上下文注入 | `ui/update-model-context` | 可用（未用） | 实测 `openai/modelContext` 能力位 + `updateModelContext` | 中高 |
| 打开本地文件 | `openai/files/open` | 可用（未用） | 实测 `experimental.openai/files` | 中 |

## 6. 降级方案

| 原版能力 | Codex 现状 | 降级做法 |
| --- | --- | --- |
| 右栏面板本体 | thread 入口 | 已落地：`DeckSidebarTab` → `DetailsDock` 整块渲染 |
| 状态栏（`StatusBar`） | 无宿主槽位 | 面板内一行状态条（列表页顶部）；或 `ui/update-model-context` 把状态交给模型，界面不常驻 |
| 运行面板（`RunPanel`） | 无宿主槽位 | 面板内「运行」标签页；工具执行进度用面板内轮询/事件，不指望宿主推送 |
| 设置页（`SettingsPage`） | 无宿主槽位 | 面板内「设置」标签页（复用同一组件）；若日后 `openai/settings` 可用，只把少量布尔/枚举项搬去原生表单 |
| 原生 tab 类型/图标/引导页 | 无 API | 全部丢弃；标题与图标由 `tools/list` 条目的 `title`/`icons` 决定（官方入口图标解析顺序） |
| `tools.register` | MCP `tools/list` | 九个工具逐个映射；超时统一设 `tool_timeout_sec`；`render` 改为「摘要 + 提示 + 明细」文本块 |
| 每工具超时 | 服务级 | 工具内部自己做预算（上游 `call-scope.js` 的钳制逻辑可复用） |
| `exec.signal` 中止 | 无 | 工具内部超时自终止，回 `status: "unsupported", reason: "timeout"` |
| skills provider | 无 | 保留自绘 `SkillsTab`（现状）；或发布为 Codex 插件/技能目录，二选一 |
| locale 服务 | 只有信号 | bridge 读三层信号 → 拼 DSH 形状适配器（见 4.3） |
| 宿主 sessions/workspaces | 无 | 沿用「每面板用 `_meta.thread_id` 解析 cwd」的现有做法 |

## 7. 未确认事实与下一步探针

1. **`hostContext.locale` / `documentElement.lang` 的真实取值**。当前白名单把值过滤了。探针：在 `host-context.mjs` 里为 `locale`、`timeZone`、`lang` 三个键开一个只记值的例外，重启 Codex 桌面端，读 `.scratch/upstream-sidebar/<key>/host-context-captures.json`。
2. **`global` 入口对本机裸 `mcp_servers` 是否生效**。探针：给某个工具加 `entrypoints: [{type:"global"}]`，重启 Codex，看主侧边导航是否出现条目。若只有「插件安装」的才出现，则需把服务改造成插件包。
3. **`openai/settings` 是否对插件安装的服务开放**。探针：把同一服务打包成插件（`.codex-plugin/plugin.json` + `.mcp.json` + `~/.agents/plugins/marketplace.json`），安装后重抓 `ui/initialize`，比对 `hostCapabilities` 是否多出 `openai/settings`。
4. **`~/.codex/skills` 与 `$HOME/.agents/skills` 的加载关系**（见 3.2）。探针：只在 `~/.agents/skills` 放一个测试技能，重启后看 `/skills`。
5. **插件带的 MCP 服务与裸 `mcp_servers` 在能力广告上的差异**。第 2、3 条其实是同一个探针的两种观察面，建议合成一次插件化实验。
6. **`file` 入口**：与本 port 无关，除非要做「点开 `.md` 票」的查看器。

## 8. 来源

官方：

- [OpenAI MCP Extensions Specification](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md)：入口类型、Structured settings、`ui/message`、`ui/update-model-context`、`openai/files`、条目图标/标题解析。
- [Add UI to your MCP server](https://developers.openai.com/plugins/build/chatgpt-ui.md)：MCP Apps 基础、`document.documentElement.lang` locale 镜像、内联/全屏/画中画、CSP。
- [Model Context Protocol（ChatGPT/Codex）](https://learn.chatgpt.com/docs/extend/mcp.md)：Codex 支持的 MCP 传输与配置项、`enabled_tools`、`tool_timeout_sec`、插件提供的 MCP 服务。
- [Build skills](https://learn.chatgpt.com/docs/build-skills.md)：技能目录、加载位置、插件分发、`agents/openai.yaml`。
- [Package your plugin](https://developers.openai.com/plugins/build/plugins.md)：`plugin.json`、`skills/`、`mcp.json`、marketplace、hooks。

本机：

- `.scratch/upstream-sidebar/02a17a8faba7ae80/host-context-captures.json:296-415`：真实 `ui/initialize` 能力位与上下文键。
- `prototypes/upstream-port/browser-runtime.mjs`、`sidebar-server.mjs`、`sidebar-bridge.js`、`host-context.mjs`：port 当前装配与白名单。
- `prototypes/upstream-port/../vendor/mattskills-1.8.0-rc.7/lib/client.js:2756-2764,30052-30107`、`lib/bootstrap.js:6-13,19-72,180-189`、`shared/deck-tools/agent-register.js`、`shared/deck-tools/plan.js:99-101`：上游消费的服务形状。
- `~/.codex/config.toml:85-115,162-166`：`mcp_servers` 与 `features.enable_mcp_apps`。
- `~/.codex/plugins/cache/openai-bundled/browser/26.1103.31037/{.codex-plugin/plugin.json,docs/mcp-apps.md}`：插件声明 `skills`，以及「MCP Apps 在侧边面板标签页打开」的一手描述。
- `~/.codex/plugins/cache/openai-bundled/codex-app-tools/26.1103.31037/.mcp.json`：插件提供的 MCP 工具清单。
- `C:\Program Files\WindowsApps\OpenAI.Codex_26.1103.3517.0_x64__2p2nqsd0c76g0\app\resources\app.asar`：`openai/settings` schema 与 entrypoints 处理代码（压缩后字符串，仅作旁证）。
