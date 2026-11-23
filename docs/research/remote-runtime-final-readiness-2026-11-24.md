# 当前完整 runtime 候选与手动接纳就绪记录

当前候选是 **运行源码 a7c9c55／release manifest 48c40d84**。最终完整回归 **312/312通过，零失败、取消或跳过**；两次完整打包、ZIP解压校验、隔离SDK读取、真实只读plan和外部手动入口正反例均通过。**尚未生产apply、安装或迁移**。现用生产继续运行BF基线的只读组件，云端仍为70aa、protocol 1。

手动接纳方法见 [ADOPT-RUNTIME.md](../../prototypes/remote-companion/ADOPT-RUNTIME.md)，工程结论见 [双审记录](remote-runtime-adoption-review-2026-11-24.md)，实际宿主与剩余人门见 [阶段验收报告](remote-companion-acceptance-2026-11-24.md)。本记录整理既有证据，没有重跑验收或执行安装。

## 当前固定包与分发文件

| 项目 | 实际记录 |
| --- | --- |
| 运行代码 Git source | `a7c9c55f1bfd78d654c610238d2eeb5a176a0633` |
| 两次独立打包目录 | `runtime-a7c9c55-v6-complete-a`、`runtime-a7c9c55-v6-complete-b` |
| 两包相同 manifest SHA-256 | `48c40d8403ac97950bba31bb2d6dde9e0e56ea786a937905cf259e6005231ca7` |
| catalog | **481 项，8,636,220 bytes**，含 29 个 core 文件 |
| manifest 本身 | 另有 `client-release.json`，93,260 bytes；故物理文件共 **482 个** |
| adapter manifest | `dc04813e34b463827667f8bca236ffc6c31ec847959a414c334d4ead9e756e10` |
| 构建工具 | 已在固定 source 内；SHA-256 `052397fc45f636c92993e362869e885e9990037895673ed5400900846f5d47f5` |
| ZIP | `deck-runtime-v6-a7c9c55-48c40d84.zip`，**2,972,511 bytes** |
| ZIP SHA-256 | `e86358900abdaa3c6e37cc1e26fa461d19fd717d274ca320172d6cbd6978721b` |
| 解压校验 | `extractionVerified:true`，catalog 481 项、physical 482 文件，source 和 pins 一致 |

来源为 [当前 build evidence](../../.scratch/runtime-releases/runtime-a7c9c55-build-evidence.json) 与 [当前 distribution summary](../../.scratch/runtime-distribution-a7c9c55-44/distribution-summary.json)。两者均明确 `installed:false`，构建记录另确认 `productionPairingOrProviderOrStartupChanged:false`。

旧 1cdb835／9df1 包已在生命周期诊断后撤回，保留原记录用于追溯，**不再是安装候选**。本文下面的包、SDK 与 plan 均指 a7c9c55／48c40d84，不把旧包的计数或结果混入当前候选。

## 当前完整包的 SDK 读取

[当前 SDK acceptance](../../.scratch/runtime-package-smoke-NfE4oh/acceptance.json)绑定上述相同 source、release manifest 和 adapter manifest：

- 16 tools、1 resource；原 UI 为 **2,518,404 bytes**，SHA-256 `d92e4c83d2955c89fbd02ed5390a966639cf3a2dfa1d18b8aab27e74838eb8ec`。
- 实际读取 wayfinder 11,763 bytes、tdd 3,401 bytes、writing-for-agents 10,811 bytes，均保存内容 hash。这是三份文档抽样，不是本次 SDK 逐一读取了全部 27 份文档。
- 写入被拒绝，读取后包未变，可变状态位于 release 外，资源已关闭。
- `loopbackOnly:true`、`fakeIdentity:true`、`actualCodexApproval:false`；不能把这项隔离验证说成真实宿主安装、UI 渲染或真人批准。

## 真实只读 plan 与配置保持

[当前真实 plan 公开摘要](../../.scratch/adoption-ready-44-be6733e8-a74c-4a22-8a5e-de21e50f01f0/public-evidence.json)采于 **2026-11-23 22:02:53 UTC**：

| 项目 | 实际记录与边界 |
| --- | --- |
| 模式 | `initial-readonly-adoption`，两个既有来源 |
| 真实已注册项目 | 19 个 root |
| 选择与过滤 | selected=73、filtered=46 |
| 显式仅归档 | archiveOnlyCount=3，不作为待激活业务 |
| 云端兼容 | verified=true、protocolVersion=1，与本机目标一致 |
| 阻塞项 | `blockers:[]` |
| ledger | `ledgerMissing:true`；仅初次只读接纳可使用该例外，未创建账本，不能外推到 full-code update 或写授权 |
| 激活与执行 | `activationReady:false`、readOnlyCollection=true、productionApplyPerformed=false |
| plan digest | `ec69617369d48cdf0813b0e4f7d38f60c12c64bc15721b2c140c2f99c7c2b175` |
| private plan SHA-256 | `7460f5d4da16b8ba95426d35e4007f6c18305c5902711986c60dd48fe1017347` |

旧只读 runtime 的 18 文件在采集前后均校验通过；其 manifest SHA-256 为 `6a82e9aeefb1134dcf5be2d125a62a60b3de1f9920bda948a5d3dbaa61e1b926`。provider、pairing、caller 的现有配置 hash 保持不变，未解密真实凭据。

`blockers:[]` 不等于已经允许使用旧 digest 切换。证据明确要求真实 Codex 正常退出后取得 **fresh plan**；运行中采集的 plan 不是用户签字或已安装状态。

## 心跳修复与回归：分项记录，不能相加替代全套

运行 core 的稳定字节为 lifecycle `eaf4cad89ffc1749a5a2a674dec1f4b3c3a8b77c2493474f1fcd8837c82023d5`、adopter `389055f2379b42dce7ed3b877a4eca06024037a10d8854d22bff12ce64fe05eb`，均已封入当前 a7 候选。

| 验证 | 已发生的结果 |
| --- | --- |
| 原生故障诊断 | 旧生命周期中 1000 次 fd 读取的实例 ID 均正确，但 rename EPERM 后 1 毫秒出现意外 onStop；顶层 rename EPERM 共 282 次。不是单凭 reader 解释，也没有把原始拒绝归因于未证实的 AV。 |
| 修复后原生压力 | 1000 次读取正确、readerError=null、onStop=0；仍有 133 次顶层 EPERM，但成功 publish 186 次、updatedAt 推进 183 次／2,035 ms，未停留在旧心跳记录。 |
| 第二审查者独立控制注入 | **6/6**：短暂拒绝恢复；持久拒绝有界耗尽仍 stop；EIO 不重试；owner 更换不覆盖；close 中断后不再 publish；撤销发布失败仍触发权威回调。真实 timer 和随机假配对 DPAPI，非生产或原生压力测试。 |
| 受影响局部回归 | **40/40**，session 67835；该范围使用修复 core 和当时 `5f346b33…` 测试文件，不能覆盖或否定其他全套运行的失败。 |
| 根首次 fixed 全套 | **312 项中 311 通过、1 失败，474,228 ms**。不能写成全部通过。 |
| test-only 修正后定向 | `b4fa910486e138ce67814e49c17d527fa17dc68df4072852cba0c7e0e6f4852d` 的 START 组 **1/1**，session 24197。产品 core／a7 包未改变。 |
| 最后完整回归 | **312/312通过，fail/cancelled/skipped/todo全部0，423,236.9042ms**：session 12822，日志 `.scratch/checkpoint-v6-final-deterministic-full-results.log`。 |

首次全套失败的确切原因已经分清：旧测试让迟到实例在固定 150 ms 后出现，实例恰在 START 超时后的 catch 二次读取中被正确发现，并被精确停止，实际错误为 `START_NOT_CONNECTED`、结果为 `stopped`；旧断言却只接受 `unknown`。这是测试时序假设不成立，不是应把已知停止强行改成未知。

测试修正单独提交为 **`5f9c64a97920bf13237bae0fe9fa756ec5879626`**：未知场景用显式 release gate，待 unknown 已持久返回才创建迟到实例；另加真实 owned 实例仅在 catch 二次读取出现的确定性场景，必须验证 `stopped`、exactStops=1、最终无 runtime。没有将断言放宽为任意 unknown／stopped 都算成功。该提交仅改测试；**运行包 source 仍为 a7c9c55，manifest 仍为 48c40d84**。

以上6、40、311和1的范围存在不同边界及重叠，不作相加；最后312/312来自一轮完整独立运行。日志SHA256为`43056fb701f21eb5cb819cc543b80c5a31d1afdce904a65839d76cf54fb03ef6`，[收尾摘要](../../.scratch/checkpoint-v6-final-deterministic-summary.json)另核最终lifecycle/adopter/test哈希均与审阅值一致；测试源为5f9c64a，产品运行源码仍为a7c9c55。

分项证据：

- [诊断来源与独立六场景索引](../../.scratch/lifecycle-retry-review-44/source-provenance.json)
- [修复后原生压力记录](../../.scratch/heartbeat-diagnostic-fixed-b7cd27cd-6e9c-43fb-b20c-08823a47aa46/diagnostic.json)
- [40 项影响回归结果](../../.scratch/adopt-final-validation-44/affected-regression-result.json)
- [test-only 修正及 1 项定向结果](../../.scratch/adopt-final-validation-44/start-barrier-regression-result.json)

## 外部手动入口：静态双审与实际正反例

[外部操作说明](../../.scratch/operator-a7c9c55-44/README.md)和 `install-readonly.ps1` 位于 `.scratch/operator-a7c9c55-44/`，绑定当前 a7 包：

- PS SHA-256：`6f0cfe06fab80f8a064252b6622e4d8566d6a9df504eb7569d6ea8ccf4a32722`。
- 实际 helper 为 `prepare-adoption.mjs`，SHA-256：`7ff0b6bc2961cefc0538174607b68b89a4a7d21143d30aacb6454c7fc0a79ba4`。
- 已双审；原 CLIENT 模板的 .NET 全 catalog 验证前缀逐字相同，Node 前还核验 helper pin。执行模块均来自固定包，没有可变 worktree 的执行依赖；旧 worktree 仅作为固定数据和配置的只读输入。
- 默认仅 PlanOnly；Apply 要求应用正常退出、fresh plan、完整手输 `APPLY <freshDigest>`，提示明确该次授权包括启动固定 **只读** companion。DRAIN 仍需另行手输 digest，并核验精确 owned 实例证明；失败／未知保留，不盲目重放，也不启动 Codex。

根任务已实际执行 [PlanOnly 正例](../../.scratch/operator-a7c9c55-44/planonly-dryrun.log)：19 root、selected=73、filtered=46、blockers=[]，新 digest 为 `d078f11ae2b37e2d4348f157041e82639edb783454a855cc3015a8f2ee7c5f1e`。这是另一次 fresh 只读计划，不与前述 ec696 digest 混用。

[运行中 Apply 负例](../../.scratch/operator-a7c9c55-44/apply-running-app-negative.log)只在 `normal-app-exit` 阶段拒绝。没有 dispatch API apply、停止组件、START、DRAIN、代签或 GUI；正反例通过不能推定真实切换已经完成。

## 剩余人门与生产状态

手动更新／恢复来自[部署架构、授权与验收边界](https://github.com/wozhendeshifwa/matt_pocock_plugin/issues/42)第四轮 **Q7–Q8**，仍需用户在独立本机入口审阅并签字；**Q9是基线锁定**，**Q10是真人最终宿主验收**。Agent没有代输签字。CUA被物理Esc终止后，本轮UI操作已停止；自然idle休眠冷启动仍未证明。

当前生产仍为 **BF只读组件＋cloud 70aa／protocol 1**，没有被当前a7包替换；未生产迁移、改Startup／provider或开放生产写。完整回归已收口，用户手动版本切换／失败恢复、真实UI和审批验收仍须实际完成；正式规格与地图保持open。

[最后只读环境复核](../../.scratch/final-environment-readonly-44.json)确认配对和provider配置仍匹配UTC19:39:35固定基准；主工作区仍为`codex/checks-recovery`、HEAD `701029b1efcdac8d4faedffe5955293efecc36a8`，43条既有状态记录保留。这是配置hash与工作区状态观测，没有将其扩大为全库前后逐字节证明。[最后真实宿主调用](../../.scratch/adoption-ready-44-be6733e8-a74c-4a22-8a5e-de21e50f01f0/final-host-context-attestation.json)也成功返回原主项目/当前聊天/正确仓库；调用走现用BF组件，不冒称a7已实际安装。
