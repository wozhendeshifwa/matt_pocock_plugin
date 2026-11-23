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
