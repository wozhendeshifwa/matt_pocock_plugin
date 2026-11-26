# 来源、草稿与更新集成：本轮复核

> 历史阶段记录；当前交付与关闭结论见[生产绑定及共享验收收口](spec61-production-binding-closeout.md)。此处保留当时状态，不恢复已解除的验收门槛。


日期：2026-11-26（Asia/Shanghai）。目标：[集成来源状态、草稿与更新结果并完成规格验收](https://github.com/wozhendeshifwa/matt_pocock_plugin/issues/71)。

## 阶段与结论

票已认领给 wozhendeshifwa，标签为 ready-for-agent、wayfinder:task，无 needs-triage。两个原生依赖「统一全部入口的上下文与新版草稿」「自动维护限定技能库并保护可用版本」均关闭。所属地图的追加授权允许实施；不再按历史 Notes 的仅规划限制重复停工。

既有实现真实存在。底栏消费者已接入 prepare/check，不能继续把“尚未接入底栏”当成当前缺口。代码与受控边界通过；原生三出口及实际技能来源／加载、产品请求后的实际会话证据仍未通过。本票及父规格保持开放。

收尾已把仍开放的[实现可靠宿主草稿出口与目标变化保护](https://github.com/wozhendeshifwa/matt_pocock_plugin/issues/70)加入 blockedBy，保留两条已关闭的历史前置；deck_map_link 写后读回逐条确认三条原生依赖。真实状态、复测结果与下一步已写入本票正文，并通过 deck_issue_report 再次上报。未关闭，因此不向地图 Decisions so far 写完成结论。

## 本轮执行证据

工作树：`C:/Users/27263/Desktop/matt_pocock_/.scratch/issue62/integration`。产品代码固定点 `418066b`，初始文档点 `fe05a0b`；复核期间另一会话新增文档提交 `8c95550`，仅增加 issue62-resumption-recheck.md，产品代码未变化。未覆盖或撤销其他会话的改动。

以下命令均从该工作树执行，退出码为 0：

| 命令（入口位于 prototypes/upstream-port/） | 观察结果 | 证据边界 |
|---|---|---|
| node build.mjs | 生产构建通过 | 不代表运行服务已切换 |
| node verify-reviewed-draft-outputs.mjs | 列表预览和底栏均通过；来源变化停止三个旧出口，取消保留手写文本，未知／错误回执不报成功 | 生产 bundle + jsdom + 受控宿主／剪贴板；构建后重跑通过 |
| node verify-context-drafts.mjs | 目标范围、当前／新聊天同文、新版模板及旧配置保留通过 | 生产 UI 受控测试 |
| node verify-request-preparation.mjs | 来源说明先进入候选、最终文本一致、来源变化保留编辑、失败仅允许查证、路径不误触维护 | 生产 runtime 公开契约 |
| node verify-review-fixes.mjs | 引用行为变化触发重审、CRLF 不误挡；多来源按技能筛选，无匹配不报最新 | 实际来源／维护服务的临时数据 |
| node verify-protected-draft-outputs.mjs | 8/8 通过：已有输入确认、未知版本拒绝、目标变化和外部编辑取消、无可靠适配器拒绝出口 | 受控宿主契约，不是原生成功 |

本轮最初误写了不存在的 verify-host-draft-outputs.mjs 路径，报 MODULE_NOT_FOUND；更正为上表 verify-protected-draft-outputs.mjs 后通过，不将误调用计作产品失败。

`git diff --check fe05a0b..8c95550` 通过。更宽的 `git diff --check 701029b...8c95550` 报 prototypes/sandbox-tasks/host-filter.test.mjs:41 的既有 EOF 空行；本票未改该文件，未宣称宽基线检查全绿。

## 当前宿主与运行差异

只读 Get-AppxPackage 确认桌面包仍为 OpenAI.Codex 26.1120.6357.0，PrimaryRuntime 26.1123.915.0 是另一包。只读进程查询显示 sidebar-server.mjs 进程仍指向主工作区 prototypes/upstream-port/sidebar-server.mjs，没有指向本次集成工作树。

重新读取当前安装包 app/resources/app.asar 的 webview/assets/async/141674.c261c78fc6.js：

- 字符偏移 39891 附近：openai/message 严格选项仍只有 target(active/new)、send。
- 92300–94200：send:false 对 active 调用 append，对 new 调用新草稿路径，随后 return {}。没有填入回执，不能证明最终文本或目的地。
- 115876 附近：公开能力组装仍可见 ui/message；本轮没有完整动态握手，因此不将静态读取升级为所有实验能力的穷尽证明。

MCP Apps UI 检查两次列举均为空；期间调用 open_deck_sidebar_probe 得到 Original MattSkills sidebar，但没有可读面板 tab。由此只能认定本轮 UI 检查入口不可用，不能认定侧栏完全打不开，更不能记为原生产品验收通过。

本轮没有改用户配置、切换运行服务或模型提供商，也没有改真实技能库。此聊天受用户直接调用 wayfinder 驱动，不能冒充新产品生成请求后的实际行为案例。

## 下一步与关闭门槛

1. 宿主出口票取得可验证的公开适配能力：可读输入及版本、明确项目／聊天、原子条件替换、可确认未发送的结果。没有这些事实时，继续保留预览和明确复制，拒绝未知聊天写入。
2. 运行已集成构建，并记录服务路径和产品代码版本；若需调整配置，保留恢复备份，不能以旧面板观测代替新构建。
3. 在真实 Codex 验证当前／新聊天和系统剪贴板与最终可见文本一致；验证已有输入确认与取消、来源变化重审和目标变化停止。
4. 补实际来源绑定／加载与产品生成请求后的可追溯会话；目录可见、正文可读和此轮手动技能调用均不能替代。
5. 缺项仍在时保持本票与父规格开放；全部必验项通过后才写 resolution comment、关闭，并在所属地图 Decisions so far 追加具名链接及 gist。
