# #44 GitHub D 组专用夹具

2026-11-24 北京时间。**v4 bootstrap、真实 v3 旧数据导入、两个 immutable v4 目录共用稳定数据根均已通过**。D6 真实 GitHub 写入验收另记逐项证据；bootstrap 成功本身不代表 GitHub 写验收或真人审批。

## 固定边界

* 仓库仅限 private `wozhendeshifwa/deck-remote-acceptance-44`，Actions 由独立 REST GET 确认为 false，Issues 开启。未访问正式 map 仓库或 Render `deck-relay-44`。
* owned 本机 Git 项目的唯一 origin 指向该专仓；仅 seed commit，没有 push/fetch/pull、workflow、CI 或发布。
* SDK `1.32.2` → 本机 `127.0.0.1` relay → companion → 真 stdio adapter。UUID/项目注册来自夹具 fake CODEX_HOME 和手工 SDK metadata；没有真实 Codex 聊天、宿主确认签名或 HITL 证据。
* 原 v3、两个 v4 runtime 均按450项 manifest 逐字节复制、再独立校验，源和 immutable 副本代码不打补丁。
* 原 `gh auth token --hostname github.com` 输出只进入内存和 child `GH_TOKEN`，不打印、不落盘。空 GH 配置、Git 全局/系统配置、hooks 和 fake HOME 均在夹具目录，不复制原 gh 配置或 provider。错误仅输出脱敏分类码。
* 安装夹具 ledger/journal 跨 run 保留。unknown/running 阻断新写；禁止删库、reset 或换配对逃避屏障，也禁止未知结果盲重放。
* 每次运行 finally 只停止自身 SDK/client、companion、stdio 和 loopback；不停止原 readonly 生产组件。

## 本机上下文

夹具目录：`C:\Users\27263\Desktop\matt_pocock_\.scratch\wayfinder-render-44\.scratch\github-fixture-44`。

| 项 | 相对夹具目录 |
| --- | --- |
| 固定非敏感上下文 | `local-context.json`，schema1原内容不改 |
| owned 项目 | `owned-project` |
| fake Codex / 用户 home | `fake-codex-home` / `fake-os-home` |
| 空 gh / Git config / hooks | `empty-gh-config` / `empty-git-config` / `empty-hooks` |
| 保留原 v3 runtime | `reviewed-runtime-v3` |
| 两个 v4 runtime | `reviewed-runtime-v4-a` / `reviewed-runtime-v4-b` |
| 稳定业务数据根 | `installation/local-state/data` |
| **固定安装 ledger** | `installation/write-ledger.sqlite` |
| 响应 journal | `fixture-response-journal.sqlite` |
| 可恢复导入记录 / 原数据快照 | `installation/stable-data-import-v3.json` / `installation/snapshots/owned-v3-before-stable-1795463839782` |

固定假 UUID 为 `d8f1397d-2027-4f41-8daf-f0fa9def9dbb`。原 bind 只真实执行一次，operationId `923aba4b61c7172aa3e9de51d99c7f1b14cebe350b1d3bce0c1f38a7b29025af`，`completed/succeeded`。后续 bootstrap 读取保留 journal 回包并核对真实 choices/workspace，未重放 bind。

## 冻结版本和升级证据

| 版本 | Manifest SHA256 | 行为 |
| --- | --- | --- |
| reviewed v3 | `4b6e2183a3c3b0226cd88629fa5fa2e17ddb456e9b7114985190c928b1cc2a6b` | 保留原按 adapter 目录 hash 的 dataRoot；没有显式根 seam |
| reviewed v4 | `fc0fd6325f929f6cc03f5deb3071d1ea7621e6f71db554714f6ec510322594f1` | stdio `DECK_LOCAL_DATA_ROOT` 与 effect `localDataRoot` 同根；原 `listLabels` 真实通过 |

[连续性证据](../../.scratch/github-fixture-44/continuity-v4-1795463866387.json)记录：先用原 v3 真 stdio 只读 choices/log switch/context；关闭自身组件并通过本机进程读回确认 owned runtime Node 数为0；用 `local-data-upgrade` 只读 plan/snapshot API 保存5文件、9796字节，再向全新稳定根独立复制，校验源前后及目标 inventory SHA256 完全相同，保留原目录与快照。快照 manifest SHA256 `cfabffe5d139d6ccb1106bb663f10e7e8484f407f1e313b590871fc94e0b7d6b`，仍明确 `activationReady:false`。

随后两个不同路径、相同 v4 字节的运行副本读取同一稳定根，choices SHA256均为 `8595f6f5dea35776067a97579645ad1125a9a45ddd68d131a323da7f62893867`，workspace文件 SHA256、原ledger历史一致；只读 log switch为 `enabled:false,sampleRate:1`，原先没有开关文件，没有把缺省值冒充磁盘写入。两个v4目录均未产生版本hash fallback业务目录。

这是**真实 v3 legacy → snapshot → v4 导入，加两个 immutable v4目录的数据连续性**。原v3不支持显式根，所以没有宣称“两个代码版本共用显式根”，更不是正式 Windows 安装迁移、失败回退或 HITL 已验收。

[v4 bind-only bootstrap](../../.scratch/github-fixture-44/bootstrap-2026-11-23T19-59-07-066Z.json)进一步确认 exact repo/root/thread、initialized:true、原bind持久状态、真实原 `listLabels` 与独立REST完整列表一致。此时业务写为0、issue数为0。

历史 v3 [bootstrap](../../.scratch/github-fixture-44/bootstrap-2026-11-23T19-24-11-980Z.json)和[只读诊断](../../.scratch/github-fixture-44/readonly-diagnostic-1795461753712.json)保留。原缺口是vendor真实使用的 `gh label list --repo ... --json name,color,description --limit 1000` 未被read gate接受，v4已修复；v3代码未被覆写。

## 复现入口与写验收

从 #44 worktree 运行：

```powershell
node .scratch/github-fixture-44/bootstrap.mjs
node .scratch/github-fixture-44/continuity-v4.mjs
node .scratch/github-fixture-44/diagnose-readonly.mjs
```

bootstrap默认只有 `bind` grant并要求空issue清单，用于写验收前的准备。D6建票后不要再以“空仓”bootstrap作重复验收；用只读诊断或保留证据。continuity首次导入后也不会重复制快照覆盖已经演进的稳定业务数据。

`withFixtureSession(callback,{runtime,methods})` 的runtime仅允许固定三个选择；methods只接受固定bind+六项D6的唯一子集，默认bind。参数只来自本机测试程序，不接受MCP根、远程命令、任意repo、HOME或token。v3-legacy只能只读。D6运行器启用的六项是 `deck_issue_create/deck_issue_patch/deck_map_link/deck_map_plan_create/commentIssue/setLabelColors`，生产授权仍独立且未改变。loopback与SDK请求上限180秒仅用于真实串行前后读回；不自动重试。

新仓默认只有10个GitHub标签，原task/map/bug建票不会自动建立缺失的标签定义。为防先建票后labelError，已授权仅专仓一次性用固定CLI REST POST准备 `wayfinder:task/wayfinder:map/needs-triage`，其余已有定义保持。它是**夹具准备，不是产品D6能力**；[前后读回证据](../../.scratch/github-fixture-44/label-setup-after-1795464061209.json)共13标签，Actions仍关闭。

```powershell
# 固定3标签准备；已有项仅只读核对，不覆盖
node .scratch/github-fixture-44/prepare-labels.mjs
# 仅一次独立实验run，固定d6-run.json，已有run直接拒绝盲重放
node .scratch/github-fixture-44/d6-acceptance.mjs
```

D6运行器每次原tool/RPC写入前保存关联锚和意图，写后立即保存原回包与安装ledger；再独立REST核对真实issue/原生parent、sub_issues、dependencies、comments和完整label定义。已知成功plan再带同planId追加子票，验证不重复建图；正常闭环后才验缺失标签的terminal partial，已应用颜色再用原RPC恢复。实验票正文和标题标明实验用途，保持open。遇真实API/schema差异或unknown即停，原业务、ledger和证据均保留，交实施者核对，不靠伪造readback通过。

## D6 实际验收结果

[完整D6证据](../../.scratch/github-fixture-44/fixture44-1795464152077-6fdec9ea-acceptance.json)已通过六项真实原tool/RPC：

| 方法 | 独立验收事实 |
| --- | --- |
| `deck_issue_create` | 原task/map自动区块、必需labels及唯一创建锚，实验票#1/#2/#3 |
| `deck_issue_patch` | #1仅替换指定labels；标题、正文、状态、assignees保留 |
| `deck_map_link` | #1原生parent=#2，#2原生sub_issues=[1]，#1 blocked_by=[3] |
| `commentIssue` | 原RPC发出唯一实验comment，独立REST与完整comment页一致 |
| `setLabelColors` | 正常改色及恢复；另一次混合批次真实applied一项/failed一项，缺失标签未创建，已应用颜色随后恢复 |
| `deck_map_plan_create` | 同planId先建#4地图/#5 alpha，已知成功后续建#6 beta；原生sub_issues=[5,6]，beta blocked_by=[5]，计数一致且durable:true |

该run共12次D6写：11条 `completed/succeeded`，1条预期部分失败 `completed/failed`；没有running/unknown，原bind ledger行未替换或重放。六张实验票均保留open，未关闭正式票。

过程中有一次**夹具辅助断言**误报：辅助脚本漏算创建锚冒号后的空格，导致alpha/beta查找为空。原第10次写及独立core verifier实际均已成功。原停止证据未改写；`finish-after-helper-assertion.mjs`仅接受这一个明确错误码、核对所有原ledger行仍已知成功，使用冻结原版 `idempotencyKeyOf`并只读原生父子/阻塞事实后，再执行此前未做过的第11/12次改色负例及恢复。前10次写没有重放，没有重置run/ledger。此恢复脚本不是通用未知结果重放器。

`retry-known-plan.mjs`只在完整验收已通过、原plan operation已知成功且无unknown时，启动全新stdio/SDK，以仅plan本机grant再次发出同planId原工具调用，核对全量issue ID/字段不变。不能用于未知结果重试。

[全新stdio/SDK重试证据](../../.scratch/github-fixture-44/fixture44-1795464152077-6fdec9ea-fresh-process-known-plan-1795464722393-acceptance.json)已真实通过：同planId、地图和子票ID及票面字段完全相同，issue数6→6，返回durable:true，Actions仍false，原安装历史全部保留。

[最后只读清理核验](../../.scratch/github-fixture-44/final-verification-1795464823287.json)：owned runtime Node进程数0，v3及两个v4的450项manifest复核均通过；固定安装ledger共14条，13 succeeded、1预期terminal partial failed，全部completed，无running/unknown。最终未改变生产grant、pairing、provider或原readonly组件，也没有正式仓库业务写。

此验收仅使用既有GitHub private仓库与API配额，没有创建付费服务、磁盘、runner、CI、Actions或执行Git传输。它没有读取或证明Render剩余免费额度，也不能替代正式安装迁移/失败回退或真人宿主审批。
