# 远程连接层：真实离线与冷启动验收

最新前景恢复证据：root 在 `2026-11-23T19:43:14.384Z` 完成实际 Codex 宿主 `deck_context` 调用，耗时约6,217ms，`ok/status= true/ok`，仓库为本项目，工作区及当前真实聊天匹配。它发生于组件 connected 及既有后台读取之后，证明暖恢复可用；不是恢复后首包，也不是自然冷启动证据。

关联[Codex 私有插件与 Render 入口、本机完整业务执行规格](https://github.com/wozhendeshifwa/matt_pocock_plugin/issues/44)。本文件使用 UTC；对应本机日期为 2026-11-24。已完成真实离线拒绝和固定旧只读组件的暖恢复，**未证明自然休眠或自然冷启动通过**。真实配对仍为只读，未变更支付、provider、自启、凭据或写 grant。恢复后的真实 host 调用由主任务另行记录。

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
| 后续静默观察 | 主任务在 `19:33`、`19:36` 的管理指标仍见同一 `p99bv` 实例的新内存样本，约 57 MB；HTTP/instance 指标仍为空，无法确认自然 sleep |
| 真实离线拒绝 | 主任务实际 host `deck_context` 于 `19:38:18Z` 收到 `-32001 Local companion offline / no operation dispatched`；原 journal 在 `19:38:17Z`、`19:38:24Z` 均为 3032 条 |
| 恢复前置核对 | `19:39:35.523Z`：固定旧包 18 文件再次逐字节匹配原提交；原 adapter pin `9409bb…` 保留；`running:false`、`writeEnabled:false`、无 `writeGrant`；journal 仍为 3032 条 |
| 隐藏后台恢复 | `19:40:22.8489155Z`，从固定 bf58877 包用原配对 `Start-Process -WindowStyle Hidden`；启动前精确同配对进程数为 0，新 PID 20440 |
| 连接读回 | `19:40:44.484Z` 观察 `connected/running:true`，instanceId 前缀 `eb94cc2b`；配对文件与 provider 配置的 SHA-256 均与启动前相同，`writeEnabled:false`、无 `writeGrant` |
| 唯一实例 | `19:41:18.254Z` 只读 CIM 核对：精确引用原配对的 Node 进程只有 PID 20440，命令行包含固定 `readonly-runtime-bf58877` 包路径 |
| 后台请求证据 | 代理未发送 SDK 或 host 业务调用时，journal 从 3032 增至 3056（`19:40:44Z`）、3078（`19:41:15Z`）；已有宿主/视图后台活动，不能声称恢复前后 journal 或所有本机数据完全未变 |

已知失败与纠正均保留：首次 Git archive 按 Windows 换行配置导出了 CRLF，18 文件与 blob 的首次字节比较失败，但去除 CRLF 差异后内容全部一致。原 `source.tar` 和 `archive-first-byte-check.json` 留在忽略包目录。随后仅对新生成包使用 `git -c core.autocrlf=false -c core.eol=lf archive` 得到 `source-exact.tar`，重新提取并通过逐字节比较；没有修改现行源码或 Git 配置。

UI 能力尝试也未冒充成功：`mcpapps` provider 不可用；native 第一次 click 报 `coordinate input geometry is unavailable`，截图后的点击又被工具阻止，原因是前方 Chrome 遮挡。刷新观察后使用已暴露的窗口 `Raise` 动作，重新观察并核对远程 tab:12 的注册 URL，再关闭它。最终观察仍在原聊天，Notion 和本地 Deck 均在。

恢复材料是固定旧只读包的 `.scratch/readonly-runtime-bf58877/prototypes/remote-companion/launch.mjs`，继续使用原配对 `.scratch/relay-44-secrets/pairing.json`。原实例的 stop 请求只绑定旧 instanceId；没有撤销配对，也没有安装自启。详细本机停止记录为包目录的 `stop-observation.json`，不包含凭据。

原计划等待自然休眠。管理证据不足以确认 sleep 后，主任务明确将本轮收敛为“离线拒绝＋暖恢复”，并授权按原固定包恢复。恢复前已核对包清单、配对只读策略和无现存同配对进程。首次沙箱 CIM 查询报“无法从客户端中访问 CIM 资源”，其空输出没有被当作零进程；随后受审提权的只读 CIM 查询确认 0，再隐藏启动。下列保存本轮采用的启动配方；本轮已经恢复，不应重复启动：

```powershell
# 在 wayfinder-render-44 实施 worktree 执行；先核对生命周期状态与清单。
$nodeExe = (Get-Command node).Source
$bundleLaunch = (Resolve-Path -LiteralPath '.scratch/readonly-runtime-bf58877/prototypes/remote-companion/launch.mjs').Path
$pairingFile = (Resolve-Path -LiteralPath '.scratch/relay-44-secrets/pairing.json').Path
Start-Process -FilePath $nodeExe -ArgumentList @($bundleLaunch, '--pairing', $pairingFile) -WindowStyle Hidden -PassThru
```

旧组件启动即发起 `bridge/poll`。本轮后台记录的回包字段与 `current_project`、snapshot/refresh、chain、logBatch 相符，且项目读数约每两秒出现；journal 没有保存原请求名，因此这些具体方法名是依字段形状判断的范围，不冒充完整请求审计。固定旧组件继续拒绝业务写，配对与 provider 文件未变；读取和日志基础设施确有新记录。后台活动来源需另行定位。

保守静默起点计算的 15 分钟最早于 `19:32:01Z` 到达，但期间没有取得可证明自然休眠的管理证据。恢复后保持唯一旧只读组件在线；代理没有主动发送 SDK、MCP、health 或服务入口探测请求。主任务接下来进行的 host 调用属于暖恢复验收，不能记为 host 首包独自冷唤醒。固定包目录中的 `restore-preflight-*`、`restore-start-*`、`restore-connected-*` 和 stdout/stderr 日志保留实际启动与读回证据；它们均在忽略目录，未写入凭据到本文。
