# Render 入口与本机组件：实施候选

关联[正式实施规格](https://github.com/wozhendeshifwa/matt_pocock_plugin/issues/44)。这是实施中的连接层，尚非全部功能交付；当前远程业务写入保持拒绝，不将此限制当作最终可接受降级。原本机插件、provider 和用户工作树保持原状。

## 运行方式

- `relay.mjs`：零第三方运行依赖的 HTTPS 后端（TLS 由 Render 终止），MCP JSON 请求经有界内存队列转发。不同的 caller、device、session 凭据；不持久保存业务正文或 GitHub 凭据，不打印请求/认证头。
- `launch.mjs`：使用本机 DPAPI 配对配置，主动向云端长轮询，不开放本机监听端口。通过本机固定 stdio 入口复用原业务；项目由原解析器确认，拒绝无归属、冲突与旧请求。
- `journal.mjs`：SQLite 仅在本机，执行记录绑定配对、聊天和可信项目。缓存响应限 128 项、单项 1 MiB、24 小时；保留完成/未知记录的防重放标记。数据库页数限制约 128 MiB，满时拒绝继续登记，不能删掉未知记录后重做。静态 UI 和协议发现不写完整资源缓存。
- 每个 MCP session/request id 对应稳定 operation id，每次转发有独立 delivery id 和请求指纹；迟到结果不能完成另一次投递。进程中断后的 running 变 unknown；未知结果需要核对，不自动再次执行。

本机安装和启停见 [LOCAL-SETUP.md](LOCAL-SETUP.md)。脱敏私有插件安装形状及宿主验证方法复用[已验收的探针模板](../remote-compat-probe/REPRODUCE.md)，正式插件须使用独立名称与 caller 凭据，不替换原探针。

## 隔离验收

在仓库根运行：

```powershell
npm ci --prefix prototypes/remote-compat-probe
node --test prototypes/remote-companion/test.mjs prototypes/remote-companion/lifecycle-test.mjs
```

SDK 只作验收依赖；部署 relay 不需要 npm 包。测试使用新建的项目、SQLite、随机凭据和本机回环连接；生命周期测试只操作临时 Startup 目录。不修改真实 Codex home、Startup、业务项目或 GitHub。

上述通过不证明实际 Render 或 Codex 中已通过。保留完整规格的真实用户最终验收、写审批、全部业务矩阵、长休眠、更新/回退等前置，不能据此关闭正式实施票。

## 隔离写入切片：尚未在真实配对开放

生产配对仍为 `writeEnabled:false`。独立临时配置只有同时设置 `writeEnabled:true` 和
`writeGrant:{enabled:true,projectRoots:[<可信绝对项目根>],methods:[<明确方法>]}` 才能写。项目列表、方法列表都不能空；本切片只实现 `deck_issue_report` 与 `gitStage`，其他原本开放的写能力仍待后续实现和验收，不能据此缩减最终规格。

`write-grant.mjs` 只接受本机配置，按真实路径精确匹配项目根。`launch.mjs` 使用固定安装级 `%LOCALAPPDATA%/MattSkillsDeck/RemoteCompanion/write-ledger.sqlite`，不接受配对或 MCP 参数指定库文件。不能每个配对新建空库，也不能通过删库解除未知写入。程序测试可本机注入独立库，不能把该测试 seam 暴露为远程参数。

启用隔离写 grant 时还必须是当前 `choices-and-bound-project-v2` 冻结 overlay：适配器在二次解析聊天后、执行前核对本机钉住的项目和 thread。旧 `choices-data-root-v1` 仅允许只读启动，不会为了接入新代码强行重启当前生产只读组件。stdio 会先删除远端同名 envelope，再注入本机可信 `_deckLocalDispatch`，模型传入的根不是授权来源。

`write-ledger.mjs` 在 SQLite 事务及唯一索引内登记项目未决写：跨聊天、MCP session、配对和进程重开都保留屏障。同 operation id 永不重新执行；不同项目互不阻塞。只保存类型化本机意图/结果引用，不接收认证、任意命令或原始响应。超时及 `isError` 不证明零副作用，保留 unknown；本机核对也不能仅传 `confirmed:true`。核对“未执行”需要实际读回及执行已停止证据，不能把“还没看到结果”当作“以后不会执行”。

`deck_issue_report` 的上游 `ok/status` 甚至 `chain.recorded:true` 都不单独证明写盘成功。本切片会校验工单、工作区及 backend/repo 自洽，但本机持久链文件读回尚未实现，因此该方法执行后仍保守标为 unknown，不宣称“已可靠记链”。它的最终完成判定仍需补齐持久证据。

stdio 的 `beginRequest()` 分离前台响应与本机完成通道。前台超时或 relay 不再等待后，仍跟踪至有界的 300 秒完成窗口；晚到的明确成功会写入安装级记录，状态工具可查询，绝不重发原写。停止组件会等待这些完成通道；超过完成窗口则保留未知屏障。

```powershell
node --test prototypes/remote-companion/write-ledger-test.mjs prototypes/remote-companion/write-integration-test.mjs
```

集成测试创建临时 Git 仓库、临时 Codex 索引并复制适配器静态文件到新 runtime，验证实际 `git add`，不操作用户现有工作树、配对或运行中的冻结实例。`DECK_TEST_ADAPTER_ROOT` 仅为本机测试选择待复制的候选源；未指定时使用此检出的适配器。测试还覆盖新 session/另一聊天/另一配对的未知写屏障及迟到结果。原工具 annotations、RPC 和 UI 对话框不增加新确认；这些结构检查不能代替真实客户端对审批次数和取消行为的 HITL 验收。未通过该验收前不得启用真实配对。

## 部署配置与免费边界

Render 选已确认的 My Workspace，单个 free Web service、Singapore、手动部署。源码为本分支，构建可用 `node --check prototypes/remote-companion/relay.mjs`，启动 `node prototypes/remote-companion/relay.mjs`；Node 需 >=24。实际 source commit 和 deploy ID 必须读回，live 后才做 HTTPS smoke。

环境变量 `DECK_CALLER_TOKEN`、`DECK_DEVICE_TOKEN`、`DECK_SESSION_SECRET` 必须是三个独立的随机秘密，通过 Render 的环境配置设置，不写入源码。`RENDER_EXTERNAL_URL`、`PORT` 由平台提供。节点监听 `0.0.0.0`，`GET /healthz` 只表明 relay 可处理请求；电脑离线时 MCP 请求应明确失败。对用户的业务可用性以本机连接状态为准。

2026-11-24 在真实控制台核对：Hobby、无银行卡、Free instance hours 1.42/750、带宽0/5 GB、pipeline 0/500 min，构建额外开销上限已为 $0，当前/预计费用 $0。本轮未修改该设置。用户要求继续免费方案，实际遇到超额再说明限制与费用，由用户决定是否消费。

长轮询会计作入站请求，本机在线连接持续时服务通常不会因15分钟无流量而休眠；会消耗共享免费小时。停止组件后可进入休眠，唤醒约一分钟只是平台描述，客户端可否等待仍需实测；不得假称长休眠已通过。750小时为整个 workspace 共享，多个运行中的免费服务共同计费时长；免费小时用尽会暂停服务。带宽/构建也有独立限额，不能把 free 实例当无限资源。

实际核对来源：[免费限制](https://render.com/docs/free)、[环境变量](https://render.com/docs/configure-environment-variables)、[部署](https://render.com/docs/deploys)、[日志](https://render.com/docs/logging)。应用只输出固定状态，无业务正文日志；平台会保留相应运行/请求元数据，不能承诺平台绝对不留存。凭据不能出现在 URL/query、日志或可提交文件中。

## 当前验收记录

2026-11-24，Windows Node 26.13.0：12 项 HTTP/SDK/本机 stdio 测试和 5 项生命周期测试通过。两项安全回归在隔离副本撤去对应修复后均按预期失败，证明能捕获聊天移项目后复用旧结果、迟到回包误结束新投递。未以这些局部结果宣称远程写入已获批准或全部功能已验收。
