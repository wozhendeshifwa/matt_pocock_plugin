# 已验收首版的独立发布

日期：2026-11-27（Asia/Shanghai）。本次只提交并推送已验收改动，不合并默认分支，不重复人工验收。

## 发布范围

- 发布基线：GitHub 默认分支 `codex/render-mcp` 的 `bf5159d7fa3cd18939a811b07cba25164bddae88`。
- 验收来源：`codex/issue62-integration` 的 `0058493`；产品固定点 `7000f52`、生产证据 `cfebf12`。原记录保留在 [最终验收](issue62-final-review-and-acceptance.md) 和 [生产绑定收口](spec61-production-binding-closeout.md)。
- 提取 `65094e5..0058493` 的验收增量，未继承集成分支之前的性能、快照缓存、沙箱界面、评论分页等历史快照。远端既有沙箱保护保留。
- 额外带入该增量直接依赖的技能 `$` 前缀适配器及其回归检查。它提供请求目录所用的技能名，不带入其他基线功能。
- 五处上下文冲突按远端当前结构接入本次功能；构建产物从发布源码重新生成。主工作区未暂存的修改和其他未跟踪文件没有进入发布树。
- 已验收范围包括动作策略、上下文请求、可编辑底栏及复制、来源审阅、27项插件专属参考副本维护。可靠当前／新聊天填入仍按用户决定延期至 #70；未声称宿主实际激活受管技能。

## 发布树验证

重新构建后通过以下自动检查：

- `verify-issue-actions.mjs`、`verify-project-switch.mjs`、`verify-skill-prefix.mjs`。
- `verify-bottom-action-bar.mjs`、`verify-action-drafts.mjs`、`verify-chat-output-availability.mjs`、`verify-reviewed-draft-outputs.mjs`。
- `verify-context-drafts.mjs`、`verify-auxiliary-context.mjs`。
- `verify-skill-sources.mjs`、`verify-skill-updates.mjs`、`verify-request-preparation.mjs`、`verify-production-skill-binding.mjs`、`verify-review-fixes.mjs`。
- `verify-rpc-manifest.mjs`；`node --test verify-protected-draft-outputs.mjs` 的8项测试。
- `verify-skills-page.mjs`：真实MCP至页面的27项技能目录、选中参考正文、只读维护拒绝及固定来源接线。修正了仍预期生产来源未绑定和旧斜杠名称的过期断言；没有改变产品行为。
- `git diff --cached --check`。

技能维护的链接测试在受限沙箱中因创建链接权限失败，随后在主机临时夹具中完整重跑通过。生产联网安装与真实原生界面的人工结论沿用原验收记录，不把发布树的夹具检查当成新的宿主实测。

## PR同步默认分支

创建PR #74时发现，默认分支已在 `27f6065` 经另一条交付路径合入同批已验收功能及补充证据。因此同步该默认分支，产品共享文件以默认分支为准，保留其全部记录和既有实现。本PR的最终净增量只剩本发布记录及 `verify-build.mjs`、`verify-skills-page.mjs` 两份相关检查脚本；不重复覆盖产品代码。

修正旧脚本对已移除的详情“执行”按钮、缺少可靠回执的测试宿主、旧斜杠技能名和“生产来源未绑定”的预期。技能目录改验明确的参考/宿主边界，不要求宿主未知时安装警告消失。同步后重新构建通过，技能页面真实MCP检查通过；构建UI检查用既有快照的临时开放工单副本验证底栏两个受控目标，未改变真实工单或人工结论。GitHub的Windows与Ubuntu检查针对更新后的PR重新运行后再合并。
