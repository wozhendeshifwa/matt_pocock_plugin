# MCP 侧栏会话身份实测

2026-11-06 北京时间 23:54 重启后的真实探针记录位于 `.scratch/upstream-sidebar/02a17a8faba7ae80/host-context-captures.json`。

`mcp/tools/call` 的请求元数据同时包含 `thread_id` 与 `threadId`。23:54:56 两者均为 `01a1b180-89f8-7291-beb2-43f569f3709c`，精确匹配当前聊天的本地 `session_meta.payload.id`，其 `cwd` 为 `C:\Users\27263\Desktop\matt_pocock_`。

23:53:55 的另一条入口请求携带 `01a1b191-088a-78e3-b56c-f2ab82b6defd`。本地未找到该 ID 的会话文件，桌面 read_thread 返回 `ephemeral threads do not support thread/turns/list`。此身份还不能映射到项目目录。

同一轮页面端 `openai.subjectId` 仍为 null。资源读取请求没有身份元数据。因而页面端空身份不足以否定服务端关联能力。当前证据只确认侧栏入口工具调用的元数据，尚未确认 UI 后续数据请求或跨聊天保留的面板如何更新身份。

下一步须验证 UI 发起的 tools/call 是否也携带身份，再将每次调用的身份解析为目录。若只有入口有身份，需要通过对应工具结果把绑定传给该面板，并验证切换通知。禁止用服务进程全局的最后一次 thread ID 绑定所有面板。临时聊天无本地 session_meta 时必须明确失败，避免回退到旧项目。

当前 bridge 暂停挂载原版客户端并显示项目未关联提示。此为临时阻止串仓库的处理，自动跟随和真实派发尚未通过验收。
