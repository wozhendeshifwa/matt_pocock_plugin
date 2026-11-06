# MattSkills 原版 Codex 适配

基线为本机 DSH 已安装的 1.8.0-rc.7，完整原包位于 `../../vendor/mattskills-1.8.0-rc.7`，原文件不修改。此目录是正在开发的宿主适配；本机 `deck-sidebar-probe` 注册已于 2026-11-06 指向本目录，旧 sidebar-probe 代码保留为回退路径。

构建：`node build.mjs`。输出 `dist/client.js` 和记录原文件哈希与适配入口的 `dist/manifest.json`。只在构建产物中适配当前聊天和新聊天预填两个入口，保留原页面和提示词。

主题：`theme.css` 把 Codex 注入的 `--background`、`--foreground`、`--border` 等变量映射到上游使用的 DSH 别名；`sidebar-bridge.js` 监听 MCP `ui/notifications/host-context-changed` 和 Apps SDK `openai:set_globals`，主题切换无需重开面板。宿主没有提供变量时使用 `light-dark()` 兜底。

项目跟随探针：`host-context.mjs` 只保留字段路径和 `thread/session/project/workspace/cwd` 候选值，敏感字段及无关值不会写入磁盘。捕获结果位于当前项目对应的 `.scratch/upstream-sidebar/<hash>/host-context-captures.json`。这是诊断数据，不代表已经找到可用的自动跟随信号。

启动 MCP 服务：`node sidebar-server.mjs <项目绝对路径>`，或提供 `DECK_PROJECT_ROOT`。服务按显式目录隔离缓存；此绑定不代表已识别 Codex 当前项目。读取原版 GitHub 数据需要本机 git、gh 及既有 gh 登录。

验证命令：

```powershell
node verify-original-client.mjs ../../.scratch/upstream-host-data/snapshot.json ../../.scratch/upstream-host-data/issue-2.json
node verify-build.mjs ../../.scratch/upstream-host-data/snapshot.json ../../.scratch/upstream-host-data/issue-2.json
node verify-sidebar.mjs C:/Users/27263/Desktop/matt_pocock_ 1 wozhendeshifwa/matt_pocock_plugin "Exercise the MattSkillsDeck sidebar"
node verify-host-context.mjs
```

前两个使用本地采集的数据，第三个通过实际 MCP 服务读取真实 GitHub 数据。第三个参数依次为项目目录、Issue 编号、期望仓库和正文片段；省略后三个参数时仍可用于旧 `yu_picture`/Issue #2 夹具。DOM 验证不等同于视觉验收。当前 Codex 注册固定绑定本项目；自动跟随和会话关联仍待接入，详见 `../../docs/research/upstream-parity.md`。
