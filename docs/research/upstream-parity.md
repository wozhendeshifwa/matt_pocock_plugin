# MattSkillsDeck 1.8.0-rc.7 搬运基线

基线来自用户已安装的 DSH desktop 插件，与两张参考截图中的版本一致。完整发布包保存于 `vendor/mattskills-1.8.0-rc.7`，共 355 个文件。旁边的 integrity 文件记录逐文件 SHA-256，原 MIT 许可证随包保留。此前读取的上游 a81af8b 提交对应 1.9.0-beta.34，不能混用为这版界面的验收基线。

## 已核对的原版行为

| 原版能力 | 源码位置 | Codex 搬运要求 |
| --- | --- | --- |
| 仓库身份、刷新、列表、版本管理、拉取请求、技能、环境检查、需求与 BUG 入口 | `lib/client.js` 的 `useTabsRow`、`DetailsDock` | 沿用原组件、样式、顺序和窄栏折叠规则，能力门控取真实适配结果 |
| 全部、Open、已关闭、阻塞、可接，排序、标签筛选、分页与已关闭折叠 | `ListTab`，`lib/issueList.js`、`lib/issuePage.js` | 沿用原计算和筛选，分页不能改成固定读取 50 条 |
| Issue 正文、评论、父级、子任务、阻塞关系、面包屑返回、评论提交、复制链接 | `IssueDetail`，`lib/issueDetail.js`、`lib/commentThreads.js` | 正文和评论按原接口取数，不能从摘要推断为空 |
| 地图分层、任务状态、当前可推进层、单项与批量动作 | `MapDetail`，`lib/mapBody.js`、`lib/mapTickets.js`、`lib/ticketGrouping.js` | 直接复用原规则和原界面 |
| 诊断、接手、补充、修复、讨论、研究、原型、执行 | `rowActionKind`、`rowActionText`、`PROMPTS` | 优先级与提示词保留，只适配宿主发送入口 |
| 当前聊天预填与新会话 | `inject`、`openTextInNewSession` | 分别映射 Codex 的当前聊天与新聊天能力，核验目录和会话归属 |
| 27 个技能、技能正文、推荐及加载 | `SkillsTab`、`lib/skillDoc.js`、`bundled-skills/` | 搬运同版本技能，逐个核对 DSH 专用工具与 Codex 对应能力 |
| 环境检查与修复入口 | `ChecksTab`、`lib/detectChain.js`、`lib/tracker/` | 接真实环境检查结果，保留失败和修复流程 |
| 版本管理 | `lib/versionControl*.js` 及客户端对应组件 | 按同版本已有操作搬运，沿用原确认流程 |
| 拉取请求列表及打开、关闭、合并状态 | `PrTab` 与 tracker | 保留原页面与状态定义 |
| 项目内共享与跨项目隔离 | `getCwdSync`、`useDockSync`、`lib/workspaceCwd.js`、`lib/workspaceKey.js` | 用真实 Codex 聊天归属替换 DSH sessions，按原目录规则读取项目 |
| 设置、主题、模板、交接、状态栏 | `SettingsPage`、`StatusBar` 和宿主配置接口 | 分别核验可挂载的 Codex 入口，保留原操作语义 |

原版任务动作先判断状态，再判断类型。无标签或 `needs-triage` 进入诊断，然后依次为 `ready-for-human` 接手、`needs-info` 补充、`bug` 修复、`wayfinder:grilling` 讨论、`wayfinder:research` 研究、`wayfinder:prototype` 原型，其余进入执行。来源为 `lib/client.js:7296`。

1.8.0-rc.7 的清单说明 GitHub 是主要后端，Markdown 为预览，GitLab 暂不支持。目录中存在 GitLab 模块也不能据此宣布已支持。后续若升级基线，需重新核对版本差异。来源为原包 `package.json`。

## 适配边界

原始发布包保持逐字保存。迁移代码独立放在 `prototypes/upstream-port`。前端通过模块加载器、React、slots、connection、sessions、workspaces、locale、timer 等宿主服务装配。后端通过 subprocess、fs、timer、connection 等服务装配。改动集中在这些宿主接口，原有页面和任务规则继续使用上游实现。

此前 `prototypes/sidebar-probe` 只保留为原生侧栏接入和独立诊断的验证代码。其固定仓库、手写页面、统一只读诊断及单独运行卡片不代表搬运实现。

## 当前验证

- 原始客户端通过隔离的模块加载器与 React 装配，在 DOM 中注册并挂载了原生侧栏组件。原组件中的列表、版本管理、技能、环境检查导航可读。
- 隔离检查拒绝数据与动作请求，用来验证原始客户端能装配。它没有验证真实 Codex 侧栏的数据、导航外观和任务执行。
- 原始 React 组件在开发模式下报告部分子节点缺少 key。此次保留上游文件，后续视觉与交互检查需继续留意。
- Codex 项目归属与会话 API 的核对见同目录 `codex-host-contract.md`。自动跟随与原生派发仍需宿主端验证。

### 2026-11-06 原版移植调用链验证

`prototypes/upstream-port/node-host.mjs` 已装配原版后端。早期用真实 `yu_picture` 工作目录读取 GitHub 快照和 Issue #2 作为夹具；2026-11-06 当前项目已初始化本地 Git 并关联 `wozhendeshifwa/matt_pocock_plugin`，侧栏现改为读取该仓库的 Issue #1。缓存与状态位于工作区的独立数据目录。当前接口仅开放读取，写入类业务操作尚未适配。

`build.mjs` 打包 React 与原版客户端，保留上游 vendor 文件不变。构建产物仅在 `inject`、`openTextInNewSession` 两个宿主动作入口注入适配转发；每个锚点必须唯一，否则构建失败。样式、组件、动作选择和提示词生成仍使用原实现。构建清单记录原版客户端 SHA-256。

`verify-build.mjs` 已验证生产构建中的原版列表、#2 行点击、完整正文、验收条件与评论，并验证原版“执行”和“新会话”将同一提示词交给 active/new 两个宿主目标。也验证了不提供虚构 session 的加载路径。动作测试使用内存接收器，没有创建或发送真实聊天。

`sidebar-server.mjs` 与 `sidebar-bridge.js` 提供待部署的 MCP 侧栏接入，要求显式项目目录，兼容 board.html、board-v3.html、board-v4.html 三个资源地址。`verify-sidebar.mjs` 已通过“原版页面 → MCP → 原版后端 → GitHub”的真实列表、详情、评论读取。该检查中的 MCP UI 握手为模拟，不能替代原生桌面视觉验收。

主题适配由 `theme.css` 与 `sidebar-bridge.js` 完成：Codex 的 `--background`、`--foreground`、`--border` 等变量映射到上游 DSH 别名，同时支持 MCP `host-context-changed` 和 Apps SDK `openai:set_globals` 的实时更新。宿主变量缺失时按 `light`/`dark` 使用 `light-dark()` 兜底，避免继续落到上游固定深色默认值。

聊天动作适配检查实际握手声明的 openai/message 能力，以 send:false 保留原版预填语义。未声明能力时显示错误，不伪造成功。本机 `deck-sidebar-probe` 注册已替换为上游适配服务；宿主热加载日志确认服务以 `0.2.0` 初始化。当前仍未验证原生桌面中的列表/详情视觉、当前项目自动跟随、新聊天项目继承、技能加载、版本管理及写入操作；这些仍是完整移植的验收项。

### 2026-11-07 身份检查、挂载键与派发边界

- `verify-sidebar.mjs` 改为临时 `CODEX_HOME` + `_meta.threadId`：先写入一条映射到本项目 cwd 的 `session_meta`，再走真实 thread→cwd 解析；服务端返回 `isError` 时直接报可读错误，不再把错误文本当 JSON 解析。真实 GitHub 列表/详情/主题检查已重跑通过。
- `sidebar-server.mjs` 不再要求启动项目参数；数据根按 adapter checkout 隔离，项目按每次请求的 thread 身份解析。`open_deck_sidebar_probe` 也不再宣称固定项目。
- `sidebar-bridge.js` 以 cwd 作为面板挂载键：同一项目换聊天只更新请求身份、不重挂；切换项目才重挂；`threadId` 用于本次请求和旧请求校验。
- port 的 `执行/新会话` 仍只生成 `send:false` 草稿；独立任务会话与结果回显只存在于旧 `sidebar-probe`。边界见 `docs/adr/0002-prefill-dispatch-boundary.md`。

### 2026-11-07 Codex 宿主边界研究

- `codex-host-surfaces.md`：Codex 只支持 MCP Apps 的 `global` / `thread` / `file` 三种入口；`sidebar.right.pane.tab` 就是 `thread` 入口，位置由宿主决定。状态栏、运行面板、设置页没有宿主槽位，原生 tab 类型/图标/优先级不能注册；工具走 MCP `tools/list`；没有 skills provider；locale 只有信号，需要 bridge 拼 DSH 形状适配器。状态栏/运行/设置改为面板内标签页，技能页保留自绘。
- `codex-message-dispatch.md`：真实桌面声明 `openai/message`（含 `.draft`）；`ui/message` + `send:false` 只生成 composer 草稿，不返回线程 ID、没有结果订阅，`target:"new"` 的新草稿不继承当前 thread 的项目。继续按 ADR-0002 保留草稿边界，界面文案不得暗示独立任务会话或结果回显。
- `codex-thread-identity.md`：UI 的每次 `tools/call` 都带 `_meta.thread_id` + `threadId`；`resources/read`、`ui/initialize`、`host-context-changed` 不带身份。项目 cwd 的耐久来源是 `~/.codex/state_5.sqlite` 的 `threads.cwd`（220/220），`session_meta` 只覆盖 55% 且移动过的会话会返回旧项目。`session-project.mjs` 需改为 state_5 优先、rollout/zstd 兜底、来源冲突 fail closed；#11 已按此补充。
- 新增 `#23`：验证裸 `mcp_servers` 能否获得 `global` 入口；若不能，评估插件化安装。ADR-0001 的全局入口要求仍需真实桌面证据。

### 2026-11-07 安装与真实宿主夹具

- `prototypes/upstream-port/install.mjs` 与 `install.ps1`：一键检查/安装，自动备份 `~/.codex/config.toml`；写入绝对 node 路径、只传 `sidebar-server.mjs`、`cwd`、`CODEX_HOME`、`startup_timeout_sec`，并确保 `features.enable_mcp_apps = true`。依赖缺失时执行 `npm ci`/`npm install`，构建过期时重跑 `node build.mjs`。
- `prototypes/upstream-port/executables.mjs`：`gh` / `git` 改为 PATH + `DECK_GH` / `DECK_GIT` 覆盖 + 常见安装路径兜底，不再硬编码一台机器的路径。
- `prototypes/upstream-port/doctor.mjs`：安装、配置、构建、MCP 握手、资源、thread 身份、真实 GitHub 读取的总健康检查；GitHub API 网络不可用时 `gh auth` 显示 WARN，不误报未登录。
- `prototypes/upstream-port/verify-host-harness.mjs`：回放真实桌面 `ui/initialize` 的 `hostCapabilities` 键集，验证 `openai/message` 能力、真实 GitHub 列表/详情、`执行`/`新会话` 的 `send:false` 草稿；原生面板位置与视觉验收仍归用户。
- 安装后的 `codex mcp get deck-sidebar-probe` 显示 command / args / cwd / env / startup_timeout_sec；`serverInfo.name` 与配置键对齐为 `deck-sidebar-probe`。

### 2026-11-07 RPC 读取覆盖

- `prototypes/upstream-port/rpc-endpoints.mjs` 把 vendor `lib/index.js` 的 56 个 `harness.handle` 注册分成 30 条读端点与 26 条写端点。`skill.readDoc` 命名修正；`detect`、`gitStatus`、`gitDiff`、`gitLog`、`gitWriteCheck`、`gateStats`、`bindings`、`handoffLatest`、`awaitCreatedIssue`、`updateStatus/Check/Changelog` 等读取路径纳入。
- `node-host.mjs` 不再维护 `readMethods` 白名单：读端点全部路由，写端点显式返回 `Host action is a write and is not enabled in this ticket`，未知端点显式报 `Unknown upstream endpoint`。`setupLayout` 按是否带 `layout` 分为读/写。
- `sidebar-server.mjs` 新增 `deck_rpc_manifest`；`verify-rpc-manifest.mjs` 对照 vendor 注册表校验清单，`verify-rpc-coverage.mjs` 走 MCP 代表性读取端点并验证写端点/未知端点被拒绝；`doctor.mjs` 增加 manifest 检查，当前 `doctor` 29/29（未跑 GitHub 时）。

### 2026-11-07 工具、locale 与会话服务

- `node-host.mjs` 补 `tools` 服务：上游 `hookDeckAgentTools` 注册的 9 个 `deck_*` 工具被捕获，`sidebar-server.mjs` 通过 MCP `tools/list` 暴露；`project-worker.mjs` 的 `__deck_tool_call__` 把当前项目 cwd/thread 作为 `exec` 上下文传给工具。
- 真实数据已验证：`deck_context`、`deck_issue_list`、`deck_issue_get`、`deck_map_snapshot` 返回真实仓库/票/地图数据；写工具仍受 #5 的写授权边界约束。
- `sidebar-bridge.js` 从 `hostContext.locale` / `document.documentElement.lang` / `window.openai.locale` 拼 DSH 形状 locale 服务（`register` / `bind` / `getSnapshot`），`tr()` 不再永久中文；`verify-locale.mjs` 覆盖 en-US 初始与 zh-CN 切换。
- 新增 `session-store.mjs`：只读 `state_5.sqlite` 的 `threads.cwd`，给 `sessions.get` / `sessionQuery.filterSessions` / `readSession` / `listEvents` 提供真实记录；bridge 的 `useSessions` 返回当前项目会话，缺失时返回空快照。
- `verify-deck-tools.mjs` 验证 9 个工具与真实数据；`verify-sessions.mjs` 验证会话存储映射；`doctor.mjs` 增加 9/9 工具表检查（当前 30/30，未跑 GitHub 时）。
