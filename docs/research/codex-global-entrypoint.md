# Codex 桌面端 `global` 入口实测与首版入口结论

核对时间 2026-11-07。对象是本机 Windows Codex 桌面端 `26.1103.4239.0`（随机附带的 CLI `0.167.0-alpha.3.2`）；`#8` 研究时的 `26.1103.3517.0` 已被替换，因此本票顺带复核了新版本。

## 一句话结论

**首版继续使用 `thread` 入口。** 在本机版本上，`global` 入口对裸 `mcp_servers` 和本地安装的 Codex 插件都不产生主侧栏条目；插件详情页虽然能打开一个全屏 App 视图，但该视图的 `ui/initialize` 不带 `threadId`/`cwd`，无法按聊天项目隔离。这属于宿主能力限制，不是 port 少写了一个字段。

## 探测方法

1. 用 `ChatGPT.exe --remote-debugging-port=9222` 启动桌面端，通过 CDP 连接 `app://-/index.html`。
2. 读取左侧导航的按钮标签、`document.body.innerText`，并截图留证。
3. 修改 `sidebar-server.mjs` 的 `tools/list` 条目后重启宿主，重复第 2 步。
4. 需要插件时，用本地 marketplace + `codex plugin add` 安装，再重复第 2 步。

自动化的 CDP 脚本是本次探测的临时工具，放在 `.scratch/`（已被 git 忽略）；命令与观察值记录在下面，足以复现。

## 结果

### 1. 裸 `mcp_servers` + `{type:"global"}`：主侧栏没有条目

把 `open_deck_sidebar_probe` 的 `_meta["openai/ui"].entrypoints` 从 `thread` 改成 `global`，重启后主侧栏只有宿主内建项：

```
首页 图像 定时任务 资料库 插件 探索 代码审查 站点
```

没有 `MattSkillsDeck`，也没有多出任何 App 图标。宿主日志能证明服务已被拉起，说明不是配置没生效。

### 2. 本地插件 + `{type:"global"}`：插件页可见，主侧栏仍没有条目

按官方布局做了最小插件：

```
mattskills-deck/
├── .codex-plugin/plugin.json   # name/version/mcpServers/interface
└── .mcp.json                   # stdio: node + sidebar-server.mjs
```

用本地 marketplace 安装后：

- `插件 → 已安装` 出现 `MattSkillsDeck`；
- 插件详情页有 `打开插件`；
- 点击后确实进入全屏 App 视图，页面标题变成 `MattSkillsDeck`；
- **主侧栏仍然没有条目**；给工具补 `icons` 后也没有。

本地插件的 `plugin.json` 没有 `extensions` 字段；宿主把「全局侧栏条目」建在已安装插件的 release 元数据 `extensions.entrypoints`（含 `default_pinned`）上，本地插件声明不了。也就是说，global 入口在本机只存在于「插件详情页手动打开」这条路径，不进入 ADR-0001 要求的右上角 `+` 对应区域。

### 3. 全局 App 视图没有 thread 身份

点击 `打开插件` 后，bridge 落下的 `ui/initialize` capture：

- `hostContext` 没有 `threadId`、没有 `cwd`；
- 多出 `openai/viewer-header`、`hostContext.view`、`widget`、`subjectId` 等 App 视图字段；
- 同一轮之前的 `resources/read` 只带空 `metadata`。

这与 `#22` 的结论一致：global 入口天然没有 thread 身份，项目跟随必须由 UI 自己提供显式项目选择器。当前 port 的 `resolveSessionProject` 会 fail closed，所以真实看板在这个视图里只会停在加载/报错，不会误读上一个项目。

### 4. 最小 App 能加载，证明不是资源通路坏了

用一个只返回 `<h1>GLOBAL PROBE OK</h1>` 的最小 MCP App 重测：点 `打开插件` 后页面标题变成 `Global Probe`，宿主显示 `响应超时 / 重试`（因为没有 bridge 回应握手）。这说明 App 视图的 HTML 注入与 `ui://` 资源读取在本机是通的；问题不在资源通路，而在入口形态与身份。

## 为什么不是「再补一个安装脚本」就能解决

- 主侧栏条目需要插件的 `extensions.entrypoints` / `default_pinned`，这是宿主下发的 release 元数据；本地 `plugin.json` 无法声明。
- 即便宿主未来对本插件开放该元数据，全局视图仍然没有 `threadId`，必须新增显式项目选择器，并把 `deck_*` 工具的项目解析改成「用户选择优先、缺失 fail closed」。
- 这两件事都不属于本 port 的单票改动，且会让首版验收口径从「按聊天自动跟随」变成「手动选项目」，需要重新评估。

## 对首版的影响

- 首版入口：`thread`（与当前实现一致），项目跟随继续走 `state_5.threads.cwd`（`#11`）。
- `#15` 的入口验收项改为 `thread`；不再把 global 当作首版门槛。
- ADR-0001 的「全局入口」要求记录为宿主限制；若宿主版本升级后开放本地插件侧栏固定，再另开票评估「global + 显式项目选择器」。
- 本次探测用的插件、marketplace、插件缓存已删除；`~/.codex/config.toml` 的裸 `deck-sidebar-probe` 已恢复 `enabled = true`，`sidebar-server.mjs` 已恢复 `thread` 入口。

## 未覆盖

- 没有遍历命令面板、搜索、系统托盘等所有可能的 App 入口；只验证了主侧栏、插件页与插件详情页。
- 没有验证 hosted/远程插件（需要上架或账号侧 release 元数据）；本结论只覆盖本机可复现的裸服务与本地插件。

## 复现附录

最小插件与 marketplace 的安装命令（在临时 `CODEX_HOME` 下也验证过）：

```powershell
codex plugin marketplace add <repo>/.scratch/plugin-probe
codex plugin add mattskills-deck@probe-marketplace
```

marketplace 文件：

```json
{
  "name": "probe-marketplace",
  "plugins": [
    {
      "name": "mattskills-deck",
      "source": { "source": "local", "path": "./plugins/mattskills-deck" },
      "policy": { "installation": "AVAILABLE", "authentication": "ON_INSTALL" }
    }
  ]
}
```

插件 manifest 最小字段：`name`、`version`、`description`、`mcpServers: "./.mcp.json"`、`interface.displayName`。`mcpServers` 里用绝对 `command`/`args`/`cwd` 指向本仓库的 `sidebar-server.mjs`。

宿主代码旁证（`26.1103.4239.0` 的 `app.asar` 压缩代码）：

- 全局条目来自 `plugin.installed && plugin.enabled && availability !== "DISABLED_BY_ADMIN"` 的 `extensions.entrypoints`；
- 缓存键 `mcp-global-entrypoints-v3`；
- 工具侧的 `_meta["openai/ui"].entrypoints` 会被解析并做 `ui://` 校验，但不会自动变成主侧栏条目。
