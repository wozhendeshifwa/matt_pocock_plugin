# Codex 宿主适配核对

核对时间为 2026-11-06。目标是保留 DSH 版的页面、动作和任务会话行为，在宿主边界接入 Codex。

## 侧栏与当前项目

原生侧栏可继续使用 MCP Apps 的 `thread` 入口。该入口收到空参数，每个聊天拥有独立面板实例。`ui/initialize` 和 `ui/notifications/host-context-changed` 是检查宿主能力及上下文的入口。已阅读的扩展协议没有约定当前 `threadId`、`projectId` 或项目目录字段，仍需记录本机实际握手中的字段名与必要值，核对可信来源。不能据此断言宿主不可能提供这些信息。[入口协议](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md#thread-entrypoint)、[官方 UI 指南](https://developers.openai.com/plugins/build/chatgpt-ui)

现有服务的 `DECK_PROJECT_ROOT` 与 `DECK_REPO` 是显式绑定。服务启动目录、最近修改的聊天和最近使用的项目都不能独立证明当前侧栏归属。自动跟随验收必须覆盖同项目两个聊天、另一个项目，以及切回原聊天。

## 原生新聊天与提示词

官方扩展支持通过 `ui/message` 发送到新聊天，需检测 `hostCapabilities.experimental["openai/message"]`。参数为 `role: "user"`、文本 `content`，以及 `_meta["openai/message"]: { target: "new", send: true }`。`send: false` 对应新聊天草稿。当前聊天可用 `target: "active"`。因此原版“执行”和“新会话”应分别接到宿主消息能力。该规范没有承诺返回新聊天 ID、后台创建、项目继承或结果订阅，必须在本机实测这些行为。[消息扩展](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md#prompt-target-and-send-behavior)

## Codex 会话 API

官方 app-server 提供 `thread/start`、`turn/start`、`thread/read` 和 turn/item 事件。适配层可保存返回的 thread ID，按 ID 查询进度与结果。开始执行和完成状态应由服务响应及事件确认。读取历史可用分页接口，`thread/read` 本身不会订阅事件。[官方 app-server 文档](https://learn.chatgpt.com/docs/app-server)

本机 `codex-cli 0.166.0-alpha.6` 的 `app-server generate-ts --experimental` 生成结果进一步确认以下字段。它们是本机版本证据，升级后应重新核对。

- `ThreadStartParams` 包含 `projectId`、`cwd`、`runtimeWorkspaceRoots`。
- `Thread` 包含 `projectId`、`cwd`、`source`、`status`、`sessionId`。
- `Project` 包含 `id`、`name`、`roots`。`ProjectRoot` 包含 `path`。
- `TurnStartParams` 接受 `threadId` 与 `input`，并具有工作目录和权限配置字段。

生成命令只写入本次进程临时目录。仅发现 schema 不代表普通 MCP UI 能直接调用这些 API。

## 本机只读探测

用独立 `codex app-server --stdio` 完成握手并执行 `thread/read`，成功读取已有验收任务 `01a1b076-954b-7fe3-ba02-9d9ef18c77a4`。返回目录为当前工作区，`source` 为 `exec`，`projectId` 为 `null`，运行状态为 `notLoaded`。这验证已有 CLI 会话可以通过 app-server 查到，尚未验证桌面中的原生项目归属。

官方 CLI 也提供 `app-server proxy`。对默认控制 socket 的只读握手探测在沙箱内外均失败，报 Windows error 10050，目标为 `~/.codex/app-server-control/app-server-control.sock`。本次没有改动宿主配置、启动 daemon 或创建新聊天。此失败仅说明默认连接路线在当前环境未建立。

当前助手具有 `codex-app-tools` 的 `create_thread`、`list_projects`、`read_thread` 和 `wait_threads`。这些是助手可调用工具，其存在不能证明第三方 MCP 服务或 iframe 也能直接访问。插件的调用链必须有独立的受支持依据。

2026-11-06 已为真实侧栏加入只读上下文探针：`ui/initialize`、`ui/notifications/host-context-changed` 和 `openai:set_globals` 会经过字段白名单筛选，只记录 project/thread/session/workspace/cwd 候选值，敏感值和其他上下文内容不落盘。结果写入项目隔离目录，用于比较同一项目的两个聊天和另一个项目。探针存在不等于宿主会提供项目身份；在取得真实差异证据前，固定绑定和显式切换仍不能被宣称为自动跟随。

## 接入顺序

1. 保留上游前端与动作语义，将 DSH 宿主调用集中替换到 Codex adapter。
2. 在真实侧栏读取一次初始化能力与上下文，随后核对项目切换通知，确认可用于关联项目的信号。
3. 对原版“执行”和“新会话”使用已声明的 `ui/message` 能力，核对新会话项目、是否跳转、返回值与结果关联。只有原版已经提供的动作才进入迁移界面。
4. 若要用 app-server 驱动独立任务会话，先验证它与桌面列表、项目归属、批准流程的整条路径。默认 proxy 的连接失败需要解决后再选定路线。
5. 把项目关联和结果追踪未验证的部分保留为移植验收项。现有 `codex exec` 只读诊断可提供回归证据，但不能代表上游全部执行工作流已经迁移完成。
