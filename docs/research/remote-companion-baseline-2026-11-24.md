# 远程组件迁移候选基线清点

日期：2026-11-24（Asia/Shanghai）。对应[正式实施规格](https://github.com/wozhendeshifwa/matt_pocock_plugin/issues/44)，承接[全部能力研究](https://github.com/wozhendeshifwa/matt_pocock_plugin/issues/40)与[当前客户端兼容性验证](https://github.com/wozhendeshifwa/matt_pocock_plugin/issues/43)。本报告只清点现状与执行局部验证，不冻结发布、不替用户验收 WIP，也不修改业务源文件、配置或部署。

## 当前候选与可追溯性

主工作区 HEAD 为 `701029b1efcdac8d4faedffe5955293efecc36a8`。该提交与当前实际源文件、构建产物不是同一个版本：port 有 **15 个已跟踪文件变更、23 个未跟踪文件**，vendor 没有变更。完整相对路径、文件大小与 SHA-256 存在[候选清单 JSON](remote-companion-baseline-2026-11-24.json)。清单捕获于 `2026-11-23T17:49:42.5015163Z`，包含 port 95 份、vendor 322 份，共 417 份源码/静态产物，合计 7,990,160 字节；清单文件本身 SHA-256 为 `1f1845af581a0b620e0f39a023c4e96bbfe813cdc6be77756b83aee3ac7ef8cc`。

清单排除 `node_modules`、`.scratch`、`.git`、`.env`、`*.secret` 及用户 home/认证文件。没有调用真实 `createSnapshotCacheIdentity()`，没有读取 Git/gh 凭据内容。验证后重新比对全部 417 份文件，未发现捕获期间源文件漂移。

正式组件分支的检查点是 `06f4ed9e956bdfa50512342de6e29bb50149588a`（原探针证据加脱敏复现模板补丁）；它不包含主工作区这些业务 WIP。连接层在该分支使用旧提交的 adapter 做局部测试，不能据此声称当前实际版本的全部业务已经保留。

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

## 最小可冻结候选与下一步

当前最小可追溯候选是“`701029b` 加 JSON 清单所列当前 adapter 源文件/静态 dist”，而不是一个已发布提交。可在独立目录复制运行/构建必需文件及原封 vendor、按上述哈希逐项读回，再记录完整候选版本；测量、预览、在线测试和配置工具不因位于同目录就自动进入运行包。冻结前重新检查漂移；本报告和哈希清单本身不等于已经复制或冻结了组件。

应先在隔离候选中解决并验证真实 dataRoot 指纹落点，或清楚暂停该缓存能力并呈现其影响供用户决定；不能默默部署旧 adapter 来绕过当前体验要求。无需回头重复采访已确认的云端入口/本机完整业务方向。

此后还需把选定候选与正式组件配对、协议版本、凭据撤销和未知写入记录绑定，复用既有本机闸；逐项完成 GitHub 与本机业务、主题/技能/草稿和项目切换矩阵。主工作区 WIP 的接受情况、实际 Windows 启停/更新、Render 配额/日志与冷启动、真实 Codex 全链路及用户最终确认仍未由本报告验收。不得将局部 7 项检查或探针关闭票数换算成产品完成度。
