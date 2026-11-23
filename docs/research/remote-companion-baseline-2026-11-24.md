# 远程组件迁移候选基线清点

日期：2026-11-24（Asia/Shanghai）。对应[正式实施规格](https://github.com/wozhendeshifwa/matt_pocock_plugin/issues/44)，承接[全部能力研究](https://github.com/wozhendeshifwa/matt_pocock_plugin/issues/40)与[当前客户端兼容性验证](https://github.com/wozhendeshifwa/matt_pocock_plugin/issues/43)。本报告只清点现状与执行局部验证，不冻结发布、不替用户验收 WIP，也不修改业务源文件、配置或部署。

## 当前候选与可追溯性

主工作区 HEAD 为 `701029b1efcdac8d4faedffe5955293efecc36a8`。该提交与当前实际源文件、构建产物不是同一个版本：port 有 **15 个已跟踪文件变更、23 个未跟踪文件**，vendor 没有变更。完整相对路径、文件大小与 SHA-256 存在[候选清单 JSON](remote-companion-baseline-2026-11-24.json)。最终清单捕获于 `2026-11-23T17:55:30.8374394Z`，包含 port 95 份、vendor 355 份，共 **450 份**源码/静态产物，合计 8,006,916 字节；清单文件本身 SHA-256 为 `5390342ff96c94f3d3884853e2631d92f3a56cd0c1cc9aa37a96b83aee4dacef`。

首份阶段清单在 `2026-11-23T17:49:42.5015163Z` 仅按源码扩展名筛选 417 份（SHA-256 `1f1845af581a0b620e0f39a023c4e96bbfe813cdc6be77756b83aee3ac7ef8cc`）。冻结前已补入原封 vendor 的许可证、VERSION、27 份 agent YAML 元数据、两个技能 shell 模板及 `cordis.patch.yml` 共 33 份，避免把不完整的 vendor 替代为全部功能候选。JSON 保留前一清单摘要与补充原因；未改变上游文件。

清单排除 `node_modules`、`.scratch`、`.git`、`.env`、`*.secret` 及用户 home/认证文件。没有调用真实 `createSnapshotCacheIdentity()`，没有读取 Git/gh 凭据内容。首轮验证后重新比对全部 417 份文件，未发现捕获期间源文件漂移；最终冻结还会校验全部 450 份原始文件的哈希并拒绝额外路径。

本轮正式组件分支起点是 `06f4ed9e956bdfa50512342de6e29bb50149588a`（原探针证据加脱敏复现模板补丁）；它不包含主工作区这些业务 WIP。连接层此前在该分支使用旧提交的 adapter 做局部测试，不能据此声称当前实际版本的全部业务已经保留；后续冻结候选的独立版本与修正见下节。

| 关键产物 | 当前 SHA-256 |
| --- | --- |
| `prototypes/upstream-port/dist/client.js` | `f6ddc3460a3a7dabfa2798ef354fed0287a97473e2f059ac92ae92a1895f2c66` |
| `prototypes/upstream-port/dist/manifest.json` | `408ed6944cc3b7f69b860aee0e4b106843a037c4a9cf5c3484dca39189ce936c` |
| `prototypes/upstream-port/node-host.mjs` | `e0b0932cab497a5addc7060cbdfd2209bf461b11c60d0bd8cc96167458d37523` |
| `prototypes/upstream-port/project-worker.mjs` | `357bf6bd2b6c7c0c608493d6a78587c95b3bf41a3fa3a4478700a145b52747d5` |
| `prototypes/upstream-port/rpc-endpoints.mjs` | `5d02cc8844acddc9661da9ddd5a3028d81c6214163e3a7ae0ba427112d6ddf18` |
| `prototypes/upstream-port/sidebar-server.mjs` | `05cca89a58269503d555d5a275dee561b66fda6956663d88659eae66a6c38a29` |
| `prototypes/upstream-port/snapshot-cache-identity.mjs` | `d816fdcedbe86880dcdbdaaf2d26663304eb8ee71e4f788ea2e4606a17d10d46` |
| `vendor/mattskills-1.8.0-rc.7/lib/client.js` | `f78b6b17073453b4327d7d6e9cb1e55db8aa6d6a9e9b384d53bc24d79f1570ce` |

## 差异范围

已跟踪业务/产物变更为 `build.mjs`、`dist/client.js`、`dist/manifest.json`、`project-worker.mjs`、`rpc-endpoints.mjs`、`sidebar-bridge.js`、`theme.css`、`upstream-host.mjs`。另有 7 份已有验证脚本变更：`verify-build`、`verify-handoff-view`、`verify-map-view`、`verify-project-switch`、`verify-rpc-manifest`、`verify-skills-page`、`verify-version-control-view`。

未跟踪的实际运行/构建依赖包括 `project-snapshot-cache.mjs`、`snapshot-cache-identity.mjs`、`skill-prefix-client.mjs`；另有 timeout 配置工具、测量/在线 Git 验证/视觉预览及其说明文件。完整 23 份列表在 JSON 的 `status` 字段中。运行模块、构建依赖和仅开发用脚本应分别核对是否进入发布包；本报告未把它们整包提交或自动纳入部署。

静态差异显示，快照缓存、预检并发、宿主草稿技能前缀、交接/看板动作、主题与界面，以及已有验证脚本均与旧提交不同。不能只发布旧 `701029b` 产物同时宣称保留当前体验；也不能因部分局部验证通过就把全部 WIP 标为已验收。

## 实际能力清单与开放边界

从当前 `rpc-endpoints.mjs` 与 vendor 的 `harness.handle` 注册逐项比对，仍为 **56/56 个上游 RPC：31 读、25 写**，无缺项、无额外上游端点。`setupLayout` 无 `layout` 值为读，有值为写。另有适配器读取 `portSnapshotCache`，不计入上游 56 个；该能力只存在于当前 WIP，不能套用到旧提交的 adapter。

31 个读端点：

```text
awaitCreatedIssue, bindings, chain, cwd, detect, focus, gateStats,
gitDiff, gitLog, gitStatus, gitWriteCheck, handoffLatest,
issueComments, issueDetail, issuesPage, listLabels,
logBatch, logExport, logGetSwitch, mapTickets, namingPlan, probe,
refresh, registry, selection, setupLayout, skill.readDoc, snapshot,
updateChangelog, updateCheck, updateStatus
```

25 个写端点：

```text
bind, cancelNewSessionWatcher, commentIssue, deckExec,
gitCommit, gitFetch, gitPull, gitPush, gitStage, gitUnstage,
handoffResolve, initPublish, logClear, logSetSwitch,
namingRegister, namingResult, namingSignal, openFolder, openPath,
pickDirectory, pickFile, registerNewSessionWatcher, retryPush,
setLabelColors, updateInstall
```

当前 `ENABLED_WRITE_ENDPOINTS` 实际开放 17 个：`commentIssue`、`setLabelColors`、`bind`、`handoffResolve`、`cancelNewSessionWatcher`、`logSetSwitch`、`logClear`、`openFolder`、`openPath`、`gitStage`、`gitUnstage`、`gitCommit`、`gitPull`、`gitFetch`、`gitPush`、`initPublish`、`retryPush`。这只证明本机白名单开放，仍受各自命令/路径、项目与审批闸约束，不代表跨网络已经授权或验收。

其余 8 个写 RPC 不应宣称可用：4 个自动命名/watcher 接口保留禁用结果；`pickDirectory`/`pickFile` 缺宿主选择器；`updateInstall`/`deckExec` 明确 unsupported。条件写 `setupLayout` 另有策略但不在实际写开放清单。读取类也不代表“零本地副作用”：例如 `logBatch` 会接收本地日志。

9 个 deck 定义与策略逐项一致：

| 分类 | 工具 |
| --- | --- |
| 读（4） | `deck_context`、`deck_issue_get`、`deck_map_snapshot`、`deck_issue_list` |
| GitHub 写（4） | `deck_issue_create`、`deck_map_plan_create`、`deck_map_link`、`deck_issue_patch` |
| 本机状态写（1） | `deck_issue_report` |

6 个服务外层工具仍为 `deck_current_project`、`open_deck_sidebar_probe`、`deck_upstream_read`、`deck_upstream_write`、`deck_rpc_manifest`、`deck_host_context_probe`；当前 MCP 总计 15 个原工具。`deck_host_context_probe` 是本机诊断写，不能把它的 read/write annotation 与业务读取混为一谈。

技能来源仍为 vendor 的 27 项，`skills-service.mjs` 明确不扫描用户 DSH profiles。当前前缀适配覆盖这些技能与 46 份双语提示模板。UI、设置/检查、日志/状态/运行、GitHub issue/map/PR、文件/Git、会话/项目跟随及草稿行为的职责继续按原能力研究分配到本机；旧 `sidebar-probe` 的独立任务引擎不纳入本 port 的迁移验收，遵循 ADR-0002。

## 本次运行的检查

这些检查都针对当前主工作区候选，而非正式云端全链路。未调用真实 GitHub、未改真实 Codex 配置、未启动 UI 或改主工作区 `dist`。

| 检查 | 结果及证据边界 |
| --- | --- |
| `node prototypes/upstream-port/verify-rpc-manifest.mjs` | 通过，56 个注册、31 读/25 写、条件路由及适配读分类 |
| `node prototypes/upstream-port/verify-write-policy.mjs` | 通过，25 写 RPC 加条件项、9 deck 策略、2 项明确 unsupported；不是写业务端到端执行 |
| `node prototypes/upstream-port/verify-project-switch.mjs` | 通过，JSDOM 同项目/子目录、跨项目、切回、旧面板及无项目/缺身份拒绝；不是实际桌面项目切换 |
| `node prototypes/upstream-port/verify-skill-prefix.mjs` | 通过，27 技能、46 双语模板、去重、剪贴板、URL/路径保留及锚点失配拒绝 |
| `node prototypes/upstream-port/verify-project-snapshot-cache.mjs` | 通过，stub identity 的缓存水合、项目/绑定/变更隔离、旧回包、过期与强制读取；不验证真实身份指纹的文件落点 |
| `node prototypes/upstream-port/verify-preflight-concurrency.mjs` | 通过，stub auth/repo 并行且鉴权先于访问，失败边界；不调用实际 gh 认证 |
| `node prototypes/upstream-port/build.mjs --outdir <全新隔离目录>` | 通过。输出至本 worktree 忽略目录 `.scratch/baseline-build-d4998b04a6a84995a1355fd53339b1e0`，与主工作区 `dist/client.js`、`dist/manifest.json` 的 SHA-256 **均完全相同**。没有覆盖主 `dist` |

`verify-build.mjs` 已确认仅读取传入 snapshot/detail 与现有 dist、在 JSDOM 操作，但它要求完整列表/详情夹具；本次没有使用真实项目快照或擅自补写外部数据，因此未运行该全 UI 检查。现有原始输入、实际宿主、完整业务矩阵与网络 Git 验收需另行留证。没有运行会接触真实认证文件的 cache identity 路径。

## 缓存指纹目录风险：当前仍存在，未修复

源码链路可以直接确认目录不一致：

1. `sidebar-server.mjs:17` 按 adapter 路径生成自己的 `.scratch/upstream-sidebar/<key>`；`project-hosts.mjs:9` 为每个项目创建独立子目录并作为 worker cwd。
2. `project-worker.mjs:8` 把该 cwd 作为 `dataRoot`。`node-host.mjs:318` 创建 vendor platform 时注入 `homedir: () => dataRoot`。
3. vendor `platformChannel.js:335` 将 `platform.getHome()` 提供给 choice store；`choiceStore.js:38–45,143–146` 因而从 **worker dataRoot** 下的 `.dsh/mattskillsdeck/choices.json` 读取实际后端选择。
4. 当前 `snapshot-cache-identity.mjs:20–24` 却用 `node:os.homedir()` 指向用户 home 下的同名 `choices.json`；`project-worker.mjs:11` 也没有把真实 dataRoot 传给该身份工厂。

所以实际后端选择文件改变时，指纹可能不变；缓存水合仍可能采用旧后端快照，直到另一项身份变化或 TTL 使其失效。前述 stub identity 测试通过不能否认这个风险。本次只读核实，没有打开任一真实 choices/gh 文件，没有修源码，也没有把旧 P2 不经核实判成已解决。

## 已冻结的隔离候选

在保留主工作区原始 WIP 的前提下，已用 `prototypes/remote-companion/freeze-adapter.mjs` 把最终 450 项输入冻结到本 worktree 忽略目录 `.scratch/frozen-adapter-20261124-choices-v1`。它保留 `prototypes/upstream-port` 与 vendor 相对布局；不复制 `node_modules`、运行数据、Git/gh 配置或会话库。清单中的开发/测量/验证脚本原封保留作来源记录，冻结器不会执行它们，也不会自动安装 vendor 的 npm prepare 脚本。

冻结器硬锁输入清单摘要；拒绝输入哈希/大小漂移、缺失或额外文件、重复/越界/链接路径、修正锚点漂移、已存在输出目录和本 worktree `.scratch` 外的输出。已验证的输入字节保留在内存后再复制，并逐文件读回 SHA-256，避免混入中途变化的版本。输出 `frozen-adapter.json` 保存原始/最终文件摘要、`choices-data-root-v1` 修正版本及 `userAccepted: false`。

只有生成副本中的两个文件采用精确锚点修正，主工作区原文件没有改变：

| 文件 | 修正后的行为 | 最终 SHA-256 |
| --- | --- | --- |
| `project-worker.mjs` | 显式传入 `{ dataRoot: process.cwd() }` | `6bb5ff3e945edeafd80c014a5b341b991373c573138a5505b8d4ee7dc0137b68` |
| `snapshot-cache-identity.mjs` | choices 路径使用已解析的本机 dataRoot；缺失/非绝对 dataRoot 时，在读取配置或执行 Git 前返回 null。GitHub 配置仍保持原本机归属 | `fb0dbc3fdb60c9e2e40ffd36a35e8e634954c752517c12e3b65d15c59f72a454` |

因此这份候选是“当前原始 WIP + 两项可追溯 overlay 修正”，不是原包、旧提交或已被用户接受的完整发布。实际候选 manifest 的 SHA-256 为 `9409bb077951e53821417dc4420923925c993c0910408fa9aaa7bc89cea2fc47`；入口为该候选内的 `prototypes/upstream-port/sidebar-server.mjs`。只读 `verifyFrozenAdapter({ directory, expectedManifestSha256 })` 已用此固定摘要校验 manifest 与全部 450 文件；候选后续被改动时会拒绝通过。

重建时从主工作区根运行，选择全新输出，不覆盖已有候选：

```powershell
$candidateOutput = Join-Path (Get-Location) ('.scratch/wayfinder-render-44/.scratch/frozen-adapter-' + [Guid]::NewGuid().ToString('N'))
node .scratch/wayfinder-render-44/prototypes/remote-companion/freeze-adapter.mjs (Get-Location).Path $candidateOutput
```

如果源文件在原清单后已经变化，重建会拒绝；应先重新盘点并审查新的输入清单，不能跳过摘要校验。命令只冻结候选，不启动组件、配对、自启或业务写入。

## 修正验证与未完成边界

`node --test prototypes/remote-companion/freeze-test.mjs` 在正式 worktree 中 **4/4 通过**：原封静态文件/许可证保留、只改两项 overlay、拒绝覆盖/漂移/额外路径/篡改 manifest/错锚点/越界输出，以及冻结后篡改检测。意义测试在隔离假项目、假 Git 配置、假 gh 目录和仅对子进程生效的假 home 中执行真实 identity 调用；没有读取真实认证文件或改变宿主 HOME。

相同断言先在原函数上实际失败（dataRoot 下 choices 变化未改变指纹），再在冻结副本上通过：正确 dataRoot 变化会使指纹变化，错误 home 下同名 choices 变化不会代替它，未传 dataRoot 则返回 null。测试结束也验证原始函数文件哈希不变；临时测试目录在确认解析路径位于专用测试根后清理。

仍需把此明确候选与正式组件配对、协议版本、凭据撤销和未知写入记录绑定，复用既有本机闸；逐项完成 GitHub 与本机业务、主题/技能/草稿和项目切换矩阵。当前主工作区的目录风险仍原样保留，本次只修生成候选。WIP 的最终接受情况、实际 Windows 启停/更新、Render 配额/日志与冷启动、真实 Codex 全链路及用户最终确认仍未由本报告验收。不得将局部检查或探针关闭票数换算成产品完成度。
