# 统一上下文、技能来源与更新：续跑复核

> 历史阶段记录；当前交付与关闭结论见[生产绑定及共享验收收口](spec61-production-binding-closeout.md)。此处保留当时状态，不恢复已解除的验收门槛。


日期：2026-11-26（Asia/Shanghai）。目标：[规格：统一上下文注入、技能来源与自动更新规则](https://github.com/wozhendeshifwa/matt_pocock_plugin/issues/61)。

## 阶段与范围

deck 读全正文、评论、标签、认领与关系：票已由 wozhendeshifwa 认领，标签 ready-for-agent / wayfinder:task，没有 needs-triage。前置验收决策已关闭；已读所属地图和来源集成票。此轮复用已有实现，未重复拆票或创建实施分支。

本地统一交付：`.scratch/issue62/integration`，分支 `codex/issue62-integration`，HEAD `fe05a0b`；产品固定点 `418066b`。工作树检查前后均干净。原工作区已有修改未改动。

## 本轮实际检查

在上述集成检出执行，下列命令均退出 0：

- `node build.mjs`
- `node verify-request-preparation.mjs`
- `node verify-reviewed-draft-outputs.mjs`
- `node verify-skill-sources.mjs`
- `node verify-review-fixes.mjs`
- `node verify-context-drafts.mjs`
- `node verify-auxiliary-context.mjs`
- `node --test verify-protected-draft-outputs.mjs`（8/8）
- `node verify-skill-updates.mjs`
- `git diff --check 774ba4d...418066b`

更新测试最初在沙箱内创建 junction 时 EPERM，随后主机侧重跑完整通过；只用临时技能目录和受控 HTTP 源，没有改真实技能库。一次只读宿主检查尝试使用 Python，因未安装失败，已改用 Node 完成。未将这两次环境失败记录为测试通过。

这些结果确认生产 bundle 的受控边界：最终可见文本保持、来源变更停旧出口并保留编辑、引用行为摘要、按技能筛选绑定、完整只读备用和必要工具检查、更新失败保留与备份恢复、无变更不下载、并发与越界保护。它们不能证明实际宿主成功填入或实际加载技能。

## 当前宿主证据

本轮只读 Get-AppxPackage 确认桌面包仍为 `OpenAI.Codex 26.1120.6357.0`，独立 PrimaryRuntime 为 `26.1123.915.0`。

直接只读解析已安装 `app/resources/app.asar` 的头与指定文件，未提取或修改应用：`webview/assets/async/141674.c261c78fc6.js` offset 39891 附近的 `openai/message` 严格参数只有 `target: active/new` 和 `send`；offset 91684 起的完整 `ui/message` 草稿分支中，当前聊天调用 append、新聊天调用新草稿路径，均返回 `{}`。本轮工具清单亦没有可供此插件使用的 composer 读取、原子条件写入或填入结果回执接口。

这是安装包公开实现的静态核验，不是新的运行时握手或原生交互验收，不能据此排除未公开的实验能力。当前没有足以实现合格可靠适配器的证据，不能凭空标记能力可用或把 `{}` 当作成功回执。

## 真实状态与下一步

代码和本轮受控复核通过；规格仍未完成产品验收，保持 open。原运行服务未切换，实际来源绑定／加载、新产品生成请求后的可追溯会话、原生系统剪贴板和三出口、最窄宽度／缩放／输入法仍待验收。

下一步先取得合格的公开宿主能力并实现可靠适配器，再切换实际服务并补齐原生矩阵及新产品会话证据；若考虑改变已确认的可靠读写与回执门槛，须回到对应决策澄清。此轮不降低门槛、不虚关规格、不把 API 或浏览器夹具升级为原生验收。
