# 原生直接填入主按钮配色修复

范围：#109 对 `4777a3d` 具体候选的原生静态验收发现；规格沿用 `native-visual-design-spec-2026-11-28.md` 的中性主动作反色约定。本子任务使用主代理本轮实际生成的 matt `issueActionRequest` 提示词，读取随包 implement-spec、本地 tdd 完整规则及引用作为只读备用；未声称宿主加载 Skill。

## 原因和改动

主代理先核对实际面板三个资产与候选一致，再观察列表直接填入主按钮仍为浅紫底白字。生产 `DirectIssueActions` 的 `.dsws-btn.primary` 带行内 `background: colorHex`；普通 stylesheet 的中性背景规则无法覆盖它。既有基础探针仅检查没有此行内色的评论发送按钮，遗漏了实际列表／详情直接填入控件。

仅将 `theme.css` 中 shell 主按钮基础背景及其 hover 背景加 `!important`。文字颜色、边框、禁用规则及语义状态变量不变；后置禁用背景优先级仍有效。没有修改事件、草稿请求、RPC、桥接、主题通知时序或任务执行。

## 红绿与验证

公开接缝为生产 `MattSkillsCodex.mount` renderer + 实际 `theme.css` → 真实 Chromium。新增宿主 `codexActions` 夹具提供真实公开能力边界，pending 通过其 Promise 控制；所有填入均在隔离浏览器夹具内完成，不触碰用户草稿。

- 首次缺宿主能力时控件是禁用态，因此该失败不作为目标缺陷证据。补齐公开宿主能力后，真实目标红灯为 `list direct-fill primary uses host inversion in light: rgb(192, 132, 252)/rgb(242, 237, 226)`。
- 基础背景改动后，原有真实指针检查又报 `primary hover visibly changes host inversion`，补齐对应 hover 优先级后通过，没有放宽断言。
- `node prototypes/upstream-port/verify-native-visual-foundation.mjs`：明暗非默认宿主色下，实际列表／详情直接填入主动作的中性背景、文字、真实 Tab/Shift+Tab 焦点、实际 pointer hover、请求 pending 的禁用配色和恢复均通过；既有评论发送和宿主别名／兜底检查继续通过。
- `node prototypes/upstream-port/verify-native-visual-surfaces.mjs`：既有 82 布局／状态通过。
- `node prototypes/upstream-port/verify-version-control-style.mjs`：320/380/760 代表宽度、明暗 Git 语义色与局部 diff 滚动通过。`DECK_TEST_HOVER=1` 同探针：VC 确认主按钮与实际评论发送主按钮的真实 pointer hover 表现一致。
- `git diff --check` 通过。上述 Chromium 命令因本机 CDP 所需权限在获准沙箱外运行。

本子任务未构建、提交、部署、重启服务或修改实际可见面板。主代理须将修复纳入新候选，在资源哈希匹配后重新核对原生直接填入按钮，再决定 #109 验收和整合；上述受控通过不替代原生结论。
