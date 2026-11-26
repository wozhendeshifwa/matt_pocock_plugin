# 新聊天来源项目绑定修复（2026-11-27）

分支：codex/prompt-injection-fix。此记录只覆盖新聊天项目继承；可靠输入框读回与原子目标保护的完整 #70 规格仍有其他验收项。

## 根因及实现

原先使用 ui/message 的 target:new、send:false。当前宿主公开消息入口仅传预填文本和附件，没有来源项目；新草稿沿用全局项目选择。当前安装版本 26.1120.6357.0 的原生 codex://new 路由接受 projectId、path、prompt、mode；主进程按 projectId 查找已注册项目，再把 project 交给新聊天导航。

新出口改为 MCP ui/open-link 打开上述项目深链接，同一次请求携带由可信当前聊天解析出的项目 ID、项目根及最终文本。当前聊天仍走原生追加请求，不自动发送。缺少链接能力或 projectId、核验时项目身份改变、宿主拒绝时停止；不退回全局新聊天入口，不自动重试。

## 已运行检查

- node prototypes/upstream-port/verify-new-chat-project.mjs：改动前失败，actual ui/message、expected ui/open-link；改动后通过，覆盖项目、目录、完整文本、中文及 URL 特殊字符、无自动发送、项目缺失、能力缺失、项目变化和宿主拒绝。
- 真实构建桥接回归及同项目跨聊天回归通过，检查具体 projectId/path/prompt。
- node scripts/check.mjs：124 文件语法、构建、RPC 清单、写策略、项目切换与全部侧栏检查通过；沙箱 27 通过、1 因 Windows 符号链接权限跳过。

## 部署与验收进度

已备份并部署到当前配置使用的 .scratch/issue62/integration/prototypes/upstream-port，备份位于 .scratch/prompt-injection-deploy/20261127-project-inheritance。

用户明确允许一次服务关闭再启用；已完成并核对 config.toml 与备份 SHA-256 一致。实际继续展开侧栏，发现宿主资源连接仍使用旧客户端（预览说明仍为宿主全局选择项目）。不能将受控检查或部署文件哈希当作原生验收通过。未发送测试消息，未操作其他聊天草稿。等待用户安排宿主重启以加载新资源后继续原生验收。

## 原生失败反馈与参数更正

重启后实际页面已显示来源项目绑定说明。通过正常纯文本预览核验后，ui/open-link 收到 ACK，但原生没有导航。随后核验当前已安装宿主 schema，合法 app mode 为 chat/work/codex；实现误传了 code。现已改为 codex 并重建部署，项目路由及真实生产桥接回归通过。此发现也说明仅检验输出参数和 ACK 不足以代替原生验收；等待更正后最终加载结果。
