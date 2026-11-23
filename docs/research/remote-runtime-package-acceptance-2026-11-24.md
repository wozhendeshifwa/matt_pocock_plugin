# 完整 runtime 包／ZIP／SDK 验收记录

本记录汇总已保存的构建、分发和 SDK 验收证据，没有重新运行写入验收、安装、迁移或启动生产组件。固定输入与操作方法见 [RUNTIME-RELEASE.md](../../prototypes/remote-companion/RUNTIME-RELEASE.md)。下列通过项证明完整包的生成、校验与隔离读取可用，不表示真实安装或正式交付已经完成。

## 固定来源与可重复产物

| 项目 | 已保存的实际结果 |
| --- | --- |
| 包内 core 来源 | 27 个 core 模块来自固定 Git commit `70aa02f91dd5670b805c8862fe9e187faf4f8910`，不取工作树 WIP |
| Adapter | 固定 450 文件 v6；manifest SHA-256 `dc04813e34b463827667f8bca236ffc6c31ec847959a414c334d4ead9e756e10` |
| 协议／overlay | protocol 1；`bound-effects-and-bundled-docs-v6` |
| 两个独立输出 | `runtime-70aa02f-v6-complete-a`、`runtime-70aa02f-v6-complete-b` |
| 各包内容 | **479 files，8,554,162 bytes** |
| 两包相同 manifest SHA-256 | `10c3befde71d6352b1a6938df4d0338cc52a1f7ec840373f2d053e1c2f64f344` |
| 静态验证 | 353 模块仅编译、不求值；709 条相对导入引用及 133 个动态导入配方核对通过 |
| 构建工具 SHA-256 | `052397fc45f636c92993e362869e885e9990037895673ed5400900846f5d47f5` |

构建工具当时**尚未进入上述 70aa 源 commit**，证据中 `buildToolIsPartOfPinnedSource:false`。包内代码的 Git 来源与本机打包工具的独立 digest 分开记录，不能把未提交工具说成源 commit 的组成部分。原 `verifyClientRelease`、adapter 和完整 catalog 验证按发行说明通过。

早期 `runtime-70aa02f-v6-review` 曾因生成的 PowerShell 语法问题被撤回，留有 `INCOMPLETE`，从未安装。最终 a／b 是另建的新目录，不能将早期目录用作最终包。

## ZIP 分发与解压校验

[分发摘要](../../.scratch/runtime-distribution-44/distribution-summary.json)记录：

- ZIP：`deck-runtime-v6-70aa02f-10c3befd.zip`，位于 `.scratch/runtime-distribution-44/`。
- 压缩文件 **3,001,879 bytes**，SHA-256 **`6f267f3d568502a42c7444215cc43e61b5198401e7d4149856c69dc5901512ec`**。
- `extractionVerified:true`，479 文件；源 commit、release manifest 与 adapter manifest 均与上述固定值相同。

ZIP hash 证明这个分发文件的身份；解压校验与下述包内 SDK 读取是分别保存的证据，不从 ZIP 存在推定已经安装。

## 独立 builder 测试与根回归

[独立 builder 日志](../../.scratch/checkpoint-runtime-package-results.log)为 **5/5 passed，0 failed／cancelled／skipped／todo**。五项覆盖：

1. 固定 Git 对象忽略脏文件与未跟踪文件，产物可重复，任意 Git 输入代码不执行。
2. 拒绝符号 ref、不兼容 protocol／overlay 和缺失相对导入闭包，失败不创建 ready 输出。
3. 拒绝覆盖已有输出与 adapter 漂移，catalog 拒绝多余文件、篡改及 `INCOMPLETE`。
4. 捕获后源漂移保留 `INCOMPLETE`，不能发布 ready 包。
5. PowerShell bootstrap 复用 catalog 校验，先验证包外固定状态，再执行无害 stub。

[根 v6 全套日志](../../.scratch/checkpoint-v6-full-results.log)记录 **297/297 passed，0 failed／cancelled／skipped／todo**，约 328.4 秒。该日志包含上述五个 builder 用例，因此不把独立 5 项再加成 302 项。日志开头另有 `Host-context capture skipped (EPERM)` 的诊断提示；297 项程序测试通过不能替代真实宿主上下文或人工验收。

这次根测试文件列表在 adoption 工作加入之前已经捕获，**不包含其后新增的 adoption 测试**；这里不声称“当前后续全部新增测试均已包含在 297 中”。

## 从完整包运行的隔离 SDK 读取

[SDK acceptance](../../.scratch/runtime-package-smoke-eb6JAQ/acceptance.json)绑定相同源 commit、release manifest 和 adapter manifest。它明确为 `loopbackOnly:true`、`fakeIdentity:true`、`actualCodexApproval:false`：

| 检查 | 实际结果 |
| --- | --- |
| MCP 清单 | 16 tools、1 resource |
| 原 UI resource | **2,518,404 bytes**；SHA-256 `d92e4c83d2955c89fbd02ed5390a966639cf3a2dfa1d18b8aab27e74838eb8ec` |
| 随包文档实际读取 | wayfinder 11,763 bytes；tdd 3,401 bytes；writing-for-agents 10,811 bytes，各有独立内容 hash |
| 写入边界 | `writeDenied:true`，没有把 fake 身份作为真人批准 |
| 包与状态 | `packageUnchangedAfterReads:true`；`mutableStateOutsideRelease:true` |
| 退出清理 | `resourcesClosed:true` |

这三份文档是本次打包 SDK smoke 的实际抽样，不能写成该次 SDK 逐一读取了 27 份文档。根回归日志中“27 个原技能文档与翻译来自同一随包目录”的用例是另一项通过证据。读取 UI HTML 字节也不等于完成真实侧栏渲染、主题或按钮验收。

## 尚未完成的正式交付边界

构建证据明确 `installed:false`、`productionPairingOrProviderOrStartupChanged:false`。本轮只准备和验证完整文件包及 ZIP，没有实际安装、迁移既有业务状态、切换生产配对、替换现用组件、修改 provider 或 Startup。包外数据根、journal、安装级 ledger、受控迁移与失败回退仍须按发行说明独立核实，不能用新空目录冒充迁移。

按原决策第四轮Q7–Q8，实际更新仍需用户手动确认；Q9规定的基线锁定已有上述可追溯材料，Q10要求的真人最终验收未完成。自然闲置休眠后的冷启动仍未证明。CUA曾被物理Esc终止，本轮没有继续操作界面。本记录不将SDK假身份、无害stub、包校验或测试计数外推为真人审批、真实登录自启、完整更新／回退或正式发布通过。

本记录仅据 [包外 build evidence](../../.scratch/runtime-releases/runtime-70aa02f-v6-build-evidence.json)、分发摘要、SDK acceptance、两份 checkpoint 日志及发行说明整理；没有重新运行业务写验收。
