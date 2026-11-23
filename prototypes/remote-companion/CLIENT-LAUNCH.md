# 本机客户端 caller 启动入口（准备完成，尚未安装）

首次 private bootstrap 可以把 `DECK_COMPANION_CALLER_TOKEN` 带入 Codex；普通 Windows 重开不会自动继承它。本模块准备了独立的本机 caller 凭据记录和日常双击入口。它属于安装控制入口，不改变业务界面、写入审批或原 Codex / DeepSeek provider 配置，也不替代 companion 的设备配对和自启动。

本次只交付本机 API、PowerShell 模板、只读快捷方式计划和隔离验收。没有改 Desktop / Startup、插件、provider 或现用快捷方式，没有启动或关闭真实 Codex。正式固定 release 打包、一次性本机 caller 配对、用户确认新快捷方式以及真实界面 / 登录 / 重开验收仍待完成；不能据此声称日常入口已经安装。

## 凭据和启动约束

- `createCallerRecord({file, callerToken})` 创建全新记录，已有文件拒绝覆盖。使用当前 Windows 用户的 DPAPI，随机 credentialId 为 entropy；记录只有 caller 密文及版本 / app / 环境变量元数据，不包含 device、session 或 GitHub 密钥。
- `loadCallerRecord(file)` 默认只返回脱敏元数据。`{decrypt:true}` 仅供受信本机调用获得内存值；不要打印该结果。
- `launchClient({callerFile, releaseDirectory, expectedManifestSha256})` 启动前核对批准的固定 manifest 和完整文件目录，拒绝篡改、未列文件和链接。caller 记录必须放在 release 外。
- 生产可执行文件只从当前用户已安装的 `OpenAI.Codex` Appx 包定位到 `app\ChatGPT.exe`，没有可由远程 MCP 指定的程序或参数。查询失败即拒绝。解密前及解密后检查相同 app 的进程；存在时提示用户正常退出，绝不 kill，也不冒充已给现有单实例注入认证。
- caller 只加到新子进程的环境副本，父进程环境保持原值。它不会进入 argv、日志、明文 JSON、插件 cache 或永久用户环境。已启动进程的环境仍属于该进程；本入口不声称能抹除所有内存副本。
- 仅本机 JS API 的第二参数允许测试程序注入 fake executable / args / process check / child env；没有远程工具、OAuth、任务引擎或自动更新接口。

## 固定 release 清单

正式入口必须指向经用户确认的独立版本目录，例如 `…\DeckClient\releases\<releaseId>`，不能指向正在编辑的 checkout / worktree。先从固定提交打包，再生成并核对清单；新版本重新确认 digest 和快捷方式，不自动切换。

release 根目录放 `client-release.json`，自身 SHA-256 作为 `expectedManifestSha256` 单独保存在批准的快捷方式参数中。清单格式：

```json
{
  "schemaVersion": 1,
  "kind": "deck-client-launcher-release",
  "releaseId": "owner-approved-version",
  "entrypoint": "prototypes/remote-companion/client-launch.mjs",
  "files": [
    { "path": "prototypes/remote-companion/client-launch.mjs", "bytes": 123, "sha256": "64位小写SHA256" }
  ]
}
```

`files` 必须列全打包文件的真实长度和 hash（上例仅解释结构）。当前本模块的相对导入闭包还包括 `lifecycle.mjs`、`write-grant.mjs`、`local-data-layout.mjs`、`local-data-upgrade.mjs`、`protocol.mjs`，应从同一固定版本收集并重新核验，不能把此清单当永久依赖列表。限制：2000 文件、单文件 32 MiB、总计 64 MiB；路径用 `/`，不含 `.git`、`node_modules`、链接和额外文件。凭据、生成启动脚本、快捷方式、备份和可写运行状态都放在 release 外。

PowerShell 模板先用 .NET SHA256 检查所有文件，再加载 Node 入口；Node 再完整验证。快捷方式固定本机 Node 路径，要求受信的支持 `node:sqlite` 的 Node 版本。它不负责下载 / 验签 Node 或制作正式安装包。`-ExecutionPolicy Bypass` 仅作用于这一次 PowerShell 进程，不修改机器 / 用户执行策略；模板仍在加载入口前验证固定 release digest。

## 一次性本机配对与预览（模板，未执行安装）

CLI：`pair <callerFile>` 从当前进程的 `DECK_COMPANION_CALLER_TOKEN` 读取已有本机值；没有时读取有界 stdin。不要把值写进命令、文件或 `setx`。输出只含脱敏元数据，失败只输出固定错误码。

若需要本机交互输入，确认固定 release 后使用安全提示和管道；下面三个路径需替换为已批准的真实值：

```powershell
$node = 'C:\approved node\node.exe'
$entry = 'C:\approved fixed release\prototypes\remote-companion\client-launch.mjs'
$callerFile = 'C:\private local state\caller.json'
$secureCaller = Read-Host 'Caller token' -AsSecureString
$localCaller = [Net.NetworkCredential]::new('', $secureCaller).Password
try {
  $localCaller | & $node $entry pair $callerFile
  if ($LASTEXITCODE) { throw 'Caller pairing failed' }
} finally {
  $localCaller = $null
  $secureCaller.Dispose()
}
```

`shortcut-plan <callerFile> --release-dir <fixedDirectory> --manifest-sha256 <approvedHash>` 只读输出脚本、路径和参数，默认目标为 Desktop，不写文件。也可在本机 JS 中调用：

```js
const options = { callerFile, releaseDirectory, expectedManifestSha256 };
const plan = await planClientShortcut(options);
// 交给用户审阅 plan；不包含 caller 密文或明文。
const preview = await writeClientShortcut(options); // 默认 dryRun:true
```

未来安装器经确认后才能显式调用 `writeClientShortcut(options, {dryRun:false})`。它只生成独立的 `Deck Codex Remote-<credentialId>.lnk`，不替换原快捷方式。参数只含 paths / hash；脚本放在 caller 记录旁。覆盖同名生成文件前先复制带唯一名称的备份，并返回 hash；`restoreClientShortcutBackups(result)` 默认只预览，显式 `{dryRun:false}` 才恢复，恢复前也备份当前文件。不修改 Startup 或原程序配置。测试的 `shortcutDirectory` seam 只用临时目录。

未来日常使用步骤是正常退出正在运行的 Codex，双击经确认的新快捷方式，再由用户验收远程插件工具和界面。普通原快捷方式仍可使用，但不能把它的重开当作已继承 caller 的证据。升级维持手动确认；撤回入口只涉及新生成文件，不删除原 Codex 或 DeepSeek 配置。

## 可重复隔离验收

在 Windows 仓库根目录运行：

```powershell
node --test prototypes/remote-companion/client-launch-test.mjs
```

11 项检查覆盖真实 DPAPI 回读 / 错 entropy、refuse overwrite、无额外凭据字段、manifest / 文件篡改 / 未列文件 / 路径跳转、fake child 的 caller hash、父环境和 provider 哨兵保持原样、运行中和检查失败拒绝、错误脱敏、默认计划无写入、PowerShell 语法 / 带空格路径 / fake entry / 篡改阻断、临时 `.lnk` 反读 / 备份恢复、stdin CLI。fake child 只写 bool / hash，扫描临时文件确认没有 token。所有生成内容都在 `.scratch/client-launch-test-*`，测试结束按已核对的父路径清理，不执行真实 app。

本机只读实测确认已安装包 `OpenAI.Codex_26.1117.4957.0_x64__2p2nqsd0c76g0` 的生产 exe 为 `app\ChatGPT.exe`，进程检查识别到运行中的同包进程；这不等于启动或真实认证验收。沙箱内 Appx 查询可能拒绝访问，必须报错并停止；不要因此回退到猜测路径。非 Windows 的 DPAPI / COM 检查明确 skip，不算 Windows 验收完成。
