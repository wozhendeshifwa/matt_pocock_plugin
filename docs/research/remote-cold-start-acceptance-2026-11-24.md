# 远程连接层：真实离线与冷启动验收

关联[Codex 私有插件与 Render 入口、本机完整业务执行规格](https://github.com/wozhendeshifwa/matt_pocock_plugin/issues/44)。本文件使用 UTC；对应本机日期为 2026-11-24。当前只完成停止与测试面板关闭，**尚未证明自然休眠或冷启动恢复通过**。真实配对仍为只读，未变更支付、provider、自启、凭据或写 grant。

| 事件 | UTC 与事实 |
| --- | --- |
| 固定旧组件 | 从提交 `bf588778138027aa18354325425b6bccddd75709` 用 `git archive` 提取 `prototypes/remote-companion` 完整 18 文件，放在忽略目录 `.scratch/readonly-runtime-bf58877` |
| 校验 | 最终 18 文件逐字节匹配 `git show <commit>:<path>` 的 blob；逐文件长度、SHA-256 和归档摘要在该目录 `bundle-manifest.json` |
| 请求停止 | `2026-11-23T19:15:42.594Z`，调用固定旧包的 `lifecycle.requestStop()`，只针对原配对当前实例 |
| 观察停止 | `2026-11-23T19:15:42.881Z`：之前 `connected/running:true` 的 PID 39892 已退出；状态 `stopped-or-unresponsive/running:false`，`writeEnabled:false` |
| 测试面板 | 观察并选中 tab:12，核对注册 URL 前缀 `mcp-registration-e0aaa7`，只点击其关闭按钮；随后 tab:12 与该远程注册视图消失 |
| 保留的界面 | Notion tab:4、本地 Deck tab:11（注册前缀 `3b90719`）、原聊天与未发送草稿均保留；没有发送、修改或清理草稿 |
| 保守静默起点 | 关闭测试面板后首个时钟读数 `2026-11-23T19:17:01Z`；这不是已经证实的最后 inbound 时间 |
| Render 管理面 | 对既有 My Workspace 的 `deck-relay-44` 只读查询，仍为 free、Singapore、autoDeploy off；未访问服务入口或 health |
| 首次指标 | 查询区间 `19:10:00–19:17:01Z`；`http_request_count` 与 `instance_count` 均为 `data:[]`，**不能解释成零请求或零实例** |
| 内存证据 | `19:17:00Z` 仍有 `memory_usage=55,988,224 bytes` 的样本，因此当时不能声称服务已休眠 |
| 宿主能力变化 | 停止组件并关闭测试视图后，运行时通知 deferred `mcp__deck_remote_companion` namespace 移除；恢复后还需核对真实宿主重新发现 |

已知失败与纠正均保留：首次 Git archive 按 Windows 换行配置导出了 CRLF，18 文件与 blob 的首次字节比较失败，但去除 CRLF 差异后内容全部一致。原 `source.tar` 和 `archive-first-byte-check.json` 留在忽略包目录。随后仅对新生成包使用 `git -c core.autocrlf=false -c core.eol=lf archive` 得到 `source-exact.tar`，重新提取并通过逐字节比较；没有修改现行源码或 Git 配置。

UI 能力尝试也未冒充成功：`mcpapps` provider 不可用；native 第一次 click 报 `coordinate input geometry is unavailable`，截图后的点击又被工具阻止，原因是前方 Chrome 遮挡。刷新观察后使用已暴露的窗口 `Raise` 动作，重新观察并核对远程 tab:12 的注册 URL，再关闭它。最终观察仍在原聊天，Notion 和本地 Deck 均在。

恢复材料是固定旧只读包的 `.scratch/readonly-runtime-bf58877/prototypes/remote-companion/launch.mjs`，继续使用原配对 `.scratch/relay-44-secrets/pairing.json`。原实例的 stop 请求只绑定旧 instanceId；没有撤销配对，也没有安装自启。详细本机停止记录为包目录的 `stop-observation.json`，不包含凭据。

只有主任务确认静默窗口及休眠证据、完成首个真实 host 调用的时序协调后才能恢复。恢复前需再次核对包清单、配对 `writeEnabled:false` 与无在运行同配对实例；后台启动必须隐藏窗口。示例仅供协调后执行，当前未执行：

```powershell
# 在 wayfinder-render-44 实施 worktree 执行；先核对生命周期状态与清单。
$nodeExe = (Get-Command node).Source
$bundleLaunch = (Resolve-Path -LiteralPath '.scratch/readonly-runtime-bf58877/prototypes/remote-companion/launch.mjs').Path
$pairingFile = (Resolve-Path -LiteralPath '.scratch/relay-44-secrets/pairing.json').Path
Start-Process -FilePath $nodeExe -ArgumentList @($bundleLaunch, '--pairing', $pairingFile) -WindowStyle Hidden -PassThru
```

旧组件启动即发起 `bridge/poll`，可能先于真实 host 工具成为唤醒触发。恢复验收必须记录组件启动、首个 host 调用与 connected 的实际 UTC 顺序，不能将预先唤醒后的成功描述为 host 首包独自冷唤醒。主任务接管静默观察期间，代理保持组件停止，不发送 SDK、MCP、health 或服务入口请求。按保守起点计算，15 分钟最早到 `19:32:01Z`；若管理证据出现更晚 inbound，应重新计算。
