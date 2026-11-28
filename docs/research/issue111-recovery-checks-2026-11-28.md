# #111 恢复助手受控验证

2026-11-28。补充规格：[刷新后端后自动恢复同一会话并接续地图](https://github.com/wozhendeshifwa/matt_pocock_plugin/issues/111)。按主代理从当前插件实际生成的 `issueActionRequest` 提示词接手，核实为已就绪代码工作。完整读取随包 implement-spec、本地 tdd 和必要引用作为只读备用；宿主没有 Skill 加载接口，不声称已加载。

## 接缝和结果

公开接缝为 `armRecovery`、`watchRecovery`、`cancelRecovery`；只在系统边界替代时钟、进程存活观察及官方 CLI 执行器。测试使用真实临时 rollout／进度文件，并有真实 Node 后端子进程退出的一条集成检查。临时文件在各自夹具内回收。

`node --test scripts/mcp-refresh-recovery.test.mjs`：15 项全部通过（本机 Windows，2026-11-28 补充复验）。已接入 `scripts/check.mjs` 的完整检查入口。

- 匹配 UUID、cwd、turn、进度文件；当前 turn 已结束时拒绝 arming。
- 只有人工中断但后端仍活着、只有后端退出、其他 turn 中断均到期而不发送。
- 取消后不发送；发送已消费后取消准确返回 `already-consumed`。
- 并发与重复 watcher 最多发送一次；CLI 失败不重试。
- daemon resume warning 仍仅记 `queued`，不冒充 `resumeVerified`。
- 等待稳定期间已有新 turn 开始时取消恢复；被编辑为过长的 lease 被拒绝。
- 真实后台子进程退出与追加 rollout 中断共同解锁恰好一次 CLI 调用。
- 正常 `task_complete` 优先结束监视，即使同时存在中断与后端退出证据也不发送；已结束 turn 拒绝再次 arming。
- 默认生产 `execFile` 路径启动真实假 CLI 子进程，不注入 `runCli`：以 Node 可执行文件及临时项目中的 `queue` 脚本跨平台模拟 CLI，核对实际收到的 thread、message、`--resume` 和 cwd；真实 stderr 的 resume warning 保持 queued／未验证恢复。没有调用真实 Codex，也没有发送聊天消息。

红绿过程：首个发送切片从缺少实现失败转绿；随后“已结束 turn 仍可 arm”“稳定窗口中新 turn 已开始仍发送”“lease 被编辑成超过 180 秒仍接受”分别先出现真实失败，再补最小防护转绿。

补充审查后先新增正常结束与真实假 CLI 两个测试，再执行得到 15/15 通过，最后接入完整检查。两项属于既有行为的验证补齐，首次即通过，没有虚构新的红灯或修改生产实现。接缝沿用已授权公开接口；选择无 shell、无平台专用包装的 Node 假 CLI，是 AI 根据用户预先授权作出的决定。子代理仅独立运行这 15 项与语法检查，完整 `npm run check` 由主代理整合后运行；本次未做 Linux 实跑。

## 未验证和交付边界

本子代理没有启动真实恢复助手，没有向聊天投递消息，没有刷新后端，没有写全局配置或改宿主草稿。上述测试不能证明真实 MCP 刷新之后桌面聊天会自动启动；主代理需在原会话演练，并用可见恢复消息、重新执行和候选资产匹配核验。CLI 在本机无可连接 daemon 时会警告，退出零不是恢复证据。

使用步骤见 `docs/agents/mcp-refresh-recovery.md`。配置 Codex app 指导、地图提示词、最终审查、完整 CI 结果和原生验收由主代理整合。主题闪烁调查 #100 继续暂停。

## Connector 交接补充（2026-11-28）

按 #111 主代理明确的补充范围，读取随包 implement-spec、本地 tdd、tests/mocking 引用与领域词表；使用 `watchConnectorRecovery`、`claimConnectorDispatch` 两个已指定公开接缝。新增 wrapper 复用原 `watchRecovery` 的外部执行边界并强制替换 CLI 执行器，只写一次 `.connector-request.json`，从不运行 Codex。请求中的原 thread/turn/cwd/checkpoint、token、到期时间和固定恢复提示词由 claim 重核；guardian 的发送领取通过独占文件限制一次。审查指出文案重复后，按主代理追加授权从原 watcher 导出共享纯函数 `buildRecoveryPrompt(record)`，供原 watcher 和 connector 验证复用；原 watcher 的控制流程及产品资产未改。指南修改前已备份到 `.scratch/issue111-config-backup/mcp-refresh-recovery.before-connector-20261128-transport.md`。

首个请求切片因模块不存在真实失败，再实现后转绿；领取切片因尚未实现真实失败，再加入身份、时限和原子领取后转绿。补充回归验证无中断／后端仍存活不写请求、取消／正常完成／新 turn 阻止请求、领取前再次检查取消／正常完成／新 turn／到期／后端存活、并发只领取一次、篡改提示词／身份／超过180秒拒绝、既有请求文件不覆盖不重试。新 turn 早于 watcher 启动时，原 watcher 会在身份验证阶段抛错而非返回 superseded；相应测试如实断言拒绝，并验证没有请求文件，没有修改原 watcher 行为。

`node --test scripts/mcp-refresh-recovery.test.mjs scripts/mcp-refresh-connector-recovery.test.mjs`：30/30 通过（原15项、新15项，Windows）。新测试已接入 `scripts/check.mjs`。文件系统使用真实临时文件，仅在受控用例替代时钟和进程存活系统边界；另有真实 Node 假后端退出后，以独立 Node 子进程运行生产 watch／claim 命令入口的集成检查，没有注入边界执行器。未调用真实 connector、真实 Codex、刷新或 UI。主代理另提供的生命周期证据 `.scratch/native-visual-109/lifecycle-probe/child-result.json` 支持限定路径的后续演练，不能代替真实 Deck MCP 刷新后的恢复验收。claim 成功不表示已投递，投递成功不表示原聊天已执行；领取到发送之间存在外部动作竞态，已知取消／过期／新 turn 则停止，未知发送结果不重试。Linux 兼容采用 Node 文件／路径接口，但本次未 Linux 实跑。
