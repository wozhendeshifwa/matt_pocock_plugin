# 完整 runtime adoption 双审记录

关联[正式实施规格](https://github.com/wozhendeshifwa/matt_pocock_plugin/issues/44)。两名独立审查者完成静态增量审查，主任务另行复核CAS与云兼容预检。原`2ba711fa…`阶段的“未发现剩余确切P1/P2”是历史静态结论：后续真实Windows隔离动态验收发现心跳故障及停止请求ABA边界，`1cdb835…`候选包已全部撤回，未生产apply。当前结论须结合文末新增量。本页不代表真实生产迁移、登录自启或人工批准通过。

## 历史固定审阅版本与范围

固定源码 commit：`1cdb835c013fe09df8cda29aa8eff7864c1f1cc4`。已独立读取该 commit 的 Git blob，确认与最终审阅文件 digest 相同：

| 文件 | SHA-256 |
| --- | --- |
| `adopt-runtime.mjs` | `2ba711fa1825d0ce3cc1475cb9dcc3042fc2ca5b71a9966f6d6529822526cf82` |
| `adopt-runtime-test.mjs` | `60d0d5199807ba2f31d59c5973893c7eab178914e70e445c9a5be5dd86e90ba5` |

完整 installer 的三个交付文件为 [adopt-runtime.mjs](../../prototypes/remote-companion/adopt-runtime.mjs)、[adopt-runtime-test.mjs](../../prototypes/remote-companion/adopt-runtime-test.mjs) 和 [ADOPT-RUNTIME.md](../../prototypes/remote-companion/ADOPT-RUNTIME.md)。审查还追读了其复用的 lifecycle、client launcher、完整包验证器、数据盘点与 SQLite 边界。文档与实现分别核对，未把文档存在当成实际安装证据。

本轮审查没有执行真实 apply、START、DRAIN 或 rollback，没有操作生产配对、Startup、Desktop、Codex、GUI 或业务项目。早期记录编写时主任务的完整 308 项回归仍在运行；本报告不宣称其已通过，也不把旧版本的测试结果外推给后续修改。

## 已确认并修复的 P2 类别

| 类别 | 最终行为与审查证据 |
| --- | --- |
| 计划返回对象可变 | 保存的计划与返回对象分别深复制；修改返回的 blockers 不能改变授权。输入读像变化需新 digest。 |
| 快照后源状态变化 | 停止准确实例后重验源；每次关键 fence 再核 source inventory、文件身份、adapter、caller 和 registry，`beforeCommit` 后也检查，阻止旧快照覆盖更新后的活动状态。 |
| 旧代码 pin 不足 | full-code 回退复验旧完整 release；initial 的 `legacyRuntimePin` 固定旧 manifest 与 18 项代码 digest，切换前及回退均复验。旧日志、归档与 metadata 不按完整目录 catalog 误判为代码篡改。 |
| 缺失安装 ledger 被当作空库 | 仅 initial readonly 可允许既有 ledger 缺失，且不创建空库；full-code 的计划、应用、START 和回退均拒绝 missing。SQLite 以 `mode=ro/rw` 打开既有库，应用/回退持 `BEGIN IMMEDIATE`，跨项目 running/unknown 阻断。 |
| 回退 lease/authority 丢失 | 回退各阶段持续核对确切 lease、撤销和固定 ledger 文件身份；owner 被替换或 authority 变化即停止，不忽略二次检查。 |
| START 超时、迟到及并发 | 派发前以首观测身份 CAS 持久占位，第二次 START 不能覆盖 pending；迟到结果保留 unknown/进程归属证明并阻断后续操作，DRAIN 只精确停止已证明的 owned 实例。不能证明停止就继续保留屏障，不 kill 任意 PID。 |
| Legacy 回退漏检新增项目 | 比较完整当前 durable catalog，并固定 registry 与原 sources；新增 bucket、未知状态或新业务会阻止回到旧 legacy 根。stable 更新/回退共享最新业务，不用旧快照覆盖。 |
| 根级未知状态被静默排除 | registered 或无法归入明确 hash bucket 的 unknown 默认阻断。`archiveOnly` 只接受精确 sourceId/path/SHA 与 log/cache/diagnostic 分类、诊断理由；变化或缺项重新阻断。批准项只进完整归档，不播种活动业务，安全排除项不能借此豁免。 |
| 安装路径重定向 | KnownFolder 下既有安装祖先、generation/version 与 ledger 在写入前检查，拒绝 junction/链接重定向；不能先向错误目标写副本再后验失败。 |
| CAS 发表后异常 | 每次先持久保存 intent，hard-link 一发表即登记变化；随后抛错仍可由 prepared inode/hash/mtime proof 核实自己的已发表文件。failure receipt 走同一恢复闸；用户后续修改保留，原备份、claimed 文件与快照保留。 |
| 缺少更新前云兼容检查 | 对可信 canonical relayOrigin 固定无 token GET `/healthz`；5 秒、16 KiB、拒 redirect，须验证 protocol 1。网络、JSON 或版本不确定即阻断，运行时握手不能代替该预检。 |

其中独立第二审确认的六类为：计划可变、旧代码 pin、missing ledger、回退 lease、START 已出现实例却在次级读取失败前漏记 owner、并发 START 覆盖 pending。另一审查者发现的迟到 START 与其失败清理归为同一机制，触发条件不同；源状态复核、根级 unknown、新项目回退和重定向由另一独立审查重点复核。重叠发现合并记录，没有重复计票。CAS 发表异常 proof 与云预检另经主任务补强。测试源码已加入对应隔离回归，但其存在不等于本报告执行了全部测试。

## API 与恢复边界

`createRuntimeAdopter(options, localDependencies)` 提供 `plan / apply / planRollback / rollback / start / drainStart`；CLI 对应 `plan / apply / rollback-plan / rollback / start / drain-start`。真实位置默认取 Windows KnownFolder；本机可信 seam 供隔离夹具使用，不是远程 MCP 输入。

`apply` 默认返回 `adopted-stopped`，不启动组件。必须另行给出匹配 receipt digest 的 `START`。启动超时不等于停止：unknown attempt 保留在 canonical 配对旁，后续采用/回退阻断；`DRAIN` 也须匹配 attempt digest 并证明进程归属。connected 仅证明组件连接，不证明真实 Codex 宿主审批。

唯一 canonical pairingFile 原路径保持，pairingId、DPAPI 密文与写策略不变，不创建可绕开原 `.revoked` 的新配对别名。旧/当前 journal 的撤销、未决状态均检查；回退旧代码时继续使用最新 schema-1 journal，保留 completed tombstone，原配置字节与旧 journal 仍归档。初次双源按 main-local 优先、remote-v1 补缺选择，冲突/未知须先过闸，两个源均完整快照保留。

## 尚未完成的真实验收

手动更新/恢复门来自 [#42](https://github.com/wozhendeshifwa/matt_pocock_plugin/issues/42) 第四轮 **Q7–Q8**；真实宿主工具、界面、登录及审批签名验收来自 **Q10**。**Q9 是基线锁定，不是更新同意。** 正常退出 Codex 与 producer、审核停止后的新计划，以及明确 APPLY/START/ROLLBACK，仍须按这些已确定的门完成。

本次没有真实生产迁移、登录自启或人工批准，不把静态双审、隔离 stub、SDK 假身份或 connected 外推为正式交付通过。

## 动态故障后的撤回与最小修复增量

后续隔离 Windows 压力诊断确证：旧生命周期 heartbeat 的 rename 遇 `EPERM` 后进入 timer catch，触发一次意外 onStop；1000 次 fd 读取本身均成功，不能据此宣称组件持续运行。[原诊断](../../.scratch/heartbeat-diagnostic-c5ba6618-3fd3-4e22-853b-8b01be3c8f2c/diagnostic.json)顶层含 282 条 rename/EPERM；JSON 文本的第 283 次出现是 onStop 诊断中对同一次错误的嵌套回录，不重复计数。另查出旧 stop 会在调用内部晚读实例 B，可能误停原本只批准停止 A 的新 owner。`1cdb835…`／`2ba711fa…` 旧候选已全部完成撤回，未执行生产 apply；旧静态结论不足以支持采用该候选。

本次只读增量限定于三项修复，并核对作者正式冻结 digest：

| 文件 | 新 SHA-256 |
| --- | --- |
| `lifecycle.mjs` | `eaf4cad89ffc1749a5a2a674dec1f4b3c3a8b77c2493474f1fcd8837c82023d5` |
| `adopt-runtime.mjs` | `389055f2379b42dce7ed3b877a4eca06024037a10d8854d22bff12ce64fe05eb` |
| `adopt-runtime-test.mjs` | `5f346b33c01df48eaab2b0980035e043e5eb0184a4e4b73bb79d8a78a3d65712` |

1. 仅 heartbeat rename 的 `EPERM/EACCES/EBUSY` 可短暂有界重试，默认最多 20 次、间隔 10ms；每轮核对 closed 和同一 instance。其它错误、持续失败和 owner 变化仍失败；重试耗尽不能压掉原撤销回调，close 不移除外国 owner。没有将故障归因为未经证明的 AV 或具体读者。
2. adoption runtime 读取将路径观测与同一 fd 的 dev/ino、大小、mtime 绑定，避免将替换中的短 lookup 窗口误判为停止。只有连续无记录且无 pending heartbeat 才返回 null；持续不稳定会报错，不伪造释放。
3. fence、失败 START 清理和 DRAIN 均把已核对的 expected instance A 传入停止函数。函数即使遇 A→B 替换，也只发表 A 的停止信号；CAS 保护 stop 文件，B 不因内部晚读而被误停。

独立读取[修复后真实压力证据](../../.scratch/heartbeat-diagnostic-fixed-b7cd27cd-6e9c-43fb-b20c-08823a47aa46/diagnostic.json)：1000 次读取、readerError null、onStop 0；186 次成功发表，updatedAt 推进 183 次、合计 2035ms。其间仍有 133 条 rename/EPERM 而成功继续，证明不是一直读取旧记录冒充心跳正常。作者另外报告 5 项定向测试通过；本页审查者没有重新运行这些测试。

第二审独立执行的[六场景证据](../../.scratch/lifecycle-retry-review-44/run-1795470995591-ad39f022-8cb9-4d60-aa4d-ea67f2f39ae8/evidence.json)已逐项读取：短暂拒绝后恢复、持续拒绝耗尽、其它错误不重试、owner 替换中止、close 中断等待、撤销回调不被发表失败压掉，均通过；源码前后均为 `eaf4cad…`。它使用实际 timer、临时配对和 CurrentUser DPAPI，但 rename 错误为受控注入，不能与上述原生 Windows 压力证据混为一项，也未访问生产/GUI/网络或解密凭据。

对上述冻结三文件的最终静态增量，**未发现剩余确切 P1/P2**。这是指定变化的审查结论；受影响回归和主任务新的完整 312 项并发回归另行记录，本页不预先宣称通过。新完整包仍须重新构建、验证和受控验收，不能复用已撤回旧包，也不因此跳过 Q7–Q8／Q10 真人门。

## 最后测试修正与完整回归收尾

原15组adoption测试中的固定150ms迟到定时，会让实例在timeout后的catch被正确发现并精确停止，旧断言却强求unknown。测试提交`5f9c64a97920bf13237bae0fe9fa756ec5879626`改为unknown持久返回后才释放显式barrier，并新增catch二次读取才出现owned实例的确定性场景，验证原`START_NOT_CONNECTED`、`stopped`、exactStops=1及runtime释放。最终测试SHA256为`b4fa910486e138ce67814e49c17d527fa17dc68df4072852cba0c7e0e6f4852d`；两名审查者均只读复核，无新增确切P1/P2。产品core仍为a7c9c55，没有为测试放宽未知/已停止的判据。

主任务随后一轮完整回归**312/312通过，0失败/取消/跳过**；[最终摘要](../../.scratch/checkpoint-v6-final-deterministic-summary.json)核三份最终源hash一致，日志SHA256 `43056fb701f21eb5cb819cc543b80c5a31d1afdce904a65839d76cf54fb03ef6`。新a7／48c40包已经双构建、SDK、ZIP及真实只读预检，详见[最终就绪记录](remote-runtime-final-readiness-2026-11-24.md)；真实生产采用和Q10仍未进行。
