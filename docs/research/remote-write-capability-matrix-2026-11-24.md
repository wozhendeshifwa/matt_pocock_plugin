# 既有写能力、结果证据与恢复矩阵

日期：2026-11-24。用途：为远程 companion 的下一批本机授权、隔离验收和结果恢复提供范围清单。本文是源码核对与受控测试记录，不是正式写能力已通过真实 Codex 验收的声明。没有向真实 GitHub 仓库写入、没有调用真实 `gh auth`，没有修改用户业务仓库、生产授权或插件配置。

## 1. 基线与覆盖口径

实际依据是 `.scratch/frozen-adapter-20261124-choices-v1/` 内的 adapter 与 vendor（450 文件），不是 main 工作区的未提交改动，也不把全量上游的潜在能力当作本 port 已开放能力。本文下文的 `A/` 指该冻结目录的 `prototypes/upstream-port/`，`V/` 指其 `vendor/mattskills-1.8.0-rc.7/`。冻结基线身份与两处 snapshot overlay 见同目录的 `remote-companion-baseline-2026-11-24.md/json`。

本次实际 import 的 `A/rpc-endpoints.mjs` 与 `A/write-policy.mjs` 计数：

| 层 | 既有范围 | 本文处理 |
| --- | --- | --- |
| upstream RPC | 56 个不同端点；31 read，25 write；`setupLayout` 在 read 列，传 layout 时条件性变 write | 17 个 `ENABLED_WRITE_ENDPOINTS` 逐项列明；其余 8 个 write 维持拒绝 |
| adapter read | `portSnapshotCache` | 只作辅助读取，不扩成写 |
| deck 工具 | 9 个 | 4 GitHub 写 + 1 本地 report 逐项列明；4 read 是 `deck_context/issue_get/issue_list/map_snapshot` |
| wrapper 工具 | 6 个 | 17 RPC 经同一个 `deck_upstream_write`；`deck_host_context_probe` 是独立脱敏诊断写，不是业务写/恢复授权 |
| 正式远程写切片 | 实施中的 grant 当前只列 `deck_issue_report/gitStage` | 这是 2/22 的试验切片，不是本文其余 20 项已被远程授权；生产配置仍需以本机实值为准 |

合计：**22 个既有写路由能力 = 17 RPC + 5 deck 写工具，100% 完成源码盘点**；另明确处理 **1 条条件写拒绝、8 条既有未开放写拒绝**。22 是能力数，不是已通过真实远程验收数，也不等于22条底层原子副作用。`deck_issue_patch`、建图、发布等一次能产生多步副作用。

对 main 当前 policy 只做差异核对：冻结与主工作区 `prototypes/upstream-port/write-policy.mjs` 的 SHA256 均为 `1ecc58dc75af03d6517962b4db4216667b9bd2e0bc9765a8f829dca0d9a5d1bb`，本次未发现 policy 差异；不据此宣称整个 main 与冻结基线相同。

## 2. 所有行共用的信任与结果规则

### 已有本机边界

`A/sidebar-server.mjs:107-156` 从宿主 `_meta` 解析当前聊天所属项目，不从工具参数接受 cwd。RPC 写还要求 `payload.expectedThreadId === project.threadId`；`cancelNewSessionWatcher` 的 sessionId 会被覆写为该已核验 threadId。随后 `A/node-host.mjs:337-389` 仅允许17项，普通 RPC 的 cwd 被覆写为本项目根；open 两项保留其目标参数，由 open gate 限制。原始 UI 的 `wf.X` 最终走 `deck_upstream_write({method:'X',payload:{...业务参数,expectedThreadId}})`。

写命令无通用 shell：`A/write-gate.mjs` 精确 gh argv，`A/git-write-gate.mjs` 按当前操作/根精确 Git 配方，`A/graph-write-gate.mjs` 限制当前 repo/工具及当前操作只读取回的数据库 issue ID。host 对真实 Git 根、路径 realpath、请求局部身份与 config 备份另作检查。项目内存在软链接、Git 配置、hooks/过滤器时，argv 安全不等于副作用范围已经被证明；验收夹具必须自有且无用户 hooks。

policy 的 `upstream-dialog`、`codex-tool-approval` 是既有确认语义与审计标签。UI 确认、MCP `readOnlyHint:false/destructiveHint:true`、实际宿主审批事件分别保留；`confirmationFor()` 写入字符串不证明用户这次点击过确认。既有 node host 没有取得可验证的宿主逐次确认签名。`expectedThreadId`、owner scope、grant、operationId、nonce、ledger hash 也都不是该签名，不能补造一次 HITL 通过记录。用户睡眠期间可以完成隔离自动验收；真实确认/拒绝体验、动态主题切换、窗口真正打开等留待醒来。

### 结果解析必须分层

MCP 的 `isError` 只表示 transport/tool 层。RPC 的 `structuredContent` 通常是 harness `{ok:true,value:V}`，`V` 才是下面各行列的业务结果；先验证外层再取 value，不能因外层 ok 就宣称业务写成。deck 正常直接返回壳对象 `D`：

```text
{ok: status==='ok', status:'ok'|'partial'|'unsupported', tool, reason, text,
 workspace:{root,key}, backend:{id,source}, repo:{backend,refId,name,url},
 cost, data, items:[], notes:[], readBack, touched:[]}
```

具体路径来源：`V/shared/deck-tools/shell.js:136-145,270-355`；不同提前拒绝会缺 repo/data 等字段。`partial/unsupported`、异常、超时、断线、缺结构、`isError:true` 都**不通用地等于没执行**。例如 gh 已建票但回读失败、pull 已 fetch 后拒绝合并、initPublish 已提交/建远端后推送失败。壳的 `reason:'backend-unsupported'` 也可能携带网络错误，不能仅凭 reason 判定没有副作用。

已知终局应保存可证明的副作用和失败范围；未证明时保留 `unknown`，禁止自动重放同操作或绕过它给同项目发新写。`isError:false`、只有 `ok:true`、空 items、文案“请重试”都不是跨能力的终局判据。已知无执行只能由本机 dispatch 前的可证拒绝，或在执行停止 fence 后的对账得出。

### 安装级 ledger 与 typed intent

当前 `prototypes/remote-companion/write-ledger.mjs` 是基础设施，不是22项恢复器：

* `projectKey` 来自可信本机 canonical resolver；同一项目跨聊天、MCP session、pairing、升级共用 unresolved 屏障，不能把这些 ID 拼入 project key 逃逸屏障。
* `ownerScope` 对 pairing/thread（可含 projectRoot/session/principal）做隔离；owner 可见性限制与项目级互斥是两件事。新 pairing 不能查看/重放旧 owner 的结果，也不能绕过旧项目屏障。
* `operationId` 稳定；`reserve` 原子创建 running；同 ID 同 intent 只能查原记录，不再执行。completed tombstone 不随 response cache/重启清空。running/unknown 不随新构造器自动释放。
* 只记录 `{method,parametersSha256,target}`，不记 token、命令串、评论全文、完整返回。现有通用 target 白名单包括 repository、issueNumber(s)、branch、remote、paths、before/expectedAfter/commit OID、状态/content SHA256、parent/blockedBy、correlationKey、localStateKey。**它没有逐方法必填/关联验证，也没有全部业务字段的专用 typed target**；下面各行是下一步应由本机解析的最小意图，不表示这些恢复器已经实现。
* `reconcile` 目前验证证据形状与目标关联，不会自己查询 Git/GitHub/文件，也不验证宿主审批。`not-executed` 必须先有执行停止时间及 fence hash，再有之后的读回；“现在看不到”不能证明迟到子进程不会继续写。不得给远程 MCP 暴露 reconcile 或接受模型伪造读回证据。

下文的“阻断”均指保留 unresolved，先收集本机事实；可靠晚到结果可以对账，不重新执行。配置变更前保留可恢复备份；原 host 的 `.git/config` 备份只覆盖它确实标识的配置变更，不覆盖所有本地状态。

## 3. 17 个已开放 RPC：参数、gate、实际结果

参数列省略共同的 `expectedThreadId` 和由 host 绑定的 cwd；`?` 是可选项，不能把 cwd/owner/repo 从远端参数升级为本机授权事实。确认：U=原版对话框，T=Codex tool approval，N=无额外确认。RPC 仍使用 wrapper 的写 annotations。

| RPC（原 UI 为 wf.同名） | 业务参数形状 | 已有 gate / 确认 | 实际成功结果 V 与限制 |
| --- | --- | --- | --- |
| `gitStage` | `{paths:string[]}`，非空相对整文件路径 | Git `add -- paths`，literal pathspec；拒绝绝对/越界/`.git`；无需票；U | `{ok:true,staged:paths,atMs}`。需 exact requested paths；命令成功不是索引内容指纹 |
| `gitUnstage` | `{paths:string[]}` | `reset HEAD -- paths`；同路径门；无需票；U | `{ok:true,unstaged:paths,atMs}`；不是 reset --hard，不改工作树 |
| `gitCommit` | `{message:string,ticketId:string,requestId?:string}` | 先 `gitWriteCheck({op:'commit',message})`；120秒内票绑定本 repo、HEAD、索引指纹；U | `{ok:true,committed:true,headBefore,headAfter,atMs}`。HEAD 不可读回 false/head-unreadable；失败且HEAD变了是 head-moved，不能重试 |
| `gitPull` | `{ticketId,requestId?}` | `gitWriteCheck({op:'pull'})`，票绑定HEAD、分支、upstream；只准 `pull --ff-only`；U | `{ok:true,mode:'fast-forward'|'up-to-date'|'unknown',headBefore,headAfter,upstream,atMs}`。mode unknown不证明HEAD状态；false也可能已fetch |
| `gitFetch` | `{ticketId,requestId?}`；remote 在 precheck 选择，不直接透传 | `gitWriteCheck({op:'fetch',remote?})`；`fetch <ticket.target.remote>`，无 --all；U | `{ok:true,mode:'fetched',remote,atMs}`，不带实际 refs 变化 |
| `gitPush` | `{ticketId,requestId?}`；remote 可在 precheck 请求 | `gitWriteCheck({op:'push',remote?})`；票校验目标、HEAD、分支与upstream；显式非force refspec，仅单分支、禁followTags/mirror；首次 -u 前备份config；T | `{ok:true,mode:'set-upstream'|'existing-upstream',remote,branch,upToDate,atMs}`；recreate也落existing-upstream。无远端OID；upToDate从stdout文本推断，不能替代远端读回 |
| `initPublish` | `{name:string,visibility?:'public'|'private'}` 默认private | Git/gh/auth与仓库前检；可能 init、add .、allow-empty初次commit、gh repo create、改origin、push；只准固定发布配方；全局safe.directory写被port拒绝；T | `{ok:true,repo:{owner,name},repoUrl}`；失败可能 `{ok:false,errorKind,error,repoUrl?,repo?,halfCreated?}`。即使halfCreated缺席，也不能推断本地没init/add/commit |
| `retryPush` | `{name?:string,repoUrl?:string,owner?:string}` | 仅缺origin时从repoUrl补origin，然后 `push -u origin HEAD`；不再次建仓；config备份；T | `{ok:true,repo:{owner,name},repoUrl}`；失败常 `halfCreated:true`。owner/name是入参回显，不保证与实际origin一致；成功URL可空，须本机解析实际目标 |
| `commentIssue` | `{number:number|string,body:string,effortId?:string}` | 当前工作区选后端/解析repo；gh REST POST或issue comment精确argv；U | GitHub为 `{ok:true,data:{id?,author:{login},authorAssociation,body,createdAt,updatedAt,editedAt?}}`。fallback或非JSON成功时会合成无id的乐观comment；REST不确定后fallback有重复风险 |
| `setLabelColors` | `{changes:[{name:string,color:string}],backendId?:string,sessionId?:string}`；色值6hex | 当前绑定后端，不靠任意repo参数；逐label `gh label edit` 或Markdown精确配色文件；U | `{ok:true,backendId,applied:[],failed:[]}`；ok可含failed，是逐项部分结果；GitHub与Markdown目标不同 |
| `bind` | `{backendId:string|null}`，旧别名backend可用；`sessionId?`仅既有本机上下文 | registry只接受已注册后端/null；写choices及首次workspace文件，Markdown可能首次放默认配色；精确项目文件/本机data root门；U | `{ok:true,cwd,backendId,labelColorsFile,workspaceFile,rev,persisted}`。绑定内存成功可伴随 `persisted:false`、配色/工作区子文件失败；现有workspace文件可保留不覆盖 |
| `handoffResolve` | `{name?:string}`，精确文件名或末尾`*`前缀 | policy为read-only-export，但兼容既有write路由；扫描本项目 `.scratch/handoff`；N | `{ok:true,file:string|null}`；null是合法未找到，既不写交接文件也不认领票。不调用已退役claim |
| `cancelNewSessionWatcher` | `{suggestionId:string}`；sessionId由已核验thread覆写 | host短路到adapter manual naming；只取消该聊天现存建议，不启watcher、不改聊天名；N | harness `{ok:true,value:{ok:true,cancelled:true|false}}`；false可表示已无该建议，不能说发生了取消写 |
| `logSetSwitch` | `{enabled:boolean,sampleRate?:number}` | 本机日志开关文件，sampleRate有限数由store处理；N | `{ok:true,enabled:boolean}`，不回sampleRate。store捕获persistSwitch写失败，内存成功仍ok；须磁盘读回 |
| `logClear` | `{date:'YYYY-MM-DD'|'all'}` | 本机cache日志目录；仅匹配日文件；unlink受data root门限制，包有清空内容fallback；破坏性、U | `{ok:true,removed:number}`；逐文件失败被吞，removed不是“总数必须都清了”的证明；无dir也可ok/0。false/0也不证明之前文件没被清 |
| `openFolder` | `{cwd?:absolutePath,path?:absolutePath}`，无值默认为本项目 | Windows仅固定 `cmd /c start` 配方，目标词法上在workspace/data root，拒绝shell元字符；U | `{ok:true,cwd:string,opener:string}`；只证明平台打开调用完成，不证明Explorer实际可见。open gate没有realpath防软链接跳出证明 |
| `openPath` | `{path:absolutePath|fileURL}` | 同open门；vendor按basename是否含点猜目录/文件，fileURL解码；U | `{ok:true}`；没有目标/窗口回执，不足以证明用户看到正确文件；不应自动重放 |

源码：Git结果 `V/lib/versionControlWrite.js:139-272`；票据 `V/shared/version-control/write-ticket.js:2-57`；发布 `V/lib/publishFlow.js:99-267`；评论 `V/lib/commentThreads.js:164-206` 与 `V/lib/tracker/backends/github/comments.js:28-70`；改色 `V/lib/workspaceLabelColors.js:138-154`；bind `V/lib/workspaceCwd.js:43-99`；handoff `V/lib/handoffClaim.js:79-99`；manual cancel `A/manual-naming.mjs:45-49`；日志包 `V/lib/logPkg/phones.js:172-268`、`store.js:360-382`；open `V/lib/pickerShell.js:9-21,81-109`、`A/open-command.mjs`。

### 逐项意图、读回、未知结果的本机裁决

所有 before 状态应在 reserve/dispatch 前由本机读取，并将完整业务参数规范化后的 hash 绑定到 operationId。这里的字段是恢复器需求，不是让远程传一个布尔值声称已核验。

| RPC | 必要本机意图 / typed target | 能独立读回的事实 | 未知时阻断规则与可复用测试 |
| --- | --- | --- | --- |
| gitStage | exact paths；before/expected索引entries及工作树对象摘要；HEAD；`beforeStateSha256/expectedStateSha256` | `git diff --cached`、`ls-files --stage -z`、gitStatus；包含删除/二进制/字面通配符路径 | 路径回显与索引不符、仅部分暂存、进程仍活即unknown；`verify-version-control-write.mjs`、`verify-git-write-ui.mjs`；缺remote丢包/复连后exact索引对账 |
| gitUnstage | paths；HEAD对象及对应路径的期望索引；before摘要 | 指定paths索引与HEAD相同，工作树内容未改 | 不把“暂存为空”当整项目无变；同上测试；缺跨进程ledger读回 |
| gitCommit | beforeOid、期望tree/parent/content hash、message hash、ticket与request correlation | HEAD/commit对象、父OID、tree、reflog；不能只看相同message | HEAD改变但不匹配目标提交、hooks可能另改内容、读不到HEAD即unknown；已有stale/replay/UI测试；缺kill后精确commit归属恢复 |
| gitPull | beforeOid、local branch、upstream和remote URL摘要、预检目标OID | HEAD/工作树/index、tracking refs、FETCH_HEAD、远端ref；验证快进关系 | 拒绝合并仍可能已fetch；mode unknown保留屏障；已有本地bare ff/divergent覆盖；缺故障各阶段remote恢复 |
| gitFetch | remote名字+解析URL摘要、执行前/期望tracking refs集合 | tracking refs/FETCH_HEAD及远端advertised refs | 没变可能是本来最新，不等于没执行；已有fetch覆盖；缺部分fetch、timeout后终止fence与对象/refs证据 |
| gitPush | repository/remote、实际push URL摘要、local/remote branch、commitOid、上游配置before/after摘要 | `ls-remote`目标ref==commitOid，config/upstream与意图一致 | 远端最新值可能被他人改动，不能仅本地ahead=0；拒绝与超时不自动再push；已有bare首次push/config备份与divergent拒绝；缺在线隔离仓迟到读回/重连 |
| initPublish | 精确repository、visibility、待发布文件清单摘要、原Git状态/是否无仓、origin/upstream before摘要、预期commit | 本地.git/index/HEAD/config/备份；GH repo元数据+visibility+默认分支ref OID | 逐阶段判断本地init/commit、远端是否已创建、是否已push；任何半成功不再initPublish；`verify-publish-flow.mjs`可复用（本次受控通过），缺真实GH阶段故障与完整本机恢复器 |
| retryPush | 从本机已验证的half-created记录导出repo与commitOid、原origin/期望origin；不信owner/name回显 | 实际origin、GitHub repo身份、remote ref OID、upstream config | 目标不一致/缺少先前half-created事实即拒绝；已有假GH+本地bare重试测试；缺真实repo读回，不能由URL有值自动授权 |
| commentIssue | repository/issueNumber、body hash、稳定correlationKey、读前comment游标/时间与作者身份 | 完整分页读取comments；REST comment id、作者、内容hash、时间/operation marker | 无id的乐观返回须读回；唯一匹配不成立/重复候选/分页不全即unknown；禁止因fallback成功掩盖重复；`verify-issue-writes.mjs`、`verify-pr-page.mjs`含真GH写，当前不直接运行；缺断线导致REST+fallback重复保护验收 |
| setLabelColors | repository或本地backend、逐name/normalized6hex清单摘要、before配色摘要 | `listLabels`或本地配色JSON，逐name颜色；`applied/failed`逐项记录 | 有failed保留部分结果；漏项/重复name/目标backend变化/读不到不能整批重试；`verify-issue-writes.mjs`；缺Markdown/GH混合失败及恢复对账 |
| bind | localStateKey=binding、当前/目标backend（可null）、三类文件before与expected摘要、choice rev | `bindings/registry/selection/setupLayout(null)`辅助；直接读choices与workspace/label文件 | `persisted:false`或子文件失败不可宣称全持久化；先备份配置，区分“已存在故保留”与“应创建失败”；已有issue-writes的GitHub bind，缺组合状态/重启对账 |
| handoffResolve | name规则/目标handoff目录身份、content hash若需打开具体文档 | 同目录现存文件名/mtime；精确名/前缀结果 | 保留“解析成功，file:null”语义；不能据此清除其他写未知；`verify-handoff-naming.mjs`、`verify-handoff-view.mjs`可复用；无需发明写恢复 |
| cancelNewSessionWatcher | localStateKey=manual-naming、本机thread关联、当前suggestionId与期望cancelled摘要 | `namingPlan`建议消失；manual-naming.json该session.cancelled等于suggestionId | false需判“本来无建议/已取消/换了建议”；文件不符/身份不符不认成功；handoff-naming/manual-naming-mcp测试；后者可选在线建票段必须关掉 |
| logSetSwitch | localStateKey=log-switch、enabled与sampleRate规范值摘要、原文件摘要 | logGetSwitch仅辅助内存；磁盘log-switch.json及新host重载值才是持久证据 | ok不代表persist，读回不符/缺file保持unknown；`verify-settings-page.mjs`可复用但默认repoRoot会写当前data，需先隔离；缺写失败被吞的验收 |
| logClear | localStateKey=logs、精确date/清单及原内容摘要/可恢复备份；本次操作范围截止点 | 指定已捕获文件不存在或内容清空；removed计数与真实范围核对 | all不无限覆盖新生日志；有活动生产者时不猜；部分清理不再整包重试；settings-page有UI路径，缺逐文件失败/清空fallback、重连对账 |
| openFolder | localStateKey=open-path、规范真实目标+允许根、路径摘要、打开意图 | 文件系统能证明目标存在与归属；仅宿主窗口观测可证明已展示 | 启动回包丢失不得重开；词法归属不能充当realpath归属；settings-page只有argv gate拒绝/形状检查，实际可见HITL待用户醒来 |
| openPath | 同上，另固定fileURL解码后真实file/directory种类 | 同上；UI要核对正确文件/目录，不仅看一个Explorer窗口 | basename含点猜测不可代替lstat；缺host窗口ack即不作“已看到”结论；同上 |

## 4. 5 个 deck 写工具

四个远端工具已有 `codex-tool-approval` policy（patch 标destructive）；report 为N。MCP registration目前对这5项设置 `readOnlyHint:false`，但这些提示不等于签名确认。共同壳做会话取根、后端选择、预算闸；GitHub写命令还过精确argv/graph gate。当前operation的数据库issue ID只能从当前repo成功只读的 `.id` 学得；GraphQL mutation、任意REST、删仓库都不在范围内。

| 工具 | 确切参数形状（均additionalProperties:false） | 实际D成功/部分结果 | 必要意图、读回与阻断 |
| --- | --- | --- | --- |
| `deck_issue_create` | required title；body?；kind?:task/bug/map；parentKey?；labels?:string[]；assignees?:string[]；idempotencyKey?；effortId? | data:{ticket,kind,idempotencyKey,limits}；touched票键；有parent时items边证据；标签/父边失败可status:partial但票已存在。自动锚仅同会话/标题/标签的5分钟窗 | repository、规范化title/body/labels/assignees hash、稳定自选锚、parentIssueNumber。读回票number/database ID/body anchor及每字段、parent/子列表。缺key/锚冲突/partial先查已建票，不能新operation再create；本机unknown屏障优先于工具文案“可重试”。已有issue-writes/graph-writes；缺丢包后唯一锚核对/跨pairing恢复 |
| `deck_map_plan_create` | required title,children；body?,planId?,labels?,effortId?；children:[{key,title,body?,kind?,labels?,assignees?}]；edges?:[{from,to,type?:blocked-by/parent}]（@map可作端点） | data:{planId,mapKey,durable,builtKeys,skippedKeys,restKeys,edges,counts:{planned,actual,ok,compared},shards,nextCall}；items逐票/边；限额/未做完为partial。counts.ok=false仅写notes，**不保证顶层改为partial**；durable游标并不证明真实GH全做完 | repository、planId、每child短key对应内容摘要、完整边集合摘要和稳定锚、cursor前状态。逐票查锚/字段、精确子集合和每条edge，不只计数；counts/children身份不符、游标不持久、未知端点都阻断整包重放。受控证明已建后才续余项；现有graph-writes；缺cursor丢盘/并发/超时后恢复与counts真假不一致用例 |
| `deck_map_link` | `{key,parentKey?,blockedBy?:string[],effortId?}` 或 `{edges:[{key,parentKey?,blockedBy?}],effortId?}`；blockedBy整批替换 | data:{requested:items.length,done,jobs}；items含key、status及edgeEvidence的op/target/kind/evidence等落点；status来自items。部分失败仍可能有边已成功 | repository、每child issueNumber、期望parentIssueNumber及blockedBy完整集合、before边集合摘要。`deck_issue_get/map_snapshot`或native子/依赖读回精确集合，区分native/body-line/unknown/unsupported。count相等不等于同一组边；任何unknown/部分边保留事实，禁止盲删再加；现有graph-write-gate/graph-writes；缺全链remote crash与部分删除后读回 |
| `deck_issue_patch` | required key；comment?；addLabels?/removeLabels?:string[]；assignees?:string[]（整批替换，[]清空）；title?/body?/progress?；close?:boolean（false重开）；effortId? | data:{requested:['comment'|'labels'|'assignees'|'text'|'state'],ticket:readBack|null}；items逐step status；顶层readBack可null，即使status:ok。labels/text读改写有本票锁；这不是整工具事务 | repository/issueNumber；逐动作期望hash、before字段；comment另有稳定关联/读前游标；close与label等分别记录。读回精确字段/评论及状态，不用最后一条item代表整个操作。多步中途异常会丢前步详细返回；不得重放comment/全包；现有issue-writes、graph-writes；缺每步故障后恢复/他人并发改正文/签名审批 |
| `deck_issue_report` | required key:string（规范去#与前导0）；note?:string（最多200回显、不入链）；effortId? | data:{key,title,state,url,backendId,effortId,chain:{recorded,reason,count},note}；status:'ok' 可chain.recorded:false；顶层workspace/backend/repo按共同壳。chain.recorded:true还不证明磁盘成功（见下节） | localStateKey=session-tickets、repository/backend、可信本机thread/shard、issueNumber、effort及action=report、before/expected状态hash。票存在性仅说明可读到票；必须核对处理链读数/磁盘，不能当作已认领assignee/改issue正文/已关闭。原deck-tools测试仅注册与schema；缺report真实持久回读/写失败/晚到flush恢复 |

这里的5项包含本地写而不止GitHub：创建票还可能触发manual naming本机记录，建图可能写plan cursor，report只写本机处理链，不改GitHub issue。Markdown等后端的能力与fs gate是否允许是运行时事实；不能因工具名开放就绕过本机fs门，也不能把GitHub夹具验收外推为所有后端通过。

### report 必须区分“工具结束、内存链、磁盘链”

精确源码/读回定位（均冻结V）：

1. `lib/tools/deckIssueReport.js:101-148` 先tracker.get验证票，再带 `sessionId:s.sessionId,rootKey:s.cwd,backend,ticketKey:key,verb:'report'` 调chainNote；hook有5秒竞速。失败/超时仍可返回status:ok，且note不落链。返回不含原始sessionId，应以本机已核验执行上下文/owner绑定。
2. `lib/refresh/sessionTickets.js:117-145` 更新内存，`saved=await flush({silent:true})` 后不论saved.ok都返回recorded:true。`flush:152-177` 才返回真正写盘ok，写失败被捕获。因此 `{ok:true,status:'ok',data.chain.recorded:true}` 至多证明内存链接受，不证明重启后仍在。
3. `lib/refresh/wiring.js:239-241` 的 `chainReadoutOf()` 调 `lib/refresh/sessionChainReadout.js:84`；`lib/sessionSnapshot.js:44-45` / `snapshotEnvelope.js:66-67` 将它挂在 `snapshot.sessionTickets`。形状是 `{ok,at,reason,sessions:[{shardId,backend,entries:[{ticketKey,effortId,at,action}]}]}`。这是内存snapshot；**RPC `chain` 是环境检查链，不是这个sessionTickets处理链读回接口**。
4. 持久文件由 `sessionTickets.js:103-106` 的fileOf确定为真实cacheDir的`session-tickets.json`。读前由本机worker/dataRoot解析文件，不能猜主仓/当前cwd。`shared/refresh/chain.js:279-346` 提供chainToDisk/chainFromDisk；盘结构 `{v,at,shards:[{s:shardId,r:rootHash,b:backend,e:[[ticketKey,effortId,at,action],...]}]}`（兼容v1需用现有parser）。`chainRootHash(rootKey)`在:33，`chainSessionShardId(sessionId)`在:38。
5. durable成功至少验证：D工具/规范key/workspace/repo一致，chain.recorded===true，磁盘parser接受的目标shard/root/backend中存在正确key/effort/action=report；必要时本机新实例重载证明。已有同key记录要看本次前后事实/时间和去重语义，不能凭count增加（最多20张/去重，本来就可能不增加）。

## 5. 明确不扩开的分支

`setupLayout({layout:null/undefined})` 是read，可读布局；提供layout（即使是空串）则被classified为write，但**不在17项ENABLED_WRITE_ENDPOINTS**。写wrapper能识别为写，不代表node host准执行：当前应拒绝 `Write endpoint is still not enabled in this ticket: setupLayout`。不得通过read wrapper、grant别名、带cwd或条件判断漏洞开放它。上游布局写single/multi到choices的实现存在，也不改变本port现状。

其余8条仍未启用：`namingRegister/registerNewSessionWatcher/namingSignal/namingResult` 不恢复自动命名守护；`pickDirectory/pickFile` 无宿主picker；`updateInstall/deckExec` unsupported。尤其不新增任务引擎、自动发送草稿、改聊天名。符合ADR-0002的宿主可编辑未发送草稿边界。

`deck_host_context_probe({capture})` 由wrapper单独将脱敏上下文持久化；它不是22项业务写之一，不能凭其允许绕过grant/ledger，也不能把capture当可信审批证据。若将来改它的诊断持久化模型，应另列目标与保留策略。

## 6. 已有测试的安全复用与本次结果

本次只重跑以下已审阅脚本；默认工作目录是#44 worktree。测试路径前缀均为冻结候选 `A/`。

| 脚本 | 本次结果 | 证明边界 |
| --- | --- | --- |
| `verify-write-policy.mjs` | PASS：25 write端点+条件setupLayout，26 policy、9 deck policy | 清单/策略覆盖，不执行真实写 |
| `verify-write-gate.mjs` | PASS：12允许模板、21拒绝形状、4 gate methods | 精确gh argv门；不证明GitHub实际结果/逐次审批 |
| `verify-graph-write-gate.mjs` | PASS：native关系模板、当前operation ID来源、repo/tool边界/拒绝 | 纯gate，不向GitHub写 |
| `verify-publish-flow.mjs` | 初次sandbox失败；受控 `require_escalated` 复验PASS | 真实临时本地Git+本地bare remote，gh/auth全部假transport；publish→half-created→failed retry→successful retry，无重复create。不是在线GH或真实UI审批验收 |

publish首次第54行retry.ok断言失败，诊断捕获真实Git `sh.exe` 的 `NtCreateDirectoryObject(\\BaseNamedObjects\\msys-2.0S5-...): 0xC0000022`。复验只提升该已审阅临时夹具，并额外包装execFileSync：每次push读取夹具.git/config，若URL为http/ssh/git@则拒绝，避免意外在线目标；复验通过，确认是sandbox命名对象权限限制。没改测试源/核心文件，没调用真实gh/auth。不能把这个环境失败算产品缺陷，也不能把复验通过算完整远程写验收。

其余现有脚本只核对源码、未在本次直接执行：

* `verify-version-control-write.mjs`：自建tmp Git/bare/peer，覆盖6个Git写、stale票/replay、divergence、config备份，附JSDOM `verify-git-write-ui.mjs`。复用前加隔离CODEX_HOME/data root与阻网保护；不依赖用户仓库。需要排除初始化后台真实gh调用，不能因“local bare”注释直接假设整个host无联网。
* `verify-publish-flow.mjs`：假GH适合AFK；还需init已有origin分支、owner身份回显不一致、半成功但回包丢失、config备份恢复、hooks/配置污染拒绝。
* `verify-issue-writes.mjs`、`verify-graph-writes.mjs`、`verify-online-git-network.mjs`、`verify-pr-page.mjs`：含真实GitHub创建/评论/配色/关重开/边或push；不直接对当前业务repo运行。
* `verify-handoff-naming.mjs`：自建Codex home与handoff/manual JSON，适合移植隔离恢复验收；`verify-manual-naming-mcp.mjs`含可选真实建票段，须禁用该段再做纯本地验收。
* `verify-settings-page.mjs`：JSDOM + MCP，含日志开关实际写与outside open拒绝；默认repoRoot/data落点要先隔离，不能借测试改用户开关/日志。它不证明原生Explorer显示。
* `verify-deck-tools.mjs`：9工具注册/schema/read-routing基础，**没有report盘成功的等价测试**；`verify-rpc-manifest/coverage.mjs`是路由/坏参覆盖，不是所有写的真实接受证据。
* `prototypes/remote-companion/write-ledger-test.mjs` 与实施中的 `companion-test.mjs`：安装级互斥/重放/晚到/受限grant基础，应与每项方法的真实状态读回组合，不能替代上述逐方法验收。

## 7. 推荐AFK并行验收分组与最小GitHub夹具

不同组使用不同可信project roots、独立worker/data root/本地夹具。不要用不同thread/pairing对同项目并行写绕过屏障。对于同一项目的22项，尤其多步map/patch/publication，必须串行执行并等终局。

| 组 | 无人值守可做的内容 | 验收完成条件 / 隔离资源 |
| --- | --- | --- |
| A：纯policy/协议拒绝 | 清单17+5；只读路由拒写；setupLayout/8未开放拒绝；伪owner/根/参数/跨session冲突；故意缺签名不冒充确认 | 不产生业务写；全部拒绝有前dispatch证据；可并行，无GitHub |
| B：Git本地 | 六Git写，独立tmp project/bare/peer；坏票、literal path、stale、late success、disconnect、crash/restart、安装ledger跨pairing屏障；发布用假GH | exact index/HEAD/ref/config对账；unknown时新写确实被挡；网络origin拒绝；本地资源与用户hooks隔离 |
| C：本机状态 | report持久链（fake tracker读取票）、bind文件与choices、manual cancel、日志开关/清空；handoff只读解析 | 每项文件before/after与新实例重载；模拟磁盘写失败/超时并核对真实reported状态；不触碰真实用户配置和日志 |
| D：外部GH/网络Git | 独立repo中的create/patch/comment/color/graph、真实push/fetch/pull；冻结审批语义后才开此repo的精确grant | 每个原子副作用有远端独立读回；partial/丢包不重票/重评/重推；需要明确独立fixture repo，不占用map#38真实票 |
| E：宿主/HITL | 真实approve/deny、原版确认框、窗口打开、动态主题、切聊天/项目、sleep/reconnect后正确恢复与草稿未发送 | 用户醒来后真实操作/可观测宿主事件；只有实际完成才勾选，不用自动化模拟签名代替 |

**最小新的独立GitHub资源：**一个专用private fixture repo用于四deck GH写、评论/改色/关系与六Git网络写，repo说明明确“临时验收、无人维护业务”；启用Issues，授予当前本机GitHub身份该repo所需的issue/metadata/content写权限。禁用Actions和其他有费用/业务副作用的集成，不建CI、Pages、Packages、大文件；不改当前正式repo权限/branch protection。repo中至少准备：一个map父、两个task（形成parent+blocked-by）、一个可改title/body/assignee/close-reopen的票，一个唯一测试label与一个测试分支；可复用同批票，保持稳定marker/planId用于唯一读回，避免无限建票。

真实`initPublish`本来就要新建仓库，因此若要覆盖其真实建仓，**还需一个唯一的新repo名称/最终创建出的第二个空fixture repo**（从一个独立无Git本地目录起步），随后同repo验retryPush；已有fixture repo不能替代“确实创建了新的repo”的测试。假GH的本地发布测试可以先完成，不消耗新线上repo；真实发布验收后仅关闭测试issues、保留证据，不自动删除repo。独立repo创建/权限必须有现有授权或最终明确批准后执行；本盘点没有创建它们。

**费用边界：**这些AFK组不需要新增Render服务、付费compute、磁盘、数据库或云端凭据。继续现有free relay；本机Git/SQLite/假GH不产生服务账单。GitHub Issues/API的预算数字是限流预算，不是付费金额；冻结值为AI单次600 points/400 requests、每小时2000/1500、单次子票60，plugin hourly cap1750，不能把它们当消费通知阈值。真实外部组采用最小批量和读回，禁Actions避免触发构建；不要宣称当前账户免费余额/支付方式已核实。用户已说“超免费限额后通知消费”，不等于已批准付费升级/自动购买；本清单不改变账单配置、不承诺工具拿不到的实时费用告警。

## 8. 下一步实施顺序与真实未完成项

优先完成试验切片的真实结果判据：gitStage精确索引、report磁盘链，而不只把17+5名字塞进grant。随后按B/C组为每方法实现本机intent提取、终局判定、只读reconciler及故障测试，再逐组加入明确本机method/project allowlist。group D在独立repo和相应授权落实后再做；保留既有UI/approval语义。每完成一组，在#44正文写清“本地隔离/真实远程/真人确认”的不同证据，不将分组通过外推为全量通过。

本文结论：17 RPC + 5 deck写的参数、已有gate、成功信封、typed intent需求、读回/unknown规则和测试复用均已盘点；**22项全量remote grant、逐项恢复器、真实GitHub写回与逐次HITL尚未由本文实现/验收**。#44不能因本文或两方法切片关闭。

### 盘点后新增的意图模块（不改变上述验收边界）

`prototypes/remote-companion/write-intents.mjs` 提供 `buildWriteIntent(input,localDeps)` → `{method,parametersSha256,target}`，以及 `prepareWriteIntent` → `{intent,facts}`，后者facts仅供可信本机后续verifier使用，不能直接发到relay或当成功证明。input的projectRoot/threadId来自调用前已通过grant的本机resolver；parameters只放原RPC payload或原deck args，不接受事实/授权/confirmed同名字段。当前policy的22方法均有typed intent分支；setupLayout与未开放方法拒绝。

默认B组reader使用固定本地Git只读配方、不调用gh/auth/network；对索引和工作树读前状态做指纹，不以原始WT字节hash冒充经过CRLF/filter的Git blobOID。默认C组reader使用可信`dataRootFor`实际文件预读；缺可信读数失败关闭。fetch/pull/push的目标必须来自注入`readGitTicket`读取的本机预检票，不能从无remote的write payload推测。GH预读只通过可信`readBackend/readTracker/readGithubIdentity/readPublicationRecord`依赖注入，本模块没有自动在线调用。创建参数的idempotencyKey/planId保持上游可选，本地operation correlation不能冒充上游幂等保证。

`node --test prototypes/remote-companion/write-intents-test.mjs`：**11/11通过**。覆盖22/22生成结果实际进入既有WriteLedger target validators，真实隔离Git的HEAD/index保持、实际C组文件变化、缺前提/伪根/错票/错repo拒绝、原有可选anchor语义。初次Windows sandbox不允许junction创建，测试明确诊断该分支未执行；随后只提升同一组自有隔离夹具复验，**11/11再次通过且实际执行junction越界拒绝**，无诊断跳过、无在线Git/gh/auth。这个模块既不开放grant，也不实现逐方法成功/恢复判据。
