# #80 集成与验收记录（2026-11-27）

规格：[#80](https://github.com/wozhendeshifwa/matt_pocock_plugin/issues/80)。实施票为 [#83](https://github.com/wozhendeshifwa/matt_pocock_plugin/issues/83)、[#84](https://github.com/wozhendeshifwa/matt_pocock_plugin/issues/84)、[#86](https://github.com/wozhendeshifwa/matt_pocock_plugin/issues/86)。本记录对应独立 `codex/issue80-ticket86` worktree，基于集成分支 `codex/issue80-integration` 的 `05b729c606baa0c792772d80edc005705c72bb98`；正常路径代码为 `2527a2f`，异常与缓存恢复代码为 `05b729c`。

## 当前结论

代码及受控高层检查通过；四张既有规格已仅补 `spec` 标签并读回校验。**真实 Codex 窄侧栏验收尚未完成，#80 与 #86 保持 open。** 用户在界面自动化期间按物理 Esc 停止操作，本轮停止所有桌面／侧栏自动化；未部署、未更新运行侧栏、未重启应用。下述受控结果不能代替真实宿主的可读、可达验收。

上述统一检查是 a169b7a 候选证据。随后双轴审查发现并在独立修复 worktree 修正依赖保留、列表索引及维护边界问题；修复候选的定向检查通过，但最终集成统一检查与原审查者复核仍待 root 完成，不能把此前统一检查外推为修复后的最终结果。

本票将 `verify-spec-list.mjs` 和 `verify-spec-resilience.mjs` 接入仓库 `scripts/check.mjs`，使以后运行统一检查时覆盖新行为；另外清除这两项源文件的 EOF 多余空行。没有新增产品逻辑，也没有为简单接线增加镜像测试。已实际读取 implement-spec、TDD 及两份测试参考，测试沿用 #80 已确认的列表／详情／搜索公开边界。

## 逐项验收矩阵

| #80 验收要求 | 受控证据与结果 | 真实宿主状态 |
|---|---|---|
| 规格、至少两张子票及独立任务的默认列表 | `verify-spec-list`：规格及独立任务可见，确认归属的子票折叠，完整议题池及自身身份保留；通过 | 待验 |
| 全部实际子票、状态及正确 closed/total | 同一脚本：详情显示两张实际子票及 `1/2`，都可打开；真实 GitHub 后端接口搭配外部 API 夹具跨两页读取 101 张，得到 complete/101；通过 | 待验；API 夹具不是线上取数或原生画面 |
| 子票所属规格、返回及独立操作 | 同一脚本操作真实构建客户端：从规格进入子票，所属规格链接返回，自身主动作入口保留；`verify-issue-actions` 与 `verify-bottom-action-bar` 覆盖既有可编辑预览／出口行为；通过 | 待验；未启动真实任务或发送草稿 |
| 搜索命中收起子票并显示所属规格 | `verify-spec-list`：开放与关闭子票均可直接搜索命中，归属明确，关闭结果不藏在未展开区；通过 | 待验 |
| 关闭规格仍有开放子票 | `verify-spec-resilience`：默认未完成列表显示“规格已关闭 · 还有未完成子票”及 `1/2`，后端真实 CLOSED 状态不变；通过 | 待用已补标 #62／开放子票 #70 验证 |
| 规格及子票全部完成遵循既有筛选 | 同一脚本：全完成规格进入原关闭折叠，并能经显式关闭筛选找到；通过 | 待验 |
| 父票缺失、不可读或关系不完整时保留入口 | 同一脚本：缺父、failed/partial/unknown、关系冲突、同号不同 effort、坏行、成功首 100 条后尾页失败均保留可达工作；未知不表示 0/0，只有已证实空集合才显示 0/0；通过 | 待验 |
| 地图 → 规格 → 子票及地图决策票分流 | `verify-spec-list`：地图内规格保留主列表入口、决策票不平铺；`verify-spec-resilience`：map 标签优先，不把地图冒充普通规格；通过 | 待验 |
| 以 spec 标签识别并核对既有规格补标 | root 完成 #60／#61／#62／#44 前后读回，均只新增 spec，正文、状态、认领、其他标签、父边和阻塞边不变；下表与本机回执记录 | 数据迁移已实际完成；更新后的侧栏呈现待验 |
| 高层入口与真实窄侧栏分别验收 | 统一检查已包含两组规格回归；关系／读取恢复会改变公开快照版本，不再错误沿用旧缓存；受控通过 | 原生关系、计数、搜索、独立执行及追踪入口尚未验收，不能关闭规格 |

UI 夹具对照输入对象确认展示没有修改议题状态或关系。这里只验证既有独立操作入口继续存在及既有出口回归；不将“执行”按钮等同于已实际派发独立任务会话，不改变 ADR-0002 的宿主草稿边界。

## 既有规格迁移

root 先读取四票正文、全部评论与关系，确认它们是产品规格，再通过 Deck 逐张仅新增 `spec` 标签。回执 `C:/Users/27263/Desktop/matt_pocock_/.scratch/issue80/migration-receipt.json` 的四项 `unchanged` 与 `labelsOnly` 均为 true；原生子票计数来自独立分页 API 核对，详情见同目录 `migration-context.md`。

| 规格 | 原状态／认领（保持） | 保留的父票／原阻塞边 | 仅增加的标签 | 原生子票 closed/total |
|---|---|---|---|---|
| #60 | closed／wozhendeshifwa | #54／#58 | spec | 2/2：#66、#69 |
| #61 | closed／wozhendeshifwa | #54／#58 | spec | 4/4：#63、#65、#68、#71 |
| #62 | closed／wozhendeshifwa | #54／无 | spec | 4/5：#64、#67、#72、#73 closed，#70 open |
| #44 | closed／wozhendeshifwa | #38／#43、#42 | spec | 0/0：原生已核实为空 |

#60／#61／#62 原 `ready-for-agent`、`wayfinder:task` 及 #44 原 `wayfinder:task` 标签保留。没有重开已关闭规格或地图，也没有关闭 #70、移动议题或改写依赖。

补标后 root 另用 GitHub 原生 API 独立复核，上述四组子票及状态仍与表中一致。#80 当前原生子票为 #83 closed、#84 closed、#86 open，完成数 `2/3`；#83 无 blocker，#84 的 blocker 为已关闭 #83，#86 的两个 blocker 为已关闭 #83／#84。该实时票图不是运行侧栏已经显示正确计数的证明。

## 实际运行的检查

从本票 worktree 根运行 `node scripts/check.mjs`，退出码 0。该次运行提升了执行权限，以避开此前沙箱的 Windows msys `NtCreateDirectoryObject 0xC0000022`；提升运行成功并不覆盖先前失败记录。

- 127 个 JavaScript 文件语法检查通过。
- 沙箱回归 28 项：27 pass、0 fail、0 cancelled、1 skipped、0 todo。唯一 skip 是 Windows token 不具备符号链接权限的既有测试；没有将其声明为通过，也没有用本轮结果声称已补跑 Linux Docker 场景。
- 构建、新规格列表／详情／搜索及异常恢复两组回归通过。
- 项目身份／聊天切换、RPC 56 端点 manifest、写策略、当前／新聊天未发送草稿请求、旧动作、聊天出口状态、linked worktree 项目归属与资源版本回归均通过。这些名为 native 的脚本仍是受控自动化，不能代替真实宿主验收。
- 另外运行 `node verify-issue-actions.mjs` 和 `node verify-bottom-action-bar.mjs`，退出码均为 0。
- 本票工作差异 `git diff --check` 通过；提交后的 `git diff edd19db...HEAD --check` 另行核对整段集成差异。

完整日志位于本机主工作区 `.scratch/issue80/`：`issue86-full-check.log`、`issue86-issue-actions.log`、`issue86-bottom-actions.log`。完整检查日志 SHA-256：`13e73866b72831ca1d2bca24998a491861a2023bba400d88e9e03345679a5e05`。没有向仓库提交本机完整运行日志。

## 未完成的下一步

1. 初次双轴审查候选 a169b7a 发现 2 项规范问题及 1 项依赖保留代码问题；单一修复 worktree 已完成定向修复，详见 `issue80-final-review.md`。root 仍需合入修复、让原审查者定向复核并在最终集成 HEAD 重跑统一检查；本记录不提前声称最终审查通过。
2. 用户恢复界面操作授权后，按已有备份／差异预检流程更新侧栏，并确认宿主加载本次构建；当前没有执行部署。
3. 在真实 Codex 窄侧栏核对 #80 的三张实施子票及独立任务、双向详情／正确完成数、收起子票搜索、关闭 #62 与开放 #70、独立操作及追踪入口可读可达，记录真实构建与宿主证据。
4. 必需验收满足后才关闭 #86 和 #80。#80 无所属地图，不因此修改 #75 或其他地图。主工作区用户 `GLOSSARY.md` 修改和其他任务 worktree 均不属于本票。
