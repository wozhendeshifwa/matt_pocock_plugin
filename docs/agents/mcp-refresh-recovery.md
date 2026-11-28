# 后端刷新后的同一会话恢复

用户授权在任务范围内刷新后端时，先准备恢复，再刷新。该流程使用 `scripts/mcp-refresh-recovery.mjs`，不要求安装常驻服务、切换执行宿主或修改草稿。静默模式可自动完成加载已审查／测试候选所需的本地重连；发布、权限及明确暂停项继续遵守各自边界。

## 刷新前

1. 保存工作区内的进度文件，包含任务、当前提交／未提交改动、检查证据、授权和暂停边界、下一步。核实原会话 UUID、项目真实 cwd、rollout 首行 `session_meta` 和最新 `task_started.turn_id`。
2. 只读核实将被刷新的 Deck 进程 PID、完整命令行和创建时间；把这些证据放入进度文件。`arm` 要求进程仍存活，不猜 PID，不以整个 app 或无关进程代替目标后端。
3. 调用 `arm`，明确提供 `--thread`、`--turn`、`--cwd`、`--rollout`、`--checkpoint`、`--mcp-pid`、`--cli` 和 `--ttl-seconds`。CLI 必须是本机已核实的官方 `codex` 可执行文件。有效期大于零且至多 180 秒，推荐 120 秒；`arm` 返回 lease 文件路径。
4. 用独立后台进程执行 `node scripts/mcp-refresh-recovery.mjs watch --lease <lease>`。Windows 通过 `Start-Process -WindowStyle Hidden` 启动，保留 stdout/stderr 日志。确认 `<lease>.ready.json` 的 token 与 lease 一致、进程仍存活后，再执行已授权的宿主刷新。

助手不负责点击刷新，也不修改 MCP 配置。它的 ready 文件只表示监视已启动，不能当成恢复成功。

## 自动恢复条件

助手同时等待两项证据：arming 之后出现本 turn 的 `turn_aborted`（`reason=interrupted`），以及原后端 PID 结束。只有中断、只有进程退出、其他 turn 的中断都不发送。若新 turn 已启动、旧 turn 正常完成、意图被取消或到期，助手结束。

条件满足后留出短暂稳定窗口，再复查取消／到期／新 turn。助手原子消费一次意图，最多调用一次官方命令：

```text
codex queue --thread <原 UUID> --message <含唯一恢复标记及进度指针的文本> --resume
```

消息包含原 UUID、cwd 和进度文件，不读取、替换或自动发送用户草稿。多个 watcher 竞争同一意图时只有一个可消费；CLI 失败或输出不明时记录结果，不自动重试制造重复消息。

## 恢复后

确认恢复消息进入原会话且会话重新执行，再读进度文件，核对项目、最新来源、加载资源与已完成工作。沿既有授权接续；保留明确暂停项。`queued` 仅证明 CLI 确认排队；若 `--resume` 报 daemon 不可用，记录 warning，不能仅凭退出码零宣称已恢复。助手的 `resumeVerified` 保持 `false`，实际恢复由原会话的可见消息与运行证据单独确认。

本机已观察 CLI 排队消息进入现有桌面聊天；后端刷新之后是否自动启动，仍需真实刷新演练。不得为了让恢复命令成功而新建 daemon、换聊天或迁移宿主。

## 取消和记录

执行 `node scripts/mcp-refresh-recovery.mjs cancel --lease <lease>`。返回 `cancelled` 表示尚可取消；`already-consumed` 表示发送已被消费，不能许诺撤销。意图默认在 `.scratch/mcp-refresh-recovery/<UUID>/`；相邻 `.result.json`、`.ready.json`、`.cancelled`、`.consumed` 和 `.watch-lock` 是运行证据，保留到演练核对结束。

官方行为依据：[Codex queue](https://learn.chatgpt.com/docs/developer-commands?surface=cli#cli-codex-queue)、[Interrupt hooks](https://learn.chatgpt.com/docs/hooks#interrupt)。`Interrupt` hook 的输出本身不能重启 turn；本方案预先启动独立的一次性助手，不绕过 hook 信任。

## 桌面 stdio 宿主的 connector 传输

本机当前桌面 app-server 使用 stdio，官方 `queue --resume` 找不到可连接 daemon，不能据 `queued` 宣称恢复，也不为此新建 daemon 或切换宿主。仅针对 Deck MCP 进程刷新，可使用 `scripts/mcp-refresh-connector-recovery.mjs` 作为现有 watcher 的替代传输。该脚本绝不执行 CLI：它沿用原 watcher 的双条件、稳定窗口、取消、正常完成、新 turn 和最长 180 秒限制，原子消费后只写相邻 `.connector-request.json`。返回 `connector-requested`、`deliveryVerified:false`、`resumeVerified:false`，表示已交接请求，尚未投递。

使用已有 `arm` 创建 lease 后，独立隐藏进程运行：

```text
node scripts/mcp-refresh-connector-recovery.mjs watch --lease <lease>
```

刷新前同时确认该 watcher 的 `.ready.json` 和原聊天派生的 guardian 子代理已就绪。guardian 必须获用户明确授权向原聊天发送恢复 checkpoint，限定原 UUID、host、项目、turn 和同一 lease，遵守其有效期及取消条件。它只等待请求文件；出现请求后立即执行：

```text
node scripts/mcp-refresh-connector-recovery.mjs claim --lease <lease>
```

只有返回 `claimed` 才可调用受支持的 `send_message_to_thread`，以返回的 `thread` 和 `prompt`、预先核实的原 host 投递一次；省略 model/thinking 以保留设置。领取重新验证 rollout 身份、checkpoint 所在项目、请求字段及固定恢复提示词、当前 turn、后端退出、匹配中断、取消、正常完成、新 turn 和有效期，并通过 `.connector-claimed.json` 的独占创建限制一次领取。返回其他状态或抛错均不投递。领取后应立即发送；若这期间已知取消、到期或新 turn，应停止。领取与外部工具调用无法组成事务，工具结果未知时不重试，领取标记不能删除后重用。工具成功也只算投递证据，原聊天实际重新执行仍须另行观察。

生命周期边界：本次受控实验记录 `.scratch/native-visual-109/lifecycle-probe/child-result.json` 表明指定父 turn 被中断后，child 自然完成了原聊天的只读工具调用，时间早于后续 followup。这仅支持继续演练当前版本的 Deck MCP 刷新路径。官方[子代理文档](https://learn.chatgpt.com/docs/agent-configuration/subagents)没有保证父 turn 中断后的存活；不得推广到整个 app-server 重启、应用退出、任意版本或永久后台守护。真实 Deck 刷新、自动投递和原聊天接续须用同一演练单独验收。若 guardian 就绪未确认，则不得触发可能中断聊天的刷新。
