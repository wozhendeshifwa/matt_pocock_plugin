# 真实 PR 与评论翻页：MCP SDK／假身份，专用私仓真实读取

本轮补齐原读取矩阵中“PR 为 0、评论不足 50 条”的证据缺口。固定 v6 候选经过真实原 stdio adapter、独立回环 relay 和 MCP SDK，完成 **13 次原能力读取**。PR 列表、详情、评论、实际提交差异，以及评论 **50 → 1 → 0** 的真实游标翻页均通过。最终保存响应的 12 项独立离线复核也全部通过。

SDK 使用自己创建的假 Codex SQLite 身份，不是真实宿主界面或 HITL。未给 executor 任何 write grant，未实例化新的安装级 WriteLedger；样本准备由独立固定 REST 脚本完成，属于实验 fixture setup，不能算产品写能力通过。没有修改生产配对、Render、用户配置、provider、原 D6 helper 或已有账本。

## 固定对象与最小样本

复用已完成 publication normal 验收的现有私仓，精确身份从 `.scratch/publication-fixture-44/local-context.json` 和 `normal-completion-1795465596405.json` 读取，再经独立 GET 校验：

- 仓库：`wozhendeshifwa/deck-remote-publication-44-1795465033050-5998d366-normal`，id `1469273700`。
- default/base 分支：`fixture-44`；准备前后及 SDK 读取后 HEAD 均为 `c685f1dbfce47330ec2f6b7261936c9869a5d41b`。
- base README blob 均为 `f0a92e19bfd461f9b781aa942a9739039b523b6e`；原分支与 README 没有改动。
- 独立读取确认 private、Actions disabled；原树仅 README，没有 workflow 或 runner。
- 新实验分支：`deck-pr-read-44-1795466577803-2d040c1d`；只在该分支 README 追加通用实验文字。
- draft PR [#1](https://github.com/wozhendeshifwa/deck-remote-publication-44-1795465033050-5998d366-normal/pull/1)，id `5460894836`；head `9d4a4a07571cb89548a0ad0f0226961e58d4caba`。没有 merge。
- 实验 issue #2，id `6568442868`：51 条唯一、顺序编号的通用评论。PR #1 另有 1 条通用评论，用于真实 PR 评论读取分支；**合计 52 条评论**。

这些内容不带 mention、assignee、reviewer 或业务材料。没有新建仓库、删除任何已有内容、发起 review 或发送消息。

选择一个 PR 有源码依据：原 GitHub PR list 在 `vendor/mattskills-1.8.0-rc.7/lib/tracker/backends/github/issues.js:175` 固定 `first=100`，外部没有小 pageSize；三个 PR 仍不能证明非空第二页。原 `issueComments` 在 `lib/commentThreads.js:39` 固定 `comments(first:50,after)`，原 UI `lib/client.js:10333` 使用 `{number,after}`，因此同一 issue 的 51 条评论是两个非空页的最小样本。原 `issuesPage({limit:2})` 只查询 repository issues，不包含 PR；不能用它声称 PR 翻页通过。

准备脚本串行 mutation，最短间隔 1,250 ms。56 个唯一效果为 branch、分支 README commit、PR、issue 各一项，加 52 条评论。一次 issue 创建收到 201 后，立即列表读回因可见性延迟未找到唯一 anchor，记录 unknown 后停止，没有重新创建；下一轮先 GET 唯一 anchor 找到同一 id，才继续。历史 unknown 记录完整保留；按请求 fingerprint 取最新记录，56 个效果均已 independently confirmed，没有未确认的新建结果。

## 原 SDK 实际结果

| 原能力与输入 | 观察与独立校验 |
| --- | --- |
| `snapshot({})` | 原 PR 区数据出现 #1，`isPullRequest:true`。title、url、author login、updatedAt、labels 与独立 REST 相等；原规范化 state 为 `OPEN`，mergedAt 为 null，reviews 为空数组。 |
| `issueDetail({number:1})` | 原 UI 实际参数无需 PR hint；number/title/body/url/author/createdAt/updatedAt、labels、assignees、首评论与独立 REST 一致。原 GraphQL 详情 state 为小写 `open`，reviews 保留 `{nodes:[]}`。 |
| `issueDetail({number:1,isPullRequest:true})` | 支持原可选 hint；同样成功。 |
| `gitDiff({rev:<真实PR head>,path:'README.md'})` | 通过隔离本地 Git 的只读 fetch 取得该提交对象后调用原 RPC。返回完整 hunk，逐行等于 GitHub PR files API 的 patch；`truncated:false`。没有独立 PR-diff RPC。 |
| `gitDiff({rev:<真实PR head>})` | 文件仅 README，added=2、deleted=0，与 GitHub PR files API 相等。fetch 使用 `--no-tags --no-write-fetch-head`，没有改本地分支 HEAD。 |
| `issueDetail({number:2})` | 首 50 条 comments，`hasNextPage:true`，符合原 UI 首屏契约。 |
| `issueComments({number:2})` | 50 条，`hasNextPage:true`，返回真实 endCursor。 |
| `issueComments({number:2,after:<第一页cursor>})` | 1 条，`hasNextPage:false`，返回另一个真实 endCursor。 |
| `issueComments({number:2,after:<第二页cursor>})` | 0 条，`hasNextPage:false`，endCursor=null。 |
| 重读第二页 | nodes 逐字段完全一致；不是猜测或人工构造游标。 |
| `issueComments({number:1})` | 原 PR 评论路径实际读到 1 条；body 与独立 REST 相同。曾怀疑 `repository.issue` 不支持 PR 的假设被真实调用推翻，不列产品问题。 |
| `deck_issue_get({key:'1',comments:2,blocking:false})` | 原 deck wrapper 成功读取 PR。 |
| `issuesPage({state:'all',limit:2})` | 只返回实验 issue #2，nextCursor=null；PR #1 被正确排除，这是原分支语义。 |

两非空评论页合并后，51 条 body 的顺序、author、authorAssociation、createdAt、updatedAt 逐项等于独立 REST；REST 中 51 个 comment id 唯一。原 GraphQL 评论 shape 本来不含 id，未声称 SDK 返回了这些 id。PR labels、assignees、reviews 本样本均为空，不能据此证明非空标签、非空 review 或 merged/closed PR 分支。

## 隔离、版本与证据

固定 manifest：`dc04813e34b463827667f8bca236ffc6c31ec847959a414c334d4ead9e756e10`，`bound-effects-and-bundled-docs-v6`。从 `.scratch/frozen-adapter-20261124-docs-v6-reviewed` 复制 **450 个逐文件 hash 校验**文件到全新 runtime450，调用前后均验证。新的项目副本、假 Codex SQLite、业务数据根和 Journal 均在本实验目录。

认证采用仅 RAM 的本机 `gh auth token` → 子进程 `GH_TOKEN`，不打印或保存 token。GH REST 固定 github.com 及上述 repo；本地 Git 使用独立空 HOME、空系统／全局配置、空 hooks 与现有已信任 CA，TLS 验证保持启用。未修改任何全局证书或 credential 配置。

publication 与 D6 既有 `write-ledger.sqlite` 均以 readOnly SQLite 查询 `SELECT * ... ORDER BY operation_id`，SDK 调用前后全行序列化 hash 相同。原账本没有删除、重置或迁入此新根。远端 base HEAD、base README blob 和本地 main HEAD 也保持一致。所有 owned SDK、adapter、companion、relay 与 Journal 均由 finally 关闭。

主要证据：

- `.scratch/pr-read-fixture-44/context.json`、`before.json`、`setup-state.json`：固定身份、初始状态、逐效果审计及历史 unknown 的读回收敛。
- `.scratch/pr-read-fixture-44/prepare.mjs`、`fixture.mjs`：独立 fixture setup 与固定权限边界。
- `.scratch/pr-read-fixture-44/read-sdk.mjs`：13 次真实原调用与隔离 harness。
- `.scratch/pr-read-fixture-44/read-run-1795466914320/`：最终 13 个原始 SDK 响应、独立 GET 数据、`acceptance.json`、`offline-verification.json`。
- `.scratch/pr-read-fixture-44/inspect-saved.mjs`：仅读取上述已保存文件，精确比对 patch、UI 字段、评论逐字段、唯一 id 和准备状态，不再联网。
- `.scratch/pr-read-fixture-44/read-run-1795466823475/`：保留首轮响应与 false 断言。当时夹具错误地要求详情 state 大写且 reviews 为数组；按原源码确认详情与 snapshot 的不同 shape 后，只修正本实验断言，并在新目录独立只读复跑，未改产品代码。

在 [原读取矩阵报告](remote-readonly-matrix-sdk-2026-11-24.md) 的 97 次调用之外，本轮再补 13 次；这 13 次证明了真实 PR 样本与跨 50 条评论的读取。没有超过 100 个 PR 的非空 PR 第二页证据，没有宿主渲染、真人审批、Windows 安装、生产迁移或真实 UI 交互证据，也没有扩张原 `mapTickets`、updater 或其他既有限制。
