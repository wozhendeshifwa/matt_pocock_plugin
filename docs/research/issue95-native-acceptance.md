# #95 真实 Codex 验收：连接已配置，候选尚待加载

日期：2026-11-27。父规格 #81；前置 #91/#93/#94 已关闭。本轮只完成了宿主配置及加载检查，没有将受控结果记为 T/X 原生通过。#81/#95 保持开放。

## 待验构建

- 独立分支 `codex/issue95-native-combined`，准备提交 `0181500a7cc78229e1c35173b67283edf17d6157`，产品组合 `a636d1f11501c52d04dc819b76726b894e39c744`。
- 来源为主题 `35cb8e3` 与 A 界面及审查修复 `7e9337b`。完整受控及构建指纹见 `issue95-combined-candidate.md`。
- 预检资源：`ui://deck-sidebar/board-e743dedbfc0353ea.html`；HTML SHA256 `20b7953d3fe5fc635408e7ffe5a4c92136d02823193bb84e78fedd1191f1a9ae`。这是独立 stdio 客户端读取结果，不是宿主加载证明。

## 已获授权并完成的设置操作

用户明确授权：先备份，再仅新增 `deck-issue95-acceptance`；保留原连接及全部 provider，加载最终组合候选验收，未完成前不关闭 #81/#95。

实际写入前核对配置指纹并保存完整字节备份：

`C:/Users/27263/Desktop/matt_pocock_/.scratch/issue95/context/config-backups/config.before-issue95-2026-11-27T05-04-36-530Z.toml`

原配置 SHA256：`d4559d1e4fdc003413ed311b2767ff5e3412fd2c802c61bd79f17540aa73cbab`。只追加独立候选表，初次追加后 SHA256 为 `be3f57b7a22e1f9c056815ba28963c36efe6629aa7c084dd2e86de31a873ed9d`，原字节前缀完整保留。备份含私人配置，保存在被忽略的本机目录，不纳入提交或上传。

另一个经用户授权的 #92 聊天随后追加了自身 `deck-issue82-acceptance`，本轮不修改该条目。2026-11-27T05:10:26Z 再核对：原完整字节前缀仍一致，原 `deck-sidebar-probe` 及所有原 provider 段原文均保留，95 候选存在且 enabled=true。该时点总配置 SHA256 为 `e1d605b4ba3388b2d42585e870041f1ec87be9e0925d0b11c16a6d01b1b6fd70`；不将并发授权追加误认为原配置丢失。

## 原生观察与加载缺口

通过返回的原生窗口对象读取和操作当前 Codex 模式宿主，实际运行路径为：

`C:/Program Files/WindowsApps/OpenAI.Codex_26.1120.6357.0_x64__2p2nqsd0c76g0/app/ChatGPT.exe`

这里用运行路径确认包版本 `26.1120.6357.0`；不把可执行文件中的 Chromium `158.0.8127.89` 当作 Codex 发布版本。

- 真实设置 > 插件 > MCP 已出现 `deck-issue95-acceptance`。
- 候选专属详情实际显示授权的 node 命令、`.scratch/issue95/context/candidate/stdio-entry.mjs` 和独立 cwd；保存按钮为禁用，未改写这些字段。
- 仅对本候选开关执行停用/启用一次，真实截图确认最终启用，未动原服务或其它连接开关。
- `codex mcp get deck-issue95-acceptance --json` 正确解析同一入口及 enabled=true。
- 单独停启后，当前工具目录仍无95候选命名空间；只读进程查询 `CandidateProcessCount=0`。候选捕获文件只含早先独立协议预检的 `mcp/resources/read/resource`，没有新的宿主初始化主题/项目捕获，故不能称为实际宿主加载。

原生设置截图及AX、配置应用和保留核对JSON、协议预检JSON都保存在本机 `.scratch/issue95/evidence/` 与 `.scratch/issue95/context/candidate/`。截图可能含账户/聊天侧栏信息，仅本机留存，不上传或提交。

## 公开重载入口的实际范围

本机 MCP 列表的“重启”位于服务器列表头部，专属候选详情没有单连接重启入口。只读检查当前包 `app.asar`：

- `webview/assets/async/623136.6836bc50cb.js` 的该按钮派发 `codex-app-server-restart`，参数为 `hostId: V, intent: "restart"`，没有候选服务器名。
- `.vite/build/early-bootstrap-916-47f4a741fd176386.js` 对该消息调用 `getAppServerConnection(t.hostId).restart(...)`。

因此当前找到的公开入口是本机 Codex 后端重启，不是仅重连95候选，可能中断其它执行中的聊天。未点击该入口，未关闭应用或终止后端/原服务进程，也未用私有调用绕过界面。原始只读源摘录仅保存在本机 `evidence/reload-scope-source.json`。

## 原生矩阵状态

| 场景 | 本轮状态 |
| --- | --- |
| T1 显式浅/深优先于相反系统主题 | 待验：候选尚未加载 |
| T2 跟随系统双向变化、弹窗/提示同步 | 待验：没有执行系统或宿主主题切换 |
| T3 首开/重开采用主体当前主题 | 待验 |
| T4 信号缺失/恢复 | 沿用受控证据；不声称原生故障模拟 |
| T5 增量通知缺字段 | 沿用受控证据；不声称原生通过 |
| T6 有效颜色缺失/跨模式配色 | 受控已有；真实可见组合待验 |
| T7 编辑/选择/滚动/展开/弹窗保留 | 待验：没有写入宿主或Git提交说明 |
| T8 普通控件、Git显示、明暗对照 | 受控已有；真实候选待验 |
| T9 窄栏、完整长路径和大段diff | 受控已有；真实宽度/倍率待测 |
| X1 A各状态下换肤与字段/恢复文本 | 待验 |
| X2 主体与版本管理往返、窄栏对照 | 待验 |
| X3 同构建证据归属及可靠性边界 | 构建已固定，原生证据未齐，不通过 |

## 未完成下一步

取得对本机后端重载及其聊天影响范围的明确安排后，使用公开入口加载新连接；重新选择95命名空间，先核验该候选实际资源及项目绑定，再执行T原生适用场景及X共同场景。与#92复用同一组合的证据，不能把82独立候选的主题表现套用95组合。

不自动发送、不为主题验收执行产品Git写操作，不把ACK升级为可靠草稿确认，#70标准及状态不变。任何必需原生场景未完成，#81/#95继续开放。
