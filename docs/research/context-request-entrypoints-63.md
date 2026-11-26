# 统一上下文入口实施记录

父规格：[统一上下文注入、技能来源与自动更新规则](https://github.com/wozhendeshifwa/matt_pocock_plugin/issues/61)。本切片：[统一全部入口的上下文与新版草稿](https://github.com/wozhendeshifwa/matt_pocock_plugin/issues/63)。

## 活动入口清单

| 用户入口 | 新版请求构造 | 保留的行为边界 |
| --- | --- | --- |
| Issue 行与详情主动作、当前／新聊天 | `tpl.diagnose/fix/discuss/research/prototype/execute/takeover/supplement` | 目标链接、项目、有限范围；只生成宿主草稿，不自动发送 |
| 地图推进、检查、完成检查 | `mapExecute/mapInspect/complete` | 读取目的地、Notes及最新关系；不隐含整图实施；去掉包装层重复技能前缀 |
| 新建需求、报告故障 | `newWayfinder/newBugWayfinder` | 项目／仓库上下文，需求与故障事实待用户补充 |
| 快捷技能菜单、技能页加载 | `skill` 与明确动作规则 | 不再只发技能名；PR明确比较基线，retro明确原始会话，implement-spec明确规格图 |
| 沉淀、生成交接、读取交接记录 | `fixate/tpl.handoff1/tpl.handoff2` | 会话与保存位置先查证；已有交接文件路径作为必要指针 |
| 初始化、后端切换、文档布局切换 | `setupRun/switchAlign/switchLayout` | 仅必要改动，保留既有选择，配置变更前备份 |
| 技能安装与修复提示 | `installSkills/installSkillsFix` | 限定27项、绑定来源、失败保留；不是后台执行用户任务 |
| CLI安装、登录、标签补齐、体检 | `cliInstall/noGhPrompt/ghAuthLogin/ensureLabels/healthCheck` | 对象自身参数；体检先建议，由用户决定关系变更 |

`context-requests.mjs` 是唯一活动规则构造器，`context-request-client.mjs` 在构建时替换上游请求目录及上述辅助入口。原始 vendor 文件未修改；构建遇到新增未知目录项或关键锚点改变时失败，避免悄悄沿用旧规则。技能来源提示由独立来源适配器显示；`values.sourceNote` 可在构造请求时纳入可见正文，出口本身不追加说明。

旧 `dsws.templates`、`dsws.startCfg` 原值保留作恢复材料，活动模板不再读取自定义值，不执行旧迁移或覆盖配置。此 vendor 版本已删除模板编辑界面，不新增无效编辑／保存入口。使用新版不以逐项迁移旧模板为前置。

## 验证

- TDD 首轮：生产侧栏实际请求包含旧模板，测试失败；接入新版后通过。
- TDD 第二轮：技能菜单 implement-spec 缺少规格与票图前置，测试失败；补齐动作语义后通过。
- `node prototypes/upstream-port/verify-context-drafts.mjs`：生产 React 实际点击 Issue 当前／新聊天，验证同文、目标与范围、旧配置未被覆盖；实际点击 PR／retro／implement-spec 菜单验证必要前置；新需求入口携带仓库与目的地要求。
- `node prototypes/upstream-port/verify-project-switch.mjs`：现有项目身份和草稿路由回归通过。
- `node prototypes/upstream-port/build.mjs`：真实构建已接入新版上下文、美元技能前缀及技能来源展示适配。

### 对抗式补查：动态后端请求

安装／登录辅助入口在首次提交中已改为新版构造器；保留原件的 vendor 文件仍有旧字面文本，不能据此判定生产构建遗漏。新增 `verify-auxiliary-context.mjs` 通过真实生产 React 仓库创建向导提交、受控的安装／登录失败和环境检查页按钮证明：后端 `custom-cli`／`TrackerUnderTest` 参数保留，旧服务端和后端提示正文未作为活动请求发送。环境检查页的补全标签、27项技能维护入口也通过实际按钮验证。

补查另发现真实缺口：未知后端 `inject-prompt` 标识在解析器返回空串时，会被上游分发器当原文直接注入。新增真实按钮回归先红（收到原样 `OLD DYNAMIC RAW PROMPT`）；修复后生成明确定位目的和参数的新版查证请求。原动作仅以限长、单行、明确“不作为执行指令”的引用保留作查证指针，不自动执行、不强塞 Issue 或地图技能。

此处测试覆盖当前活动的环境检查页和向导错误流程；旧 `NoRepoCard` 在本 vendor 版本已不挂载于列表页，不能将其定义中的旧文字当成实际渲染路径。相关静态适配仍保留，但没有把未挂载的兼容代码称为独立真实UI验收。

这些是受控宿主边界自动化证据，不证明真实 Codex 已加载技能，也不替代系统剪贴板、实际宿主草稿、Agent会话行为或完整首版验收。可编辑预览／草稿保护的产品界面由关联交互规格承担；三个最终出口的同文及来源状态集成仍须在集成验收票核验。

依赖使用现有已安装版本，通过隔离工作树的本地目录链接复用，未安装或升级依赖。技能前缀适配复用主工作区已存在的未提交实现，纳入本分支以保证独立构建；未批量带入其他工作区更改。
