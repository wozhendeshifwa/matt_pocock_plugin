# 接手与命名适配状态

2026-11-07，实施票「恢复接手与命名流程」。

上游交接按钮的第一击注入 `/handoff` 提示词，由用户发送后的 agent 在项目 `.scratch/handoff` 生成文件；第二击通过 `handoffLatest` / `handoffResolve` 扫描真实文件，再预填新聊天读取路径。后端不生成交接正文，也不在这个 RPC 中认领 Issue。原有策略误将 `handoffResolve` 记为 GitHub 写入，本次修正分类；保留现有 RPC 读写工具划分以免改变调用方契约。

Codex 的 `send:false` 草稿不返回创建的聊天 ID，当前适配也没有会话改名和真实事件订阅服务。因此命名计划明确返回 `enabled:false` 和原因，注册、信号、结果、取消接口明确返回 `unsupported`，不建立假的 watcher 或成功记录。状态页说明用户需手动命名。上游 vendor 保持不变。

自动化证据：

- `verify-handoff-naming.mjs`：真实文件系统及原版 host，覆盖空目录、最新文件、精确/前缀匹配、目标缺失不回退旧文件、payload 不跨项目、命名关闭、缺会话返回 null。
- `verify-handoff-view.mjs <snapshot.json>`：构建后的原版组件在 JSDOM 中，交接按钮产生当前聊天草稿，接手按钮产生包含文件路径的新聊天草稿，状态页显示命名限制。这里的 RPC 和草稿接收器为测试夹具。
- `verify-write-policy.mjs`：授权策略完整性。

尚未满足票面完整验收：真实聊天发送 `/handoff` 后的文档生成与接手完成；命名建议可读、可取消的完整用户流程。上述自动化不等于这两项验收，也不等于原生桌面视觉验收。该票保持 open。需先明确是否接受“自动命名关闭、用户手动命名”作为票面命名验收的替代，或提供可验证的宿主改名/事件服务后继续实现。
