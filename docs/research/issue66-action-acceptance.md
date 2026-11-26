# 主动作与场景草稿验收

关联：[标签组合与主动作场景草稿](https://github.com/wozhendeshifwa/matt_pocock_plugin/issues/66)，规格为[标签驱动策略](https://github.com/wozhendeshifwa/matt_pocock_plugin/issues/60)。

2026-11-26，实施分支 `codex/issue66-main-actions` 基于集成分支现有运行基线；原工作区不变。列表、详情和新会话入口共用请求策略及轻量预览；底部 B 布局和完整草稿生命周期由关联交互规格接入，本文不将轻量预览当作 B 布局完成。

## 自动化证据

运行 `npm run check:issue-actions`（port 目录）通过：真实生产构建、React DOM 中点击动作、修改预览并捕获当前／新聊天请求及剪贴板系统边界；项目切换与不自动发送桥接契约；27 技能前缀及 46 个双语模板回归。

16 个场景包含 needs-info + bug、wontfix + bug、bug + research／grilling、prototype、多状态、多个具体类型、map 角色冲突、task 类型冲突、缺规格与实施票、缺就绪状态、人工接手、无关标签、无标签、未知标签，以及详情页 bug 动作。三出口保留最终编辑文本。读取列表和点击选择动作均不产生宿主草稿请求。

TDD：首个 needs-info + bug 高层测试在旧实现上因无预览失败；接入生产适配后通过。wontfix 禁止默认调用 triage 的回归先红后绿。测试针对用户可见语义，不锁定提示词全文；它只能证明草稿携带自主查证要求，不证明模型实际决策正确。

Fresh Windows checkout 的 vendor 为 CRLF，旧构建精确 LF 锚会失败；构建读取后统一换行，再应用原有严格锚校验，源文件与 integrity hash 均保留原始内容。

## 待验收

- 真实 Codex 宿主可编辑、不自动发送、真实聊天路由及系统剪贴板：待关联交互与宿主出口集成后实测。
- Agent 对多状态、多类型、查证与技能加载的实际行为：待有原始来源的会话验证，未以字符串测试冒充。
- B 布局、草稿项目隔离、已有宿主输入保护、目标变化保护：由交互规格负责，不在本实施票宣称完成。

未安装、未部署、未更新技能、未发布 PR。本记录只证明实现与自动化层进展。
