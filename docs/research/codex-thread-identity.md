# 侧栏请求身份与 Codex 会话来源

核对时间 2026-11-07 01:10–01:25（Asia/Shanghai），对应 ticket #22。本文回答四件事：UI 发起的 `tools/call` 是否带聊天身份、如何把 thread 解析成项目目录、临时聊天/同项目多聊天/跨项目/切回分别怎样、以及身份缺失或歧义时的 fail-closed 规则。

结论按证据强度分三级：**本机实测**（真实桌面请求或真实本地存储）、**宿主实现**（已安装 `app.asar` 里的代码路径，能证明宿主会做什么，不等于第三方可调用）、**官方文档**（可外部复核的契约）。未证实的一律标「未验证」。

## 0. 一句话结论

**UI 发起的每一次 `tools/call` 都带 `_meta.thread_id` + `_meta.threadId`，值与入口聊天一致；`resources/read`、`ui/initialize`、`host-context-changed` 不带可用身份。** 因此不需要 UI 端把入口身份转交给后续请求。

**项目目录的耐久来源已经不是 `session_meta`。** 本机 220 条 thread 里只有 122 条（55%）还能读到明文 `.jsonl`；78 条活动 thread 的 rollout 已不存在，29 条归档 thread 中 20 条只剩 `.jsonl.zst`，而 `state_5.sqlite` 的 `threads.cwd` 220/220 齐全、且与最后一次 `turn_context.cwd` 64/64 一致。`thread_history_1.sqlite` 根本没有 cwd 列。

**当前 `session-project.mjs` 只读 `session_meta` 首行，会在「会话被移动过 cwd」时静默返回旧项目**（本机有真实反例），并且对归档聊天假失败。缺失/不一致/无记录时它确实 fail closed，但「取到旧项目」不是 fail closed。

## 1. 证据基线与版本

| 项 | 值 | 来源 |
| --- | --- | --- |
| Codex Desktop 构建 | `26.1103.31037`（此前 `26.1029.61003`） | `~/.codex/logs_2.sqlite` 的 `client_version`；`.codex-global-state.json` 的 `appVersion` |
| Windows 安装包 | `26.1103.3517.0` | `~/.codex/config.toml:13`、`C:\Program Files\WindowsApps\OpenAI.Codex_26.1103.3517.0_x64__2p2nqsd0c76g0` |
| codex-cli | `0.167.0-alpha.3.2` | `codex.exe --version`；新 rollout 的 `session_meta.payload.cli_version` |
| 旧 rollout 版本 | `0.166.0-alpha.6`（11-04）、`0.163.0-alpha.10.2`（10-20） | 对应 `session_meta.payload.cli_version` |
| `state_5.sqlite` schema | `_sqlx_migrations` 到 v62（`threads attached parent`） | 直接只读查询 |
| `thread_history_1.sqlite` schema | `_sqlx_migrations` 到 v8（`thread turn root`） | 直接只读查询 |
| 历史模式 | 全部 `history_mode = "paginated"`；`rollout_migration_state = legacy_to_paginated_v1` | `state_5.sqlite` |
| OS | Windows `10.0.26200` | 本机 `codex app-server` 的 `initialize.userAgent` |

本机真实桌面请求的采集文件是 `.scratch/upstream-sidebar/02a17a8faba7ae80/host-context-captures.json`。**这份文件不是纯桌面数据**：每个 thread 会拉起独立的 MCP 服务进程（实测 4 个 `node.exe sidebar-server.mjs` 子进程，父进程都是同一个 `codex.exe`），它们共用同一个 capture 路径；`verify-*` 的 JSDOM 夹具也写入同一目录。因此文件里同时有真实条目（thread id 能在 `logs_2.sqlite` 找到）和模拟条目（`thread-test-1`、`11111111-…`、`metadata.simulated-thread`）。本文只把能回查到桌面日志的 id 当作真实证据。

## 2. Q1：UI 发起的 `tools/call` 是否带 `thread_id` / `threadId`？

### 2.1 实测：带，而且是每个请求都带

`_meta` 中恰好出现两个键，值相同：

```json
{"thread_id":"01a1b180-89f8-7291-beb2-43f569f3709c",
 "threadId": "01a1b180-89f8-7291-beb2-43f569f3709c"}
```

真实桌面条目（线程 id 均能在 `~/.codex/logs_2.sqlite` 回查到 `thread/start` 或 `thread/resume`）：

| 时间 (UTC) | 来源 | threadId | 说明 |
| --- | --- | --- | --- |
| 16:22:26 | `mcp/tools/call/deck_upstream_read` | `01a1a6b0-…` | 旧面板（yu_picture）继续读数据 |
| 16:22:30 | `mcp/tools/call/deck_current_project` | `01a1b1aa-…` | 新聊天里的侧栏轮询 |
| 16:32:30 | `mcp/tools/call/deck_upstream_read` | `01a1b1ab-…` | 论文阅读报告 |
| 16:51:25 | `mcp/tools/call/deck_upstream_read` | `01a1b189-…` | temp 项目 |
| 16:53:51 | `mcp/tools/call/deck_upstream_read` | `01a1b180-…` | 本项目 |
| 16:53:52 | `mcp/tools/call/deck_current_project` | `01a1b180-…` | bridge 每 2 秒轮询 |
| 17:12:48 | `mcp/tools/call/deck_current_project` | `01a1b189-…` 与 `01a1b1d5-…` | 同一秒两条，来自两个独立面板/进程 |

`deck_current_project`、`deck_upstream_read`、`deck_host_context_probe` 都是 bridge 自己发起的（`sidebar-bridge.js:80,153,196`），不是入口工具，因此可以确认：**UI 后续请求同样携带身份，不是只有入口工具带**。

### 2.2 宿主实现：身份由 Codex 桌面端注入

从已安装 `app.asar`（`C:\Program Files\WindowsApps\OpenAI.Codex_26.1103.3517.0_x64__2p2nqsd0c76g0\app\resources\app.asar`，约 12.24 MB 偏移）抽出的 `callMcpTool`：

```js
callMcpTool(e,t){
  let r = e._meta && typeof e._meta === "object" && !Array.isArray(e._meta) ? e._meta : {};
  return this.sendRequest("mcpServer/tool/call", {
    ...e,
    _meta: e.threadId == null ? e._meta : { ...r, thread_id: e.threadId, threadId: e.threadId }
  }, t);
}
```

同一文件里，MCP App widget 调用 tool 的路径把 `conversationId` 原样作为 `threadId` 传给 `callMcpTool`：`callMcpTool({ threadId: a, server: c, tool: p.name, arguments: ..., _meta: m }, ...)`，其中 `a` 是该面板的 `conversationId`。表格之外还抽到 `codex-app-tools` 的入参接受 `openai/threadId`、`openai/thread_id`、`codexThreadId`、`codex_thread_id`、`threadId`、`thread_id`、`x-codex-turn-metadata.thread_id` 以及 `metadata.thread.*`，全都没有时直接报 `Codex app tools require thread metadata from the executor.` 这与 `mcpServer/tool/call`（[app-server 文档](https://learn.chatgpt.com/docs/app-server.md)：「call a tool on a thread's configured MCP server」）一致。

**三个推论（置信度：高）：**

1. 正常 UI 请求不会缺身份；缺身份只可能是调用方 `threadId == null` 的路径。
2. 服务端可以信任 `_meta.thread_id`/`threadId` 来自宿主；bridge 不需要、也不应该自己声明项目。
3. 这是宿主实现行为，**不在**公开的 [MCP Extensions 规范](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md) 里（规范检索不到 `thread_id`/`threadId`）。它随桌面版本变化，必须在升级后重抓。

### 2.3 没有身份的三类请求

- `mcp/resources/read/resource`（16:51:29 真实条目）：`keys` 只有 `metadata`，`candidates` 为空。资源是静态 HTML，服务端不依赖身份，当前无影响；若以后资源内容按项目变化，这里拿不到身份。
- 真实 `ui/initialize`（16:51:22）：`hostContext` 只有主题、尺寸、locale、`openai/modelContext` 等；**没有** `threadId`、`cwd`、`project`。`openai.subjectId` 为 `null`。所以 bridge 不能从 `ui/initialize` 或 `openai.*` 取身份，只能靠 `tools/call`。
- `ui/notifications/host-context-changed` 与 `openai:set_globals`：只有主题/尺寸，无身份。

### 2.4 一条无法归因的空 `_meta` 记录

16:30:56Z 有一条 `mcp/tools/call/deck_upstream_read`，`_meta` 为空。它与 `sidebar-server.mjs` 的修改时间（00:30:41 +08）只差 15 秒，前后没有配套的入口调用/`ui/initialize`，也不在真实聊天时间线里。**最可能是一次本地探针/harness 直接调用**（capture 目录被所有进程共用），而不是桌面 UI 请求；但这无法 100% 证明。宿主代码说明：`threadId` 为 `null` 时 `_meta` 会原样保留，因此「存在一种不带身份的工具调用路径」是确定的，只是本机没有把它归因到某个真实面板。**置信度：中**。下一探针见 §6 第 1 条。

## 3. Q2：如何把 thread 解析为项目 cwd？哪个来源耐久？

### 3.1 本机 `~/.codex` 实际结构

```
~/.codex/
  sessions/YYYY/MM/DD/rollout-<ts>-<threadId>.jsonl   113 个，最新 2026-11-07T00:40:19+08
  archived_sessions/rollout-<ts>-<threadId>.jsonl     9 个
  archived_sessions/rollout-<ts>-<threadId>.jsonl.zst 20 个（归档后压缩）
  state_5.sqlite                                      220 条 thread、19 个 project
  thread_history_1.sqlite                             195 个 thread 的 turn/item，无 cwd 列
  session_index.jsonl                                 只有 id/thread_name/updated_at，最后写入 16:40Z
  .codex-global-state.json                            桌面端私有状态，含项目成员关系
  logs_2.sqlite                                       桌面端结构化日志（含 client_version）
```

### 3.2 三个候选来源的覆盖率

| 来源 | 覆盖 | 当前性 | 结论 |
| --- | --- | --- | --- |
| `session_meta.payload.cwd`（rollout 首行） | **122/220（55%）**：113 活动明文 + 9 归档明文 | **创建时** cwd；会话被移动/任务工作目录改变后不更新 | 不能单独作为项目身份 |
| `state_5.threads.cwd` | **220/220**（含 29 条归档） | 与最后一次 `turn_context.payload.cwd` **64/64 一致**；真实「移动」反例里已更新 | 当前最佳 |
| `thread_history_1.sqlite` | 195/220 | 有 turn/item，**没有任何 cwd 列**，`item_json` 里也没有可用的 per-turn cwd | 不能回答项目 |
| `session_index.jsonl` | 206 行 | 只有 id/name/updated_at，最后写入 16:40Z | 不能回答项目 |
| `.codex-global-state.json` | 36 条 `thread-project-assignments` / 220 | 桌面端自己的项目成员关系；`threadAssignmentsMigrated:false`，67 条待迁移 | 只能作旁证，不能单独依赖 |

**rollout 不完整的证据：** 220 条 thread 中，**78 条活动 thread 在 `state_5.threads.rollout_path` 记录的位置已没有任何文件**（全部是 2026-10 创建的；具体是保留策略清理还是迁移，本次未验证）。29 条归档 thread 的文件都还在，但只有 9 条是明文 `.jsonl`；另外 20 条是 `.jsonl.zst`，其中 14 条的 DB `rollout_path` 仍写 `.jsonl`（需自行补 `.zst`），6 条直接写 `.zst`。因此：明文 `.jsonl` 可读 **122/220（55%）**；把 zstd 也算上是 **142/220（65%）**；**78/220 彻底没有 rollout**。也就是说，rollout 不是耐久档案，`state_5` 才是当前索引。

**`threads.project_id` 一律为 null**（220 条中 0 条非空），所以 `state_5.projects` / `project_roots` 目前只能按 cwd 反查项目，不能按 thread 的 project 外键直接连。桌面端真正的项目成员关系仍在 `.codex-global-state.json` 的 `local-projects` + `thread-project-assignments` 里，ID 与 `state_5.projects` 是两套（有 `app-server-project-id-by-legacy-project-id-by-host` 映射），且迁移未完成。

### 3.3 真实反例：`session_meta` 会返回旧项目

thread `01a1b107-afb9-7882-8180-32322734bdc5`（11-06 21:23 创建，标题是交接文档）：

- `session_meta.payload.cwd` = `C:\Users\27263\Desktop\matt_pocock_`（创建时）
- 第 1020 行之后的 `turn_context.payload.cwd` = `C:\Users\27263\Documents\Codex\2026-11-06\new-chat`（运行中被改到任务目录）
- `state_5.threads.cwd` = `\\?\C:\Users\27263\Documents\Codex\2026-11-06\new-chat`（同步更新）

扫描最近 70 条 thread：`session_meta` 与最后一次 `turn_context` **1 条不一致**；`state_5.cwd` 与最后一次 `turn_context` **0 条不一致**。当前 `session-project.mjs` 只读首行，因此对这条返回的是 `C:\Users\27263\Desktop\matt_pocock_`——**把任务会话错误地归到原项目**，不是 fail closed。

### 3.4 推荐的解析阶梯

1. 从 `_meta` 取 `thread_id`；`threadId` 同时存在时必须相等；必须是 UUID。
2. 查 `state_5.threads`（只读连接）：命中则取 `cwd`，去掉 Windows `\\?\` 前缀后 `realpath`。
3. 未命中再查 rollout（`sessions` + `archived_sessions`，`.jsonl` 与 `.jsonl.zst` 都要支持；Node 26 的 `zlib.zstdDecompressSync` 可用）：文件名含该 id、首行 `payload.id === id`，取 `session_meta.payload.cwd`。
4. 两者都没有 → fail closed（临时聊天或尚未落盘的聊天）。
5. 两者都有且规范化后不一致 → **不要二选一**，按歧义 fail closed；除非两个路径都能唯一映射到同一个已知项目根（见第 6 步）。
6. 校验目录存在；按项目根做**精确匹配**（`state_5.project_roots.path` 或 `local-projects.rootPaths`，规范化大小写/分隔符/`\\?\`）。嵌套项目（本机同时存在 `dufu_learning` 与 `dufu_learning\temp`）不能用「前缀包含」。
7. 结果按 `threadId + mtime` 缓存；不要每 2 秒重新 glob 整个 `sessions` 目录。

Windows 注意：`state_5.cwd` 带 `\\?\`，`session_meta.cwd` 不带；`project-hosts.mjs` 以 cwd 字符串作 Map key，若两种写法混用会给同一项目起两个 worker。必须先统一规范化。

## 4. Q3：四种场景分别怎样

| 场景 | 本机可验证的结论 | 置信度 | 仍需真实桌面验证的部分 |
| --- | --- | --- | --- |
| 临时聊天 / 新建未发消息 | 身份照常存在；`state_5` 无行、rollout 无文件、`thread_history` 无行；当前 resolver 报错，面板显示「项目未关联」，不会回落旧项目。实测样本：`01a1b1aa`、`01a1b1c5`、`01a1b1ca`、`01a1b1d0`、`01a1b1d5`（均在 `logs_2.sqlite` 有 `thread/start`，但本地无记录） | 高（解析结果）/ 中（是否等同宿主意义上的 ephemeral） | 宿主的「临时聊天」是否显式标记 `ephemeral:true`；外部 `codex app-server --stdio` 对这类 id 只返回 `thread not loaded`，拿不到 flag |
| 同项目两个聊天 | 5 条真实聊天（`01a1b180`、`01a1b18c`、`01a1b18e`、`01a1b185`、`01a1b19e`）全部解析到 `C:\Users\27263\Desktop\matt_pocock_`；bridge 的 JSDOM 测试断言同 cwd 不重挂、只换 threadId | 高（解析/桥接逻辑） | 真实桌面里两个聊天是复用同一个 iframe 还是各建实例；官方规范写「每个 thread 一个不同实例」 |
| 另一个项目 | 4 条真实聊天分别解析到 `论文阅读报告`、`yu_picture`、`temp`、`matt_pocock_`，互不串；bridge 在 cwd 变化时 dispose 旧面板并重挂，旧请求用 `expectedThreadId` 拒绝 | 高（解析/桥接逻辑） | 真实桌面切换聊天时侧栏是否自动重绘；切项目是否触发新的 `open_deck_sidebar_probe` |
| 切回原聊天 | 未直接验证。旁证：`01a1b189` 的面板在 16:51 打开后，17:12:48 仍在轮询并带原 id，说明按 thread 的面板可以长时间存活、身份不漂移 | 中 | 切回后原面板是否保留状态（滚动/标签）、是否重新 `ui/initialize` |

**关于「同一面板换聊天」**：官方规范对 `thread` 入口的原话是 *Every thread will have a different instance of the entrypoint*（[MCP Extensions · Thread Entrypoint](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md#thread-entrypoint)）。如果桌面端严格执行，跨聊天根本不会复用同一个 iframe，`sidebar-bridge.js` 里「同项目不重挂」的分支只可能在宿主复用面板时生效。两种情况下数据都正确，但「同项目切聊天保留看板状态」的验收口径需要按真实宿主行为重写。

另外，入口工具 `open_deck_sidebar_probe` 只有 `{type:"thread"}` 入口（`sidebar-server.mjs:67`）。如果将来改成 `global` 入口（上游旧的 `deck_board` 就是 global），**该入口天然没有 thread 身份**，只能退回显式项目选择器；不能靠 `_meta` 自动跟随。

## 5. Q4：fail-closed 规则与当前实现

### 5.1 规则

1. **身份缺失/格式错误** → 返回 `isError`，不挂载、不读数据。
2. **`threadId` 与 `thread_id` 不一致** → 同上，不能挑一个信。
3. **本地无记录**（临时/未落盘）→ 同上；提示语只说明「无本地会话记录」，不要断言是临时聊天（无法区分）。
4. **多份记录指向不同 cwd** → 歧义 → 同上。
5. **两个来源（state_5 与 rollout）不一致** → 歧义 → 同上，除非能证明属于同一项目根。
6. **cwd 不存在 / 不是目录 / 无法 realpath** → 同上。
7. **绝不使用**：进程 cwd、最近聊天、上一次成功解析的项目、服务启动参数、`ui/initialize` 里的空值。
8. **每个请求独立解析**；不设进程级「最后 thread id」。
9. 桥接层在失败时清空面板；旧请求必须用 `expectedThreadId` + 当前 cwd 双重校验后丢弃。
10. 面板重新挂载时，只允许使用本次请求解析出的 cwd。

### 5.2 当前 `session-project.mjs` 的实测行为

直接 import 真实模块跑真实 id（只读）：

| 输入 | 结果 | 判定 |
| --- | --- | --- |
| `01a1b180`（本项目） | `C:\Users\27263\Desktop\matt_pocock_` | ✅ |
| `01a1b1ab`（论文阅读报告） | 正确 | ✅ |
| `01a1a6b0`（yu_picture） | 正确 | ✅ |
| `01a1b189`（temp） | 正确 | ✅ |
| `01a1b107`（移动过） | `C:\Users\27263\Desktop\matt_pocock_`（旧） | ❌ 静默错项目 |
| `01a1b103`（已归档） | `无法…确定唯一项目目录` | ⚠️ 假失败（state_5 有 cwd） |
| `01a1b1d5` / `01a1b1c5` / `01a1b1aa`（未落盘） | 报错 | ✅ |
| `{}` | `当前侧栏请求没有可验证的聊天身份。` | ✅ |
| `{threadId:A, thread_id:B}` | `宿主传入了不一致的聊天身份。` | ✅ |

已实现：UUID 校验、双键一致性、无记录报错、多目录报错、`realpath`、错误经 `tools/call` 的 `isError` 回到 bridge、失败即 `clearPanel`。

未实现/缺口：

- **只读 `session_meta` 首行**（`session-project.mjs:19-31` 读完首行就 `break`）→ 移动过的 thread 返回旧项目；这是当前唯一会「答错」的路径，也是本票最需要修的。
- **只扫 `~/.codex/sessions/**/*.jsonl`**：归档在 `archived_sessions`（9 个明文 + 20 个 `.zst`）全部解析失败；本机 29 条归档聊天都不可用。
- **不使用 `state_5`**：因此 78 条 `rollout_path` 已无文件的旧 thread 也解析失败。
- **不做来源交叉校验**：即使 `state_5` 与 `session_meta` 冲突也无从发现。
- 只认 `threadId`/`thread_id` 两个键；宿主若只发 `openai/threadId` / `x-codex-turn-metadata` 会 fail closed（安全，但可能假失败）。
- 每次请求 `glob` 整个 sessions 树；bridge 每 2 秒轮询一次，成本偏高，且没有缓存。
- 没有专门测试文件；`.scratch/session-project-test/` 只有两条手工 fixture。

### 5.3 建议的落地改动（供实施票，不在本票执行）

1. `state_5` 优先、rollout 兜底、二者冲突即 fail closed。
2. 归档路径与 `.zst` 纳入兜底；`rollout_path` 不存在时尝试 `path + ".zst"`。
3. 统一 `\\?\` / 分隔符 / 大小写，再做 `realpath`。
4. 用 `state_5.project_roots`（或 `local-projects.rootPaths`）做精确项目校验；不在任何项目根下的 cwd 是否放行需要产品决策（`new-chat` 任务目录就是这种）。
5. 按 threadId + 文件 mtime/DB 变更缓存解析结果。
6. 增加测试：正常、移动、归档、未落盘、双键冲突、来源冲突、删除目录。

## 6. 未验证事实与下一探针

1. **16:30:56Z 空 `_meta` 的真实来源**。探针：在 `sidebar-server.mjs` 记录每条 `tools/call` 的完整 `_meta` 键集合 + 进程 pid + 父 pid，重启桌面后复现；若再次出现，用 pid 对 `logs_2.sqlite` 定位是哪个聊天/哪条路径。
2. **同一面板是否换 thread**。探针：聊天 A（项目 P1）打开侧栏 → 在同一窗口切到聊天 B（P2）→ 观察是否出现新的 `open_deck_sidebar_probe`/`ui/initialize`，以及原进程的 `deck_current_project` 是否改带 B 的 id；再切回 A，看 A 面板是否保留状态。
3. **同项目两个聊天是否各建实例**。探针：A1、A2 同项目，同时打开侧栏，抓两份 capture，确认两条 `ui/initialize` 与两套进程。
4. **临时聊天与「新建但未发消息」的区别**。探针：分别新建两种聊天，各等 60 秒、各发一条消息，比较 `state_5`/rollout 出现时机；若桌面有「临时聊天」入口，再抓它的 `thread/read`（只能从桌面内 app-server 取，外部进程会得到 `thread not loaded`）。
5. **会话移动/任务工作目录的归属口径**。探针：用 Codex 的移动项目/任务目录功能（或 `codex exec` resume 到另一 cwd）复现 `01a1b107` 型记录，确认 UI 把它显示在哪个项目下，再决定 cwd 取「创建时」还是「最后一次 turn」。
6. **`state_5.threads.project_id` 是否会随迁移补齐**。探针：等 `threadAssignmentsMigrated` 变 true（或升级桌面版本）后重查；当前 220 条全为 null。
7. **`.codex-global-state.json` 的项目成员关系是否稳定**。探针：给同一聊天移动项目，比较 `thread-project-assignments` 是否即时更新；该文件是 Electron 私有状态，不能当作公开契约。

## 7. 证据索引

本机路径（相对仓库）：

- `.scratch/upstream-sidebar/02a17a8faba7ae80/host-context-captures.json`：真实与模拟混合的 MCP 元数据捕获；真实条目见 §2.1。
- `prototypes/upstream-port/session-project.mjs`：当前解析器（只读首行 `session_meta`）。
- `prototypes/upstream-port/sidebar-server.mjs:76-101`：`deck_current_project` / `deck_upstream_read` 的解析与 `isError`。
- `prototypes/upstream-port/sidebar-bridge.js:126-207`：轮询、cwd 挂载键、`expectedThreadId`、失败清空。
- `prototypes/upstream-port/verify-project-switch.mjs`：同项目不重挂、跨项目重挂、旧请求拒绝、缺身份清空的 JSDOM 测试。
- `prototypes/upstream-port/verify-unassociated-sidebar.mjs`：未关联时不得挂载固定项目。
- `docs/research/mcp-thread-identity-evidence.md`：11-06 23:54 的首次入口身份记录。

本机绝对路径（只读证据）：

- `C:\Users\27263\.codex\state_5.sqlite`：`threads`（id/cwd/rollout_path/project_id/archived）、`projects`、`project_roots`、`rollout_migration_state`。
- `C:\Users\27263\.codex\thread_history_1.sqlite`：`thread_items`、`thread_turns`、`thread_history_projection_state`（无 cwd）。
- `C:\Users\27263\.codex\logs_2.sqlite`：`thread/start`、`thread/resume`、`client_version`、`shell_snapshot` 的 `thread_id`。
- `C:\Users\27263\.codex\.codex-global-state.json`：`local-projects`、`thread-project-assignments`、`projectless-thread-ids`、`app-server-projects-migration-by-host`。
- `C:\Users\27263\.codex\sessions\2026\11\06\rollout-2026-11-06T21-23-53-01a1b107-afb9-7882-8180-32322734bdc5.jsonl`：`session_meta` vs 后续 `turn_context` 的真实移动反例。
- `C:\Program Files\WindowsApps\OpenAI.Codex_26.1103.3517.0_x64__2p2nqsd0c76g0\app\resources\app.asar`：`callMcpTool` 的 `_meta` 注入（约 12.24 MB 偏移）。

官方：

- [OpenAI MCP Extensions Specification](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md)：`thread` 入口「每个 thread 一个实例」、`global` 入口、入口能力。
- [Codex App Server](https://learn.chatgpt.com/docs/app-server.md)：`mcpServer/tool/call`、`thread/read`、`thread/archive`/`thread/unarchive`、paginated history、`ephemeral` fork。

## 8. 置信度汇总

| 结论 | 置信度 |
| --- | --- |
| UI 发起的 `tools/call` 带 `thread_id` + `threadId`，且逐请求注入 | 高 |
| `resources/read` / `ui/initialize` / `host-context-changed` 无可用身份 | 高 |
| `session_meta` 只代表创建时 cwd，不是耐久项目来源 | 高（122/220 覆盖 + 真实移动反例） |
| `state_5.threads.cwd` 当前准确（与最后 `turn_context` 一致） | 高（64/64） |
| `thread_history_1` 不能解析项目 | 高（无 cwd 列） |
| 临时/未落盘聊天必须 fail closed | 高（5 个真实 id 实测报错） |
| 同一面板是否跟随聊天切换 | 未验证（规范倾向每 thread 新实例） |
| 切回原聊天保留状态 | 未验证（有面板长活的旁证） |
| `.codex-global-state.json` 是权威项目成员关系 | 中低（私有、迁移未完成、仅 36/220） |
| 16:30:56Z 空 `_meta` 的来源 | 低（最可能是本地探针） |
