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
