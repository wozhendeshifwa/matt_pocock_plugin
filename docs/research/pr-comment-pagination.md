# PR 评论分页修复与验证

对应 [恢复 PR 评论超过 50 条时的分页](https://github.com/wozhendeshifwa/matt_pocock_plugin/issues/32)。2026-11-23；本次只提交该票修复，原有工作区改动保留。

## 原因与适配

有两个串联缺陷：详情查询支持 PR，但续页固定查询 `issue(number)`，对 PR 报 notFound；即使续页数据正确，固定客户端仍只渲染 `commentsNodes.slice(0,50)`。

宿主适配通过受边界校验的加载钩子，替换 legacy GitHub 评论读取函数：`issueOrPullRequest` 联合查询同时覆盖 Issue 和 PR；原 handler 仍负责项目身份与其它后端分发。数字偏移仅供 REST 详情回退续页使用，50 对应第 2 页；不透明游标只走 GraphQL，失败不悄悄改成 REST 页号。返回结构不完整、游标无进展、权限、对象不存在、限流和网络错误均明确失败；网络最多重试一次。

客户端构建适配去掉评论显示的前 50 条截断，并修正已显示计数；不改 vendor、不新增 PR 写操作、不改项目隔离或草稿语义。构建前的本地 dist 备份在 `.scratch/issue32-before-dist/`；重建沿用当前已有的其它构建适配。

## 可复跑验证

在 `prototypes/upstream-port/` 运行：

```powershell
node verify-comment-pagination.mjs --baseline
node verify-comment-pagination.mjs
node verify-pr-page.mjs --pagination
```

第一条是有意保留的原 vendor 反例：PR 续页因 notFound 失败。第二条通过实际详情/评论 handlers，在传输边界注入确定性响应，验证 PR 和普通 Issue 的 50/50/1 顺序、完整性与终止；并在已构建客户端 DOM 中连续点击加载更多到第 101 条，确认末页没有加载更多、PR 无评论输入框。它还覆盖空评论、权限、不存在、限流、网络/游标/JSON 错误、有限重试、REST 页号和并发项目隔离。这是源码/构建产物与 DOM 验证，不是原生桌面人工验收。

第三条是隔离仓库现有 PR 的在线 MCP/面板验证，会串行准备 101 条带本轮标记的评论、与独立 REST 读回比较，并清理本轮创建的评论。创建遇到拒绝不重试，避免非幂等写入。

## 本次结果及限制

- 修复前 handler 测试实际失败于 PR notFound；修复后 PR/Issue 50/50/1 通过。
- 客户端修复前 DOM 实测只出现前 50 条，评论计数到 100 而第 100 条不可见；修复后 DOM 验证通过到 101。
- 15 项扩展回归已执行：首次沙箱内 12 项通过；本地 Git 写/模拟发布/会话数据库三项环境受限，沙箱外复核均通过。脚本语法检查通过。
- Standards 与 Spec 两轴审查；发现的测试清理问题已修正。新增客户端变更另行复审。
- **在线 101 条验收未通过**：首轮批量创建遇到 GitHub `was submitted too quickly`，该轮数据已清理；第二轮串行创建途中再次中断，此后 gh 和 Windows HTTPS 客户端读/删均返回连接 EOF。另一次真实宿主握手回归因 GitHub 快照 EOF 超时，未计为通过。
- 通过独立 GitHub 连接器再次确认，专用测试仓库 `wozhendeshifwa/codex_mattskills_plugin` 的 PR 10 留有 6 条第二轮测试评论，标记 `pr-pagination-32-38684-`。待网络恢复后仅删除以下已核对的 ID，再复跑在线验收：`7105627407`、`7105629555`、`7105631627`、`7105633671`、`7105635631`、`7105639840`。未把失败的删除请求记为清理成功。

当前结论：代码与确定性面板回归完成；在线验收及上述清理仍未完成，issue 保持开放，不宣称全量验收通过。
