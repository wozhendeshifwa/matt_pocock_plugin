# 原生验收服务切换

日期：2026-11-26（Asia/Shanghai）。用户在本聊天明确确认后执行。

## 已完成

- 配置：`C:\Users\27263\.codex\config.toml`。
- 原始配置备份：`C:\Users\27263\.codex\config.toml.bak-issue62-2026-11-26T10-03-51-827Z`。
- 仅将 `[mcp_servers.deck-sidebar-probe]` 的 `args[0]` 与 `cwd` 从主工作区 `prototypes/upstream-port` 改为 `.scratch/issue62/integration/prototypes/upstream-port`。
- 原始配置 SHA256：`8f1b2791c2aac7c6563ec86bd69b80e059f9cbd5d482f055960d41d73ba06ae3`。
- 应用后配置 SHA256：`a9685d4546c0002843a5a247e3799bdb2fb5fd40094774fc1ebe22358e34bd51`。
- 写入前检查配置指纹、备份逐字节相等且无并发修改；两项路径替换逆转后逐字节等于原配置。因此提供商及其他配置内容完整保留。
- 执行 `node install.mjs --check --no-build --no-install`，19/19 检查通过；GitHub 认证项因网络标为 WARN/unverified，不能表述为联网认证验证成功。

## 尚未生效的运行状态

配置切换后重新调用侧栏工具，再以只读 CIM 查询运行进程。所有匹配 `sidebar-server.mjs` 的 Node 进程仍使用主工作区脚本，没有指向集成工作树的服务进程。因此不能将现有面板当作新版原生验收结果。

当前没有发现可用的公开 MCP 服务重载工具。本轮没有终止用户的 Codex 进程或其他聊天的服务。下一步由用户重启 Codex，返回本聊天继续；随后先确认进程及面板已经加载集成版本，再进行原生布局、折叠/恢复、草稿隔离和复制检查。

## 验收与回退

本记录只证明备份及配置路径切换完成，不证明新版已运行或任何原生产品必验项通过。可靠宿主草稿读写的独立限制仍见 [最终矩阵](issue62-final-review-and-acceptance.md)，父规格保持开放。

如需回退，应先核对配置是否有后续修改；仅恢复这两项原路径，不直接以旧备份覆盖可能新增的用户配置。完整备份作为恢复依据保留。
