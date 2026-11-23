# 远程连接层实施：阶段验收

日期：2026-11-24，Asia/Shanghai。关联[正式实施规格](https://github.com/wozhendeshifwa/matt_pocock_plugin/issues/44)。规格保持 open；当前是可验证的只读连接候选，完整系统未交付。

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
