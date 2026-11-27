# 历史输入兼容夹具

来源：integration commit a7b22b5ec0d0a51761ed33292fd3afdbe08d1652 的 prototypes/upstream-port/dist/client.js。

legacy-renderer-a7b22b5.js.gz 是 git blob 从首个 window.__ModuleLoader__.load({ 开始到文件结尾的原始 UTF-8 字节，使用 Node zlib.gzipSync 压缩。不含浏览器 runtime；生产 build.mjs 没有导入本目录。

- 解压内容 SHA-256：bf709ad2c0c7acbd438867e9f90873773cdf476dc962c371206e66a52d7b2116
- 压缩文件 SHA-256：471fc08e466d18d0614768bcbb2bfcb919a18436a63f96936a48e0220eeda176

重建：git show 读取上述 commit 的 client.js（保留 git blob LF 换行），截取上述边界，使用 gzipSync 写入夹具。压缩流版本可能改变压缩文件 hash，解压内容必须一致。

sidebar-fixture.mjs 每个场景先运行当前生产 runtime。只有 seed 通过公共 ModuleLoader 加载归档 renderer，以旧公开 UI 填写历史文本及字段；随后卸载并通过同一 ModuleLoader 加载最终 renderer。技能名前缀辅助函数取自当前构建并与 renderer 一起封装。页面不重载，因此生产 runtime 中原有的页面会话内存自然保留。测试不读取私有 map，不注入持久化，不新增生产调试接口。

最终 renderer 没有旧面板或折叠预览入口。复制历史原文、上下文恢复、项目/仓库/backend/effort/Issue 隔离等断言均在最终公开 UI 上完成。
