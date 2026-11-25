# Sandcastle：Windows 运行环境与 Codex 认证路径

日期：2026-11-26（Asia/Shanghai）。对应决策研究：[研究：核实 Sandcastle 的 Windows 运行环境与 Codex 认证路径](https://github.com/wozhendeshifwa/matt_pocock_plugin/issues/47)。本文只提供事实及验证边界，不选择安装、付费或认证方案。

## 固定研究基线

上游固定为 [mattpocock/sandcastle 的 commit 1b380ca5e7a9fbece96c49d9edba264c1f512c4e](https://github.com/mattpocock/sandcastle/commit/1b380ca5e7a9fbece96c49d9edba264c1f512c4e)，该提交的 [package.json](https://github.com/mattpocock/sandcastle/blob/1b380ca5e7a9fbece96c49d9edba264c1f512c4e/package.json) 声明 npm 包 `@ai-hero/sandcastle`、版本 `0.14.0`、MIT 许可。版本来自源码；未安装 npm 发布包，未验证源码与发布物一致。

## 可行性结论

保留当前 Windows 项目路径时，Docker/Podman 是上游明确提供的本机候选，但本机运行环境尚未证实可用。WSL2 + Bubblewrap 要求 Linux 文件系统，不能把当前 C 盘项目经 `/mnt/c` 直接代入。Codex 的 ChatGPT 认证存在官方 headless/Docker 路径，但 Sandcastle 不自动继承宿主登录；本次不能承诺现有桌面登录可直接复用，也不能据此断言必须购买 API Key。[上游沙箱说明](https://github.com/mattpocock/sandcastle/blob/1b380ca5e7a9fbece96c49d9edba264c1f512c4e/docs/guide/sandbox-providers.md)、[OpenAI 认证说明](https://developers.openai.com/codex/auth/)

## Windows 候选对比

| 路径 | 上游明确支持及限制 | 对本需求的结论 |
| --- | --- | --- |
| Windows + Docker | Windows 原生 init 提供 Docker；绑定宿主项目，Codex 镜像模板基于 Node 22 并安装 Git 和 Codex CLI | 不要求按 WSL 方案搬迁项目；需要另验 Docker daemon、Windows 路径挂载、Git worktree 和项目工具链 |
| Windows + Podman | Windows 原生 init 提供 Podman，生成 Containerfile，提供构建命令 | 同属保留路径候选；本机可用性和 VM/挂载行为未验 |
| WSL2 + Bubblewrap | 必须在 WSL2 内运行，仓库放 Linux ext4，不能 `/mnt/c`；沙箱隐藏 Windows 互操作，不能运行 Windows exe | 与当前 C 盘项目直接运行的约束不符；需搬迁或额外同步设计，交用户决策 |
| noSandbox | 官方存在，但不提供隔离 | 不满足本需求“沙箱任务”，不能当不可用时的自动降级 |

依据：[init 平台选择](https://github.com/mattpocock/sandcastle/blob/1b380ca5e7a9fbece96c49d9edba264c1f512c4e/docs/guide/init.md)、[沙箱与隔离边界](https://github.com/mattpocock/sandcastle/blob/1b380ca5e7a9fbece96c49d9edba264c1f512c4e/docs/guide/sandbox-providers.md)、[Codex 镜像与初始化源码](https://github.com/mattpocock/sandcastle/blob/1b380ca5e7a9fbece96c49d9edba264c1f512c4e/src/InitService.ts)。

隔离不能等同无网络：上游原生沙箱网络开放，可访问宿主 localhost。Docker/Podman 在 Windows 提供 VM 边界；Git worktree 的分支隔离与进程/文件沙箱是两层独立约束。费用也应拆开：Sandcastle 的 MIT 许可不代表容器产品许可、云沙箱或模型调用免费；本研究未选择付费产品，未核查具体商业套餐。[沙箱说明](https://github.com/mattpocock/sandcastle/blob/1b380ca5e7a9fbece96c49d9edba264c1f512c4e/docs/guide/sandbox-providers.md)、[MIT 许可](https://github.com/mattpocock/sandcastle/blob/1b380ca5e7a9fbece96c49d9edba264c1f512c4e/LICENSE)

## Codex 认证与 provider

上游 `codex(model, options)` 通过 `codex exec --json -m <model>` 启动代理；支持 effort、env、会话捕获和 approvalsReviewer。API 没有专门的 ChatGPT 登录继承开关，也没有专门的 model_provider 配置参数。默认跳过 Codex 自身审批/沙箱，依赖外层隔离；auto_review 会调整其审批参数。[AgentProvider 源码](https://github.com/mattpocock/sandcastle/blob/1b380ca5e7a9fbece96c49d9edba264c1f512c4e/src/AgentProvider.ts)

Sandcastle init 的 Codex `.env.example` 明确使用 `CODEX_API_KEY`，不是自动读取桌面登录。原生沙箱使用独立 private home，宿主 `.codex` 默认隐藏，凭据注入与宿主配置继承必须明确设计。[InitService 源码](https://github.com/mattpocock/sandcastle/blob/1b380ca5e7a9fbece96c49d9edba264c1f512c4e/src/InitService.ts)、[原生沙箱登录边界](https://github.com/mattpocock/sandcastle/blob/1b380ca5e7a9fbece96c49d9edba264c1f512c4e/docs/guide/sandbox-providers.md)

OpenAI 官方支持 ChatGPT 登录；headless 环境可用设备码，备用方式包括把文件认证缓存传入 Docker。缓存可能存在系统凭据库而非文件，且令牌需要刷新。因此这些是官方候选路径，并非 Sandcastle 当前默认配置已通过的证明。API Key 按 API 计费，区别于 ChatGPT 套餐额度。[OpenAI 认证说明](https://developers.openai.com/codex/auth/)（访问时重定向到 ChatGPT Learn 的认证页）

尚未确认：当前桌面登录使用何种缓存、现有账户是否允许设备码、沙箱内凭据持久化及刷新、Codex CLI 版本兼容、DeepSeek fallback 配置如何最小暴露给沙箱。未读取任何凭据或 provider 配置文件。后续必须保留现有 OpenAI/DeepSeek 配置，不以删除或覆盖它们解决适配。

## 当前机器只读证据

在当前 Windows PowerShell 会话检查命令解析、版本、有限安装路径和服务；没有安装软件、登录、复制凭据或运行真实代理。

| 检查 | 结果 | 能证明什么 |
| --- | --- | --- |
| `node --version` | `v26.13.0` | 当前会话可调用 Node；不证明沙箱工具链通过 |
| `git --version` | `2.55.0.windows.5` | 当前会话可调用 Git |
| `codex --version` | `0.171.0-alpha.13.2`，来自 WindowsApps 的 exe | CLI 可调用；有临时 PATH alias 清理/创建权限警告；不证明 Linux 容器内可用 |
| `Get-Command docker,podman,bwrap` | 无匹配 | 不在当前 PATH；不能证明整机从未安装 |
| 常见 Docker/Podman exe 路径、Docker/WSL 相关服务查询 | 无返回项 | 有限范围未发现；不作完整安装审计 |
| `wsl.exe --list --verbose` | 受限环境返回“系统无法访问此文件”；扩大权限的只读复查最终返回“没有注册类”，`Wsl/CallMsi/Install/REGDB_E_CLASSNOTREG`，退出码 -1 | 本次 WSL 查询失败，未能列出发行版；不能宣称 WSL 可用，也不能据此断言没有历史安装 |
| 目标项目 | `C:\Users\27263\Desktop\matt_pocock_` | 当前是 Windows 路径，不符合上游 bwrap 的 Linux ext4 前提 |

## 集成接口与分支事实

官方 `run()` 支持 AbortSignal 取消代理和 hooks，保留 worktree；文件日志支持 text/toolCall/raw 实时事件。结果返回 stdout、提交 SHA、分支、迭代及日志路径，可配 structured output。公共 API 不是独立任务服务，本次未找到持久任务 ID 查询、队列或宿主重启恢复契约；这些应由插件方案定义。[run API](https://github.com/mattpocock/sandcastle/blob/1b380ca5e7a9fbece96c49d9edba264c1f512c4e/docs/guide/run.md)、[日志](https://github.com/mattpocock/sandcastle/blob/1b380ca5e7a9fbece96c49d9edba264c1f512c4e/docs/guide/run-logs.md)

Docker 等 bind-mount 默认 head（直接写宿主），隔离云 provider 默认 merge-to-head（自动合并）；必须显式选择分支策略才能形成用户预期。branch 使用独立命名分支/worktree；merge-to-head 冲突会中止合并并保留分支。dirty worktree 可保留；会话 resume/fork 不等于任务崩溃恢复，并发 fork 需要不同分支。[分支策略](https://github.com/mattpocock/sandcastle/blob/1b380ca5e7a9fbece96c49d9edba264c1f512c4e/docs/guide/branch-strategies.md)、[代理会话](https://github.com/mattpocock/sandcastle/blob/1b380ca5e7a9fbece96c49d9edba264c1f512c4e/docs/guide/agent-sessions.md)

## 最低验证步骤（后续实施，不是本次执行）

1. 用户决定是否允许补齐 Docker/Podman，或接受 WSL Linux 路径方案；先验证选定运行时和无代理的隔离探针，检查 Windows 路径、Git/worktree、工具链与清理。
2. 用户选择 ChatGPT 认证候选或另配 API Key；对 ChatGPT 先验证沙箱专用登录/缓存、刷新和失效提示，不默认挂载整个宿主 `.codex`；不输出令牌。
3. 使用独立测试仓库和明确分支策略，验证启动、日志、取消、失败现场、结果分支；认证失败不得切换到无沙箱执行或静默换付费路径。
4. 单独验收宿主重启后的任务状态和遗留沙箱处置；这些不是官方会话 resume 自动保证的能力。

本文完成事实研究；实际沙箱运行、登录复用、费用选择和用户验收均未完成。
