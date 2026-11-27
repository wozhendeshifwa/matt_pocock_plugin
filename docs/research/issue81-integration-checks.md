# #81 集成构建与受控检查

日期：2026-11-27。集成分支 `codex/issue81-integration`，基点 `edd19db`。

## 集成内容

- #93 实施提交 `38b9e11`，以 `8d5101b` 合入：共享宿主主题生命周期、回退与增量配色处理，以及生产面板高层状态保留检查。
- #94 实施主提交 `a6643ad`，包含最新集成的分支 tip `f66e89b`，以 `6c23e29` 合入：普通控件、共享主题令牌、Git 专用显示与长路径/diff 内部滚动。
- 两次均使用独立实施 worktree 和 `--no-ff` 集成合并。未重置其他工作线或修改主工作区原有 `GLOSSARY.md`。
- 本记录及最终 `dist/client.js`、`dist/manifest.json` 由集成 worktree 统一构建。manifest 的 upstream SHA 按本次实际 checkout 字节计算；CRLF checkout 导致其与旧生成物中的 SHA 不同，不伪造为旧值。客户端生成物包含本次 `versionControl.fullPaths` 适配的实际变化。

## 命令与结果

以下前五条从 `prototypes/upstream-port` 执行，根检查从集成仓库根执行，Node.js `v26.13.0`。

| 命令 | 结果 |
| --- | --- |
| `node build.mjs` | 通过，使用组合后的真实客户端与 bridge/CSS 构建 |
| `node verify-theme-sync.mjs` | 通过：T1–T7 三组高层受控检查，覆盖宿主优先、无信号浅色回退、增量保持、跨模式清理、编辑/选择/diff/滚动状态值、确认区域和重开 |
| `node verify-version-control-style.mjs` | 通过：Chromium 真实布局引擎中的 320/380/760px 侧栏内容容器，明暗普通控件、确认区域、Git 专用显示及长内容滚动 |
| `node verify-project-switch.mjs` | 通过：同项目聊天/子目录保留面板，跨项目重挂载，返回恢复；projectless 或身份缺失清空 |
| `node verify-unassociated-sidebar.mjs` | 通过：未关联侧栏不加载固定仓库数据或动作 |
| `node scripts/check.mjs` | 初次沙箱运行因 Git/MSYS 命名对象权限失败；提权重跑通过，详见下文 |

布局受控测量：三个容器实际宽度分别为 320、380、760px，浏览器 viewport 分别为 512、512、838px（不把请求窗口宽度冒充实测侧栏宽度）。三种宽度下，浅/深按钮及输入控件均为 26px 高；diff 的可见宽度分别为 253、313、693px，内容宽度为 7599px，在内容区域滚动。Git 新增/删除等语义色在明暗模式分别保留，确认区域背景为浅色白色与深色 `rgb(22,24,29)`。

仓库检查初次结果为沙箱测试 28 项中 25 通过、2 失败、1 跳过。两处失败均在临时夹具 `git clone` 时触发 `NtCreateDirectoryObject(...): 0xC0000022`，属于受限进程的 Git/MSYS 权限失败；没有修改产品代码来绕过。使用同一命令提权重跑后：

- JavaScript 语法检查：127 个文件通过。
- 沙箱回归：28 项，27 通过、0 失败、1 跳过。跳过项为 Windows token 缺少 symlink privilege 的既有用例，不记为通过。
- 侧栏构建、项目切换、56 个 RPC 注册覆盖及写权限策略检查通过。
- 原生草稿适配的受控请求、项目绑定、legacy 动作等待/失败反馈、出口可用性、linked worktree/子目录身份和资源版本回归通过。
- 根检查最终打印 `PASS: syntax, sandbox tests, sidebar build, project identity/draft routing, RPC manifest and write policy`，退出码 0。

## 证据边界与未完成下一步

上述是受控行为和 Chromium 布局证据，不是 Codex 原生验收。jsdom 检查的 `scrollTop`/`scrollLeft` 保留只证明状态值未丢，真实滚动由浏览器布局用例补充；仍未取得最终组合构建在 Codex 中实际加载、宿主主题双向变化、真实最窄侧栏/倍率及 X1–X3 共同场景的证据。

此轮仅为集成与受控检查，未部署或切换运行服务，未为主题验收执行真实提交/推送等产品 Git 写动作。仓库检查中的临时 Git 夹具仅用于已有回归，不操作用户业务仓库的产品写入口。

审查修复已合入：唯一修复代理提交 `fb82723` 统一了实际主体与版本管理普通控件的 focus/hover 合同，补充真实主体刷新按钮的焦点对照，并清理 `verify-theme-sync.mjs` 的 EOF 多余空行。详情见 [最终审查修复](issue81-review-fixes.md)。集成后重新执行 `node build.mjs`、`node verify-theme-sync.mjs`、`node verify-version-control-style.mjs` 均通过，`git diff edd19db...HEAD --check` 无错误。修复仅涉及 CSS、验证和空行，未重复刚通过的无关仓库全量回归；重新构建没有产生语义生成物差异。

焦点受控结果：320/380/760px 容器、浅/深两种主题下，实际主体刷新按钮、版本管理按钮/输入及确认区域取消按钮均为蓝色 `rgb(88,166,255)`、2px 实线、2px offset。

主按钮 hover 残留分支由唯一修复代理在 `0dcf3eb` 中补齐，并以 `2f36c32` 合入集成。重新执行构建、T1–T7、三宽度样式/布局及全差异 `git diff edd19db...HEAD --check` 均通过；构建没有产生语义生成物差异。`DECK_TEST_HOVER=1 node verify-version-control-style.mjs` 使用真实 Chromium CDP 指针，对照实际主体评论发送按钮和版本管理推送确认主按钮，浅色/深色下常态与悬停的背景、边框、阴影完全一致；悬停边框为 `rgba(20,10,30,0.55)`。没有点击评论发送或 Git 写确认。普通沙箱首次连接本机 CDP 端口时报 `EACCES`，同一命令获准提权后通过；这是受控浏览器证据，不是 Codex 原生交互证据。审查随后指出浏览器提前退出时测试辅助清理可能等待未来 exit 事件，失败收尾修复仍在进行，不在此记录冒称全部审查已结束。

#95 继续等待 #93、#94、#91 的前置满足，再在实际加载最终同构建后完成 T 类及 X 类原生验收，与 #92 共享证据，不互设阻塞。#81 父规格及 #95 均不能因本记录关闭，#70 的独立可靠性标准与开放状态不变。
