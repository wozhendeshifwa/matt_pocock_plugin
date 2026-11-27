# MattSkills 原版 Codex 适配

基线为本机 DSH 已安装的 1.8.0-rc.7，上游代码位于 `../../vendor/mattskills-1.8.0-rc.7`。上游 `lib/client.js` 保持不改，界面差异由本目录构建适配。Tracker 后端及快照编排保留本项目扩展，包括规格原生子票、依赖读取及完整性元数据；升级上游时须合并保留这些扩展，并运行仓库检查中的规格列表与异常回归，不能整目录覆盖。此目录是 Codex 宿主适配；本机 `deck-sidebar-probe` 注册已指向本目录，旧 `sidebar-probe` 代码保留为回退路径。

## 安装与健康检查

```powershell
node install.mjs --check        # 只检查，不写 Codex 配置
node install.mjs --apply        # 安装/更新 ~/.codex/config.toml（自动备份）
.\install.ps1                   # 等价于 --apply；.\install.ps1 -Check 为 dry run
node doctor.mjs --github        # 安装、MCP 握手、真实 GitHub 读取全检
node verify-host-harness.mjs    # 用真实桌面的 ui/initialize 能力集回放面板
```

`install.mjs` 会：

- 检查依赖；缺失时执行 `npm ci`（有 lockfile）或 `npm install`。
- 在 `dist` 缺失或与 vendor client 哈希不一致时运行 `node build.mjs`。
- 写入 `[mcp_servers.deck-sidebar-probe]`：绝对 node 路径、只传 `sidebar-server.mjs`（不再带旧项目 argv）、`cwd`、`CODEX_HOME` 环境变量、`startup_timeout_sec`。
- 确保 `[features] enable_mcp_apps = true`。
- 写前备份 `~/.codex/config.toml`；不会强杀 Codex。安装后手动重启桌面，或先运行 `codex mcp get deck-sidebar-probe` 核对。

`codex mcp get deck-sidebar-probe` 应显示新的 command / args / cwd / env / startup_timeout_sec。`gh`/`git` 从 PATH 发现，仍可用 `DECK_GH` / `DECK_GIT` 覆盖。

## 构建

`node build.mjs` 输出 `dist/client.js` 和记录原文件哈希与适配入口的 `dist/manifest.json`。只在构建产物中适配当前聊天和新聊天预填两个入口，保留原页面和提示词。

## 主题

`theme.css` 把 Codex 注入的 `--background`、`--foreground`、`--border` 等变量映射到上游使用的 DSH 别名；`sidebar-bridge.js` 监听 MCP `ui/notifications/host-context-changed` 和 Apps SDK `openai:set_globals`，主题切换无需重开面板。宿主没有提供变量时使用 `light-dark()` 兜底。

## 项目跟随

`host-context.mjs` 只保留字段路径和 `thread/session/project/workspace/cwd` 候选值，敏感字段及无关值不会写入磁盘。捕获结果位于适配目录对应的 `.scratch/upstream-sidebar/<adapter-hash>/host-context-captures.json`；按项目隔离的缓存和会话记录在 `projects/<cwd-hash>/` 下。

面板以解析出的 Codex 项目根（project root）为挂载键：同一项目的两个聊天共用 project root，换聊天只更新请求身份，不重挂；切换项目才重挂。项目身份来自每次 `tools/call` 的 `_meta.thread_id` / `threadId`；cwd 优先读 `~/.codex/state_5.sqlite` 的 `threads.cwd`（只读），未命中再查 `sessions` / `archived_sessions` 的 `.jsonl` / `.jsonl.zst`。state_5 是耐久来源；rollout 首行只记录创建时 cwd，移动过的会话会返回旧项目，因此只做旁证，绝不覆盖 state_5。cwd 必须精确落在 `state_5.project_roots`（或 `local-projects.rootPaths`）的某个项目根内；项目外 cwd（projectless 任务目录）fail closed，不挂载、不派发上一个项目的数据。解析结果按 threadId + state_5/WAL 签名缓存，避免每 2 秒 glob。

## 派发边界

`执行` 和 `新会话` 只生成 `ui/message` 草稿（`send:false`），不会启动独立任务会话，也没有侧栏内结果回显。真实桌面拿不到新线程 ID 或结果订阅，新草稿也不继承当前项目；独立任务会话和结果卡只在旧 `sidebar-probe` 回退路径中存在。详见 `../../docs/adr/0002-prefill-dispatch-boundary.md`。

## 宿主边界（2026-11-07 研究）

- Codex 只支持 MCP Apps 的 `global` / `thread` / `file` 三种入口；port 当前使用 `thread` 入口。状态栏、运行面板、设置页都已改为面板内的 `看板 / 设置 / 状态 / 运行` 标签页（#18 复用上游 `settings.plugins.tab` 注册的同一个 `SettingsPage`）；原生 tab 类型/图标/优先级不能注册。
- 面板 shell 在 `browser-runtime.mjs`：收集上游 `sidebar.right.pane.tab`、`conversation.input.dock`、`tool.view.cordis` 三个组件，复用原 `StatusBar` / `RunPanel`，把 `session` / `useSessions` / locale 标签传进去；主看板保持挂载，切 tab 不丢状态。
- 工具走 MCP `tools/list`；Codex 没有 skills provider，port 用 `skills-service.mjs` 把 vendored `bundled-skills`（27 个）直接做成技能注册表；检查链的技能三项因此从「等待技能服务」变为已安装（6/6），面板技能页可列出 27 个、`skill.readDoc` 读到的正文与 vendor 文件逐字一致。该服务**不提供** `registerProvider`：上游 bootstrap 只有在看到这个方法时才会去扫 `~/.dsh/profiles/**`，而本票要求技能只来自 vendor、不读那些 profile 目录。locale 只有信号，需要 bridge 拼 DSH 形状适配器。
- 地图详情复用原 `MapDetail`（漏斗分层 / 当前层 / 迷雾 / 动作）。GitHub 原生依赖边在快照里是「键字符串」，而原地图视图的旧比较按数字票号；`panel-payload.mjs` 在项目数据进程把纯数字键还原为数字（非数字键原样），否则被阻塞子票不显示阻塞者也会照常给动作按钮。证据：`verify-map-view.mjs`；分层与 frontier 的口径仍由上游 `computeLevels` / `groupTickets` 计算。
- `global` 入口是否对裸 `mcp_servers` 生效尚未验证，见 #23；若只有插件安装的服务才有全局入口，首版入口形态需要重新评估。
- 读取端点已按 `rpc-endpoints.mjs` 全量路由（31 条）；写入端点 25 条由 `write-gate.mjs` + `ENABLED_WRITE_ENDPOINTS` 逐条放行，其余仍显式拒绝（`still not enabled`）。`deck_rpc_manifest` 返回清单。`logExport` 只读当天日志，已按 `write-policy` 的原注记移入读集（#18）。
- Issue 详情写操作（#12）已落地：`commentIssue`（评论）、`setLabelColors`（改色）、`bind`（工作区后端绑定，只写 `docs/agents/workspace.json`）经 `deck_upstream_write` 工具执行；认领 argv 归 `deck_issue_patch`；`handoffResolve` 仅扫描交接文件。面板只在用户自己的动作（评论提交 / 改色保存 / 切换确认）后调用写工具；bridge 的读调用仍走 `deck_upstream_read`，写端点走读工具会被服务端拒绝。`write-gate.mjs` 是唯一判据：固定 argv 模板 + owner/repo、票号、标签名、6 位色值、正文长度逐项校验，git 写入 / `gh api graphql` / 任意 endpoint / 多余 flag 继续 fail closed。每次写（endpoint 与真实 argv）追加 `<项目数据目录>/write-audit.jsonl`，只记方法、分类、项目哈希、argv 哈希、确认方式与结果，不记正文与绝对路径。证据：`verify-write-gate.mjs`（12 条允许模板、21 条拒绝形状）与 `verify-issue-writes.mjs`（测试仓库 `wozhendeshifwa/codex_mattskills_plugin`：评论、改色、绑定、缺票错误、关/重开、审计、面板评论表单；写入只落在测试仓库）。
- 版本管理读取（`gitStatus` / `gitDiff` / `gitLog`）走真实 git：上游会给每条命令加一段固定全局选项前缀（`-C <dir> --no-optional-locks --literal-pathspecs -c k=v …`），`read-command.mjs` 先剥这段前缀再判子命令（含 `for-each-ref`、`rev-list`、`reflog show`），写子命令和 `--output`/外部 diff 之类仍拒绝。输出超过字节上限时按 `truncated` 上报，不把半份的状态或补丁交给界面。
- 拉取请求页（#4）：PR 行来自快照（`isPullRequest` + `mergedAt`，已合并显示「已合并」），PR 详情是上游 #506 的只读视图——只列评论、不给输入框（文案「read-only · 写操作请走 新会话」），评论写入仍走同一条 `commentIssue`（面板里由提示词侧发起），无 PR 的仓库显示「还没有拉取请求」。上游 1.8.0-rc.7 没有关闭/合并动作，`pullRequests` 能力位只驱动页签显隐。已知限制：`issueComments` 用 tracker 的 GraphQL 按 issue 号解析，对 PR 号返回 `notFound`，所以 PR 评论的「加载更多」不可用（首屏来自 `issueDetail`）。证据：`verify-pr-page.mjs`。
- 写权限模型见 `../../docs/research/codex-write-authority.md` 与 `write-policy.mjs`：固定 argv 白名单、项目/数据根白名单、上游确认或 Codex 工具审批、`write-audit.jsonl` 审计；`updateInstall`/`deckExec` 明确拒绝。已开的写面：issue 写（#12）与设置写（#18：`logSetSwitch`、`logClear`、`openFolder`、`openPath`）；git 写入（#9）、PR（#4）、自动命名守护保持关闭；#7 手动建议在状态页查看、复制或取消，详见 `../../docs/research/codex-handoff-naming.md`。
- 设置页（#18）：面板内新增「设置」标签，复用上游 `SettingsPage`；调试日志开关写 `wf.logSetSwitch`，导出走读电话 `wf.logExport`，清空走 `wf.logClear`（只删数据目录内的日志文件）；设置按项目隔离（项目数据进程的 cwd 决定缓存目录）。「打开」目录走上游平台配方 `cmd /c start`，`open-command.mjs` 只放行该 argv 形状且目标必须落在工作区或项目数据根内，其他程序/语句/根外路径一律拒绝。Codex 侧没有 `dsh-plugin-update`，面板在设置页明确写出「不内置更新，请拉仓库后跑 `install.mjs --apply`」，`updateStatus`/`updateCheck` 如实返回缺包错误而不是假装已是最新。
- 9 个 `deck_*` 工具已通过 MCP `tools/list` 暴露；`deck_context`、`deck_issue_list`、`deck_issue_get`、`deck_map_snapshot` 已用真实数据调用。`deck_issue_patch` 的评论 / 标签 / 认领 / 标题正文 / 关重开走同一套 `write-gate.mjs` 与审计；`deck_issue_create` 的建票 argv 已放行，父子/依赖边仍因 `gh api graphql` mutation 未放行而失败（见地图 fog）。
- locale 由 bridge 从 `hostContext.locale` / `document.documentElement.lang` / `window.openai.locale` 取信号，拼 `register/bind/getSnapshot` 服务；`verify-locale` 覆盖 en-US / zh-CN。会话读取由 `session-store.mjs` 映射 `state_5.sqlite`，bridge 通过 `useSessions` 提供当前项目会话。
- 证据：`../../docs/research/codex-host-surfaces.md`、`codex-message-dispatch.md`、`codex-thread-identity.md`。

## 验证命令

```powershell
node verify-original-client.mjs ../../.scratch/upstream-host-data/snapshot.json ../../.scratch/upstream-host-data/issue-2.json
node verify-build.mjs ../../.scratch/upstream-host-data/snapshot.json ../../.scratch/upstream-host-data/issue-2.json
node verify-sidebar.mjs C:/Users/27263/Desktop/matt_pocock_ 14 wozhendeshifwa/matt_pocock_plugin
node verify-map-view.mjs C:/Users/27263/Desktop/matt_pocock_ 3 wozhendeshifwa/matt_pocock_plugin
node verify-host-context.mjs
node verify-rpc-manifest.mjs
node verify-rpc-coverage.mjs
node verify-deck-tools.mjs
node verify-locale.mjs
node verify-sessions.mjs
node verify-session-project.mjs
node verify-project-follow.mjs
node verify-write-policy.mjs
node verify-write-gate.mjs
node verify-issue-writes.mjs
node verify-skills-page.mjs
node verify-pr-page.mjs
node verify-settings-page.mjs
node verify-version-control-read.mjs
node verify-version-control-view.mjs
node doctor.mjs --github
node verify-host-harness.mjs --issue 14
```

前两个使用本地采集的数据；`verify-sidebar` 通过实际 MCP 服务读取真实 GitHub 数据；`verify-map-view` 用一次原生 GraphQL 查询（`subIssues` + `blockedBy` + assignees）独立算出层/可接/被阻塞，再断言快照、地图统计与面板 DOM 与之一致，并验证地图级动作仍是 `send:false` 草稿；`verify-rpc-manifest` 对照 vendor 的 56 个 `harness.handle` 校验读/写分类，`verify-rpc-coverage` 走 MCP 代表性读取端点并验证写入端点被拒绝；`verify-deck-tools` 验证 9 个 `deck_*` 工具与真实数据；`verify-locale` 验证宿主语言切换；`verify-sessions` 验证 Codex 会话存储映射；`verify-session-project` 校验 state_5 优先、rollout/zstd 兜底、项目根匹配与 fail-closed；`verify-project-follow` 用两个真实 MCP 服务实例校验同项目/跨项目/项目外/未落盘四类身份；`verify-write-policy` 校验写端点/工具/argv/fs/确认/审计模型覆盖；`verify-write-gate` 校验新写闸的允许模板与拒绝形状；`verify-issue-writes` 在测试仓库 `wozhendeshifwa/codex_mattskills_plugin` 上跑真实评论/改色/绑定/关重开，并驱动面板评论表单与审计断言；`verify-skills-page` 校验检查链技能三项全绿、27 个技能全列、3 份正文与 vendor 逐字一致、面板点开技能走 `skill.readDoc`；`verify-pr-page` 在测试仓库拉取请求夹具上校验 PR 页签（Open / 已合并状态）、只读详情、`commentIssue` 写 PR 评论、以及无 PR 仓库的空状态；`verify-settings-page` 驱动真实面板点开「设置」标签（上游 `SettingsPage` 渲染、更新禁用说明）、拨动调试日志开关并断言项目数据目录里的 `log-switch.json`、审计与读回一致（结束后恢复原值），并校验 `logExport` 走读电话、`openFolder` 只接受 `cmd /c start` 且目标根外/含壳元字符一律拒绝；`verify-version-control-read` 用临时仓库验证版本管理三条只读电话（脏/干净/非 git/大补丁截断/分页/只读不写 index）；`verify-version-control-view` 从面板点开版本管理标签，验证真实仓库的改动清单与提交数；`verify-host-harness` 回放真实桌面 `ui/initialize` 的能力集并验证执行/新会话草稿与面板内状态/运行标签页；`doctor --github` 是安装后的总健康检查。DOM 验证不等同于原生桌面视觉验收，最终仍需用户在 Windows Codex 侧栏实际点击验收。

## 说明

- `install.mjs --apply` 会改写 `~/.codex/config.toml`；写前备份。若不想改真实配置，先用 `node install.mjs --check`。
- `doctor.mjs` 的 `gh auth` 在 GitHub API 网络不可用时会显示 `WARN`（未验证），不把网络失败误报为未登录。
- `verify-host-harness.mjs` 只证明“真实握手能力 + 真实 GitHub + 面板逻辑”；不证明原生面板位置、视觉或跨聊天实例行为。
