# #84：关闭规格与异常关系的工作入口

规格 [#80](https://github.com/wozhendeshifwa/matt_pocock_plugin/issues/80)，实施票 [#84](https://github.com/wozhendeshifwa/matt_pocock_plugin/issues/84)。基于集成提交 `2527a2f`，独立 worktree / 分支 `codex/issue80-ticket84`。未更改主工作区、用户 GLOSSARY、配置、生产运行目录或议题状态。

## 已交付行为

- 关闭规格仍有开放子票时，默认列表继续保留规格入口，显示“规格已关闭 · 还有未完成子票”，同时显示实际 closed/total。保留真实 CLOSED 状态；显式“已关闭”筛选仍可找到该规格。全部子票完成后沿用原关闭折叠和筛选。
- 规格读取 failed、partial 或未获得明确完整证明时，完成数显示未知／不完整，不输出 null、0/0 或全部完成暗示。关闭规格的子票读取未完成时也保守保留入口。
- 子票折叠需要同 effort 的带 spec 标签普通规格、完整的原生子票集合及该集合中明确包含此票。父票缺失／不可读、集合读取失败／不完整、旧 parentKey 与本次集合不一致时保留子票；搜索与自身详情、动作和返回规格入口仍可达。wayfinder:map 优先于 spec，不把地图当普通规格。
- GitHub 原生子票分页遇坏行或重复身份时不再认完整；逐行保留后续有效票，保留此前成功页。仅正整数 number、明确 open/closed 状态的实际议题参与已知集合。任何损坏或尾页失败都使总数为 null；有已知子票时为 partial，无已知子票时为 failed。
- 快照 validator 新增 parentKey、childrenRead 及嵌套子票身份／状态／标题签名。原生关系变更和读取恢复不一定改变 GitHub issue.updatedAt，强制 refresh 后仍需改变版本，避免后续条件请求继续持有旧投影。

## TDD 与检查

已加载 implement-spec、tdd 及 tests.md / mocking.md；沿用用户已确认的列表／详情／搜索高层边界。新增 `verify-spec-resilience.mjs` 使用真实构建客户端、真实 GitHub 后端和公开 composeSnapshot；仅宿主 RPC、GitHub API 是系统边界夹具，不 mock 内部协作者。

先红后绿的具体失败：关闭规格进入关闭折叠；failed 读取仍错误收起子票；公开快照在读取恢复时版本相同；坏行导致后续有效票丢失；本次原生集合不含该票但旧 parentKey 仍使其消失。

回归覆盖：partial / unknown 计数；真正空集合可显示 0/0；全完成规格关闭筛选；缺父票；同号不同 effort；map + spec 标签优先级；failed 时子票自身动作与返回规格；100 条首成功页后尾页失败；parentKey 单独变化的公开快照版本。UI 场景对照输入对象，确保展示不修改后端状态及关系。

本 worktree 下通过：

- `node build.mjs`
- `node verify-spec-resilience.mjs`
- `node verify-spec-list.mjs`
- `node verify-issue-actions.mjs`
- `node verify-project-switch.mjs`
- `node verify-bottom-action-bar.mjs`
- `node verify-rpc-manifest.mjs`
- `node verify-write-policy.mjs`
- `git diff --check`

## 后续边界

本票受控场景已经通过；未部署，未执行或声称真实 Codex 窄侧栏验收。#86 继续负责四张既有规格补标、仓库 check 接入、最终集成与真实宿主检查；#80 不能以本票测试代替完整验收。读取上限仍为每规格 100 页，达到上限保守视为不完整。
