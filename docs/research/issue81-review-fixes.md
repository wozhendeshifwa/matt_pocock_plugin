# #81 最终审查修复

2026-11-27。修复工作复用独立 `ticket94` worktree，确认干净后 fast-forward 合入集成提交 `1e16f29373d57faeb635fc77b977112663e3ac88`，不 reset。

## 发现与处理

- Spec P2：版本管理自定义紫色焦点圈与主体普通控件不一致，普通按钮 hover 还额外改变背景。受控测试原先只证明焦点可见，没有证明与主体相同。
- 在允许修改的共享普通控件边界采用主体已有的蓝色 `#58a6ff`、2px 实线、2px offset 合同，覆盖实际主体普通按钮及输入，与版本管理页面/确认区域共用。排除有独立焦点样式的看板图标按钮，没有改变其专用样式。
- 版本管理普通按钮 hover 保持常态的主体表面背景，只沿用主体边框与既有公共阴影反馈，不引入额外背景变化。主按钮仍保留主体已有主按钮色。
- Standards 无人工问题；另清理 `verify-theme-sync.mjs` EOF 多余空行。

## Red → green

真实 Chromium 生产渲染测试增加与**实际主体刷新按钮**的焦点对照，不用裸参考元素替代主体交互。red 重现浅色 VC 输入焦点为 solid/2px/rgb(124,58,237)/2px，真实主体刷新按钮为 auto/1px/rgb(16,16,16)/0px。

修复后明暗两种主题、320/380/760px 实测内容宽度下，实际主体刷新按钮、VC 普通按钮/输入、推送确认区域取消按钮的焦点展示完全相同，均为 solid/2px/rgb(88,166,255)/2px。几何、普通控件、语义色、完整路径及 diff 内部滚动原有检查仍通过。

验证命令（从 `prototypes/upstream-port`）：

- `node verify-version-control-style.mjs`：真实 Chromium 三宽度明暗对照通过。
- `node verify-theme-sync.mjs`：生产面板主题行为、增量配色、状态保留和重开回归通过。
- `git diff --check`：通过。

首轮只静态核对 hover；随后 Spec 复核发现同一 P2 的主按钮分支仍有残留：版本管理主按钮的高优先级透明边框压过主体的主按钮 hover 边框。

## 主按钮 hover 残留修复与真实指针补证

接续现有独立 worktree 和未提交测试改动，新增的可选指针模式通过临时 Chromium 的本机 CDP 端口发送 `Input.dispatchMouseEvent`，实际移动浏览器输入指针；页面同时断言生产控件命中 `:hover`，没有派发 DOM mouse 事件冒充 CSS hover。对照对象是版本管理实际推送确认主按钮与主体 Issue 详情实际评论“发送”主按钮，后者只填写受控临时草稿以启用按钮，绝不点击发送。

有效 red：版本管理主按钮 hover 边框保持透明，主体主按钮变为 `rgba(20, 10, 30, 0.55)`，背景和阴影相同。最小修复仅补版本管理 `primary:hover` 的主体边框规则。修复后实际启用控件在浅/深两种主题下，常态和 hover 的背景、边框、阴影逐项一致。

追加命令及结果（从 `prototypes/upstream-port`）：

- PowerShell `$env:DECK_TEST_HOVER='1'; node verify-version-control-style.mjs`：真实指针浅/深主按钮对照通过。首次普通沙箱连接本机 CDP 端口遇到 EACCES，提权后完成同一受控检查，未修改产品来绕过环境限制。
- `node verify-version-control-style.mjs`：320/380/760px 实测内容宽度的明暗布局、焦点、确认区域、语义显示及长内容滚动继续通过。
- `node verify-theme-sync.mjs`：T1–T7 三组高层检查继续通过。
- `git diff --check`：通过。

以上仍为受控 Chromium 及模拟宿主边界证据；真实 Codex 最终构建加载、原生主题、最窄侧栏及交互视觉仍由 #95 在前置满足后补证，#81 保持开放。未部署、未切换服务、未执行真实 Git 写操作验收或发送评论。

## 指针测试进程提前退出的清理修复

最终 Spec 复核确认原 P2 已解决，同时发现测试基础设施 P3：浏览器在端口探测期间提前退出后，`finally` 才订阅 `exit`，会错过已发生的事件，使顶层等待未完成且临时目录未清理。

本轮先合入集成 tip `2f36c32`。最小修复是在启动后立即保存不拒绝的退出 Promise，记录 `exit` 和 `error`；端口轮询看到提前退出或启动错误即报出明确原因，清理时仅终止仍运行的进程，并等待先前保存的结果。没有修改产品实现。

新增 `node verify-version-control-browser-failure.mjs` 从外部执行现有验证命令，分别把浏览器边界换成“收到 Chromium 参数便退出的 Node 可执行文件”和“不可执行目录”。断言普通失败退出码、4 秒内结束、具体启动/退出原因及临时目录为空，不调用或镜像内部清理函数。

- red：旧脚本在提前退出场景约 6.6 秒后以未完成顶层 await 的退出码 13 结束，未形成正常验证失败。
- green：提前退出和 spawn error 均及时以退出码 1 失败，两种情况下测试临时目录均清空；外层失败路径验证通过。
- 真实 Chromium CDP 指针浅/深主按钮成功路径继续通过。
- `git diff edd19db...HEAD --check` 与未提交差异检查通过。
