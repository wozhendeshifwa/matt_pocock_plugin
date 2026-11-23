# Render 免费服务受控重新部署与连接恢复

2026-11-24 北京时间 05:02–05:06，对既有 `deck-relay-44` 完成了一次受控、运行代码不变的重新部署。新部署达到 **live**，HTTPS `/healthz` 返回 `200 / ready / version:1`；原本机只读组件在旧云实例正常 drain 窗口之后仍为同一唯一实例、`connected`、`writeEnabled:false`。没有创建服务、改计划、改配置或触发业务写入。

这证明实际平台重新部署和本机连接恢复。主任务随后通过实际已连接的 Codex MCP 工具完成 `deck_context` 首 call，返回正确项目与仓库。本实验没有发送 SDK 业务读取或模拟宿主身份；这些证据不证明免费服务自然闲置 15 分钟后的休眠冷启动，也不替代真人审批或最终界面验收。

## 触发前的固定边界

使用 Render connector，明确传入此前已确认的 workspace `tea-dc24efmc6qcc73ccllt0`；未切换 workspace、未调用 CUA。

| 项目 | 触发前核实结果 |
| --- | --- |
| 服务 | `deck-relay-44` / `srv-dc27rs3rjlhs73ehvlv0` |
| 来源 | `https://github.com/wozhendeshifwa/matt_pocock_plugin`，branch `codex/render-companion-44` |
| 计划、自动部署 | runtime plan `free`；autoDeploy `no` / trigger `off`；单实例配置 |
| Build | `node --check prototypes/remote-companion/relay.mjs` |
| Start | `node prototypes/remote-companion/relay.mjs` |
| 原 live | `dep-dc28n26c6qcc73eqt6ag`，commit `cee163b8208dfc3849f017dde1587a3393eb4a05` |
| 原 service.updatedAt | `2026-11-23T18:53:27.696466Z`，与原 live 同期，没有后续配置更新时间 |
| 目标远端 HEAD | `70aa02f91dd5670b805c8862fe9e187faf4f8910`；通过 `git ls-remote` 和 GitHub `git/ref/heads/...` 独立读取一致，触发前再次核实 |

首次带编码 slash 的 GitHub `branches/...` 请求返回 404；后续以固定原始 ref 路径及 ls-remote 双重确认，不把它误记成分支缺失，也未据失败触发部署。

Connector 没有 restart 或 commitId 参数，因此使用唯一可用的 `trigger_deploy(clearCache:false)`。正式触发之前比较两个固定 Git 对象的全部运行 import 闭包：

| 文件 | 字节数 | 两个提交共同的 SHA-256 |
| --- | --- | --- |
| `prototypes/remote-companion/relay.mjs` | 12,870 | `070a848f760b019f8e3bc68868d94e1745fc4b68c7311b1b03949f984d7eed47` |
| `prototypes/remote-companion/protocol.mjs` | 3,345 | `9354d0b97be1278b325c788fed6b96257bc9f9e2b768527919da687d5cebb2eb` |

闭包仅这两个文件和 `node:http`、`node:crypto`、`node:url`，没有 dynamic import、require 或新的外部运行依赖。根目录 package/lock/render.yaml/node version/npm 配置在两个提交均无新增差异；build/start 命令与原记录相同。旧、新实际 build 的固定日志均报告环境 `NODE_VERSION` 选择 **26.13.0**。

这不是 Render Dashboard 的“Restart service”特殊同 commit 操作：新部署 commit 是已暂停 push 的当前分支 HEAD，运行文件字节与旧 live 完全一致，仓库中其他非云运行文件可以不同。未读取或变更服务环境变量秘密；平台部署事件另外报告 `envUpdated:false`。

## 实际平台与本机观察

本表时间均为 UTC，换算北京时间加八小时。

| 时间 | 观察 |
| --- | --- |
| 21:01:54 | 本机原只读组件 pid `32148`、instanceId `43ea57a5-d3a2-42be-9bd0-d301dff2134f`，running/connected/unique，writes disabled；18 个 bundle 文件 hash 匹配。 |
| 21:02:16 | 部署前 healthz：200、ready、version 1。 |
| 21:02:49 | 只触发一次 `clearCache:false`；返回 `dep-dc2ajucipgvc7389odg0`，commit 精确为 `70aa02f91dd5670b805c8862fe9e187faf4f8910`。 |
| 21:03:01 | build `bld-dc2ajucipgvc7389odh0` 事件 succeeded。 |
| 21:03:12 | 新实例 `srv-dc27rs3rjlhs73ehvlv0-dlzkx` 输出唯一固定应用 marker `Deck relay ready (protocol 1)`。没有请求正文日志。 |
| 21:03:15 | 新 deploy live，deploy_ended=succeeded；旧 `dep-dc28n26c6qcc73eqt6ag` 转为 deactivated。 |
| 21:03:26 | 部署后独立 HTTPS healthz：200、ready、version 1，约 2.0 秒。服务原 healthCheckPath 为空，Render 使用原默认 TCP 检查；没有把本次独立 HTTP 探测说成已配置 Render HTTP 检查。 |
| 21:04:29 | 超过文档正常 60 秒 drain 窗口后，本机仍为同一 pid / instanceId，最新心跳、connected、unique、writes disabled，18 个 bundle hash 仍匹配。 |
| 约 21:05–21:06 | 主任务实际调用 `mcp__deck_remote_companion__deck_context` 成功，ok/status ok；返回真实 thread `01a20973-bdb8-7682-bfd2-13690078c98c`、项目 `c:\users\27263\desktop\matt_pocock_` 与仓库 `wozhendeshifwa/matt_pocock_plugin`。这是实际插件只读工具，非 SDK 假身份；时间为主任务报告的约值。 |

本机 pairing、provider 配置和 DPAPI cloud credential 封套的前后 SHA-256 均未变，没有解密 caller token、重配对、启写、停止或重启本机组件。进程唯一性来自精确 pairing 文件参数匹配的 Win32_Process 只读清单，不凭单一 PID 判断。报告及 metadata 没有保存 credential、ciphertext、请求正文或 Render 用户邮箱。

21:04 的新实例分钟级内存样本为 `73,236,480` bytes，平台 limit 为 `536,870,900` bytes；旧实例 `...-p99bv` 只有 21:02–21:03 点。这是普通恢复后的分钟采样，不能外推为极限峰值或资源压测。`instance_count` metric 返回空数据，因此不据它推断实际云实例数量；服务配置仍为 numInstances=1，本机进程则另行核实唯一。

触发前后未见本次窗口的 `server_failed`、`pipeline_minutes_exhausted` 或暂停事件；runtime plan 仍为 free，buildPlan 的原值 starter 也没有调整。未读取账单剩余额度或证明零潜在超额费用，没有付费、换 plan 或自动升级；费用边界沿用既定“实际超限再告知，由用户决定消费”。

## 证据与未外推范围

所有新文件位于 `.scratch/render-redeploy-44/`：

- `preflight.mjs` / `runtime-preflight.json`：两个固定 Git 对象的逐字节 import 闭包与 build 输入比较。
- `before-deploy.json` / `trigger.json`：最后核实的服务配置、远端 HEAD、旧部署、部署前 health 和唯一 trigger 返回。
- `platform-observations.json`：脱敏平台事件、新实例 marker、live 状态、Node version、health 与首批 metrics。
- `postdrain.json` / `local-*.json`：新旧部署状态、恢复后 metrics、本机实例与配置指纹。
- `host-recovery-attestation.json`：主任务实际 Codex MCP `deck_context` 读回的结果摘要与来源说明，不保存原请求正文。
- `observe-local.mjs` / `inventory.ps1`：只读 bundle、心跳、精确 pairing 参数的进程清单；不调用 stop/start。
- `official-deploys.md`：本次实际获取并阅读的官方部署文档。另实际读取 [官方健康检查文档](https://render.com/docs/health-checks.md)，按其新部署就绪与 running health 语义判断。

工具接受 trigger 本身没有被当作成功；已等到指定 deploy live 并验证 HTTPS health、本机状态和新平台进程 marker，随后主任务实际宿主只读首 call 也通过。原本机生产仍是已安装的只读 bundle，并未以当前候选替换。本报告不声称自然休眠冷启动、真实 Windows 登录自启、人工批准或写授权恢复已经验证。
