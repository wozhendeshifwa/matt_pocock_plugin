# 私有远程插件兼容性验证：阶段证据

日期：2026-11-24（Asia/Shanghai）。对应[当前客户端验证](https://github.com/wozhendeshifwa/matt_pocock_plugin/issues/43)。这是阶段结果，不是全功能通过结论。

## 已完成

- 独立 worktree `.scratch/wayfinder-render-43`，分支 `codex/remote-plugin-probe-43`，探针源码提交 `c25fb2e849d5f71e08f8225afe42b4e0968e3826` 已推送；未改主工作区WIP或原有业务代码。
- 当前PATH中的Codex来自Windows包 `26.1117.4957.0`，Node为`26.13.0`。未将旧报告的UI版本当成本次实测版本。
- 使用固定官方MCP SDK 1.32.2。探针只有两个只读工具与一份界面资源，不读取项目文件、GitHub凭据或会话数据库。诊断只返回元数据键名、存在性与聊天ID摘要，不记录原始路径/聊天内容。
- 本机真实HTTP协议测试通过：无认证401、错误Origin403、无效会话404、独立会话、工具列表、界面资源、元数据值脱敏、无效参数拒绝。沙箱内一次回环请求因EACCES失败；沙箱外重跑通过，未把失败当通过。
- 用户明确选择Render `My Workspace` 后创建免费Web服务 `deck-compat-probe-43`，区域Singapore，自动部署关闭，未创建付费计算/数据库。免费计算不等于所有平台用量绝对零账单。
- 服务ID `srv-dc26h3bm8hqs73b8m6eg`，部署ID `dep-dc26h43m8hqs73b8mbeg`；Render读回`live`，源提交为上述探针提交。
- 真实远程HTTPS smoke通过：未认证请求401，SDK initialize/list/call/resources正常；工具为`open_remote_compat_probe`与`remote_compat_identity`，资源类型为`text/html;profile=mcp-app`。
- smoke使用普通SDK客户端，没有宿主元数据，实际返回`hasThreadId=false`、`hasCwd=false`。这只说明普通客户端没有发送身份，不能推出Codex宿主远程身份支持或不支持。
- 最小兼容布局插件与独立marketplace已在隔离CODEX_HOME安装通过，随后通过Codex官方CLI安装到真实用户配置。插件ID为`deck-remote-compat-probe@deck-remote-probe-43`，版本0.1.0。
- 修改前已备份用户配置至主工作区`.scratch/remote-probe-secrets/before-install/config.toml`；安装后原有model_providers块逐一核对保留。未删除或切换原有provider、DeepSeek回退与deck插件。
- 测试密钥仅用于探针，存放于本机忽略目录及Render环境配置；未加入源码提交、本文或issue。不上传密钥和本地认证配置。

## 尚未完成

| 项目 | 当前状态 |
| --- | --- |
| 实际Codex插件目录显示与加载 | CLI安装成功；UI尚未确认，需重新加载客户端 |
| 私有远程插件中的侧栏/主题/握手 | 未实测 |
| 模型调用与界面调用的逐请求项目身份 | 未实测；不能用普通SDK smoke替代 |
| 当前聊天/新聊天可编辑草稿、不自动发送 | 未实测；最小界面已准备当前聊天测试按钮 |
| 同项目两聊天、跨项目、切回、无项目与旧请求隔离 | 未实测 |
| 云端重启/休眠与客户端恢复 | 未实测 |

## 桌面操作边界

本次通过Computer Use读取当前Codex窗口，看到用户正在另一个工作中的聊天编辑内容。尝试打开插件页时工具返回`user input was detected in this window`，未执行点击；没有清空草稿、发送消息、切换聊天或重启客户端。

下一步由用户在方便时重启Codex使插件加载，回到本聊天回复“已重启”；然后验证插件目录、只读工具、最小侧栏、主题、身份和草稿。不把CLI安装或Render live当真实桌面验收。

## 可恢复与清理

本机测试marketplace、隔离home与配置备份均在主工作区忽略目录；正式插件缓存由CLI管理。后续清理用官方插件/marketplace移除命令并保留其他配置，不能直接覆盖当前配置为旧备份（期间可能有其他合法修改）。云端服务保持free且自动部署关闭；测试完成后再按实际需要停止或移除，不静默删除恢复材料。

官方打包参考：<https://developers.openai.com/plugins/build/plugins>；当前文档支持兼容manifest与本地marketplace，并说明本地插件变更后重启桌面客户端。本文未声明本地插件路径等同于托管插件全部能力。
