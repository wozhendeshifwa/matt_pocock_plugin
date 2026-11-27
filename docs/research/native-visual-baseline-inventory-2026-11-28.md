# Codex 视觉更新：界面清单与基准采集

本记录服务于 [采集当前 Codex 视觉基准与全插件界面清单](https://github.com/wozhendeshifwa/matt_pocock_plugin/issues/103)。以下是源码能证明的界面范围，不等同于当前宿主的视觉实测。

## 源码界面范围

- `prototypes/upstream-port/browser-runtime.mjs` 的 `PanelShell` 装配看板、沙箱任务、设置、状态、运行五个顶层页签。沙箱任务取决于宿主能力；其余页签取决于上游组件是否注册。
- 看板内部的 Issue 列表、详情、搜索、规格子票、技能入口和提示词直接填入来自 `vendor/mattskills-1.8.0-rc.7/lib/client.js` 与本地适配客户端。版本管理视图在同一上游文件中，以 `[data-vc-root]` 限定自己的主题样式。
- 上游 `.dsws-modal` / `.dsws-modalbox` 承载表单、向导、标签颜色等弹窗；技能弹层、加载、空白、错误、成功反馈也需要纳入视觉样本。`prototypes/upstream-port/manual-naming-view.mjs` 和 `prototypes/sandbox-tasks/view.mjs` 是额外界面入口。
- `prototypes/upstream-port/theme.css` 定义宿主变量别名、外壳、顶层页签、按钮、焦点与版本管理覆盖样式。其明暗令牌、上游局部令牌及大量内联样式可能同时影响最终外观。源码含减少动画偏好处理。

## 待采集的真实基准

1. 记录可见插件实际加载的构建、Codex 版本、窗口尺寸、缩放、侧栏宽度、明暗主题与系统主题模式。磁盘发布文件哈希不能替代可见面板实际字节证明。
2. 在 Codex 与插件相邻区域，对照记录字体与字重、字号层级、背景层次、分隔线、圆角、按钮与输入框高度、图标、强调色、悬停、焦点、禁用和反馈状态。明暗各一组。
3. 按五个顶层页签及看板内部列表/详情/版本管理逐一核对实际可见性，采集代表性弹窗和长标题、长路径、空白、加载、错误场景；记录窄侧栏、宽侧栏、全屏尺寸下的溢出与操作可达性。
4. 主题切换闪烁由独立的[主题切换闪烁调查](https://github.com/wozhendeshifwa/matt_pocock_plugin/issues/100)取证。本票只引用结果。

## 证据边界

当前没有本轮真实宿主截图或尺寸记录。Computer Use 随包 `docs/guidance.md` 明确禁止自动化 ChatGPT 桌面应用 UI；本轮没有使用它操作 Codex。上面的运行态基准尚待取得，不能把源码清单记为原生验收。
