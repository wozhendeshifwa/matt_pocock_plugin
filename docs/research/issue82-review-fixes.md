# #82 最终审查修复：具体阻塞原因与补齐方法

基于 `codex/issue82-integration@e38f1d5`，独立工作树 `review-fixes`。最终 Standards 审查没有代码发现，Spec 审查发现一项 P2：必要条件未满足时，直接操作只显示笼统提示，丢失已核验的原因及补齐方法，违反 #82 决策 5。

## 修改

来源准备的公开结果增加 `blockingReasons`：只摘取现有 `execution.reasons` 中非空字符串，附技能名；没有诊断时给出查证来源、工具和资料的补齐提示。不输出规则正文、完整来源对象或 JSON。

直接动作采用本次 `check` 的最新诊断，在按钮邻近反馈显示。主动作与更多动作共用此路径；仍先停止宿主请求，保持不自动改投、重试、复制或发送。没有重建旧面板，没有改原生适配器或 #70 标准。

## Red → green

沿用 #82 已确认的生产侧栏 → 来源准备／宿主与剪贴板边界。列表／详情、主动作／更多动作共四个场景：第一次准备返回旧原因，最终核验返回「缺少 GitHub 工具授权；请连接 GitHub 后重试」。

- 修改前，主动作场景失败：可见反馈只有「必要来源、工具或资料未核验，请先补齐」，缺少具体原因及补齐方法。
- 修改后，四个场景均显示最新具体诊断，不显示旧原因，宿主出口与剪贴板调用均为 0。

## 实际检查

2026-11-27：生产构建及以下受影响回归通过：`verify-direct-issue-actions`、`verify-request-preparation`、`verify-more-issue-actions`、`verify-direct-recovery`、`verify-bottom-action-bar`、`verify-legacy-draft-copy`、`verify-direct-new-chat`。`git diff --check` 无错误；工作树生成产物的 Git 换行提示不是检查失败。全量验收由 #92 独立记录，不无理由重跑未受影响模块。

本修复只取得高层受控证据；真实候选构建尚未在宿主加载，原生仍待 #92。未改现用服务、配置、provider、主树用户改动或 GitHub。
