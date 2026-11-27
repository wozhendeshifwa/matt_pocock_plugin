# #83：规格聚合正常路径

规格：[#80](https://github.com/wozhendeshifwa/matt_pocock_plugin/issues/80)，实施票：[#83](https://github.com/wozhendeshifwa/matt_pocock_plugin/issues/83)。2026-11-27 用户确认三票图；本票基于集成分支 `codex/issue80-integration` 的 `edd19db`，在独立 `codex/issue80-ticket83` worktree 实施。未改主工作区的用户 GLOSSARY 修改，未部署。

## 行为和数据

- 默认列表仅对已确认原生规格归属的子票折叠；保留完整议题池供搜索、详情、动作、依赖与追踪使用。地图里的规格可以进入主列表，地图决策票继续在地图页；既有地图入口保持。
- 规格详情复用原子票导航，显示真实子票 closed/total，子票保留自身详情及动作并可返回所属规格。搜索包含收起子票，显示所属规格，已关闭子票的搜索结果直接显示。
- GitHub 列表额外分页读取每个 `spec` 规格的原生 `sub_issues`，不以全仓有界列表推断子票完整。每页 100，耗尽短页才认完整，100 页安全上限。
- 元数据附在规格 Issue 行上：`children` 是原生读取到的实际议题数组；`childrenRead.state` 为 `complete` / `partial` / `failed`。只有完整分页耗尽，`total` 才为实际整数；未完整时为 `null`。`partial` 表示至少读到一张子票后失败或达到上限；`failed` 表示没读到子票且未完整。此字段不来自 `deck.partial`。规格闭合后也不能由该闭合状态推断子票完成。
- `panel-payload` 将嵌套子票的 key、state 适配为既有客户端的 number、大写状态；自身身份、后端状态和依赖不变。
- 关闭地图的规格子票保留为普通议题入口，避免父地图关闭后使其消失。

## TDD 与验证

沿用 #80 与用户已确认的列表／详情／搜索高层入口。测试在真实构建客户端 mount 后操作 JSDOM，外部 GitHub API／宿主 RPC 作为系统边界夹具；没有模拟内部模块或断言内部调用顺序。

`verify-spec-list.mjs` 首次运行在“known spec child is folded from default list”失败，然后实现正常折叠和导航。闭合子票搜索直接可见、平铺地图决策票隐藏两个后续切片也分别先红后绿。最终覆盖：地图→规格→两张子票、独立任务、1/2 完成数、双向详情、自身动作、开放与闭合子票搜索归属；真实 `listIssues` 接口跨两页读取 101 子票并给出 complete/101，面板嵌套身份适配。

通过的命令（工作目录 `prototypes/upstream-port`）：

- `node build.mjs`
- `node verify-spec-list.mjs`
- `node verify-issue-actions.mjs`
- `node verify-bottom-action-bar.mjs`
- `node verify-project-switch.mjs`
- `node verify-rpc-manifest.mjs`
- `node verify-write-policy.mjs`

## #84 / #86 下一步

#84 要使用上述完整性字段处理失败／未知／分页不完整的诚实展示、保留子票入口，以及关闭规格仍有开放子票时的未完成列表入口。目前正常详情数值渲染尚未为 partial/failed 写未知文案，不可视为本规格最终验收。规格父票不在有界全仓列表时还需核验归属可达；缓存版号需覆盖父边和完整性变更。

#86 负责旧规格逐张补标及真实 Codex 窄侧栏验收。本票的受控验证不是原生宿主验收，不包含部署或全规格完成声明。
