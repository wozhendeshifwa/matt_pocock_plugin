# Codex 桌面端 `ui/message` 与派发能力核对

核对时间：2026-11-07（Asia/Shanghai）。对象是 ticket #13 的四个问题：能力声明、`send:false` 草稿行为、返回值/结果订阅、失败模式与适配。

本文不使用 CLI `codex app-server` 的行为作为桌面 UI 证据。证据分四类，每条结论都标注来源与置信度：

- **官方规范**：OpenAI MCP Extensions 与 MCP Apps SEP-1865（可外部复核）。
- **本机真实握手**：`.scratch/upstream-sidebar/02a17a8faba7ae80/host-context-captures.json` 中真实 Codex 桌面端 `ui/initialize` 的字段名（白名单只记键名，不记值）。
- **本机宿主实现**：从已安装的 Codex 桌面包 `app.asar` 抽出的实际处理代码（含字符偏移，可复现）。这是宿主的静态实现，不等于 100% 的运行时路径；本文只在与真实握手字段互相印证时才把它当强证据。
- **port 现状**：`prototypes/upstream-port/sidebar-bridge.js`、`build.mjs`、`verify-project-switch.mjs` 与 `docs/adr/0002-prefill-dispatch-boundary.md`。

## 一句话结论

桌面端**确实声明** `hostCapabilities.experimental["openai/message"]`，并额外声明 `.draft`；`ui/message` + `send:false` 在实现上分别走「当前 composer 追加」和「新建可编辑草稿并切过去」。**两种情况都只返回 `{}`，不返回线程 ID，也没有任何结果订阅**；新草稿不带当前 thread 的项目参数，因此 `ui/message` 不能承担「派发到独立任务会话」的语义。当前 bridge 的能力检查足以防止「未声明还照发」，但不足以判断 `target:"new"` 在当前视图是否可用，也不足以把动作结果与线程关联。

## 1. 能力声明：是否广告 `openai/message`

**结论：是。真实桌面握手声明了 `hostCapabilities.experimental["openai/message"]`，且带 `draft` 子键。置信度高。**

证据：`.scratch/upstream-sidebar/02a17a8faba7ae80/host-context-captures.json:296-415`，`capturedAt = 2026-11-06T16:51:22.647Z`（北京时间 2026-11-07 00:51:22），`source = ui/initialize`。该条记录的 `keys` 里明确出现：

```
initialization.hostCapabilities.experimental
initialization.hostCapabilities.experimental.openai/modelContext
initialization.hostCapabilities.experimental.openai/find
initialization.hostCapabilities.experimental.openai/message      ← 本票关键
initialization.hostCapabilities.experimental.openai/message.draft
initialization.hostCapabilities.experimental.openai/skillsDeepLinks
initialization.hostCapabilities.experimental.openai/files
initialization.hostCapabilities.logging
initialization.hostCapabilities.openLinks
initialization.hostCapabilities.serverResources
initialization.hostCapabilities.serverTools
initialization.hostCapabilities.message
initialization.hostCapabilities.message.text / .image / .resourceLink / .resource
initialization.hostCapabilities.updateModelContext.*
initialization.hostCapabilities.sandbox.*
```

这份 capture 是真实桌面的，不是模拟：同目录的 `host-context-captures.simulated.json`（以及 `07b4faf897601368/`、`b1dccc7753f75d3b/` 两份）里的模拟握手使用 `thread-test-1` / `11111111-1111-4111-8111-111111111111`，且 `hostCapabilities` 为空，见 `verify-sidebar.mjs:76-86`；而 16:51:22 这条的主记录来自真实桌面，同一秒的 `deck_host_context_probe` tool call 携带真实 thread id（`01a1b189-3978-7160-992c-cd441b3418bf`）。

交叉印证：宿主包里构造这份能力的代码在 `app.asar` 成员 `webview/assets/async/63396.ec0c2499c7.js:98640-98730`：

```js
hostCapabilities:{
  experimental:{
    "openai/modelContext":{},
    ...(c?{"openai/find":{}}:{}),
    ...(aS?{"openai/message":{draft:nA()?{}:void 0}}:{}),   // ← E = "openai/message"
    "openai/skillsDeepLinks":{},
    ...i.experimentalCapabilities,
    ...(aE?{"openai/files":{}}:{})
  },
  ...
  message:L,   // L = nw ? {} : undefined；aS 时再补 text/image/resourceLink/resource
  ...
}
```

其中 `nA = () => e?.get(ep.O)?.updatePrompt != null`（`e` 是 composer store），所以：

- `openai/message` 的值为对象；`draft` 在支持草稿时是 `{}`，否则是 `undefined`（键仍在，结构化克隆会保留 `undefined` 键）。
- capture 只记录键名，因此**无法从 capture 区分 `draft: {}` 与 `draft: undefined`**。`message.text/image/...` 这组键也不能反推 composer 一定存在：代码是 `L = nw ? {} : undefined; aS && (L = {text,image,resourceLink,resource})`，`aS` 为真时即使没有 composer 也会补出这四个键。所以“draft 可用”这一点仍需第 5 节探针确认。

**基线风险**：官方规范只承诺 `"openai/message": {}`，`draft` 是宿主私有扩展，不能在适配层硬依赖（见第 4 节）。

## 2. `ui/message` + `send:false` 的实际语义

**结论：会生成可编辑草稿。`target:"active"` 追加到当前 composer；`target:"new"` 新建一个 `freshDraft`、切到该草稿并预填。成功结果都是 `{}`。置信度高（官方规范 + 宿主实现一致），但「草稿真的出现在 UI 里」尚未在本机做端到端观察。**

### 2.1 规范怎么说

官方 MCP Extensions（[`ui/message` extensions](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md#uimessage-extensions)）明确：

> Defaults when undefined: `{ target: "active", send: true }`.
> For supported target/send combinations, `send: false` appends content to the active draft or opens a fresh editable draft when `target: "new"`, without submitting it.

平台支持表把 Extended message sending 在 Desktop 标为 Supported。也就是说**不写 `_meta` 就等于立即发送**；`send:false` 是唯一的安全默认。

### 2.2 宿主实现（`app.asar`）

`webview/assets/async/63396.ec0c2499c7.js`（下面偏移均为该成员的字符偏移）：

- `22599` `let E="openai/message"`；`22670` 附近的 `C` schema：`{target: enum(["active","new"]).optional(), send: boolean().optional()}`，另有一个 `send: literal(false)` 的变体（`46158` 的 `tz` 联合）。参数必须是 `role:"user"` + `content` 数组 + 可选 `_meta["openai/message"]`。
- `75,3xx–76,450` 是 `case "ui/message":` 完整分支。关键片段（原文压缩后整理）：

```js
const a = options?.target ?? "active";
if (options?.target !== "new" && activeComposer == null)
  throw MethodNotFound("MCP app messages are disabled for this view");

if (options?.send === false) {
  const {text, attachment} = split(content);          // 只把纯 text 当 prompt；其余变附件
  assertActive();                                     // widget 失效则抛 "This widget is no longer active."
  if (options.target === "new") {
    if (aA) throw MethodNotFound("New drafts are unavailable in this view");
    startNewConversation(store, {
      freshDraft: true, selectChat: true,
      prefillPrompt: text, prefillMcpAppAttachments: attachment ? [attachment] : []
    });
  } else {
    if (activeComposer == null) throw MethodNotFound("The composer is unavailable");
    if (/* composer 忙/不可写 */ || !canAppend(activeComposer, text, "append"))
      throw Error("The composer is unavailable");
    appendToComposer(activeComposer, /* attachment */);
    scrollComposerIntoView(activeComposer);
  }
  return {};
}
// send:true（本 port 不用）走 sendMcpAppMessage，new 还需要用户手势并解析 getNewThreadDestination
...
return {};
```

要点：

1. **active 是「append」而不是「replace」**。连续点两次会在同一草稿里追加两段；上游 `inject` 是设置整段 draft（`vendor/mattskills-1.8.0-rc.7/lib/client.js:10119-10127`，同文件 `10138` 的注释明确写 `setDraft 只收全文`），语义有差异。
2. 空文本会被拒：`An MCP app message cannot be empty`（`-32602`）；不支持的内容类型会被拒（音频等）。
3. `target:"active"` 需要当前有 composer；没有就 `MethodNotFound`。
4. `target:"new"` 在宿主内部是一个**本地 fresh draft**，不是已创建的 thread。
5. 两个分支都 `return {}`——**没有 thread/session id**。

### 2.3 新聊天继承哪个项目 / 哪个线程

**结论：`ui/message` 不携带项目参数，也不复制当前 thread 的 cwd；新草稿落在应用主页（`/`）的 fresh draft 上。置信度中（静态代码明确「不传」，但主页最终选中哪个项目需要实测）。**

证据链：

- handler 调用 `startNewConversation(scope, {freshDraft:true, selectChat:true, prefillPrompt, prefillMcpAppAttachments})`（`63396…:75960`），**没有 `activeProject` / `cwd` / `workspace`**。
- `startNewConversation` 的实现见 `webview/assets/async/182735.e33af7cdca.js:4941424`（模块 `Q8aV`）：

```js
function R(e, t) {
  let {activeProject:n, prefillComposerMode:r=null, startInSidebar:i, replace:a,
       onNavigate:o, selectChat:I, freshDraft:A, onFreshChatDraftCreated:S, ...b} = t ?? {};
  ...
  const D = {...b, ...(void 0===n ? {} : {project: av(n)}), focusComposerNonce:k};
  ...
  (x || null != L) && (... prepareNavigation("/", {replace:a, state:D}) ...);
  ...
  if (I) P(e, D, e => (M.state=e, L?.()));
}
```

`project` 只在调用方传了 `activeProject` 时进入导航 state；`ui/message` 的调用点没传，所以新草稿的 state 里没有 `project`。`selectChat:true` 只负责切到该草稿。

- 唯一会显式算「新线程目的地」的是 `send:true` 分支：`getNewThreadDestination` 由宿主组件提供，工具结果卡片这一路默认是 `() => ({kind:"app-server", hostId})`（`webview/assets/async/188101.d623f5b054.js:79,4xx`），同样没有 cwd。`send:false` 分支根本不走这条。

因此：

- **不继承当前 thread 的 cwd/project** 是确定的；
- 新草稿发送后最终落在哪个项目，取决于宿主主页 composer 的默认项目（可能是「无项目聊天」，也可能是上次使用的项目）。静态代码无法定论，**未实测**。

补充：上游 `openTextInNewSession` 的语义是 `sessions.create({cwd})` + `open(sid)` + `rename(title)`，明确「新会话默认继承点击时所在会话的工作区（`st.cwd`）」（`vendor/mattskills-1.8.0-rc.7/lib/client.js:9794,9837`）。port 把入口映射成 `prefill("new", …)` 后，**这条 cwd 继承已经被丢掉**。ADR-0002 接受的是「草稿语义」，但需要明确：这不是「同项目的新任务会话」。

## 3. 返回值、线程 ID 与结果订阅

**结论：不返回新线程/会话 ID；`ui/message` 的成功结果按规范就是 `{}`；没有给 MCP App 的结果订阅。临时/侧聊无专门分支，未实测。置信度：无 ID/无订阅 = 高；临时聊天 = 低/未验证。**

### 3.1 结果恒为 `{}`

- 官方 MCP Apps 规范把 `ui/message` 的成功响应定义为 `result: {}`（[SEP-1865 `ui/message`](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/draft/apps.mdx#mcp-apps-specific-messages)）。
- 桌面实现两个分支都 `return {}`（`63396…:76441` 与 send:true 分支末尾）。
- 新草稿内部确实会生成客户端标识（`startNewConversation` 里 `T.dW(...,{clientNewThreadId:R,...})`，`182735…:4941424` 附近），但它是**客户端草稿 ID**，不通过 `ui/message` 返回给 App，也不会写进结果。

### 3.2 没有结果订阅

- 官方规范没有为 `ui/message` 定义任何订阅或后续通知。
- 桌面宿主有一个 `openai/events/subscribe`，但它要求 **trusted connector scope**：`MCP event subscriptions require a trusted connector scope`（`63396…:80660`）。本 port 是 `~/.codex/config.toml` 里的裸 `mcp_servers` 条目，没有 connector scope，因此不能用它订阅「消息/线程结果」。
- 结论：**不能用 `ui/message` 实现「派发后回显任务结果」**。需要结果就只剩两条路：(a) app-server 的 `thread/start` + `turn/start`（另一张票，且要处理项目归属/审批），(b) 用户手动发送后，由侧栏另行读取本地会话记录。ADR-0002 已经选了「草稿 + 用户确认」，本票结论与之相容。

### 3.3 临时聊天 / 侧聊 / 墓碑

- `ui/message` 处理器里没有 `ephemeral` 分支；唯一的「失效」检查是 `assertActive()`，它检查 widget 仍是当前实例：`assertActive` 的实现会抛 `This widget is no longer active.`（`webview/assets/async/418842.f2626a6652.js:305118`）。
- 桌面状态里确实存在 `ephemeral` 会话与 side chat（`182735…` 的 `ephemeral` 字段；`878027.dbdeee6be7.js` 里 side chat 用 `{ephemeral:true}`），widget 参数里也有 `isTombstone`。
- 但「在临时聊天里打开 thread 入口后，`ui/message` 是被拒绝还是照常写草稿」**没有本机证据**。按代码没有专门拒绝分支推断：会照常写当前 composer；聊天关闭后草稿随之消失。**这是推断，置信度低，必须实测。**

## 4. 失败模式与适配建议

### 4.1 宿主的失败面（全部来自 `63396…` 的 `ui/message` 分支）

| # | 触发条件 | 宿主行为（代码） | 对 App 的表现 |
| --- | --- | --- | --- |
| 1 | 未声明 `openai/message`，但调用 `ui/message` | 宿主转发条件为 `(aS \|\| !nw)`（能力声明条件，或无 composer 的视图）；不满足时方法不被 forward。若宿主只实现基础协议，则可能按默认值处理（**推断**） | 报错；**基础协议宿主可能直接发送**（默认 `{target:"active",send:true}`），这是必须门控的原因 |
| 2 | `target` 非法 / content 非法 / 空文本 | `-32602`：`Invalid MCP app message params` / `Unsupported MCP app content` / `An MCP app message cannot be empty` | 参数错误，属适配 bug |
| 3 | `target:"active"` 但当前视图没有 composer | `MethodNotFound`: `MCP app messages are disabled for this view` | 明确失败 |
| 4 | `target:"active"`，composer 忙或不可写 | 普通 `Error`: `The composer is unavailable`（→ `-32603`） | 明确失败 |
| 5 | `target:"new"`，视图不允许新草稿（`aA`） | `MethodNotFound`: `New drafts are unavailable in this view` | 明确失败 |
| 6 | `target:"new"` + `send:true`（本 port 不用） | 需要用户手势；`New threads are unavailable in this view` / `New conversations are unavailable for this view` / `MCP app messages require an available composer` | 明确失败 |
| 7 | widget 已失效（切走/墓碑） | `This widget is no longer active.` | 明确失败 |
| 8 | 能力已声明、宿主接受了请求 | `{}` | **只代表「已接受」，不代表用户看到了草稿**；草稿是否被后续操作覆盖由宿主 UI 决定 |

### 4.2 适配层应该怎么做

1. **保留 `send:false` 显式传参**（现状如此）。绝不能省略 `_meta`，否则默认 `send:true`。
2. **能力缺失时显式报错，不降级成 active**（现状如此）。否则「新会话」会变成「往当前聊天里塞一段文字」，是伪造成功。
3. **`target:"new"` 不要承诺线程/项目**：只承诺「打开了可编辑草稿」；UI 文案不要写「已派发到任务会话」，也不要展示假的任务卡状态。
4. **`target:"new"` 的 `MethodNotFound` 可以按上游 fallback 语义降级到 active**：上游 `openTextInNewSession` 在无法建会话时会 `inject(st,text)` 并 toast 警告（`client.js:9832-9836`）。如果要保持上游行为，应在**明确 warning** 下 fallback 到 `prefill("active", …)`；如果产品要求「新会话必须新会话」，则保持显式错误。这是产品决策，不是协议能力。
5. **composer 不可用 / widget 失效**：显式报错即可；若 sandbox 授予了 `clipboard-write`，可再加「复制到剪贴板」兜底（上游 `inject` 在没有 injector 时会 `copyText`，`client.js:10119-10123`）。本次真实握手的 `sandbox.permissions` 值未采集，不能假设有剪贴板权限。
6. **错误映射**：`-32602` 视为适配层参数 bug（应修代码而不是提示用户）；`-32603` / `composer unavailable` 视为可重试；`MethodNotFound` 视为当前视图/入口不支持；`This widget is no longer active.` 视为面板已失效（bridge 现有的 thread/cwd 校验已经能在调用前挡住大部分）。
7. **不要从 `{}` 推断草稿可见**：结果只说明宿主接受了请求。若产品需要「草稿真的出现了」，只能在 UI 侧提示用户确认，或者后续读取会话记录时再核对。

### 4.3 当前 `sidebar-bridge.js` 的检查够不够

现状（`prototypes/upstream-port/sidebar-bridge.js:181-191`）：

```js
if (!initialization.hostCapabilities?.experimental?.["openai/message"])
  throw new Error("宿主未提供聊天草稿接口。");
return rpc("ui/message", {
  role: "user",
  content: [{type:"text", text:String(text)}],
  _meta: {"openai/message": {target, send:false}}
});
```

**够用于「防误发」，但有四个缺口：**

1. **没有区分 `draft` 子能力**。真实宿主把 `draft` 放在 `openai/message` 里；`openai/message` 存在只说明「扩展存在」，`target:"new"` 在某些视图仍会抛 `New drafts are unavailable in this view`。建议：把 `caps["openai/message"].draft != null` 当**软信号**（缺了不直接拒绝，但把 `target:"new"` 的失败提示写清楚），不要硬依赖这个未文档化字段。
2. **没有对 `target` 分开处理**。`active` 和 `new` 的失败条件不同（composer vs 新草稿许可）；错误文案应能区分，并决定是否 fallback（见 4.2-4）。
3. **没有把「能力声明」与「入口/视图」绑定**。能力只在 `ui/initialize` 时下发，规范没有能力变更通知（宿主重启会重新 initialize）；而视图状态（composer 是否存在、是否临时聊天）会在同一 iframe 内变化。真正可靠的做法仍是「调用 + 处理错误」，而不是只靠启动检查。
4. **成功提示过于统一**。`build.mjs:13-27` 对 active/new 都闪 `toast.injected`；`target:"new"` 成功后其实是「已打开新草稿并切走」，文案应不同，避免用户以为消息已发出。

另外两点现状是**对的**、不要改：

- `content` 用数组、`role:"user"`、`send:false` 显式传，符合 `tH` schema。
- 失败直接 `throw`，由 `build.mjs` 的 `.catch` 闪 warn 提示，不伪造成功。

**测试覆盖缺口**：`verify-project-switch.mjs:38-41` 只验证了「按键值把 target/send 放进消息」，宿主是模拟的（`hostCapabilities.experimental["openai/message"]=true`）；`verify-sidebar.mjs:78` 的模拟 `ui/initialize` 甚至是空能力。也就是说，**现有测试没有覆盖真实握手 → 真实草稿**这条链。真实握手能力已由 capture 证明；真实草稿效果仍未验证。

## 5. 未验证事实与下一步探针

按优先级：

1. **真实桌面里 `send:false` 是否真的把草稿放进 composer（active / new 各一次），以及新聊天落在哪个项目。**
   探针：在真实项目聊天里打开 deck 侧栏，点某行的「执行」（active）与「新会话」（new），记录：
   - 当前 composer 是否出现文本（是否 append）；
   - 是否切到一个新的空聊天、其项目面包屑/图标显示什么；
   - 是否产生任何新 thread（草稿未发送时应为 0）。
   若要在不盯屏的情况下留证：给 bridge 加一条**仅研究用**的 `deck_ui_message_probe` 上报（记录 target、耗时、`rpc` 的 result/error），人工点两次后读 `.scratch`。这是产品改动之外的研究探针，需另开实施票。
2. **`openai/message.draft` 的真实值**（`{}` 还是 `undefined`）。探针：在 `host-context.mjs` 白名单里给 `openai/message.draft` 开一个只记值的例外，重启 Codex 后重抓 `ui/initialize`。这决定软检查是否可用。
3. **临时聊天 / 侧聊里的行为**。探针：在同一项目的临时 side chat 中打开侧栏，重复探针 1；记录是报 `New drafts are unavailable in this view` / `The composer is unavailable`，还是照常写入。
4. **能力缺失时的真实表现**。本机当前版本无法制造「缺能力」的桌面宿主；只能按规范推断「基础协议可能直接发送」。不要把这条推断当已验证。
5. **`aA`（`Oj9r` store 的 `Rj` 布尔）在 thread 侧栏里的取值**。它控制 `target:"new"` 是否允许；代码里只看到 `aA` 与 `New drafts are unavailable in this view` 绑定，真实值未采集。

## 6. 证据附录

### 6.1 从 `app.asar` 复现代码片段

```js
// node extract.mjs
const fs = require("fs");
const asar = "C:/Program Files/WindowsApps/OpenAI.Codex_26.1103.3517.0_x64__2p2nqsd0c76g0/app/resources/app.asar";
const member = process.argv[2]; // e.g. webview/assets/async/63396.ec0c2499c7.js
const fd = fs.openSync(asar, "r");
const head = Buffer.alloc(8); fs.readSync(fd, head, 0, 8, 0);
const headerSize = head.readUInt32LE(4);
const hb = Buffer.alloc(headerSize); fs.readSync(fd, hb, 0, headerSize, 8);
const tree = JSON.parse(hb.toString("utf8", 8, 8 + hb.readUInt32LE(4)));
let node = tree;
for (const part of member.split("/")) node = node.files[part];
const buf = Buffer.alloc(Number(node.size));
fs.readSync(fd, buf, 0, buf.length, 8 + headerSize + Number(node.offset));
process.stdout.write(buf.toString("utf8"));
```

```powershell
node extract.mjs webview/assets/async/63396.ec0c2499c7.js > 63396.js
node extract.mjs webview/assets/async/182735.e33af7cdca.js > 182735.js
```

本文偏移：`63396…` 的 `22599`（`openai/message` schema）、`46158`（target/send 联合）、`75,3xx–76,450`（handler）、`80660`（events 订阅错误）、`98,640–98,730`（hostCapabilities/`draft`）；`182735…` 的 `4,941,424`（`startNewConversation`）；`418842…` 的 `305118`（`assertActive` 错误）。

### 6.2 本机事实与版本

- 桌面包：`C:\Program Files\WindowsApps\OpenAI.Codex_26.1103.3517.0_x64__2p2nqsd0c76g0\app`，`ChatGPT.exe` / `app.asar` 时间 2026-11-06 18:08（本地）。
- 运行中的桌面进程：`ChatGPT.exe`（Electron）与 `resources\codex.exe`；日志 `~/.codex/logs_2.sqlite` 记录的 `app_server.client_version` 为 `26.1103.31037`。
- 真实握手 capture：`.scratch/upstream-sidebar/02a17a8faba7ae80/host-context-captures.json:296-415`（16:51:22Z）。
- 同一 capture 中 `hostContext` **没有** `threadId` / `cwd` / `project`，与 `docs/research/codex-host-contract.md` 的结论一致；thread 身份来自 `tools/call` 的 `_meta`，与本票无冲突。
- `~/.codex/logs_2.sqlite` 中检索 `openai/message`、`ui/message`、`hostCapabilities` 均为 0 条：桌面 JSON 日志不记录 iframe 侧的 `ui/initialize`/`ui/message`，因此不能用该库验证第 2 节的效果。

### 6.3 规范链接

- [OpenAI MCP Extensions Specification — `ui/message` extensions](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md#uimessage-extensions)
- [同一文档 — Prompt Target and Send Behavior](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md#prompt-target-and-send-behavior)
- [同一文档 — Global / Thread Entrypoint](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md#mcp-app-entrypoints)
- [MCP Apps SEP-1865 — `ui/message`](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/draft/apps.mdx#mcp-apps-specific-messages)

## 7. 对 port 的净结论

- 「执行」（active）与「新会话」（new）的映射**与宿主能力匹配**，不需要改 `ui/message` 的请求形状。
- 「新会话」**不是**同项目的新任务会话，也不返回线程 ID；ADR-0002 的草稿边界应保留，并在界面文案上避免「派发到任务会话 / 结果回显」的暗示。
- 当前 bridge 的门控是**必要**的（缺能力时可能触发基础协议的立即发送），但可以在错误文案、`target` 分流、`draft` 软检查、新会话提示上再做一层；这些是增量改动，没有推翻现有实现。
