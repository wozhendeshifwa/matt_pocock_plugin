# 地图工具的原生关系写入

2026-11-07，实施票：[恢复地图工具的原生父子与依赖写入](https://github.com/wozhendeshifwa/matt_pocock_plugin/issues/24)。

固定 vendor 1.8.0-rc.7 的 `lib/tracker/backends/github/graph.js` 实际先调用 `gh issue edit --parent/--remove-parent`，老 CLI 报 unknown flag 才回退 REST `sub_issues`。依赖使用 REST `dependencies/blocked_by` 的 POST/DELETE。票面最初所说的 GraphQL mutation 不是该基线的实现；不开放任何 mutation。旧 `classifyWriteCommand` 对 parent/dependency 模板都返回 null，导致建票成功却无法建边。

## 实现与边界

- `graph-write-gate.mjs` 精确匹配上述原生旗和 REST 模板，拒绝额外参数、跨仓库路径、非安全整数 ID、任意 mutation。
- 只有 `deck_issue_create`、`deck_map_plan_create`、`deck_map_link` 的 MCP 工具执行上下文能授予关系写入。继续使用宿主对这三个写工具的审批边界；读 RPC 或其他端点没有这种授权。没有新增可由调用者传入的 approved 参数。
- `node-host.mjs` 把工具 cwd 固定在所属 worker 的 workspaceRoot；写前通过上游 `deck_context` 的实际 backend selection 取得 repo，不接受工具参数指定仓库。每次操作独立建 AsyncLocalStorage scope，不沿用上一次 repo 或数据库 ID。
- REST 外键只接受同一次操作中，成功且未截断的 `gh api repos/<selected-repo>/issues/<number> --jq .id` 读到的 ID。跨仓库读取、失败读取、上一操作的 ID 不构成授权。原生旗按当前仓库票号操作。
- 地图工具与已有 Git/RPC 写入共用每项目串行写队列。关系读/写和最终 evidence 仍由上游执行；保留部分失败、幂等锚、读回与续跑语义。所有实际关系写入沿用 argv hash 审计，不存正文、标题、token 或原始参数。

vendor 逐字未改。适配没有新增 UI，也没有改动 Codex 或 provider 配置。

## 验证

- `node prototypes/upstream-port/verify-graph-write-gate.mjs`：三个工具的原生旗与 REST 模板、无来源/跨仓库 ID、错误工具上下文、越界参数与 mutation 的拒绝。
- `node prototypes/upstream-port/verify-graph-writes.mjs`：新 stdio MCP 服务 + 临时项目/会话 + 真实测试仓库 `wozhendeshifwa/codex_mattskills_plugin`。通过三个地图写工具建父子与阻塞边；独立 REST 查询核对；关闭 blocker 前后核对 frontier；重挂父票、替换/删除依赖、重复调用不重复建边；不存在 blocker 返回非 ok，实际边未改变；脱敏审计通过。
- 成功全链夹具：测试仓库票 17（map）、18（blocker）、19（dependent）、21（extra）。夹具已关闭保留证据。此前一轮票 13–16 的关系检查也通过，但脚本漏写审计路径中的 `projects`，在审计读取阶段失败，修正后重跑上述全链。
- `verify-write-gate.mjs`、`verify-write-policy.mjs` 通过；`verify-version-control-write.mjs` 通过真实临时 Git + 本地 bare 远端与原版生产 UI，不代表线上发布。
- `verify-issue-writes.mjs` 通过真实评论、标签改色、绑定、生产评论表单、关闭/重开及审计。其旧断言“Git 写入尚未开放”已改为当前的“未提供写票据必须拒绝”；unsupported 更新端点仍拒绝。
- `build.mjs` 通过。`verify-build.mjs` 需要 snapshot/detail 两个文件参数，无参数调用不构成验收；本票用上述生产 UI 回归作为界面不退化的证据。

真实 Codex 桌面审批交互和最终视觉/点击验收继续归「完成真实桌面全量验收」。本票的自动化证据不代替该验收，也不接管其他会话认领的工作。
