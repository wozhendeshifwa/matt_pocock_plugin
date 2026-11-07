# Codex 写操作授权模型

核对时间 2026-11-07。对象是 ticket #5：把上游 1.8.0-rc.7 的每条写路径映射到 Codex 适配层入口，并定义 argv / fs / 确认 / 审计规则。本文是设计输入，不执行任何写操作。

## 一句话结论

Codex port 的写权限必须走**固定 argv 白名单 + 项目/数据根白名单 + 上游确认或 Codex 工具审批 + 本地审计**四道边界；不开放任意 shell，不把 `gh`/`git` 的原始字符串交给模型，也不允许跨项目写入。`updateInstall`、`deckExec`、文件/目录选择器在 Codex 侧没有受支持能力，明确拒绝或降级。

## 分类

| 类别 | 含义 | 确认来源 |
| --- | --- | --- |
| `project-write` | 只写当前项目内的少量约定文件 | 上游面板对话框 |
| `external-github-write` | 对当前仓库的 GitHub Issue/PR/标签写 | 上游对话框；MCP 工具走 Codex 工具审批 |
| `git-write` | 对当前工作树执行 add/commit/pull/fetch/push 或 publish | 上游版本管理确认；push/publish 走工具审批 |
| `local-state-write` | 只写 port 自己的数据根（choices/logs/naming/session-tickets） | 无需用户确认，但必须审计 |
| `read-only-export` | 只读并返回文本，不应放在写端点 | 无 |
| `host-side-effect` | 打开文件/目录、系统选择器 | 上游动作；Codex 能力待核 |
| `unsupported` | Codex port 没有对应能力，明确拒绝 | 无 |

## RPC 写端点清单

| RPC | 上游入口 | 实际 argv / fs 目标 | 分类 | 确认 | 破坏性 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| `commentIssue` | `commentThreads.js`；`comments.js:38,42` | `gh api repos/{owner}/{repo}/issues/{n}/comments --method POST -f body={body}`；回退 `gh issue comment {n} --repo {owner}/{repo} --body {body}` | external-github | 评论提交对话框 | 否 | body 只作 `-f` 数据，不进 shell |
| `bind` | `workspaceCwd.js:41-74` | `gh` 不参与；fs 写 `<project>/docs/agents/workspace.json`、`<project>/docs/agents/label-colors.json`、`<data-root>/.dsh/mattskillsdeck/choices.json` | project | 后端选择卡片 | 否 | 首绑才写 workspace 文件；失败不回滚绑定 |
| `setupLayout` | `workspaceCwd.js:77-83` | `<data-root>/.dsh/mattskillsdeck/choices.json` | local-state | 布局卡片 | 否 | `layout == null` 是读；有值才是写 |
| `setLabelColors` | `workspaceLabelColors.js`；`github/label-colors-ops.js:192` | GitHub：`gh label edit {name} --repo {owner}/{repo} --color {6hex}`；Markdown：`docs/agents/label-colors.json` | external-github / project | 配色弹窗保存 | 否 | 颜色必须是 6 位十六进制 |
| `handoffResolve` | `handoffClaim.js:77-96` | 只扫描项目 `.scratch/handoff` | read-only-export | 无 | 否 | 不执行 Issue 认领；认领 argv 归 `deck_issue_patch` |
| `namingRegister` | `namingGuardian.js:239` | `<data-root>/.dsh-mattskillsdeck-cache/naming-guardian.json` | local-state | 无 | 否 | 命名状态全文覆写 |
| `registerNewSessionWatcher` | 同上 | 同上 | local-state | 无 | 否 | 与 namingRegister 同体 |
| `namingSignal` | `namingGuardian.js:242-251` | 同上 | local-state | 无 | 否 | 非受踪会话直接忽略 |
| `namingResult` | `namingGuardian.js:328-347` | 同上 | local-state | 无 | 否 | 只记 renamed/locked/failed |
| `cancelNewSessionWatcher` | `namingGuardian.js:410` | 同上 | local-state | 无 | 否 | |
| `gitStage` | `versionControlWrite.js:136`；`commands.js:65` | `git --no-optional-locks --literal-pathspecs ... add -- {paths}` | git | 版本管理确认 | 否 | paths 限定项目内 |
| `gitUnstage` | `versionControlWrite.js:150`；`commands.js:68` | `git ... reset HEAD -- {paths}` | git | 版本管理确认 | 否 | |
| `gitCommit` | `versionControlWrite.js:165`；`commands.js:71` | `git ... commit -m {message}` | git | 版本管理确认 | 否 | message 作单参数，不拼 shell |
| `gitPull` | `versionControlWrite.js:182`；`commands.js:74` | `git ... pull --ff-only` | git | 版本管理确认 | 否 | 冲突不自动合并 |
| `gitFetch` | `versionControlWrite.js:200`；`commands.js:84` | `git ... fetch [remote]` | git | 版本管理确认 | 否 | remote 走 `REMOTE_PATTERN` |
| `gitPush` | `versionControlWrite.js:212`；`commands.js:77` | `git ... push --no-follow-tags {remote} {local}:{remote}` | git | Codex 工具审批 | **是** | 禁止 `+` 强推；refspec 显式 |
| `initPublish` | `publishFlow.js:170-199` | `git init`、`git add .`、`git commit --allow-empty -m ...`、`gh repo create ... --source=. --push`、`git remote set-url origin ...`、`git push -u origin HEAD` | git + gh | 发布流程确认 | **是** | 创建远端仓库，必须显式确认 |
| `retryPush` | `publishFlow.js:244` | `git push -u origin HEAD` | git | 工具审批 | **是** | 只重试既有 origin |
| `logSetSwitch` | `logPhones.js:105` | `<data-root>/.dsh-mattskillsdeck-cache/log-switch.json` | local-state | 无 | 否 | |
| `logClear` | `logPhones.js:58` | 删除 `<data-root>/.dsh-mattskillsdeck-cache/logs/YYYY-MM-DD.log` 或全部 `*.log` | local-state | 上游确认 | **是** | 只匹配日期文件名 |
| `logExport` | `logPhones.js:25-55` | 只读日志并返回文本 | read-only-export | 无 | 否 | 当前误分在写端点；#18 移到读端点 |
| `openFolder` | `pickerShell.js` | 宿主打开目录 | host-side-effect | 上游动作 | 否 | 可映射 `openai/files/open`，#18 定 |
| `openPath` | `pickerShell.js` | 宿主打开文件 | host-side-effect | 上游动作 | 否 | 同上 |
| `pickDirectory` | `pickerShell.js` | 宿主目录选择器 | host-side-effect | 显式路径 | 否 | Codex 未提供 picker；降级为手填路径 |
| `pickFile` | `pickerShell.js` | 宿主文件选择器 | host-side-effect | 显式路径 | 否 | 同上 |
| `updateInstall` | `updateFromPackage.js:19,102,150` | 写插件自身文件；依赖 `dsh-plugin-update` | unsupported | — | **是** | 包未随 vendor；port 从 repo checkout 更新 |
| `deckExec` | `deckExec` RPC | 启动独立任务 | unsupported | — | **是** | ADR-0002 保留草稿边界，无任务引擎 |

## 9 个 deck 工具

| 工具 | 分类 | 底层写 | 确认 | 破坏性 |
| --- | --- | --- | --- | --- |
| `deck_context` | read | — | — | 否 |
| `deck_issue_get` | read | — | — | 否 |
| `deck_map_snapshot` | read | — | — | 否 |
| `deck_issue_list` | read | — | — | 否 |
| `deck_issue_create` | external-github | `gh api POST /issues`、`gh issue edit --add-label/--add-assignee`、`gh issue edit --parent` | Codex 工具审批 | 否 |
| `deck_map_plan_create` | external-github | create + parent + `dependencies/blocked_by` | Codex 工具审批 | 否 |
| `deck_map_link` | external-github | parent + `dependencies/blocked_by` POST/DELETE | Codex 工具审批 | 否 |
| `deck_issue_patch` | external-github | edit/close/reopen、labels、assignees、dependencies | Codex 工具审批 | **close 是** |
| `deck_issue_report` | local-state | `<data-root>/.dsh-mattskillsdeck-cache/session-tickets.json` | 无 | 否 |

## 授权规则

### 1. argv 白名单，不拼 shell

- 只允许上表的固定 argv 模板；占位符逐项校验：
  - `{owner}/{repo}`：GitHub 仓库名正则；只允许当前项目解析出的仓库。
  - `{n}` / `{key}`：数字票号；不接收任意字符串。
  - `{name}`（标签）：非空、不含换行与控制字符。
  - `{6hex}`：`^[0-9a-f]{6}$`。
  - `{remote}` / 分支：复用 `shared/version-control/commands.js` 的 `REMOTE_PATTERN` / `BRANCH_PATTERN`。
  - `{paths}`：解析后必须落在当前项目根内；不允许 `..` 越界、盘符切换、UNC。
  - `{message}` / `{body}`：作为一个 argv 参数传入，不经过 shell；长度设上限。
- 禁止 `+` 开头的 refspec（git 会当强推）；禁止 `--force`、`--force-with-lease`、`-f` push。
- 禁止 `gh api` 的任意 endpoint；只允许 `/repos/{owner}/{repo}/...` 下的固定集合（issues、comments、labels、sub_issues、dependencies）。
- 不允许 `gh repo delete`、组织/账号级接口、GraphQL 任意 mutation。

### 2. fs 写入根

| 根 | 允许写入 | 说明 |
| --- | --- | --- |
| `<project>` | `docs/agents/workspace.json`、`docs/agents/label-colors.json` | 仅这两个约定文件；不写源码 |
| `<data-root>` | `.dsh/mattskillsdeck/choices.json`、`.dsh-mattskillsdeck-cache/{logs,naming-guardian.json,session-tickets.json,write-audit.jsonl}` | port 自己的状态 |
| `<project>/.scratch/handoff` | 只读 | 交接文档由 agent 的文件工具写，不归插件写 |

**拒绝**：`~/.dsh/profiles/**`、`~/.codex/**`（安装器除外）、`vendor/**`、`node_modules/**`、任意绝对路径、项目外路径。

### 3. 确认

- **UI RPC 写**：沿用上游自己的确认（评论提交、后端/布局卡片、标签配色保存、版本管理按钮与确认框、发布/推送确认、日志清理确认）。适配层不加第二层弹窗，但只在这些动作被用户触发时放行。
- **MCP `deck_*` 写工具**：Codex 的工具审批是确认边界。必须配置 `tools.<name>.approval_mode` 或 `default_tools_approval_mode = "ask"`；没有审批配置时，写工具 fail closed，不能静默执行。
- **破坏性动作**：`gitPush`、`initPublish`、`retryPush`、`logClear`、`deck_issue_patch` 的 close、`updateInstall` 必须有显式确认；`updateInstall`/`deckExec` 直接拒绝。
- 确认只对当次动作有效；不缓存“已确认”状态，不跨项目复用。

### 4. 审计

- 追加写 `<data-root>/write-audit.jsonl`，每条一行 JSON：
  - `ts`、`method`、`category`、`projectHash`、`argvHash`、`fsTargetHash`、`confirmation`、`ok`、`errorKind`。
- 不记录：原始 body/title/comment、绝对路径、完整 argv、token、环境变量。
- 只追加，不覆盖；单文件超过 5 MB 时轮转到 `write-audit.<timestamp>.jsonl`。
- 审计失败不阻断业务，但要在 stderr 留一行 `write-audit-skipped`。

### 5. 项目隔离

- 每次写只使用当次请求解析出的 `cwd`；写前再次校验 `expectedThreadId` 与 `cwd`。
- 身份缺失、歧义、临时聊天、项目切换中 → fail closed，不写上一个项目。
- 不把进程 cwd、最近聊天、上一个成功项目当身份。

### 6. Markdown 后端

- Markdown 后端写 `docs/agents/label-colors.json`、`.scratch/<effort>/*.md` 等；属于项目内写。
- 上游清单把 GitHub 列为主要后端、Markdown 为预览；是否纳入首版仍在地图 `Not yet specified`。在决定前不启用 Markdown 写路径。

### 7. 未支持 / 降级

| 写路径 | 处理 |
| --- | --- |
| `updateInstall` | 拒绝；port 从 repo checkout 更新，不内建 `dsh-plugin-update` |
| `deckExec` | 拒绝；ADR-0002 保留 `ui/message` 草稿语义 |
| `pickDirectory` / `pickFile` | Codex 无 picker；降级为手填路径输入 |
| `openPath` / `openFolder` | 待 #18 核实 `openai/files/open`；不可用时只显示路径 |
| `logExport` | 实为只读；#18 移到读端点 |
| Markdown 后端写 | 待地图对 Markdown 后端的范围决定 |

## 实现映射

| 消费方 | 用到的策略 |
| --- | --- |
| #12 Issue 详情写操作 | `commentIssue`、`bind`、`setLabelColors`、`handoffResolve`、`deck_issue_patch` |
| #18 设置页 | `setupLayout`、`logSetSwitch`/`logClear`/`logExport`、`openPath`/`openFolder`/`pick*`、`updateInstall` |
| #9 版本管理写入 | `gitStage`/`gitUnstage`/`gitCommit`/`gitPull`/`gitFetch`/`gitPush`、`initPublish`/`retryPush` |
| #4 Pull Request 页 | `commentIssue`（PR 评论）、关闭/合并动作需要新增 PR 专用策略 |
| #7 接手与命名 | `handoffResolve`、`naming*` |
| #6 已暴露的 deck 工具 | `deck_*` 写工具需在 #5 之后接审批与审计 |

## 证据与未决

- 证据：`lib/tracker/backends/github/issues-write.js:48,155,191,233`；`lib/tracker/backends/github/labels.js:118,122`；`lib/tracker/backends/github/comments.js:38,42`；`lib/tracker/backends/github/graph.js:113,141,291,303`；`shared/version-control/commands.js:62-87`；`lib/versionControlWrite.js:136-212`；`lib/publishFlow.js:170-199,244`；`lib/handoffClaim.js:153`；`lib/choiceStore.js:20-23`；`lib/workspaceCwd.js:55-68,144-158`；`lib/namingGuardian.js:15,39-47`；`lib/logStore.js:7-10`；`lib/logPhones.js:25-55,58+`；`lib/updateFromPackage.js:19,102,150`。
- 未决：PR 关闭/合并的专用 gh argv（#4 需要补表）；Codex 工具审批的具体配置键以本机 `codex mcp`/文档为准；Markdown 后端是否进入首版；`openai/files/open` 是否对裸 `mcp_servers` 可用。
