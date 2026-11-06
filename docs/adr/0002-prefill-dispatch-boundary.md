# 侧栏派发保留宿主草稿语义

上游 MattSkillsDeck 1.8.0-rc.7 的「执行」和「新会话」都是把提示词注入宿主输入框，Codex 适配层把这两处映射为 `ui/message` + `send: false`；旧 `sidebar-probe` 另有独立的 `codex exec` 任务会话、任务记录和结果回显。本 port 决定保留上游草稿语义，不内建第二套任务引擎或任务卡 UI：port 的「派发」是用户在草稿上确认后自己发送，结果留在被派发的 Codex 聊天里；独立任务会话仍由 `sidebar-probe` 回退路径承载。

## Considered Options

- **在 port 里补 `deck_dispatch` + 任务状态读取**：会与原版「执行/新会话」的动作语义并行，需要另做预览/确认/结果卡 UI，等于把旧 probe 的产品功能塞进以“保留原版”为目标的 port；不做。
- **修改 Issue #1 的验收口径**：Issue #1 是只读验收夹具，票面明确不得改文件、不得向 GitHub 发布；不改它的正文，也不拿 port 的草稿语义去关闭它；不做。
- **保留预填语义，把任务卡留给旧 probe**：本次采用。它与 [upstream-parity](../research/upstream-parity.md) 的“原版动作保留”一致，也不污染 #1 的夹具。

## Consequences

Issue #1 的四项（发现 / 预览 / 派发到独立会话 / 结果回显）描述的是旧 probe 的闭环，不能当作 port 已实现的证明。port 自己的验收范围是真实 Issue 列表与详情、主题跟随、按聊天身份跟随项目、执行/新会话生成可编辑草稿。术语上，GLOSSARY 的「派发 / 任务会话」仍指旧 probe 的独立任务闭环；port 的对应动作是宿主草稿，避免用同一个词指两种行为。若后续要求 port 也提供任务卡和结果回显，需要新开实施票，并重新评估 [ADR-0001](0001-project-scoped-board.md) 中“任务卡 / 任务会话进度”的适用范围。

2026-11-07
