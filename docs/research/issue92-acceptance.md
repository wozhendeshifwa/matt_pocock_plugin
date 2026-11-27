# #92 直接提示词注入验收记录（未完成）

本记录承接规格 #82、决策矩阵 #78 与地图 #75。只汇总实际执行的检查及待验项，不将受控边界、磁盘产物或宿主请求回执作为原生成功证明。#82／#92 保持开放，#70 可靠读回、条件写入及原子目标保护的标准和状态不变。

## 构建及证据范围

- 初次整体验证基于 `codex/issue82-integration@e38f1d58c4238aeac534d711413ae5eb92cca6f0`；本票在同一提交创建独立 `codex/issue92-validation` 工作树。未合并并发推进的主树或其他规格。
- 本机 Codex `26.1120.6357.0` 仅为协调者已有静态核验事实，不是本构建已在该版本加载或成功的证明。
- 高层接缝沿用 #82：实际生产侧栏列表／详情操作 → 来源准备 → 宿主草稿／剪贴板边界。高层回归使用真实编译生产 UI；来源、宿主请求、剪贴板及延迟由受控边界提供，不读取私有 Map 证明业务结果。
- 协调者通过 IAB 观察同一生产构建的受控预览：480px 明色、320px 深色；320px 时文档 viewport／scrollWidth 均为 320，动作区 clientWidth／scrollWidth 均为 295，未横向溢出；旧面板匹配数为 0。更多动作选择 `$code-review` 后仅出现改动范围／比较基线，缺字段禁用，补齐启用，取消收起。来源、宿主和剪贴板均模拟，预览页明确标识，不是原生验收。浏览器 viewport 已恢复，预览页及其自有进程已关闭。
- 当前真实连接仍指向有既有用户改动的 issue62 服务，未覆盖、重建或切换它。隔离候选入口／配置片段位于主树 `.scratch/issue82/context/candidate/`，尚未写真实配置或启用；其语法检查不代表实际加载。

## 原始受控记录索引

以下脚本由根 `npm run check` 登记执行，所有路径相对 `prototypes/upstream-port/`。来源、场景细节与 red → green 记录另见对应文档。

| 记号 | 原始检查／文档 |
| --- | --- |
| A | `verify-direct-issue-actions.mjs`；`docs/research/issue85-direct-current-actions.md` |
| N | `verify-direct-new-chat.mjs`、`verify-new-chat-project.mjs`、`verify-native-draft-injection.mjs`；`docs/research/issue87-direct-new-chat.md` |
| R | `verify-direct-recovery.mjs`、`verify-reviewed-draft-outputs.mjs`；`docs/research/issue88-direct-recovery.md` |
| M | `verify-more-issue-actions.mjs`；`docs/research/issue89-more-actions.md` |
| L | `verify-legacy-draft-copy.mjs`、`verify-action-drafts.mjs`；`docs/research/issue90-legacy-draft-copy.md`、`test-fixtures/README.md` |
| F | `verify-bottom-action-bar.mjs`；`docs/research/issue91-final-footer.md`；上述协调者受控浏览器观察 |
| P | `verify-issue-actions.mjs`、`verify-chat-output-availability.mjs`、`verify-native-legacy-actions.mjs`；既有 #60／#61 动作与来源规则 |

历史原文夹具通过归档旧 renderer 的公开 UI 准备旧文字，再经公共 ModuleLoader 切换最终 renderer，保留同页 runtime；未新增生产调试接口或刷新／重启持久化。

## #78 的 U／I 证据矩阵

“受控通过”只指对应可观察边界；要求原生的行仍未完成。下表不是交付全通过清单。

| ID | 本构建受控证据与结果 | 原生证据／剩余步骤 |
| --- | --- | --- |
| U1 | F：A 正文／评论后正常流双按钮、相邻反馈及紧凑次动作通过；明暗受控观察通过 | 待实际加载候选观察最终布局 |
| U2 | F／L：旧编辑器、预览、更新／清空／常驻来源／重核验移除；历史状态保留通过 | 待原生观察，最终编辑／清空仅在专用宿主草稿验证 |
| U3 | A／N／R／M／L：列表／详情参数化入口和相同生成／出口行为通过 | 待原生列表／详情抽查 |
| U4 | M／R／P：最新标签主动作、手选更多动作与记忆不覆盖默认、不自动执行通过 | 矩阵本项要求受控；不据此宣称真实 Agent 已执行技能 |
| U5 | M／F：按需字段、必需项缺失禁用、取消保留字段通过；浏览器字段可用性观察通过 | 待真实窄栏控件及输入法可用性 |
| U6 | M／L：同项目同 Issue 跨聊天复用，项目／Issue／仓库／后端／effort 隔离通过 | 待原生代表场景；不声称重启恢复 |
| U7 | A／N／R：主动复制与对应完整生成文本一致；未知／失败保留文本及无自动复制通过 | 待系统剪贴板代表场景逐字核对 |
| U8 | L：历史手写 Unicode／换行／尾随空格原样复制、失败保留、与当前文本及项目隔离通过 | 待真实系统剪贴板及仍存旧文本代表场景；不主动生成或清理用户历史 |
| U9 | F：明色480px／深色320px受控观察通过，窄布局无横向溢出；不计为真实最窄可用宽度 | 尚缺380px、实际最窄／常用原生宽度、缩放、中文输入候选及关键操作可达的完整组合证据 |
| I1 | A／N：完整文本的 active 请求、未发送参数及无中转确认通过 | 真实空／非空／手写草稿、原文保留、空行分隔、完整可编辑且未发送均待验；没有用替身拼接文本冒充追加行为 |
| I2 | N：来源注册项目与实际 cwd 分开；根／linked worktree／子目录请求、中文／换行／URL文本保留通过 | 三类目录都须原生核验归属、实际目录、完整文本及未发送；原聊天草稿不搬走亦待验 |
| I3 | N：缺项目身份／cwd／链接能力禁用，具体能力原因、主动复制和无全局回退通过 | 待实际宿主适用能力观察；禁用路径不能代替新聊天成功证据 |
| I4 | N／R：正常新聊天导航不误报切换或取消成功，ACK只显示已请求通过 | 待正常原生导航；无可靠 destination token 时不能可靠区分同项目同cwd的预期新聊天与切到已有聊天，仍只报 requested，不据此声称严格保护 |
| I5 | A／R：正常后台核验、来源变化暂停及明确再生成、必要资料缺失停止请求通过 | 最终审查发现缺必要条件反馈丢失具体补齐原因，修复及受影响回归待补；原生代表场景及实际加载仍待验 |
| I6 | R／P：相关标签改变推荐动作则停旧请求，再点才执行；无关标签不打断通过 | 本项要求受控，不将标签名称注入当实际技能加载 |
| I7 | R／L：同侧栏跨动作／工具栏等待、主动复制仍可用、浏览换票与原 Issue 反馈归属通过 | 待原生代表路径；不声称跨窗口全局去重 |
| I8 | R／N：准备期间来源聊天／项目／实际目录改变则不发旧请求，重试不静默改投通过 | 受控检测不等于宿主原子条件写入 |
| I9 | R：请求后可观察的项目／目录变化和transport丢失标为未知；不补发／清理／称撤回通过 | 待原生可观察路径；同项目同cwd目的聊天不可可靠辨别的能力边界见I4 |
| I10 | A／R：可靠替身确认／ACK／未知／明确失败分支通过；native-only误报filled也不升级可靠性 | 待核对真实宿主的实际回执与可见文本；生产仍为requested／reliableDraft=false |
| I11 | R／A：具体宿主失败、保留文本、未知先检查及明确重试重新核验／不改投通过 | 待原生代表路径；来源补齐方法缺口见I5，不因此虚报本项覆盖所有错误原因 |
| I12 | P／R／M／L：既有状态／类型、上下文／来源规则与受影响链路回归通过 | 实际加载与Agent技能执行须可追溯原生会话；当前无该证据，不以技能名或磁盘文件冒充 |

## X3 与共同构建边界

#82 已有实现和受控证据，但实际候选加载、原生项目／目录／完整未发送文本尚未取得，因此 X3 的 #82 部分未完成。#81 的主题分支 `codex/issue81-integration@35cb8e3` 是另一工作线，本票没有擅自合入；#92／#95 最终须复用同一组合构建的证据。X1／X2／X3 共同结果仍待组合构建及对应受控／原生验收，不将 #82 单独结果记为全部共同通过，不互设新阻塞。

人工在原生输入框看到文本只能作为本次验收证据，不能把生产适配器升级为 reliableDraft，也不能替代 #70 的机器可靠读回、条件写入或原子目标约束。

## 本次最终检查及下一步

2026-11-27，`e38f1d5` 上完整 `npm run check` 退出 0：132 个顶层 JavaScript 语法检查通过；sandbox 28 项中 27 通过、1 跳过、0 失败；生产构建及全部 18 个登记侧栏检查通过。跳过项为 `retained untracked symlink shows its link value without reading its host target`，原因是 Windows token 无符号链接权限，需在已核验 Linux Docker 镜像另验，不算通过。执行环境使用获准的宿主权限，复用主树已有 node_modules 的 Junction；未改依赖配置、provider、真实 MCP 配置或服务。

同提交另做隔离 `createSidebarServer({dataDirectory:临时目录,changeDirectory:false})` smoke：`initialize`、`resources/list`、`resources/read` 及工具声明的资源 URI 一致，完整资源包含最终直填／再生成操作且无旧编辑器标记，通过。返回 `ui://deck-sidebar/board-02aafe0f39f23697.html`，HTML 2,502,433 bytes，SHA-256 `681d90cf0d392e6a95a4cb0838d884a7ea4f6281ab465c8dfe9955ea45539021`。进程 cwd 不变；仅创建并清理自有临时状态，未连接 Codex、未写候选 state 或真实配置、未调用宿主。此项证明该提交的工厂可供给完整 MCP 资源，不能证明原生实际加载。

最终代码审查修复并合入后，仅重跑受影响路径并说明适用提交；保持此记录对初次整体验证和后续差异复验的区分。随后须经明确授权的隔离候选连接，先验证实际加载，再用专用验收草稿完成上表原生待验项。禁止自动发送、覆盖／删除无关草稿、自动重试／改投／复制。缺必要证据不关闭 #92／#82。
