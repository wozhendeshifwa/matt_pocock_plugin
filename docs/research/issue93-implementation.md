# #93 共享主题生命周期与状态保留

日期：2026-11-27。规格：[主题统一 #81](https://github.com/wozhendeshifwa/matt_pocock_plugin/issues/81)；实施票：[#93](https://github.com/wozhendeshifwa/matt_pocock_plugin/issues/93)；验收依据：[#78 T1–T7](https://github.com/wozhendeshifwa/matt_pocock_plugin/issues/78)。

## 实施结果

在 `codex/issue93-theme` 的独立 worktree 上确认基于 `codex/issue81-integration`（起点 `edd19db`）后实施。读取项目术语、ADR 与本机 TDD 规则，沿用已确认的生产面板—宿主通知高层边界；没有声称通过宿主 Skill 接口加载技能。

宿主桥接将有效宿主明暗信号同时应用到主体根节点和版本管理原有的 body 主题消费标记。主题通知只改变样式输入，不卸载或重建 React 视图；关闭版本管理后重开也自然使用当前主题。

回退遵循有效宿主 → 本次打开期间最近有效宿主 → 尚未收到有效宿主时的系统 → 浅色。系统接口缺席或调用失败不阻止面板启动。

配色通知区分“没有字段”与“明确给出配色”：无关通知、同模式更新及缺字段的 globals 通知保留现有配色；跨模式且没有新配色时清除旧模式配色。明确的新配色中缺失或无效的已消费颜色不覆盖默认值。有效颜色通过浏览器 CSS 色值语法验证；保留 `hsl()`、`var()` 和非颜色宿主变量（字体等）。

本票不改上游 vendor、不改版本管理信息布局和 Git 写入契约，也不改 #70；普通控件统一及 CSS 颜色令牌映射由 #94 承接。

## 验证与 TDD 记录

命令在本票 worktree 执行：

- `node prototypes/upstream-port/build.mjs`：通过。使用本地既有依赖的 junction；不改变依赖版本。生成文件由集成工作线统一处理，不混入本票实施提交。
- `node prototypes/upstream-port/verify-theme-sync.mjs`：通过，加载实际生产 bundle、主体 CSS 和宿主 bridge，模拟的是宿主 RPC/通知及 Git 读取数据边界。
- `node prototypes/upstream-port/verify-project-switch.mjs`：通过，同项目聊天保持面板、跨项目隔离与无项目清空回归通过。
- `node prototypes/upstream-port/verify-unassociated-sidebar.mjs`：通过，缺失项目身份时不挂载固定仓库。
- `node --check prototypes/upstream-port/sidebar-bridge.js`：通过。

按纵向切片观察到的 red → green：

1. 无宿主且无系统信息时，主题原先为 undefined，增加明确浅色回退后通过。
2. 存在 `window.openai.theme` 时，无关宿主通知原先清空配色；将初始化全局读取和后续增量通知区分后通过。
3. 无配色字段的 `openai:set_globals` 原先被构造为显式清空；保留实际字段缺席语义后通过。
4. `--background: not-a-color` 原先覆盖可读默认值；增加已消费颜色验证后通过。

| 矩阵 | 受控证据 |
| --- | --- |
| T1 | 显式宿主浅色与系统深色相反；有效深色后系统变浅仍保持宿主深色；宿主恢复后自动同步 |
| T2 | 无有效宿主时系统双向变化；实际宿主通知双向更新，已展开 diff 和打开的确认区域继续保留 |
| T3 | 实际版本管理页签关闭、更新主题、再打开，消费当前主题 |
| T4 | 系统接口缺席/抛错时浅色；系统回退；有过有效宿主后缺失信号保留最近值；信号恢复 |
| T5 | 宿主无关通知、同模式无配色通知及 globals 无配色字段均保留原配色 |
| T6 | 不完整宿主配色、跨模式无配色、无效颜色、合法 hsl()/var()、明确配色重置 |
| T7 | 实际提交说明输入内容、焦点及文本选择范围、选中文件与展开 diff 的原 DOM 节点、scrollTop/scrollLeft 值、预检确认区域和重开主题 |

主题测试只返回受控 Git 状态/diff 及预检确认数据，不触发任何 Git 变更请求。测试显式断言没有 Stage/Unstage/Commit/Push/Pull/Fetch 请求，确认框只打开再取消。

## 证据限度与下一步

以上为 jsdom 受控证据，未启动真实 Codex 原生验收，未记录或声称任何 Codex 版本、实际侧栏宽度/缩放或宿主加载构建。scrollTop/scrollLeft 只验证视图状态值不被主题通知清空，不能证明真实布局、可滚动距离、焦点外观或颜色对比度；这些由浏览器布局检查及 #95 原生验收补足。

T2 的真实 Codex“跟随系统”通知链路、弹窗和提示的实际颜色、首次打开是否无旧主题闪屏等，仍须由 #95 在 #93/#94/#91 前置满足、最终组合构建实际加载后验收。#95 与 #92 复用同构建证据，不互设阻塞。本票代码/受控通过不代表 #81 已交付，父规格保持开放。
