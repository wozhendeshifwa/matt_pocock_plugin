# 原始读取矩阵：MCP SDK／假身份，真实专用 GitHub 只读

本轮通过真实原始 stdio adapter、独立本机回环 relay 和 MCP SDK 执行原有读取接口。没有创建真实 Codex 聊天、打开宿主窗口、发送草稿、授予业务写权限、迁移生产配置或重置既有账本。此证据不替代真人宿主界面、HITL 或 Windows 安装验收。

最终对象为本机固定 `v6-reviewed`：manifest `dc04813e34b463827667f8bca236ffc6c31ec847959a414c334d4ead9e756e10`，`bound-effects-and-bundled-docs-v6`，450 个逐文件校验的源码文件。每次运行复制到独立新目录，使用自己的 fake Codex SQLite、项目副本、空系统／全局 Git 配置、空 hooks、隔离 HOME、业务数据根和 Journal。没有给 executor 传 write grant 或新安装级 ledger。

最终记录为 **91 次矩阵调用，加 6 次只读 wrapper 补验，共 97 次**。原清单仍为 56 个 RPC：31 个 read、25 个 write；`setupLayout` 是额外的条件写分支。这里的“31/31 已调用”不等于声称 31 项都是可用产品功能；原有限制单列如下。

## 原 31 个 read RPC 的逐项结果

| RPC | 证据与边界 |
| --- | --- |
| `awaitCreatedIssue` | 原能力声明 `enabled:false`、`watching:false`，原因 `session-events-and-rename-unavailable`；没有实际 watcher。 |
| `bindings` | 返回隔离项目的 GitHub 绑定；种子由原 `createChoiceStore.rememberWorkspace` 写到该 worker 私有根。 |
| `chain` | 返回原检查链；27 个随包技能均有实际 `skill:<name>` 检查，`wayfinder` 路径指向当前候选的 vendor 文件。 |
| `cwd` | 返回该 SDK 假身份唯一关联的项目根；不取真实聊天或启动目录。 |
| `detect` | 返回该项目的原后端探测与选择。 |
| `focus` | 使用原字段 `{windowId,workspaceRoot,kind:'focus',visible:true}`，返回 `standing:'active'`、active/keepers 为 1；这是内存视野模型，不是真实窗口焦点验收。 |
| `gateStats` | 返回原统计对象；接口本来没有业务 `ok` 字段，不能把缺少 `ok` 当失败。 |
| `gitDiff` | 使用原要求的 `{path:'README.md'}`；返回已准备的 owned 本机变更文本，重复读取仍匹配。没有 push。 |
| `gitLog` | 原 `{count:1,skip:0}` 读到复制 fixture 的本机提交；`skip:1` 为空符合该单提交历史，不能据此宣称实际长历史翻页已测。 |
| `gitStatus` | 返回实际复制项目的 Git screen、HEAD、工作树与本机引用；没有 fetch，远端新鲜度不能据此推断。 |
| `gitWriteCheck` | 原 `{op:'commit',message:...}` 诚实阻止 `nothing-staged`；另以 `{op:'fetch',remote:'origin'}` 获得 allow、plan、短期票据。没有执行 commit 或 fetch。 |
| `handoffLatest` | 精确读到 owned fixture 的 `20261124-readonly-fixture.md`；没有调用 handoffResolve 或认领。 |
| `issueComments` | 真实读取专仓 #1 的 1 条实验评论；用真实 `endCursor` 续读尾页，返回空 nodes、`hasNextPage:false`。没有足够评论证明跨 50 条的分支。 |
| `issueDetail` | 真实 #1 number/title 与独立 REST 结果一致。 |
| `issuesPage` | 原 `{state:'all',limit:2,cursor}` 真实三页得到 `[6,5]`、`[4,3]`、`[2,1]`，最后 cursor 为 null。另读 closed 筛选为空。 |
| `listLabels` | 真实读取专仓既有标签和颜色，没有改色。 |
| `logBatch` | 仅发送原 `{entries:[]}`，accepted 为 0；这是空包路由验收，不冒充客户端日志写入或宿主日志转发完成。 |
| `logExport` | 原 log store 在私有 fixture 中准备日志，再按原本机日历日期读取；最终 13,652 字节，包含 `readonly-matrix-fixture` 原 writer 种子；重复读取通过。 |
| `logGetSwitch` | 读取原 writer 保存的 enabled/sampleRate，未通过业务 RPC 改设置。 |
| `mapTickets` | `{key:'2'}` 在原 GitHub legacy 分支诚实返回 unsupported；原 `isComposerSelection` 限制保留。`deck_map_snapshot` 另能实际读到 native 子票 #1。 |
| `namingPlan` | 原 manual naming writer 在私有 fixture 中准备 #1 后，读取到 1 个建议，`manual:true`、`enabled:false`、orders 为空；没有自动改名或创建聊天。 |
| `probe` | 真实专仓薄读探针返回成功。 |
| `refresh` | 返回原板数据／信封；不是 Windows 宿主刷新按钮的真人验收。 |
| `registry` | 返回原后端注册表；重复调用成功。技能服务的 27 项另通过实际 `createSkillsService.list()` 和文件 hash 证明。 |
| `selection` | 返回该 owned 项目的既有 GitHub 选择。 |
| `setupLayout` | 原只读 `{}` 返回原 writer 准备的 `single`；重复读取一致；带 layout 的写分支另被拒绝。 |
| `skill.readDoc` | 原 UI 参数是 `{name}`，不是 key；v6 下 27/27 的 md、vendor path、registry body、可选 mdZh/pathZh 全部与实际 vendor 文件匹配；fake HOME 同名毒化文档未取用，profile-only name 被拒绝。 |
| `snapshot` | 原板数据返回，重复调用成功；内容来自专仓与 owned 本机状态。 |
| `updateChangelog` | 原 UI `{version:'1.8.0-rc.7'}`；保留不内置 updater 的真实限制，返回结构化 unsupported，没有伪 markdown/latest。 |
| `updateCheck` | 原入口 `{}`；保留手动更新限制，返回结构化 unsupported，没有伪 snapshot/current/latest。 |
| `updateStatus` | 同上。没有安装 `dsh-plugin-update` 或启动自动更新。 |

专仓为 `wozhendeshifwa/deck-remote-acceptance-44`。独立 GET 核实 private、Actions disabled、6 张实验 issue、地图 #2 的原生子票 #1 和 #1 的评论。完整首 REST 页不足 100 条且没有 `pull_request`，因此本仓没有 PR 样本；本轮不能证明真实 PR 详情或 PR 多页读取分支。认证遵循已完成 D6 helper 的 RAM `gh auth token` → 子进程 `GH_TOKEN` 方式，不保存或打印 token。没有修改 D6 helper 或已有安装级 ledger；前后查询行 hash 相同。

## wrapper、deck 读取与拒绝边界

MCP SDK 实际验证 `tools/list`、`resources/list`、board HTML resource、`deck_current_project`、`deck_rpc_manifest`，以及 `deck_context`、`deck_issue_get`、`deck_map_snapshot`、`deck_issue_list`。后四项使用真实专仓；地图 native children 与独立读取一致。

独立无 GH_TOKEN 的 wrapper 补验另读取 ping、空 resource templates、`open_deck_sidebar_probe` 的常量文本／资源描述、`deck_host_context_probe` 的 owned 诊断保存、`portSnapshotCache` 的诚实 null，以及 operation status 的 not-found。SDK 没有 UI renderer，descriptor 没有打开任何窗口；缓存补验没有认证身份，null 不代表已验证热缓存恢复。HTML 读取不能替代 light/dark、滚动、按钮交互和真实侧栏验收。

下列 8 个原禁用方法全部在 remote read route、到达 adapter 前拒绝：`deckExec`、`namingRegister`、`registerNewSessionWatcher`、`namingSignal`、`namingResult`、`pickDirectory`、`pickFile`、`updateInstall`。`setupLayout({layout:'multi'})` 条件写也在派发前拒绝。9 次均为 `forwarded:0`。manifest 明确 `writesEnabled:false`、`allowedWriteMethods:[]`。这些是路由拒绝试验，没有调用业务 write 工具。

## v5 红证据与诊断

旧 `c8eefb0f5865bbb6e76b3be47da8341b04f40be1d28027cd4b40eec2e8614ea4`／450 文件候选证据完整保留，没有覆盖成 v6 结果。

真实技能缺口不是参数误差：原 client `lib/client.js:23435` 调用 `host.call('skill.readDoc',{name})`，23452-56 要求 ok/md 并读取 path、mdZh、pathZh；原 `lib/skillDoc.js:59-77` 使用相同字段。`skills-service.mjs:67-90` 已能读取 vendor-only 27 项，`node-host.mjs:319-323` 已注入该服务；但原 `skillDoc.js:19-56` 的 finder 只搜索 cwd/ancestor 下的 package/node_modules 和 HOME 的 DSH profiles，未使用这个 vendor 目录。隔离 HOME 后，registry/chain 明确有 wayfinder/ask-matt，实际文件存在且 hash 匹配，readDoc 却 missing。v6 窄 finder overlay 修复后独立 27 项实测通过，原 formatter／翻译 shape 保留。

更新读取原本就是保留限制：`lib/updateFromPackage.js:14-18` 静态裸导入 `dsh-plugin-update`；模块注释 3-6 明确缺包直接抛错，index 的懒加载尚未执行 handler 就失败。vendor `package.json:25-26` 声明 `^0.12.0`，但 main、当前工作树和冻结副本的 Node resolution 都 MODULE_NOT_FOUND；port 的 package.json／完整 package-lock 只有既有 React/jsdom/esbuild 依赖，没有 updater 条目。`prototypes/upstream-port/README.md:55` 早已明确不内置该包，研究 #40 也区分“路由存在”和“功能可用”。因此没有补装或重新实现它。v5 是裸 internal import 错误；v6 仅将这 3 条可信缺包结果适配为原 UI 能理解的 `{ok:false,unsupported:true,errorKind:'unsupported',error:'当前 Codex 版使用本机手动更新入口。'}`。UI `client.js:27165-71`、28615-68、29373-98 对失败走错误分支，未收到假的成功 snapshot；changelog 28700-21 仅在 ok 时消费 markdown。

首轮夹具曾漏给 gitDiff.path，并用 UTC 日期请求本机日历日志。原返回真实参数拒绝／空日文件；这两项不是产品缺陷。后续新独立 run 按原源码修正 README path、真实变更和本机日期，内容验收通过。原始首轮记录仍保留，不混入最终通过结论。

## 可复核工件

- 最终 v6：`.scratch/readonly-matrix-44/run-1795466120054-991689f2/`，含 `matrix.json`、每次原始回包、`verification-summary.json`、`independent-github-readonly.json`、`wrapper-followup.json` 和 exact runtime450。
- 修正参数后的 v5 红证据：`run-1795466046604-c4660a02/`，63 调用，含真实三页 cursor 与详情缺失／updater internal。
- v5 本地依赖／27 registry 文件证据：`run-1795465766540-4dfda553/verification-summary.json`。
- 本机复跑入口：`.scratch/readonly-matrix-44/run-matrix.mjs v6`；每次创建新 owned run，固定候选 digest，拒绝覆盖已有证据。`inspect-results.mjs` 汇总最新完成 run；`wrapper-followup.mjs` 仅对已完成 v6 的 owned fake 身份补验。

正式 issue 仍需按真实剩余验收保持状态。此矩阵证明对应的 SDK／原 stdio 读取外部行为，并记录原限制；它不构成生产配对已升级、Windows 已安装或真人 UI 已接受的证明。
