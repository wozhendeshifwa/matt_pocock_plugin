# Windows 本机组件：开发阶段安装与控制

这是[正式实施规格](https://github.com/wozhendeshifwa/matt_pocock_plugin/issues/44)中的本机连接层。当前支持本机 DPAPI 凭据保存、只读请求转发、执行记录、状态、停止、撤销及可恢复的登录自启配置；**远程写入仍关闭**，完整客户端、云端配对与全业务验收尚未完成。不把以下隔离测试当作真实产品已上线。

## 数据和版本

配对文件是用户在本机选定的绝对路径，不能来自远程 MCP 参数。协议 `protocolVersion` 为 `1`，字段包括：

| 字段 | 来源/作用 |
| --- | --- |
| `pairingId` | 本机生成的 UUID，绑定 DPAPI entropy 及本机执行记录归属 |
| `relayOrigin` | 本机录入的 HTTPS origin；不接受路径、query、用户密码或远程明文 HTTP |
| `adapterPath` | 本机明确选定、存在的适配器文件，保存解析后的绝对路径；云端不能选择程序、命令或工作区 |
| `journalPath` | 本机 SQLite 执行记录路径；业务状态留本机 |
| `baseline` | 冻结目录与本机固定的 manifest SHA-256；启动前逐文件复查，拒绝漂移或另一适配器 |
| `secretDPAPI` | Windows DPAPI `CurrentUser` 加密的 device token，明文不写配置/插件、不打印 |
| `writeEnabled` | 必须为 `false`；人为改为 `true` 也会拒绝启动 |
| `revoked` | 本机撤销状态，另有不可因恢复配置备份而消失的 `.revoked` 标记 |

此处“配对”是本机凭据安装，不宣称已实现交互式云端设备注册/一次性代码。需要预先取得对应 relay 的 **device token**；本工具不生成云端 caller token、不接收 GitHub 凭据、不修改 OpenAI/DeepSeek provider。

DPAPI 把 token 绑定到当前 Windows 用户及 `pairingId`；换用户/换机器不能直接使用密文，必须重新配对。DPAPI 不阻止同一 Windows 用户下已获得执行权限的程序读取其自己的凭据。请将配置、SQLite、备份和状态文件放在用户私有且不进 Git 的目录，不上传这些运行材料。

## 先运行隔离验收

在仓库根目录：

```powershell
node --test prototypes/remote-companion/lifecycle-test.mjs
```

脚本只写本 worktree 的 `.scratch/companion-lifecycle-*`，使用随机测试 token，真实调用 Windows DPAPI，并把 Startup 目录显式替换为临时目录。它验证 DPAPI 回读及错误 entropy 拒绝、拒绝覆盖、协议/写策略拒绝、状态与精确实例停止、撤销持久化、恢复旧配置仍拒绝，以及快捷方式生成/备份/移除。**不会修改真实登录自启、provider 或连接生产服务。** 非 Windows 环境明确跳过 Windows 测试，不算通过。

## 建立本机配对文件

下列操作只在用户决定连接到已验收 relay 时执行；示例 HTTPS origin 不是生产入口。适配器应来自已记录的源码/构建基线，不把当前未验收 WIP 自动当发布版。

```powershell
$pairingFile = 'C:\your-private-directory\deck-companion\pairing.json'
$env:DECK_RELAY_ORIGIN = 'https://your-verified-relay.onrender.com'
$env:DECK_LOCAL_ADAPTER = 'C:\your-verified-checkout\prototypes\upstream-port\sidebar-server.mjs'
$env:DECK_LOCAL_JOURNAL = 'C:\your-private-directory\deck-companion\journal.sqlite'
$env:DECK_FROZEN_DIRECTORY = 'C:\your-verified-frozen-directory'
$env:DECK_FROZEN_MANIFEST_SHA256 = '<从本机冻结结果记录的64位SHA-256，不从远程请求接受>'
$deviceSecret = Read-Host 'Relay device token' -AsSecureString
$env:DECK_DEVICE_TOKEN = [System.Net.NetworkCredential]::new('', $deviceSecret).Password
try {
    node prototypes/remote-companion/lifecycle.mjs pair $pairingFile
    if ($LASTEXITCODE -ne 0) { throw '本机配对未完成；请检查路径、用户、版本及是否已有配置' }
} finally {
    Remove-Item Env:DECK_DEVICE_TOKEN -ErrorAction SilentlyContinue
}
```

token 只在进程环境、匿名 stdin 和内存中经过；PowerShell helper 使用固定脚本，不把明文拼入命令参数。输出只有脱敏配置，不输出明文或密文。创建使用独占写入，已有配对文件或撤销标记都会拒绝；重配对选择新的本机文件，不覆盖旧文件、不删除撤销标记来恢复权限。

## 启动、状态和停止

启动前必须有 `baseline` 固定记录。启动器先校验冻结清单与每个文件的哈希，再取得本机实例所有权；不能通过编辑远程请求选择另一适配器。重建冻结目录和记录摘要的方法见 `freeze-adapter.mjs` 及基线报告。

```powershell
node prototypes/remote-companion/launch.mjs --pairing $pairingFile
# 另一终端中，仍使用同一绝对本机配置路径：
node prototypes/remote-companion/lifecycle.mjs status $pairingFile
node prototypes/remote-companion/lifecycle.mjs stop $pairingFile
```

启动器先取得本机单实例所有权，再打开执行记录并启动固定适配器。状态报告 `starting`、`connected`、`disconnected`、`stopping` 等和心跳；超过 15 秒未更新显示 `stopped-or-unresponsive`，不以存在某个 PID 就断言已连接。日志只输出状态，不输出 token、DPAPI 密文或请求内容。

停止命令写入 `pairingId + instanceId` 标记，由本机实例观察并主动关闭，不杀任意 PID。旧实例的停止请求不会停止新实例。停止会等待在途工作结束；如中途崩溃，执行记录仍须以 `unknown` 处理，不能自动重做写入。

## 撤销

```powershell
node prototypes/remote-companion/lifecycle.mjs revoke $pairingFile
```

撤销先持久写 `.revoked` 标记，然后在备份后更新配置，并写入 SQLite `settings.revoked=true`；运行实例观察到撤销后停止。即使恢复撤销前的配置备份，标记和执行记录仍阻止恢复权限。这里只撤销本机执行能力；云端 device/caller token 的撤销/轮换应同步在部署侧完成，不宣称一个本机命令已经注销云端认证。

## 登录自启（默认只预览）

```powershell
node prototypes/remote-companion/lifecycle.mjs autostart-plan $pairingFile
node prototypes/remote-companion/lifecycle.mjs autostart-install $pairingFile
# 上面两条均不改真实Startup；只有用户明确选择后才执行：
node prototypes/remote-companion/lifecycle.mjs autostart-install $pairingFile --apply
node prototypes/remote-companion/lifecycle.mjs autostart-remove $pairingFile --apply
```

实际安装写当前用户的 Startup 快捷方式，无需管理员。快捷方式调用隐藏 PowerShell，经固定 `launch.mjs --pairing` 启动；参数只有本机路径，不含 token。新增/修改 launcher 和快捷方式前保留带时间戳 UUID 的恢复备份；取消自启先备份再移除快捷方式，不删配对、日志、journal 或 provider 配置。撤销后仍可取消自启。

程序接口 `planAutostart(file,{startupDirectory})`、`installAutostart(file,{startupDirectory,dryRun:true})`、`removeAutostart(file,{startupDirectory,dryRun:true})` 可使用隔离目录验收；默认始终 `dryRun:true`。真实 Windows 登录启动、真实用户停止/取消自启体验仍需最终客户端验收，隔离快捷方式生成并不代替该步骤。

## 更新与恢复

当前不自动下载、切换或更新组件。手动更新前先停止本机实例，记录旧源码/Node/协议与构建版本并保留旧目录；核对插件、relay、本机协议都为 `1` 再启动。协议不符或 `writeEnabled` 不是 `false` 时明确拒绝；不能编辑版本号跳过检查。旧版可由已保留目录手动启动，配对与 journal 不复制上云，不用旧整份用户配置覆盖并发修改。备份恢复不应撤销已有撤销状态。

这些文件没有改变 DeepSeek/OpenAI 配置、已安装插件、Git 工作树或 GitHub 凭据。完整的跨版本兼容矩阵、更新失败恢复、真实 Windows 登录、云端配对/撤销及全业务客户端验收仍由正式规格跟踪。
