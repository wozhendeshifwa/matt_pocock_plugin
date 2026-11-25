# Sandcastle 任务接口与 MattSkillsDeck 衔接研究

关联：[研究：核实 Sandcastle 任务接口与现有插件的衔接边界](https://github.com/wozhendeshifwa/matt_pocock_plugin/issues/48)。研究日期：2026-11-26（北京时间）。本研究服务于接入规划，不实现功能，也没有启动沙箱或真实 Codex 代理。

## 结论

Sandcastle 提供可由本机 Node 组件调用的任务执行库，具备启动、输出事件、取消、分支与提交结果；它不是现成的持久后台任务服务。插件需要增加任务身份、持久状态与日志索引、后台运行所有权及恢复规则。现有聊天草稿动作、MCP 请求去重账本不能直接充当沙箱任务管理器。下面是事实和候选衔接方向，具体方案由后续决策票与用户确认。

## 版本与证据边界

- 上游固定为 [mattpocock/sandcastle 的 1b380ca5e7a9fbece96c49d9edba264c1f512c4e](https://github.com/mattpocock/sandcastle/tree/1b380ca5e7a9fbece96c49d9edba264c1f512c4e)，[package.json](https://github.com/mattpocock/sandcastle/blob/1b380ca5e7a9fbece96c49d9edba264c1f512c4e/package.json) 标记版本 0.14.0。
- 主工作区 HEAD 为 `701029b1efcdac8d4faedffe5955293efecc36a8`，另有15个已跟踪适配器文件修改及未跟踪文件。只读查看了这些差异与当前文件，不将它们当作已安装版本。研究分支从这个固定 HEAD 创建，仅提交本研究文档。
- 远程组件源码实际存在于另一个已有 worktree，其 HEAD 为 `ed19a9c5783df99f610f322c74979c896a117e1f`。下文组件链接固定到该 commit，不假定主工作区已经包含远程组件。
- [既有安装记录](https://github.com/wozhendeshifwa/matt_pocock_plugin/blob/ed19a9c5783df99f610f322c74979c896a117e1f/docs/research/remote-runtime-windows-cutover-2026-11-24.md)记载正式安装源码为 `a7c9c55f1bfd78d654c610238d2eeb5a176a0633`、481项载荷、生产只读。那是既有验收记录，本轮没有解密配对、检查实时 grant 或验证全部安装载荷，不能据此声称2026-11-26运行状态已复验。

## 官方已提供的能力

| 能力 | 固定版本的公开契约 | 接入含义与限制 |
| --- | --- | --- |
| 启动 | `run()` 接受 agent、sandbox、cwd、prompt/promptFile、branchStrategy、logging、signal 等，返回 Promise | 可以在本机执行器中适配；不是通过 CLI 发起后自动得到持久任务服务。promptFile 相对进程 cwd，而非 RunOptions.cwd，输入路径应显式处理。 |
| 输出事件 | `logging.onAgentStreamEvent` 给出 text/toolCall/raw、iteration、timestamp；默认文件日志位于 `.sandcastle/logs/` | 可用于实时展示；回调异常被吞掉，日志转发失败不等于代理停止，插件需单独呈现日志可用性。 |
| 结果 | `RunResult` 包含 stdout、commits SHA、branch、iterations、可选 logFilePath/output/preservedWorktreePath 等 | 能关联提交和日志；完成摘要、相对基线的差异及“哪些检查通过”的证据仍须明确生成/读取方式，不能把正常返回等同全部检查通过。 |
| 取消 | `signal: AbortSignal` 杀掉运行中代理子进程并取消 hooks，保留 worktree，以 signal.reason 拒绝 | 插件需要区分用户取消、失败及取消与完成竞态；不能把 Promise reject 一律标作失败或无改动。 |
| 长寿命句柄 | `createSandbox()` 提供 run/exec/close、worktreePath、可选 sandboxId；`createWorktree()` 独立管理工作树 | 句柄是当前进程内对象；部分 provider 没有 sandboxId，不能默认进程重启后可重新连接。 |

来源：[run与createSandbox](https://github.com/mattpocock/sandcastle/blob/1b380ca5e7a9fbece96c49d9edba264c1f512c4e/docs/guide/run.md)、[运行日志](https://github.com/mattpocock/sandcastle/blob/1b380ca5e7a9fbece96c49d9edba264c1f512c4e/docs/guide/run-logs.md)、[公共API报告](https://github.com/mattpocock/sandcastle/blob/1b380ca5e7a9fbece96c49d9edba264c1f512c4e/api-report/index.api.md)。本次查阅这些公开契约，未找到按持久 taskId 查询任务、持久队列或宿主重启后恢复任务句柄的 API；这是一项公开契约缺口判断，不声称内部源码绝无任何相关实现。

## 分支、并发与恢复

- Docker/Podman 等 bind-mount provider 默认 `head`，代理直接写宿主工作目录；isolated provider 默认 `merge-to-head`，完成时自动合并。两种默认都不满足已确认的“多个独立任务并行，用户查看后决定合入”。应在后续方案中显式选择分支/工作树隔离，而不能依赖默认值。
- `branch` 使用指定分支，`createWorktree()` 可独立管理其生命周期。官方会保留脏工作树；并发 session fork 要为每项指定不同分支。重复使用同一分支不等于新任务隔离。
- 默认分支工作树来自 Git 提交，不应承诺自动含有主工作区的未提交/未跟踪内容。官方有 `copyToWorktree`，但不等同已定义完整的未提交快照语义；启动基线、输入快照、秘密文件与工具链依赖如何处理，应交用户决策。
- `resume/fork` 是代理会话能力，要求可用的已捕获会话文件；它不是插件任务历史或电脑重启后的可靠续跑保证。用户已接受“保留历史、标记中断、手动重新运行”，无需把 session resume 加成首版承诺。

来源：[分支策略](https://github.com/mattpocock/sandcastle/blob/1b380ca5e7a9fbece96c49d9edba264c1f512c4e/docs/guide/branch-strategies.md)、[代理会话](https://github.com/mattpocock/sandcastle/blob/1b380ca5e7a9fbece96c49d9edba264c1f512c4e/docs/guide/agent-sessions.md)。

## 当前插件边界及应补职责

1. **界面入口**：现有[桥接代码](https://github.com/wozhendeshifwa/matt_pocock_plugin/blob/701029b1efcdac8d4faedffe5955293efecc36a8/prototypes/upstream-port/sidebar-bridge.js)和[ADR-0002](https://github.com/wozhendeshifwa/matt_pocock_plugin/blob/701029b1efcdac8d4faedffe5955293efecc36a8/docs/adr/0002-prefill-dispatch-boundary.md)保留 `ui/message`、`send:false` 的宿主草稿语义；[写策略](https://github.com/wozhendeshifwa/matt_pocock_plugin/blob/701029b1efcdac8d4faedffe5955293efecc36a8/prototypes/upstream-port/write-policy.mjs)没有开放 `deckExec`。新增独立沙箱任务入口与原动作并存，不能把“执行”按钮现有行为当成后台任务已实现。该新增能力超出旧ADR的首版范围，后续方案应明确它如何扩展边界。
2. **本机执行所有权**：现有项目 worker 在[IPC断开时清理并退出](https://github.com/wozhendeshifwa/matt_pocock_plugin/blob/701029b1efcdac8d4faedffe5955293efecc36a8/prototypes/upstream-port/project-worker.mjs)，单纯把代理放进视图依赖的 worker 不能自动证明关闭侧栏仍执行。需明确由哪个持续运行的本机组件持有任务及取消句柄；组件停止/重启后的处理须独立设计。
3. **短请求与长任务分离**：远程[协议](https://github.com/wozhendeshifwa/matt_pocock_plugin/blob/ed19a9c5783df99f610f322c74979c896a117e1f/prototypes/remote-companion/protocol.mjs)只承载既定MCP方法；[stdio适配器](https://github.com/wozhendeshifwa/matt_pocock_plugin/blob/ed19a9c5783df99f610f322c74979c896a117e1f/prototypes/remote-companion/stdio.mjs)默认45秒前台超时、最多300秒完成窗口。不能把一次完整的 Sandcastle run 绑定到该等待窗口。候选方向是短启动请求返回持久任务标识，后续独立查询状态/增量日志；具体接口形式待决策，不在本研究实施。
4. **请求账本与任务记录区分**：[Journal](https://github.com/wozhendeshifwa/matt_pocock_plugin/blob/ed19a9c5783df99f610f322c74979c896a117e1f/prototypes/remote-companion/journal.mjs)已有 operationId/fingerprint/作用域去重，启动时将未完成请求标成 unknown，响应缓存有容量/保留期限制；这是防重放机制，不是包含任务描述、进程、日志、分支与历史的任务库。启动请求防重与执行任务身份要关联，但不能混为一个状态。
5. **项目与授权**：[本机launch](https://github.com/wozhendeshifwa/matt_pocock_plugin/blob/ed19a9c5783df99f610f322c74979c896a117e1f/prototypes/remote-companion/launch.mjs)验证固定适配器并从可信会话解析项目；[write-grant](https://github.com/wozhendeshifwa/matt_pocock_plugin/blob/ed19a9c5783df99f610f322c74979c896a117e1f/prototypes/remote-companion/write-grant.mjs)要求本机显式方法/项目授权，现有列表不含 Sandcastle 操作。新入口须定义启动/取消/结果接纳的权限与审计，模型传入cwd不能代替项目授权；不能借研究或旧工单关闭给生产追加执行权限。

以上为需要填补的职责，不意味着必须重写现有全部执行器或中继。日志可用查询还是事件推送、任务数据放哪里等，留给方案票根据真实宿主能力决定。

## 后续决策与最低验证项

- 方案票：运行/认证路线由另一研究票提供；再决定任务状态、并发上限/排队、启动输入基线、每任务分支、断线结果未知时的核对、取消竞态、重试身份、日志和现场保留/清理边界。
- 验证“启动已执行但响应丢失”不会重复创建代理；查询失败不导致重发启动。不同聊天查看同项目任务和跨项目拒绝分别验证。
- 使用隔离项目证明：关闭视图仍执行、重新打开能查、失败/取消保留日志与现场、重启后标中断、手动重新运行产生可区分的新执行；验证并发任务互不修改主工作树。
- 结果验收须独立读回分支/提交/差异与检查证据；UI原型或“run正常返回”都不能代替真实客户端到本机沙箱的闭环。
- 当前机器沙箱可用性、ChatGPT登录复用、实际代理运行及现有生产配置均未在本票验证。本研究不改变已有provider/DeepSeek回退，不修改产品代码或未提交内容。
