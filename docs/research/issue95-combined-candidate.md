# #95 主题与 A 界面组合候选

2026-11-27。分支 `codex/issue95-native-combined`，独立 worktree `.scratch/issue95/integration`。本记录只证明组合构建及受控检查，不证明真实 Codex 原生验收。

## 固定来源与组合

- 主题工作线：`codex/issue81-integration@35cb8e3970b40d45bc9ce469c9ee49e8557007ae`，包含 #93/#94、交互审查修复及失败清理修复。
- A 界面工作线：初始固定 `e38f1d58c4238aeac534d711413ae5eb92cca6f0`，包含已关闭 #91 交付及 #85/#87/#88/#89/#90；随后按协调者确认纳入审查修复快照 `7e9337be5b1fdcb9b3ec635ddcb5f01a86c76d03`。
- 组合产品提交：初始为 `0f2fb50d5b584ba026cafbefe17bf573eebb6563`，最新为 `a636d1f11501c52d04dc819b76726b894e39c744`。从主题 tip 创建新工作线，以 `--no-ff` 合入两个固定 A tip；后续文档提交不改变产品资产。
- 仅有机械合并冲突：构建脚本的新增 import 与 `adaptedBoundaries`，以及生成 manifest。保留两边全部适配（主题完整路径、直接动作、更多动作），再统一重建生成物；未修改 vendor 或新增产品行为。
- 未修改其他工作线、用户配置、当前运行服务或 provider。依赖仅通过本地 `node_modules` junction 复用，不改变依赖版本。

## 本次实际构建字节 SHA-256

以下为 Windows checkout 中实际待载资产字节，大小写不影响哈希比较；不是声称宿主已加载的证据。

| 资产 | SHA-256 |
| --- | --- |
| `prototypes/upstream-port/dist/client.js` | `61843853f4fc080f35f406555be7d190bb0b4700fb0512e2b71fdf7d729f5635` |
| `prototypes/upstream-port/dist/manifest.json` | `1fff5ce2aa9b88645d5723948064faf4c6b9eb70cfe5df43431fcc01c2ee596d` |
| `prototypes/upstream-port/sidebar-bridge.js` | `9ee0873933a9b62912e7573b64cf59f9b7594a661d014e4feaaeff1568721abf` |
| `prototypes/upstream-port/theme.css` | `6f910fa7164308140dc1216787459c7745d09cceb8caf69329fa09a10c97487f` |

## 受控检查

在组合 worktree、Node.js 26.13.0 上执行。侧栏命令从 `prototypes/upstream-port` 执行，根检查从仓库根执行；浏览器只加载隔离受控页面，宿主 RPC/写边界模拟，不发送评论、草稿或执行产品 Git 写操作。

| 命令 | 结果 |
| --- | --- |
| `node build.mjs` | 通过，重建含主题完整路径及 A 直接/更多动作适配的同一 bundle |
| `node verify-theme-sync.mjs` | 通过，T1–T7 三组高层主题行为与状态保留 |
| `node verify-version-control-style.mjs` | 通过，实际 320/380/760px 容器、明暗普通控件/焦点/确认区域、Git 语义显示及长内容内部滚动 |
| `DECK_TEST_HOVER=1 node verify-version-control-style.mjs` | 通过，真实 Chromium CDP 指针对照主体实际评论发送按钮与 VC 确认主按钮；常态/hover 背景、边框和阴影在浅深模式一致 |
| `node verify-version-control-browser-failure.mjs` | 通过，浏览器提前退出与启动失败均及时失败并清理临时文件 |
| `node scripts/check.mjs` | 通过，退出 0；136 个 JS 语法检查，沙箱 28 项中 27 通过/0 失败/1 Windows symlink 权限跳过，构建及全部登记侧栏回归通过 |

根检查覆盖 final A footer 移除与层级、直接当前/新聊天、来源/标签/目标切换恢复、更多动作、历史草稿原文复制与上下文隔离、标签策略、可靠回执/未知结果复制、linked worktree/目录身份、RPC 和写策略。不把既有 Windows symlink 权限跳过记为通过；执行中没有产品失败，也没有为通过而改变代码。

合并完成与文档提交前均执行完整差异检查，结果无格式错误。此记录是受控检查汇总，不是原生 T/X 完成清单。

## 原生证据及漂移边界

#91/#93/#94 的关闭只代表各自声明的代码及受控交付。此候选没有启动或更改真实 MCP 连接、没有切换服务，没有真实 Codex 版本、实际宿主加载、原生主题/宽度/倍率、T 类或 X1–X3 成功证据；#81/#95 保持开放。

#92 的独立审查仍在进行；不因本快照受控通过声称候选永远不会漂移，也不以等待 #92 关闭作为新增依赖。进入原生前由协调者明确最后采用的产品快照；若后续又有产品修改，必须显式检查差异并决定是否纳入，不静默将其他构建的证据套用本候选。

## 已确认的诊断反馈审查修复

协调者明确要求纳入固定 `7e9337b`，该修复从观察和检查结果中传递最新具体 blockingReasons 到按钮附近的失败反馈，包含缺项和补齐方法，不放开来源/工具/资料未满足时的出口。检查差异仅为 `request-preparation`、直接动作反馈、对应高层用例和生成物/文档；无主题、布局、权限或宿主写语义变更。合并无冲突，统一重建后资产哈希已更新为上表。

在 `a636d1f` 组合后，补受影响回归：

- `node verify-direct-issue-actions.mjs` 通过：列表/详情与主动作/更多动作四个组合均使用最新具体原因和补齐方法，仍不写入或自动复制。
- `node verify-theme-sync.mjs` 通过，T1–T7 三组不退化。
- `node verify-bottom-action-bar.mjs` 通过，最终 A 层级、旧面板移除、直接复制和失败文本保留不退化。
- 初始组合完整根检查和 Chromium 布局/指针对照结果保留其固定快照，不为本次局部反馈/文档修复重复无关全量。完整差异检查再次通过。

尚无真实 Codex 加载/主题/组合交互结果；所有必需原生 T/X 场景仍待协调者执行并记录，#81/#95 不关闭。
