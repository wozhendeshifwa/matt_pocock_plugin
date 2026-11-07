# Codex 版本管理写入验收

2026-11-07；基线 MattSkillsDeck 1.8.0-rc.7，任务「恢复版本管理写入与发布流程」。vendor 保持不变。

适配层开放 `gitStage`、`gitUnstage`、`gitCommit`、`gitPull`、`gitFetch`、`gitPush`、`initPublish`、`retryPush`。继续使用上游预检票据：提交绑定 HEAD/索引指纹，拉取/推送绑定目标，执行前重新核对；requestId 去重。暂存与提交按钮、拉取/推送确认框、发布和半成功重试 UI 均沿用原版。

## 执行边界

- `git-write-gate.mjs` 只接受上游固定 argv 模板，按当前 RPC 方法和项目目录匹配；`-c credential.interactive=false` 与固定 Git 前缀逐字校验。不接受 force、删除 refspec、任意配置、shell、越界路径。工作区若只是父仓库的子目录，写入拒绝；路径经 realpath 校验。
- 请求上下文使用 AsyncLocalStorage；项目内写请求串行。身份仍由 MCP 请求的 thread → project 解析，每次写强制当前 workspaceRoot。read 工具携带写端点仍拒绝。
- 上游 credential-safe env 原样传给进程，undefined 墓碑删除继承变量；禁止 askpass 和交互凭据弹窗。发布流程的 gh 子进程也继承 followTags=false、push.default=nothing、目标 remote.mirror=false；推送不带 force。Windows 超时/退出时只终止仍归本 host 管理的进程树。
- 首次推送、设置或补充 origin、gh 建仓前，将已有 Git common config 备份到项目隔离数据目录的 `git-config-backups`。不修改全局 safe.directory；上游身份缺失兜底改为当次请求的 author/committer 环境变量，不写 user.name/user.email 配置。
- 共享写工具标记 `readOnlyHint:false`、`destructiveHint:true`，推送/发布保留工具审批与原版确认。审计记录方法、命令哈希、结果，不写原始路径、提交正文、token。业务层失败也记为失败。
- Git 网络写请求的 worker/bridge 等待时间延长；安装脚本生成 `tool_timeout_sec = 320`。现有安装需按安装流程应用新配置并重启服务，脚本会备份 config；本票没有改用户的 Codex 配置或切换 provider。

## 证据

`node prototypes/upstream-port/verify-version-control-write.mjs`：真实临时仓库和本地 bare 远端，在 `test-write` 分支验证字面路径暂存/撤销、提交、首次推送、fetch/pull；票据缺失、索引变化、重复 requestId；分叉拉取失败、落后远端时推送被预检阻止；Git config 备份与脱敏审计。该脚本调用 `verify-git-write-ui.mjs`，用生产构建原版组件验证暂存/提交、推送取消/确认、写后状态刷新。

`node prototypes/upstream-port/verify-publish-flow.mjs`：原版 publishFlow + 真实本地 Git + 明确模拟的 GitHub 传输，验证建仓推送半成功、失败重试、成功重试、不重复建仓。没有创建线上仓库，不能当作 GitHub 建仓端到端证据。

`verify-version-control-read.mjs`、`verify-rpc-coverage.mjs`、`verify-write-gate.mjs`、`verify-write-policy.mjs`、`verify-rpc-manifest.mjs` 保留读取、Issue 写闸和 MCP 分流回归。

## 仍待真实宿主验收

真实 Codex 工具审批弹窗、原生窄栏视觉、实际网络凭据失败与线上建仓发布由「完成真实桌面全量验收」核对。自动化 DOM/临时 Git 证据不替代该票。全局 safe.directory 自动修复刻意不开放，属主不一致会保留失败，需要用户在终端处理。
