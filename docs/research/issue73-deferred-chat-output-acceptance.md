# 首版聊天填入延期：说明与安全出口

日期：2026-11-26（Asia/Shanghai）。[代码票](https://github.com/wozhendeshifwa/matt_pocock_plugin/issues/73)，[用户已确认的范围修订](https://github.com/wozhendeshifwa/matt_pocock_plugin/issues/62)。

## 交付

集成分支 `codex/issue62-integration`，最终产品提交 `5e5097a`，功能提交 `576c862`。列表预览与详情底栏共用预览：宿主无可靠能力时提前说明原因，禁用当前/新聊天按钮；编辑和用户主动复制保持可用，说明不进入最终草稿，不自动复制、发送或改投。

可靠适配器契约保留；按钮状态和实际发送守卫共同使用 `canFillIssueActionDraft`，该函数已正确注入生产构建。此次延期不表示缺失的宿主可靠能力已通过。

## TDD与集成

独立实施工作树从 `b33b10e` 创建，先红：两预览高层测试缺少提前不可用说明；再绿：无可靠能力时禁用、解释、保留编辑/原文复制。实施者合入集成文档tip `534312d`，merger快进集成，再合入统一审查修复 `5e5097a`，无冲突。

通过的检查：build；两预览 `verify-chat-output-availability`；可靠回执/来源变化 `verify-reviewed-draft-outputs`；bottom；action-drafts；protected 8/8；project-switch。修正共享判断后重跑build/availability/reviewed/bottom均通过。merger在集成上验证构建及availability，最终diff检查通过。

新真实握手回放通过：实际MCP/GitHub列表详情及status/run渲染，两个聊天出口打开时即禁用，未发ui/message；这不是原生可靠聊天成功或完整原生布局验收。

## Standards

固定完整审查：`git diff b33b10e...5e5097a`。标准来源为仓库AGENTS、领域及tracker约定、宿主草稿ADR与Fowler启发式基线。

初审0硬违规、1项possible Duplicated Code：可用性与发送守卫重复判断。由原单一implementer统一提取并注入共享判断；原审查者定点复核 `5e5097a`，最终0硬违规、0保留维护性发现。

## Spec

独立初审及定点复核均0发现；原规格审查者独立运行两预览availability及初审reviewed检查通过。未新增未授权能力，未改变复制原文或可靠回执检查。

## 运行与首版余项

此前真实侧栏加载的是修订前产品代码；本次代码已合入并构建，但运行中的服务在启动时缓存UI资源，本轮没有再次重启用户应用，不能称该新说明已经原生重载。下次侧栏服务重载后使用新构建。

代码票可以按本票标准关闭；后续可靠宿主出口票继续开放。来源集成和最终首版验收的原生依赖已复核为63/68/73和67/68/73，已移除70；不是只有正文变更。最窄/380px/缩放/输入法、跨项目及实际来源/Agent行为等其余必验项仍保留，不借延期虚报整版完成。用户已完成人工验收的编辑/复制不再要求重做。
