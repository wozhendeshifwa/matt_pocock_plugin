# 全插件界面与剩余静态采集清单

日期：2026-11-28（Asia/Shanghai）。服务于[采集当前 Codex 视觉基准与全插件界面清单](https://github.com/wozhendeshifwa/matt_pocock_plugin/issues/103)。本子任务仅对照源码与已有实测记录，没有操控 UI、修改产品、写远端票或关闭票。

本任务使用主代理从 matt 插件 `issueActionRequest` 取得的 `wayfinder:task` 对应 `$triage` 注入提示词；已明确分流为非代码事实清点。找到并读取随包 triage 规则参考，但不声称宿主已加载技能。由主代理保留认领与上报职责。

## 证据层级

- **历史实测**：`native-visual-live-baseline-2026-11-28.md`，有实际页面/弹窗与旧批次资源 SHA-256。它的桌面自动化限制已被后续授权取代，不再是当前阻碍。
- **后续实测**：`native-visual-host-followup-2026-11-28.md`，宿主明暗与并排/全屏样本、真实配色变量，未重新绑定全部加载资源。
- **本轮主代理回报**：200% 宿主缩放浮层、DPR 3、319×366；180% 为324×416；恢复100%后DPR1.5、519×822。版本管理文本框键盘焦点 `:focus-visible` 为真，2px `rgb(88,166,255)`。这些是主代理实际操作的转述，最终以其原始工具记录与采集文档为准。
- **源码范围**：当前工作目录源码与构建适配逻辑；不独立证明当前面板已加载或对应状态可达。各表中的“待采”仅指尚无引用证据，不证明产品缺失或故障。

## 顶层与常驻界面

| 区域 | 源码定位 | 已有实际观察 | 尚待采集或限定 |
| --- | --- | --- | --- |
| 五个顶层页签：看板、沙箱任务、设置、状态、运行 | `prototypes/upstream-port/browser-runtime.mjs:37` 的 `PanelShell` | 历史实测逐页读取 | 沙箱依赖能力、其余取决注册；明暗/窄宽下各页状态未全覆盖 |
| 看板仓库栏、后端选择、标签配色、聊天操作、刷新与导航 | `vendor/mattskills-1.8.0-rc.7/lib/client.js:24077` 的 `DetailsDock`；`prototypes/upstream-port/build.mjs` 装入 `CodexBoardActions` | 列表/地图与配色加载失败弹窗已见 | 选中/悬停、工具提示、长仓库名和键盘可达性待补；沉淀/交接/新聊会写草稿，采样避免覆盖现有草稿 |
| 列表与规格子票、搜索/筛选、关闭分页 | 上游 `ListTab:22298`；`prototypes/upstream-port/spec-list-client.mjs`；`comment-pagination-client.mjs` | 列表、地图分层、筛选、双填入入口已见 | 长标题、长标签、多层关系、空结果、分页错误及滚动保持待补 |
| Issue/地图详情、评论与底部动作栏 | 上游 `DetailsDock:24077`；`prototypes/upstream-port/bottom-action-bar-client.mjs` | 地图详情已见 | 普通 Issue 长正文/评论、底部动作栏、折叠与选择保持待补 |
| 版本管理 | 上游 `VersionControlTab:17110`；`prototypes/upstream-port/version-control-style-client.mjs` | 总览、分支/改动计数/提交框及禁用；本轮文本框焦点 | 变更、历史提交、工作树/同步等实际子视图，以及长路径/diff局部滚动需逐一取样；预检不等于可随意执行写操作 |
| 拉取请求 | 上游 `PrTab:22619` | 已合并 PR 列表 | 加载/空/错误、长标题待补；无需创建或改变 PR |
| 技能列表 | 上游 `SkillsTab:22697`；`skill-source-client.mjs`、`skill-preparation-client.mjs` | 27项与来源/加载入口已见 | 详情弹层见下表，勿因采样安装或更新技能 |
| 环境检查 | 上游 `ChecksTab:23563` | 引用记录未明确实际进入 | 优先安全读取检查结果、成功/当前/失败状态；修复按钮会进入动作链，勿为采样实际修复环境 |
| 设置与更新 | 上游 `SettingsPage:29759` | 后端只读总览、日志入口、更新失败 | 工作区后端总览长内容、更新诊断/变更说明实际可达情况待补；不切换调试、不清日志、不安装更新 |
| 状态与命名建议 | 上游状态界面；`prototypes/upstream-port/manual-naming-view.mjs` | 建议读取、建议输入框/复制/取消入口 | 代码中建议框实际 `readOnly:true`，旧记录称“可编辑建议”不能作为可编辑行为证明；本次不复制、不取消建议 |
| 运行 | 上游 `RunPanel:29957` | 加载提示、打开面板/配置入口 | 当前宿主功能实际可达性由主代理核实，避免打开/改配置作为视觉动作 |
| 沙箱任务：创建表单、任务列表、摘要/日志/diff/检查、分页及操作预览 | `prototypes/sandbox-tasks/view.mjs:54` | 历史DOM读取；旧截图不算沙箱视觉样本 | 首先截图确认确在沙箱页；任务详情、空/错误、长日志可按已有任务只读取证，不创建新任务或清理数据 |

## 弹窗、浮层与内联确认

| 区域 | 源码定位 | 当前证据/安全采集入口 |
| --- | --- | --- |
| 标签配色弹窗 | 上游 `LabelColorDialog:13668` | 已采加载与失败，本轮仍报allowlist相关错误；不将错误文案当根因。可打开后取消，不保存颜色 |
| 技能详情弹层 | 上游 `PixelSkillDetailModal:23220` | 优先从技能列表的详情/名称只读打开，采正文长内容、来源提示、关闭入口；尚无引用的原生弹层证据 |
| 后端选择门、后端切换确认 | 上游 `DetailsDock` 的 `_gateOpen`、`openOverlayGate:24420`、`SwitchConfirmModal:12585` | “切换后端”可先观察打开选择层；不选新后端、不确认切换。某些确认只有真实切换前置才出现，可保持未采并解释 |
| 调试日志菜单与清空确认 | 上游 `data-dsws-logdot` 约19412、`data-dsws-logmenu` 与 `dsws-logconfirm:19469` | 菜单可只读打开，勿切开关、勿清日志。清空确认不必为样本主动触发；先列为未采 |
| 通用表单/多步向导 | 上游 `FormModalSeat:11314`、`modalFormFields:4936`、`openFormModal:11071` | 由环境检查动作链等提供schema，并非每个普通按钮都触发。需先读当前动作描述，避免提交。不可仅凭源码认定“+需求/+bug”打开表单 |
| 版本管理写入进度、远端选择、结果与确认 | 上游 `data-vc-confirm`/`data-vc-remote-choice` 约15990–16030 | 不是所有内容都是modal；部分是内联确认。只在现有可读状态取样，不为采集执行暂存/提交/拉取/推送/切换分支 |
| 地图执行模式选择 | `prototypes/upstream-port/direct-issue-actions-client.mjs:2` 的 `MapExecutionModeDialog` | 当前磁盘代码存在，运行资源是否包含需重核。打开后Escape取消，勿确认覆盖用户草稿。源码有焦点循环和关闭后焦点恢复，但未据此记为原生通过 |
| 沙箱启动、退出后台、合入与清理预览 | `prototypes/sandbox-tasks/view.mjs:70`–108 | 多数为页内预览/确认区，并非独立弹窗。仅已有数据的安全只读预览可采；确认启动/退出/合入/清理均不为视觉样本执行 |
| 动作反馈toast/底栏 | `prototypes/upstream-port/direct-issue-actions-client.mjs`、`bottom-action-bar-client.mjs` | 主代理本轮+bug出现“已请求打开新草稿”，未发送；区别请求成功与草稿读回，不据此宣布目标锁定验收通过 |

`+需求` / `+bug` 在上游源码也是新会话提示词入口（如 `panel.newBugTitle:1236`、`newBugWayfinderText:9087`）；本轮主代理已实测+bug触发新聊天草稿。此前将它们泛指为表单入口的建议已纠正。

## 可继续的采集顺序

1. 环境检查页面只读样本；技能详情弹层与关闭；日志菜单只读展开/关闭。
2. 后端选择层打开/取消（不得确认切换）；地图执行模式层打开/Escape（确认当前运行资源及用户草稿保护）。
3. 已有版本管理各只读子视图、沙箱现有任务详情，补长路径、日志与局部滚动。
4. 整理已有原生200%样本和明暗样本，重核当前加载资源；把320×400精确夹具、未能安全触发的破坏性确认及罕见状态清楚交给后续受控检查/验收，不伪造原生通过。

独立[主题闪烁调查](https://github.com/wozhendeshifwa/matt_pocock_plugin/issues/100)继续暂停，不在本清单复现、诊断或修复；它不阻塞上述静态工作。
