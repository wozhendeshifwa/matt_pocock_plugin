# 真实 HTTPS 隔离写入验收

关联 [#44](https://github.com/wozhendeshifwa/matt_pocock_plugin/issues/44)。本机日期为 2026-11-24，以下时间均为 UTC（2026-11-23）。本轮证明 **真实 Render HTTPS → companion → 原 stdio → 隔离本机项目** 的五种方法、六次顺序写入；未证明真实 Codex 写审批或 UI 验收。原配对最终仍只读。

## 范围与固定材料

- 夹具：`.scratch/https-write-fixture-44`。owned Git 项目无 remote；独立 fake Codex 索引、空 HOME/GH 配置、安装级 ledger、journal、本机数据目录。未读写其他业务项目。
- 假线程身份为夹具专用 UUID；grant 只含 owned 根与 `bind / logSetSwitch / gitStage / gitUnstage / gitCommit`。真实根和真实线程没有映射到 owned 项目，七个外部背景请求被拒绝。
- 适配器来自 v6-reviewed，450 文件逐字节复制后独立 verify。manifest SHA-256：`dc04813e34b463827667f8bca236ffc6c31ec847959a414c334d4ead9e756e10`。执行链使用当时工作区 core；这不是后来完整固定 runtime 包的安装验收。
- 云端既有 DPAPI caller/device 凭据只在 RAM 解密使用；未输出明文/cipher/env，未更改实际 pairing/token/grant/provider/Startup。未访问 GitHub，无 UI、开窗、宿主聊天或草稿操作。

## 实际结果

| UTC | 操作 | 独立效果证据 |
| --- | --- | --- |
| 20:46:10 | bind markdown | workspace 与本机 choices 均落盘 markdown |
| 20:46:11 | logSetSwitch | 磁盘为 `enabled:false, sampleRate:0.25` |
| 20:46:13 | gitStage | index 恰有 sample.txt |
| 20:46:14 | gitUnstage | index 为空 |
| 20:46:15 | gitStage | index 恰有 sample.txt |
| 20:46:19 | gitCommit | 经原 gitWriteCheck 捕获 ticket 后提交；新 HEAD、父提交、已提交文件内容与空 index 均核对 |

六行安装 ledger 均为 `completed/succeeded`，有各自结果 SHA。20:49:14 的独立只读复核仍得到六行终局和实际磁盘/Git效果：HEAD `6443e2288e55d87f667025f24ad8e1a5a3dc957f`，parent `aaf70a68e8ceb885a20879e7211fb9d243d7833f`，sample 内容为本次 owned 修改，index 空、remote 空。没有 unknown，也没有重放任何成功写。

## 精确停机与恢复

- 20:46:05 完成所有前置检查：SDK 初始化、health version 1、DPAPI 可读取、450 文件 verify、旧 bf 包 18 文件 hash、旧实例只读且唯一。
- 20:46:06 通过原 lifecycle 的 requestStop 释放旧 PID 20440 的准确 instance；确认该实例已退出后才连接 fixture，未 kill Codex 或其他 PID。
- 20:46:19 写验收结束。finally 顺序关闭 SDK、fixture companion、executor drain、stdio、ledger、journal；六项均有 closed 记录。
- 20:46:22 以 Hidden 启动准确的旧 `.scratch/readonly-runtime-bf58877/prototypes/remote-companion/launch.mjs`，使用原绝对 pairing 路径。没有加载开发中的写组件。
- 20:47:50 与 20:49:14 独立 lifecycle/CIM 复核：旧 PID 32148、instance `43ea57a5-d3a2-42be-9bd0-d301dff2134f`，connected/running，唯一同 pair 实例，`writeEnabled:false`，owned 子 Node 为零。旧包再次 18/18 文件 hash 匹配。
- 主任务随后实际 host 首 call 成功恢复到真实 root/thread/repo；这项由主任务记录，本夹具没有冒称自己的 SDK 为真实 host。

## 证据限制与保留

原 helper 在启动旧组件后退出，`result.json` 停在 restarting，没有完成最终尾段。原因未确定；不得把它记为全程无异常。旧只读恢复和资源释放由后续 `recovery-observation.json` 独立确认，原 run 未覆盖、未重跑。

原 helper 的本轮 before 指纹只保留在 RAM，没有落盘，因此本轮主仓 HEAD/index/git config、source config、sealed cloud 文件的逐项前后 SHA 比较 **证据不足**。后续单独保存了当前 hash/mtime；pairing/provider 的 hash 与先前 19:39:35 固定基准一致，这只能证明与先前基准相同，不能冒充本轮实时前后指纹。未宣称 journal/数据文件没有后台读活动。

本机保留：`acceptance.mjs`（原执行脚本）、`result.json`（原 run）、`installation-ledger.sqlite`、`journal.sqlite`、owned Git/数据/fake 索引/适配器副本；`observe-recovery.mjs` 与 `recovery-observation.json`（独立只读收尾）。不把这些本机路径下的私有详细记录打包公开。下一次验收应在停实例前先落盘 before 指纹，并把执行进度和恢复观察分别持久记录。
