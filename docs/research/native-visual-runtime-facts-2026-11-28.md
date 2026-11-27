# 原生视觉基准：运行入口与资产事实

日期：2026-11-28（Asia/Shanghai）。服务于[采集当前 Codex 视觉基准与全插件界面清单](https://github.com/wozhendeshifwa/matt_pocock_plugin/issues/103)。本轮仅只读检查配置的 Deck 入口、对应进程、磁盘资产与既有证据；没有重启服务、切换主题或操作用户界面。

## 当前可证明的事实

| 层级 | 观察 | 可证明范围 |
| --- | --- | --- |
| Codex 运行包 | `OpenAI.Codex_26.1120.6357.0_x64__2p2nqsd0c76g0` | 当前 ChatGPT.exe 进程的安装包归属；不证明插件 UI 版本 |
| Deck 配置 | `mcp_servers.deck` 的入口为项目内 `.scratch/deck-runtime/stdio.mjs` | 已配置入口；没有输出或复制其他配置字段 |
| Deck 进程 | 有两个命令行匹配上述入口的 Node.js 进程，启动时间分别为当日约 01:09、01:10 | 服务进程存在；未推断哪个进程对应当前可见面板 |
| 入口代码 | 导入 `prototypes/upstream-port/sidebar-server.mjs`，数据目录沿用 `.scratch/issue82/context/candidate/state/` | 入口加载主目录服务模块，不是旧 issue99 固定发布模块 |
| 当前检出 | `codex/native-visual-responsive`，HEAD `23b85c2` | 当前磁盘 Git 状态；不证明进程模块已重载 |
| 资产相对基线 | `git diff 37ba297 HEAD --` 对客户端、桥接、主题三个资产无差异 | 本次清单提交没有改动这三个产品资产 |

## 当前磁盘指纹

| 资产 | SHA-256 |
| --- | --- |
| `prototypes/upstream-port/dist/client.js` | `8267149b6b48eadb3faabfa3e5bf39fdac7ade10f54e41391087e4aa4af3b840` |
| `prototypes/upstream-port/sidebar-bridge.js` | `9ee0873933a9b62912e7573b64cf59f9b7594a661d014e4feaaeff1568721abf` |
| `prototypes/upstream-port/theme.css` | `6f910fa7164308140dc1216787459c7745d09cceb8caf69329fa09a10c97487f` |

按 `sidebar-server.mjs` 当前源码规定的顺序，将主题、客户端、桥接 UTF-8 文本和资源权限 JSON 以换行拼接后，资源版本为 `cc413a6b190dc48a`，对应 `ui://deck-sidebar/board-cc413a6b190dc48a.html`。客户端 JS 文本长度为 2,144,549 个字符。这是磁盘计算值，可用于与可见页面比对，不能自行升级为已加载字节证明。

## 可复用的证据与边界

- [已有源码界面清单](native-visual-baseline-inventory-2026-11-28.md)覆盖五个顶层页签和看板内部界面。其“本轮没有真实截图”属于生成当时记录，后续应以新增采集为准。
- [主题切换调查](issue100-theme-flicker-investigation-2026-11-28.md)已记录入口由旧 issue99 固定发布迁移至当前主目录，且磁盘客户端/桥接指纹与本次检查一致。它含真实 Chromium 的合成消息受控复现，不是原生视觉截图或原生切换帧证据。
- 数据目录的 `host-context-captures.json` 目前达到 40 条记录上限，出现 `ui/initialize`、`openai:set_globals`、`ui/notifications/host-context-changed` 等来源，最近记录约 01:13。该文件含项目身份信息，本记录只记聚合事实，不复制其内容。捕获被去重及截断，不能据此重建完整切换序列或验证当前资源字节。
- 旧 `.releases/issue99-spec-display-20261127/` 的历史哈希和旧面板脚本长度不能作为当前运行版基准；此目录已不再提供当时的完整客户端快照。

## 仍需可见页面证据

1. 对当前可见面板取得脚本/资源指纹，并与上述磁盘计算值比对。
2. 实测插件面板宽高、窗口尺寸、缩放与主题模式；记录宿主及插件相邻样本。
3. 按现有页面清单观察实际入口、弹窗、悬停/焦点/禁用及长内容场景。

当前不能由配置、进程存在或磁盘哈希证明可见面板加载了特定字节，也不能因此关闭视觉基准采集票。
