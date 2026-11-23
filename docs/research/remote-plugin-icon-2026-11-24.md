# 远程客户端识别图标

按用户要求，为Deck Remote Companion增加蓝青色云朵与连接节点的SVG标识；本地裸stdio MCP继续使用原默认标识。图标为256×256的包内资产，logo与composerIcon均指向./assets/remote-cloud.svg。

固定插件ID仍为deck-remote-companion@deck-remote-companion-44，显示名不变，客户端包由0.1.0更新到0.1.1。源码生成器build-client.mjs同步输出该资产与声明。先用隔离CODEX_HOME核对官方同IDplugin add可从0.1.0刷新为0.1.1，provider哨兵保留；随后备份真实来源manifest、MCP声明与config，再更新来源并由官方CLI重新安装，没有手改缓存。

真实安装读回：0.1.1、enabled:true；缓存manifest的logo/composerIcon引用均存在，SVG SHA256为c9a0b4b2f94d56fd816679113f1c2ea5cefd65f8ac22b8779809a768686eba21。真实config.toml及源/缓存.mcp.json逐字节核对未变，身份、bearer环境变量引用和连接入口沿用原值，本地版未修改。

此项只更新客户端显示包；已验收完整runtime的a7c9c55源码、48c40d84包及外部手动安装入口未改变，远程写授权未开启，正式规格仍open。当前已核安装记录及图标文件，尚未把客户端当前内存界面的图标刷新认定为已观察；本地插件重新加载/下次重开后读取新发布元数据。

本机证据在.scratch/icon-update-44/installed-result.json和live-backup；隔离重装证据在.scratch/icon-cli-check-OD4NAF/result.json。备份与原始私有配置不上传Git。
