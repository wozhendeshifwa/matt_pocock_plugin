# #92 与 #95 同构建验收候选

2026-11-27。此分支只组合已经实现的主题和直接动作工作线，准备满足 #92／#95 的同构建证据要求；不新增主题功能，不把受控结果记为原生通过。

## 固定来源

- 从 `codex/issue95-native-combined@c1f9a4500dc7fc27dc7a2c7680f7b83bef0f1098` 创建本轮独立工作树 `.scratch/issue82/native-combined`，分支 `codex/issue92-native-combined`。读取时该 ref 与固定提交一致。
- 以 `--no-ff` 合入 `codex/issue82-integration@d4067b19343f7301cad749959845283af4032c7c`，组合产品提交为 `dac412de27545d9be8bb96a27284a64c19712ea6`。自动合并无冲突，再执行真实生产构建；生成物内容与合并结果一致。
- 已分别用 Git 祖先检查确认包含主题 `35cb8e3`、最新来源诊断 `7e9337b`、原生发现的列表反馈／剪贴板声明修复 `37e1da2`。
- 构建适配并集保留 `versionControl.fullPaths`、`issueActions.directCurrent`、`issueActions.more`，服务资源仅声明 `clipboardWrite` 并将权限契约纳入资源 URI。未改成读剪贴板权限或全局权限。

未修改 #95 的工作树、票面或连接配置，没有将组合分支回合到 #82 产品分支；`codex/issue82-integration` 仍独立保留在 `d4067b1`。未改 main、用户 GLOSSARY、provider、DeepSeek 或候选入口脚本，未推送。待验工作树及依赖 Junction 保留，供协调者安全载入。

## 实际检查

本次首次组合包含主题和新原生修复，因此在组合产品 `dac412d` 上执行完整 `npm run check`，退出 0：136 个 JavaScript 语法检查；sandbox 共 28 项，27 通过、0 失败、1 跳过；生产构建及全部 18 项登记侧栏检查通过。跳过项为 Windows token 缺少 symlink 权限的 retained-untracked-symlink 场景，不算通过。执行使用获准宿主权限，避开已知 Windows Git 沙箱命名对象限制；复用主树已有 node_modules Junction，没有安装或改动依赖配置。

完整检查覆盖直接当前／新聊天请求、实际目录身份、来源／标签／目标变化恢复、更多动作、历史原文、最终 A 操作区、具体长阻塞原因和复制失败保留，以及 `resources/read` 的仅写剪贴板元数据与 URI／旧别名契约。这些场景的宿主和剪贴板边界受控，不证明生产宿主成功写入。

另在同一构建执行：

| 命令 | 本次结果 |
| --- | --- |
| `node verify-theme-sync.mjs` | T1–T7 三组主题优先级／回退恢复、增量调色与编辑／选择／diff／滚动保留通过 |
| `node verify-version-control-style.mjs` | 隔离 Chromium 实际侧栏容器宽 320／380／760px，明暗普通控件、焦点、确认区及 Git 语义显示通过；长 diff 分别在 253／313／693px 内容区内部滚动，完整内容 scrollWidth 7599 |
| `node verify-version-control-browser-failure.mjs` | 浏览器提前退出和启动失败都及时失败并清理自有临时文件 |

上述 Chromium 回归只加载受控隔离页面，RPC／写边界模拟；其窗口 viewport 分别为 512／512／838px，不把请求宽度冒充实际侧栏宽度。未操作原生 Codex 页面、用户浏览器标签或真实 Git 写流程。未为本轮仅组合改动重复之前的独立 hover 指针对照，历史证据保留其原提交边界。

构建后两个产物只有工作树 LF／CRLF 的索引显示；`git diff --quiet` 为 0，刷新索引后没有内容差异或额外产品提交。完整差异卫生检查通过。

## 待载资产字节

这是本工作树构建后实际文件 SHA-256，不能代替原生加载观察：

| 文件 | SHA-256 |
| --- | --- |
| `prototypes/upstream-port/dist/client.js` | `f66187aff9817b85b886d1616de15e0a5d137672fa8478c4b96f4290688d6585` |
| `prototypes/upstream-port/dist/manifest.json` | `1fff5ce2aa9b88645d5723948064faf4c6b9eb70cfe5df43431fcc01c2ee596d` |
| `prototypes/upstream-port/theme.css` | `6f910fa7164308140dc1216787459c7745d09cceb8caf69329fa09a10c97487f` |
| `prototypes/upstream-port/sidebar-bridge.js` | `9ee0873933a9b62912e7573b64cf59f9b7594a661d014e4feaaeff1568721abf` |

## 原生与前置能力边界

本组合尚未由协调者改候选入口并在真实宿主重新载入。当前构建的全部原生 U／I／T 和 X1–X3 共同证据仍待验，不从其他工作线的历史原生观察平移成功结论。列表长诊断和系统复制需要在新资源实际加载后以真实指针复验；公开 `clipboardWrite` 声明不保证宿主已经授予或实际复制成功。

当前生产 `ProductionSkillHost` 仅提供维护资料核验，没有执行所需 `assessRequirements` 的可信通道。首次直接动作被此守卫停止、原手写草稿保留的观察，不等于成功原生追加。不能复用 maintenance assessment、硬填 `complete:true`、改变生成请求以避开技能检测，或给候选注入测试替身来通过验收。可信执行条件核验属于需要另行明确设计接缝的前置能力；本次未实现或伪造它。

真实当前草稿原文／空行追加、完整可编辑且未发送、新聊天来源注册项目和根／工作树／子目录、系统剪贴板及历史原文、主题生命周期、原生宽度／倍率／中文输入法和共同交互，均按 #92／#95 分别记录实际结果。#82／#92 及 #81／#95 未满足全部标准不关闭；#70 可靠读回、条件写入及原子目标保护标准独立保留，不据本组合升级。无自动发送、重试、改投或复制。
