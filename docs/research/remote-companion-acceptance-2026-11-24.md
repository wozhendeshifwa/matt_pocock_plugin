# 远程连接层实施：阶段验收

日期：2026-11-24，Asia/Shanghai。关联[正式实施规格](https://github.com/wozhendeshifwa/matt_pocock_plugin/issues/44)。规格保持 open；当前是可验证的只读连接候选，完整系统未交付。

最新 AFK 检查点：v4 冻结候选450文件，manifest `fc0fd6325f929f6cc03f5deb3071d1ea7621e6f71db554714f6ec510322594f1`，尚未安装生产。根代理全量217/217回归无skip，另caller启动器11/11；两项规格P2已修并实证，详见[双轴复核](remote-checkpoint-review-2026-11-24.md)。18/22写方法已有本机实现，六tracker正在专用私有仓库实测；不等于全部真实宿主写验收。稳定目录已在owned夹具演练v3备份迁入与双v4目录连续读回，未迁移真实main业务。旧固定bf58877只读组件在UTC19:40恢复，19:43真实宿主context暖恢复通过；[自然冷启动仍未证明](remote-cold-start-acceptance-2026-11-24.md)。

## 前置审查修复

探针审查的 P2 在提交 `d20a3a0` 修复并推送：脱敏插件/marketplace 模板、环境变量认证、生成器及[复现步骤](../../prototypes/remote-compat-probe/REPRODUCE.md)。根代理独立复跑全新 CODEX_HOME 安装认证验收及 9 项原测试全部通过；未改旧探针运行代码/真实配置或重部署旧服务。

## 本机候选及防护

正式分支 `codex/render-companion-44`，连接层初始提交 `22980fb5f8b9f5ca5a3537b4cfce8bce7539512e`。随后新增冻结与启动前核对：当前实际 adapter/vendor 的 450 项静态文件已登记并读回，不复制 node_modules、运行数据或凭据。

候选由主工作区当前源生成，不以旧分支 adapter 替代。只在副本的 `project-worker.mjs`、`snapshot-cache-identity.mjs` 应用 `choices-data-root-v1`，改为读取真实 worker dataRoot 的 choices 指纹。主工作区两个源文件及其他 WIP 未覆盖。旧函数在相同隔离调用 seam 下失败，候选修正通过。许可证、VERSION、技能 YAML/脚本纳入清单，未省略原有静态技能资产。

本机忽略目录：`.scratch/frozen-adapter-20261124-choices-v1`（相对本实施 worktree）。清单摘要 `9409bb077951e53821417dc4420923925c993c0910408fa9aaa7bc89cea2fc47`。配对固定该目录、摘要及 adapter，启动前逐文件校验；错误摘要在连接前拒绝。候选仍标记 `userAccepted:false`，不冒充全部功能已验收。

执行记录绑定配对/聊天/可信项目，移项目后不会返回旧结果；转发使用独立 delivery id 和 fingerprint，迟到回包拒绝。两项回归在临时副本撤掉对应修复后均按预期失败。静态 UI 不重复写进执行数据库，结果缓存有大小/时长限制，未知与完成记录保留防重放标记。

## 实际 Render 部署

| 项目 | 读回结果 |
| --- | --- |
| 工作区 | 已确认的 My Workspace，`tea-dc24efmc6qcc73ccllt0` |
| 服务 | `deck-relay-44`，`srv-dc27rs3rjlhs73ehvlv0` |
| 部署 | `dep-dc27rsbrjlhs73ehvn90`，live |
| 云端代码 | `22980fb5f8b9f5ca5a3537b4cfce8bce7539512e`；仅 relay 运行，不运行本机业务 |
| 入口 | <https://deck-relay-44.onrender.com/mcp> |
| 计划 | free、Singapore、单实例、autoDeploy off |

三个随机凭据独立生成；Render 仅有 caller/device/session 连接凭据，不是 GitHub 业务凭据。本机恢复材料用 Windows DPAPI CurrentUser 密封保存在忽略目录；不记录明文或密文。未修改原探针服务，不创建付费资源。

真实控制台确认 Hobby、无银行卡、免费小时 1.42/750、带宽0/5 GB、pipeline0/500分钟，构建额外开销上限本来为 $0、当前及预计费用 $0；未更改该设置。用户要求继续免费，实际遇到超额再说明费用并由用户决定，不自动升级。长轮询本机在线时会消耗免费小时；测试后本机实例已主动停止，避免闲置持续请求。

## 已执行验收

1. **21项本机隔离检查通过**：官方 SDK → HTTP → companion → 真实 stdio 的握手/工具/UI/重启；认证分离、项目和过期请求、迟到回包、未知结果不重放；真实 Windows DPAPI、状态/停止/撤销、隔离 Startup 快捷方式；冻结漂移拒绝与 choices 修复。
2. **实际 HTTPS 链路通过**：健康200、缺认证401、device不能作caller、错误Origin403；SDK initialize、16工具、原 UI 资源、本机真实当前聊天的项目归属、56 RPC 清单、旧 expectedThreadId 拒绝。本轮 SDK 手工携带了当前真实聊天的标识，**不是实际 Codex 插件宿主元数据端到端验收**；未对真实项目或 GitHub 写入。
3. **新客户端声明的隔离安装通过**：`deck-remote-companion@deck-remote-companion-44`、0.1.0、streamable HTTP、环境认证、provider哨兵保留、无token缓存、拒覆盖；shortDescription 已缩短满足长度约束。
4. **实际私有插件已安装**：安装前备份真实 config，所有原 provider 块原样保留，新插件仅引用 `DECK_COMPANION_CALLER_TOKEN`，旧插件保留。未自动重启宿主，当前进程尚未加载新插件/环境。

本机私有备份、加密凭据、配对、journal、HTTP验收原始摘要及启动脚本均在本 worktree `.scratch/relay-44-secrets` 或相邻忽略目录；不上传这些文件。启动脚本只允许用户先完全退出 Codex 后手动运行，通过 DPAPI 取得 caller 凭据供新进程继承，不设置永久环境，不自动关闭用户程序。

## 下一验收闸门

用户使用准备好的本机脚本重新打开 Codex后，验证新插件真实工具/侧栏、同/异/无项目与旧请求、主题和active/new可编辑草稿。脚本会先启动已固定基线的本机只读组件，不安装真实登录自启。

远程写入保持拒绝；仍需验证原工具审批与本机写闸跨远程有效，隔离项目/仓库的完整写行为及未知写入核对、云端撤销/恢复、长休眠/客户端超时、实际登录自启与更新回退、全量业务和最终用户确认。当前没有理由关闭正式规格或地图，也不把免费 relay live 当完整交付。

## 实际 Codex 客户端补证

用户随后按准备脚本重新打开客户端，本机状态 `connected`、运行中；桌面新进程从北京时间 02:07 左右启动。新插件的 `mcp__deck_remote_companion` 工具真实出现在本聊天，直接调用 `deck_context` 和 `deck_issue_get` 成功：工作区和仓库均匹配本项目，当前聊天身份匹配，正式规格仍 open。这里是实际宿主请求，不是手工构造 `_meta` 的 SDK 回放。此前普通重启但未运行脚本时，组件未运行且新工具缺失，没有把该阶段当连通。

用户明确要求由 agent 完成展开后，已将新插件打开到右侧栏，并从 MCP Apps 的新插件页面直接检查：

| 项目 | 实际结果与界限 |
| --- | --- |
| 看板与详情 | 仓库链接正确，地图与正式规格显示，规格正文/进度/评论与关系可读取；不是静态截图 |
| 技能 | 27 项随包技能可见，Wayfinder 详情实际加载；这是原随包内容显示，不改变 agent 优先使用全局技能的规则 |
| 本机 Git | 显示真实主工作区 `codex/checks-recovery` 和当时 43 个未暂存文件；不是云端克隆或实施 worktree。没有点击暂存、提交、推送 |
| 主题 | 当前实际 dark 信号应用到页面，DOM colorScheme=dark、背景rgb(16,19,26)；本轮未做新的浅/深动态切换，不外推该场景 |
| 当前聊天草稿 | 操作前输入框为空；点击规格的执行动作后，真实可编辑输入框出现该规格的完整提示词，未发送 |
| 新聊天草稿 | 点击新会话后，真实新草稿页面出现提示词及 `matt_pocock_` 项目选择；输入框可编辑，未发送，不再仅依赖宿主RPC响应判定项目继承 |
| 回到原聊天 | 用官方导航返回本聊天，原测试草稿仍在，没有自动清空或删除；新草稿也未发送 |

尚未重做同项目另一聊天、跨项目、无项目、动态主题、长休眠和完整写行为等正式组件场景。原探针的前置证据不自动升级为这些场景的正式链路通过。测试草稿留给用户处理；生成的提示词是待发送内容，不是 agent 自动执行的新指令。

### 下一实现切片

已识别出仅按 MCP session/request id 防重不足：重连或另一聊天会有新 operation id。下一切片为安装级稳定本机 SQLite 的项目写屏障，跨 thread/session/pair 阻止未决写；保存必要类型化目标以便本机核对，迟到完成仍能记账。它不以 `confirmation` 审计字段冒充宿主签名，不把“没有查到结果”当未执行，不提供远程 `confirmed:true` 清屏障。先在隔离项目验证限定写能力，真实配对仍保持只读。

## 安装级写屏障与派发绑定补证

安装级 ledger 已接入本机执行链，限定的本机试验 grant 只含 `gitStage` / `deck_issue_report`，且必须同时明确启用、列出绝对项目根和方法。实际配对未改，仍只读。原始审批 annotations、RPC 读写路由、expectedThreadId 和本机命令/路径门保留，没有新增确认框或生成批准凭证。

真实临时 Git + 假 Codex 索引复现了原链路的竞态：同一聊天在本机授权后移到 B，适配器再次解析聊天，可能暂存 B 却把 A 记成功。修复仅作用于冻结副本和连接层：本机桥剔除远端 `_deckLocalDispatch` 字段，再注入已核实的 realpath 项目根/聊天；冻结适配器在派发 worker 前再次比对。项目变化、缺本机绑定均拒绝，两个项目保持未暂存；远端伪造字段不能替代本机绑定。主工作区原文件未覆盖。

新候选 `.scratch/frozen-adapter-20261124-bound-v2` 仍为450文件、`userAccepted:false`，overlay `choices-and-bound-project-v2`，清单 SHA-256 `6a37acd2c131e26eeb1864517813eb403a7da71cf95f2ba2c55c85ed9ff043fb`。旧 `choices-data-root-v1` 450文件仍完整验证，可继续只读；带写 grant 的启动必须使用 v2，启动前拒绝旧候选且不取得运行所有权/新建安装级库。

stdio 在45秒前台超时后继续跟踪最长300秒的本机结果；HTTP已超时、另一 MCP session、同项目另一聊天或新配对均不能绕过安装级项目屏障。真实临时 Git 的晚到暂存结果最终落库为 completed，不重复执行。异常/部分失败保持 unknown。撤销/停止的状态文件发布失败时，仍执行其停止回调。

根代理独立复跑 **40/40** 检查通过：原SDK/HTTP12、Windows生命周期5、冻结4、ledger9、写集成7、项目绑定3；写集成的源选择为上述 v2。首次默认沙箱32/40通过，8项本机回环 HTTP 被 `connect EACCES 127.0.0.1` 阻断；获准在同一隔离夹具复跑后40/40，无测试跳过，不将环境阻断藏作通过。测试未连接生产relay、未改变真实配对/自启、未写业务 GitHub。

report 的工具 `ok`、内存 `chain.recorded:true` 仍可能伴随磁盘 flush 失败，因此当前不会仅据回包将其记成功；持久链读回正在实现。全部22项既有写能力的[参数、结果与恢复矩阵](remote-write-capability-matrix-2026-11-24.md)已完成源码盘点，不能将2项试验切片或盘点当作22项已开放/验收。正式规格继续 open。

## 独立效果验证与全量隔离回归

本机持久链读回已经实现并接入启动器：可信 context、宿主聊天、本机 canonical root、分片、后端、票、动作与时间共同匹配，原 writer 的 silent flush 失败不能假成功。Git 不再只核对路径回显：独立读取索引、工作树、提交 parent/tree/message、配置、tracking refs、FETCH_HEAD 和远端 refs；预检只从同项目/聊天的实际只读响应捕获。六项 Git 经原 stdio 适配器与专用本机 bare/peer 串行执行，另有伪回包、额外分支、删除、二进制与字面 pathspec 等负例。默认配置目标 HTTPS/SSH 的读取代码保留；线上 GitHub 网络写与复杂多目标/refspec、脏树 pull 仍未专项验收。

五项本机方法也已通过原适配器：binding、日志开关/清空、manual cancellation、handoff selector。`bind:null` 的原内存解绑/未持久化被明确记录为已知 `failed/partial`；原 `cancelled:false` 只在已核实的无匹配建议分支且磁盘不变时记录 `failed/rejected`，允许后续操作。真 `cancelled:true` 却丢盘或跨聊天记录则仍 unknown。没有用通用错误推断未执行。

真实全链还揭示了两个必须修正的验收口径：默认配色模块须按原 Markdown backend 初始化后再核对非空11色；日志 store 的第一次异步加载必须共享 pending promise，且新设置等待初始读完成。日志竞态在旧 v2 的主/备用 store 均稳定 RED，新候选均 GREEN。新候选 `.scratch/frozen-adapter-20261124-log-v3-reviewed` 为450文件、`choices-bound-project-and-log-load-v3`、清单 `4b6e2183a3c3b0226cd88629fa5fa2e17ddb456e9b7114985190c928b1cc2a6b`，仍 `userAccepted:false`。一次未安装的生成候选因缓存旧设置快照被撤回，`INCOMPLETE` 标记现会阻止任何启动；不修改 v1/v2 原字节。

准备前即持有项目屏障，补充本机 before facts 时只能增补同一意图。真实 SQLite 锁等待还复现了“检查时未过期、等待后才派发”的问题；现真正派发前再校验过期/撤销。该确定性回归中已过期写为零 dispatch、`completed/failed/rejected`，随后新操作可执行。

根代理对已完成模块独立完整复跑 **155/155、无跳过**（约177秒）：原SDK/HTTP、Windows DPAPI/生命周期、冻结、六Git真实本机链/独立读回、C组真实stdIO、持久链、安装账本/并发/锁等待/晚到、资源预算、22项 typed intent 与只读升级快照计划。随后扩大原合法幂等键到200字符的兼容断言与准备中的 GitHub 读回模块共30/30通过（其中11项是原intent回归，19项为有状态假backend）。后者尚未接入正式 grant，不代表真实 GitHub 写或 tracker 漂移已被阻止。

云端预算提交 `cee163b8208dfc3849f017dde1587a3393eb4a05` 已在原 free 服务部署为 `dep-dc28n26c6qcc73eqt6ag live`。实际 Codex context/issue 及官方SDK完整2,518,404-byte UI、56 RPC、项目和只读状态复验通过；Render新实例正常负载分钟采样约39–48MB，对应报告限额536,870,900bytes，详见[资源记录](remote-relay-budget-2026-11-24.md)。不是极限云端压测。

为后续真实外部验收创建了专用私有仓库 `wozhendeshifwa/deck-remote-acceptance-44`，独立REST确认 Issues 开启、Actions 关闭；当前尚未进行其中的 issue/评论/关系写验收。生产配对仍 `writeEnabled:false`。正在做[真实离线与冷启动](remote-cold-start-acceptance-2026-11-24.md)：已固定旧只读包、精确停止本次组件并关闭远程测试面板，保持聊天/草稿；静默和恢复尚在验收，不提前标为通过。

升级盘点确认换冻结根会换业务 dataRoot，现仅有只读注册项目过滤、全源新目录快照和hash校验；原本机有业务状态、远程v1缺这些文件，唯一实盘冲突是日志。尚未激活稳定数据目录，`activationReady:false`，未迁移生产状态。完整 tracker 绑定、剩余 GitHub/发布/窗口能力、稳定状态接线与手动更新恢复、真实自启/审批/最终用户确认仍待完成，规格和地图继续 open。
