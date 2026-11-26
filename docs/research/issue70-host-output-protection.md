# 宿主草稿出口保护（2026-11-26）

关联：[可靠宿主草稿出口与目标变化保护](https://github.com/wozhendeshifwa/matt_pocock_plugin/issues/70)、[底部动作栏与首版验收规格](https://github.com/wozhendeshifwa/matt_pocock_plugin/issues/62)。本记录是代码阶段证据，不是完整产品验收。

## 当前宿主能力

只读查询确认，当前安装且运行的桌面包为 `OpenAI.Codex 26.1120.6357.0`。`PrimaryRuntime 26.1123.915.0` 是独立运行时，不能冒充桌面 UI 版本。

在当前安装包 `app/resources/app.asar` 的静态代码中核验：

- `webview/assets/async/141674.c261c78fc6.js`，offset 39891：`openai/message` 的严格参数仅有 `target: active/new` 和 `send`。
- 同文件 offset 91684：`send:false` 对当前输入执行 append；新聊天调用 fresh-draft 路径；二者均返回 `{}`。
- 同文件 offset 115876：公开消息能力没有草稿读取、条件替换、明确线程锁定或填入结果回执。
- `webview/assets/async/180247.d39a51db31.js` 的 `Y3OQ` 模块，offset 8674：新草稿调用只携带 freshDraft、selectChat、prefillPrompt 和附件，没有明确 thread/project 参数；内部 replace 没有通过 `ui/message` 暴露。
- 新的 `openai/composer/start-source-plugin-draft` 只是来源插件 mention，不能提供输入读取或可靠回执。

未重新触发真实 `ui/initialize`；现有有界捕获已不含当前初始化。上述结论依据当前宿主拥有的静态消息实现，不声称观察过所有运行时实验能力。

## 实施结果

生产 `sidebar-bridge.js` 统一提供 `createProtectedDraftOutputs()` 的拒绝出口：当前没有合格可靠适配器，`active/new/reliableDraft` 均为 false。旧菜单、地图、交接和底栏即使直接调用 `codexActions.prefill`，也不会发出 `ui/message`。拒绝说明草稿已保留，用户可以明确选择复制；不自动改投。

公开保护边界允许受控宿主适配器检验约定行为：已知输入和版本、非空输入明确确认、原子检查来源项目／聊天与输入版本、变更订阅取消、可编辑且未发送的确认回执。返回 `{status:'filled', target, destination}` 仅表示可验证的填入，不表示任务执行。此适配器约定不是给当前 MCP Apps 虚构能力，生产没有创建或注册它。

## 自动化证据

测试使用已确认的“侧栏动作到宿主草稿”高层边界；外部宿主由受控边界替代，不能据此证明真实 Codex 成功填入。

- 生产 bridge 的安全测试先红：旧代码对未知宿主内容仍发消息，出现 `Missing expected rejection`；统一拒绝后通过，并确认发出的消息数量为零。
- 正常受控出口先红后绿：完整可见编辑文本、active/new 区分、`send:false` 和可靠目的地。
- 非空输入取消、未知输入／版本、未确认／不匹配结果、同项目聊天与跨项目变化均先红后绿。
- 补充覆盖写入期间切走再切回的取消、宿主失败、不自动重试／改投、确认后出现新输入的条件拒绝，以及默认／不完整适配器关闭出口。
- `npm run check:host-outputs`：生产 build、8 组宿主保护测试和项目切换 bridge 回归通过。
- `npm run check:issue-actions` 的动作、项目切换和技能前缀检查通过；`verify-context-drafts.mjs`、`verify-bottom-action-bar.mjs` 通过。一次测试命令误用了重复路径，随后按正确路径重跑通过；不把该次命令失败计为产品失败。
- `verify-host-harness.mjs` 已更新为检查无可靠能力时明确拒绝，不能再以捕获发送请求宣称宿主填入成功。本轮未运行该联网握手回放，不能将其列为通过。

## 未满足的真实验收

当前宿主无法通过公开消息接口完成可靠的输入读取、确认替换、原子目标锁定和结果确认。生产拒绝路径及明确复制可以验证，但真实 active/new 的可靠成功必验项仍未通过。

因此票保持 open。后续需要合格的公开宿主能力，再实施真实适配器并用实际 Codex 检验；不得通过制造能力标记、私有桥接、模拟回执或静默降低验收标准来关闭票与父规格。
