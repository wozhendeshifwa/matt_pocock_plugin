# MattSkills 原版 Codex 适配

基线为本机 DSH 已安装的 1.8.0-rc.7，完整原包位于 `../../vendor/mattskills-1.8.0-rc.7`，原文件不修改。此目录是 Codex 宿主适配；本机 `deck-sidebar-probe` 注册已指向本目录，旧 `sidebar-probe` 代码保留为回退路径。

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

面板以解析出的项目目录（cwd）为挂载键：同一项目的两个聊天共享同一块看板，换聊天只更新请求身份，不重挂；切换项目才重挂。项目身份来自每次 `tools/call` 的 `_meta.thread_id` / `threadId`；耐久 cwd 来源是 `~/.codex/state_5.sqlite` 的 `threads.cwd`，`session_meta` 只覆盖 55% 且移动过的会话会返回旧项目。`session-project.mjs` 的 state_5 优先改造在 #11。

## 派发边界

`执行` 和 `新会话` 只生成 `ui/message` 草稿（`send:false`），不会启动独立任务会话，也没有侧栏内结果回显。真实桌面拿不到新线程 ID 或结果订阅，新草稿也不继承当前项目；独立任务会话和结果卡只在旧 `sidebar-probe` 回退路径中存在。详见 `../../docs/adr/0002-prefill-dispatch-boundary.md`。

## 宿主边界（2026-11-07 研究）

- Codex 只支持 MCP Apps 的 `global` / `thread` / `file` 三种入口；port 当前使用 `thread` 入口。状态栏、运行面板、设置页没有宿主 slot，后续改为面板内标签页；原生 tab 类型/图标/优先级不能注册。
- 工具走 MCP `tools/list`；没有 skills provider；locale 只有信号，需要 bridge 拼 DSH 形状适配器。技能页保留自绘。
- `global` 入口是否对裸 `mcp_servers` 生效尚未验证，见 #23；若只有插件安装的服务才有全局入口，首版入口形态需要重新评估。
- 证据：`../../docs/research/codex-host-surfaces.md`、`codex-message-dispatch.md`、`codex-thread-identity.md`。

## 验证命令

```powershell
node verify-original-client.mjs ../../.scratch/upstream-host-data/snapshot.json ../../.scratch/upstream-host-data/issue-2.json
node verify-build.mjs ../../.scratch/upstream-host-data/snapshot.json ../../.scratch/upstream-host-data/issue-2.json
node verify-sidebar.mjs C:/Users/27263/Desktop/matt_pocock_ 14 wozhendeshifwa/matt_pocock_plugin
node verify-host-context.mjs
node doctor.mjs --github
node verify-host-harness.mjs --issue 14
```

前两个使用本地采集的数据；`verify-sidebar` 通过实际 MCP 服务读取真实 GitHub 数据；`verify-host-harness` 回放真实桌面 `ui/initialize` 的能力集并验证执行/新会话草稿；`doctor --github` 是安装后的总健康检查。DOM 验证不等同于原生桌面视觉验收，最终仍需用户在 Windows Codex 侧栏实际点击验收。

## 说明

- `install.mjs --apply` 会改写 `~/.codex/config.toml`；写前备份。若不想改真实配置，先用 `node install.mjs --check`。
- `doctor.mjs` 的 `gh auth` 在 GitHub API 网络不可用时会显示 `WARN`（未验证），不把网络失败误报为未登录。
- `verify-host-harness.mjs` 只证明“真实握手能力 + 真实 GitHub + 面板逻辑”；不证明原生面板位置、视觉或跨聊天实例行为。
