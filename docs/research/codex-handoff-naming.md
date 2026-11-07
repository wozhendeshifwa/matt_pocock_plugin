# 接手与命名适配状态

2026-11-07，实施票「恢复接手与命名流程」。

上游交接按钮的第一击注入 `/handoff` 提示词，由用户发送后的 agent 在项目 `.scratch/handoff` 生成文件；第二击通过 `handoffLatest` / `handoffResolve` 扫描真实文件，再预填新聊天读取路径。后端不生成交接正文，也不在这个 RPC 中认领 Issue。原有策略误将 `handoffResolve` 记为 GitHub 写入，本次修正分类；保留现有 RPC 读写工具划分以免改变调用方契约。

Codex 的 `send:false` 草稿不返回创建的聊天 ID，当前适配也没有会话改名和真实事件订阅服务。用户于本轮明确选择“提供手动命名建议”。状态页提供查看、复制、取消；不调用改名 API、不生成自动执行计划。`namingPlan` 返回 `manual:true`、`enabled:false`（自动能力）和 `suggestions`；`cancelNewSessionWatcher` 仅取消当前手动建议；自动注册、信号与改名结果仍拒绝。

`upstream-host.mjs` 使用精确限定父模块与 specifier 的 Node 模块解析钩子，将原版 host 的 `namingGuardian` 依赖替换为无后台副作用的服务。启动、刷新、工具内部调用均不会加载原版守护或恢复旧命名缓存。vendor 文件保持逐字不变。

手动建议只来自 `state_5.sqlite` 可验证的现有聊天。MCP 服务端使用本次请求解析出的 thread ID，忽略 payload 自报的 sessionId；缺会话或其他项目返回空建议。标题合成复用上游 `naming-titles.js`。`deck_issue_create` 返回真实票号后，只为该建票请求所属的真实聊天记录映射；本地记录失败不改变建票成功结果，避免重复创建。取消状态保存在项目数据目录的 `manual-naming.json`，跨重启生效；其他建议不受影响。复制前重新核对当前建议，聊天切换后不复制旧建议。

命名提示与操作支持 en/zh 实时切换，后端不返回固定中文能力文案。认领 argv 归 `deck_issue_patch`，不再归只扫描文档的 `handoffResolve`。

自动化证据：

- `verify-handoff-naming.mjs`：真实文件系统及原版 host，覆盖空目录、最新文件、精确/前缀匹配、目标缺失不回退旧文件、项目隔离；旧缓存不加载原版 guardian、不改旧文件；手动建议/取消/重启/缺会话/建票映射。
- `verify-handoff-view.mjs <snapshot.json>`：构建后的原版组件在 JSDOM 中，交接按钮产生当前聊天草稿，接手按钮产生包含文件路径的新聊天草稿；手动建议查看/复制/取消，en→zh 实时切换。这里的 RPC 和草稿接收器为测试夹具。
- `verify-manual-naming-mcp.mjs --github`：真实 MCP 路由、payload sessionId 不能覆盖宿主身份、计划/取消/读回；在测试仓库实际调用 `deck_issue_create` 后验证建议映射真实票号（本轮测试票 12 已关闭）。
- `verify-write-policy.mjs`、`verify-write-gate.mjs`、`verify-rpc-manifest.mjs`、`verify-rpc-coverage.mjs`：策略、命令闸、端点及 MCP 读写路由。`verify-locale.mjs` 真实 MCP 语言切换通过；首次沙箱运行 GitHub 网络不可达，允许联网后重跑通过。
- 当前真实项目已生成 `.scratch/handoff/20261107-143000-000-handoff-naming-review.md`，含真实 Issue 与聊天身份；通过原版 `handoffResolve` 解析并读回核对。它是当前 agent 生成的实际交接文档，不是静态测试 fixture。

命名验收已按用户选择实现为可查看、可取消的手动建议。真实文档生成、后端解析与读回已有证据；但尚未观察用户在原生侧栏点击交接、发送草稿，并在另一个真实聊天完成接手。该票保持 open，不用 JSDOM 或当前聊天读回冒充这一步。最终原生视觉也仍归桌面全量验收。
