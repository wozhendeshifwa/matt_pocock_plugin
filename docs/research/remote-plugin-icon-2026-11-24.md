# 远程客户端识别图标

按用户要求，为Deck Remote Companion增加蓝青色云朵与连接节点的SVG标识；本地裸stdio MCP继续使用原默认标识。图标为256×256的包内资产，logo与composerIcon均指向./assets/remote-cloud.svg。

固定插件ID仍为deck-remote-companion@deck-remote-companion-44，显示名不变，客户端包由0.1.0更新到0.1.1。源码生成器build-client.mjs同步输出该资产与声明。先用隔离CODEX_HOME核对官方同IDplugin add可从0.1.0刷新为0.1.1，provider哨兵保留；随后备份真实来源manifest、MCP声明与config，再更新来源并由官方CLI重新安装，没有手改缓存。

真实安装读回：0.1.1、enabled:true；缓存manifest的logo/composerIcon引用均存在，SVG SHA256为c9a0b4b2f94d56fd816679113f1c2ea5cefd65f8ac22b8779809a768686eba21。真实config.toml及源/缓存.mcp.json逐字节核对未变，身份、bearer环境变量引用和连接入口沿用原值，本地版未修改。

此项只更新客户端显示包；已验收完整runtime的a7c9c55源码、48c40d84包及外部手动安装入口未改变，远程写授权未开启，正式规格仍open。当前已核安装记录及图标文件，尚未把客户端当前内存界面的图标刷新认定为已观察；本地插件重新加载/下次重开后读取新发布元数据。

本机证据在.scratch/icon-update-44/installed-result.json和live-backup；隔离重装证据在.scratch/icon-cli-check-OD4NAF/result.json。备份与原始私有配置不上传Git。

## 会话右侧栏入口

用户随后在桌面看到了两个同名的 `MattSkillsDeck`。包内 SVG 服务于插件展示。会话右侧栏从 `tools/list` 中读取入口工具自己的 `title` 和 `icons`。两个服务此前都直接返回同一份本地入口信息。[入口规范](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md#entrypoint-icons)

免费服务 `deck-relay-44` 已部署提交 `101bc6470de8d67fb6b0278f5001ba6ed60a4e2e`，部署 `dep-dc2hb47lk1mc73a08k7g` 已进入 `live`。在线 MCP SDK 和本机 Codex 独立进程的 `mcpServerStatus/list` 均读回下列入口。

| 连接 | 右侧栏标题 | 入口图标 |
| --- | --- | --- |
| 本地 stdio | MattSkillsDeck | 默认图标 |
| 远程 HTTPS | 远程版 · MattSkillsDeck | 蓝青底白云，内嵌 64×64 PNG |

两次读回的 PNG 均与发布资产一致，SHA-256 为 `e45f6de7aaa08cdd634b9277b947b82a0f7c77987819bbb3729d6e0acc06c7d4`。当时已从当前会话调用远程侧栏入口，菜单画面尚待目视确认。

随后用户提供的实际菜单截图仍有两个同名入口和两个相同的黑色图标。确认其余聊天已空闲后，于北京时间 13:15 正常退出 Codex，从已安装的远程版桌面快捷方式重新打开。当前窗口已显示「远程版 · MattSkillsDeck」，用户随后人工确认图标已经可见。出现同样情况时，先保存好进行中的工作，从远程版桌面快捷方式正常重开 Codex，再在右侧栏检查名称和图标。[正式规格](https://github.com/wozhendeshifwa/matt_pocock_plugin/issues/44)
