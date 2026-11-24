# 完整本机 runtime 的手动采用、启动与回退

`adopt-runtime.mjs` 是本机维护命令，可预览并手动确认固定包的安装、启动和回退。2026 年 11 月 24 日已完成生产只读安装与 Windows 登录自启。首次手动 START 的未知结果及其后续处理见[实际安装记录](../../docs/research/remote-runtime-windows-cutover-2026-11-24.md)。生产回退仍有阻塞。

## 模式与权限边界

* `initial-readonly-adoption`：旧`writeEnabled`必须为false；source严格为`main-local`优先、`remote-v1`只继承缺项。两个源在停止后重新核对并分别完整快照；只将可信注册bucket中的已知business/audit/log播种到全新外置dataRoot。旧目录与所有快照保留。
* `full-code-update`：只支持protocol1、显式`dataSchemaVersion:1`及已验证的stable完整旧包。复用既有stable数据和固定安装级ledger，不从旧快照盖回最新数据；原writeEnabled、grant和密文保持，目标代码必须仍支持原grant方法。

缺失安装ledger仅在初次readonly模式允许，且工具不会创建空ledger。后续full-code模式的plan/apply/START/rollback遇missing均拒绝。现有ledger以URI `mode=ro/rw`只打开既有库，apply/rollback持`BEGIN IMMEDIATE`锁；任意项目running/unknown均阻断。默认LocalAppData、Startup、Desktop和UserProfile来自Windows KnownFolder，不能把sandbox `LOCALAPPDATA`当作生产位置；测试仅通过本机可信dependency seam替换到临时目录。

## 单一配对与不可变代码

保留唯一canonical pairingFile原路径，**不创建第二个可绕过原`.revoked`的配对别名**。原路径即使在worktree的私有`.scratch`下也必须保留，未授权清理。新代码、新dataRoot、journal、caller密文副本、快照和备份在KnownFolder下独立generation/version目录，均在release外。

原config先备份再CAS更新；pairId、secretDPAPI、写策略不变，既有caller同credential密文复制而不解密。原journal停止写入后用SQLite backup复制，包含WAL中的已提交内容和全部operations/settings；不构造空历史。撤销marker或旧/当前journal的revoked setting任意阶段出现均拒绝。rollback恢复旧code/baseline，但保留最新schema1 journalPath，不能退回旧journal丢掉completed tombstone。原配置原字节备份与旧journal仍保留。

初次模式另须`legacyRuntimePin:{directory,manifestSha256}`：固定`bundle-manifest.json`、40位sourceCommit、byteExact及18个受限companion catalog项逐一校验，额外旧日志/归档metadata不当作代码篡改；plan、切换前与legacy rollback都复验。后续模式用`sourceRelease`的完整manifest pin复验旧包，旧代码漂移不允许回退。

## 只读计划输入

私有options示意（路径和hash都来自本机审核，不包含token或DPAPI值）：

```json
{
  "mode": "initial-readonly-adoption",
  "dataSchemaVersion": 1,
  "pairingFile": "C:/private/canonical-pairing.json",
  "callerFile": "C:/private/caller.json",
  "targetRelease": {"directory":"C:/reviewed/complete-release","expectedManifestSha256":"<full release SHA256>"},
  "legacyRuntimePin": {"directory":"C:/retained/old-core","manifestSha256":"<old bundle-manifest SHA256>"},
  "sources": [
    {"id":"main-local","adapterPath":"C:/main/prototypes/upstream-port/sidebar-server.mjs"},
    {"id":"remote-v1","adapterPath":"C:/retained/adapter/prototypes/upstream-port/sidebar-server.mjs"}
  ],
  "archiveOnly": []
}
```

后续模式改为`full-code-update`，增加`sourceRelease:{directory,expectedManifestSha256}`；原canonical必须有显式stable dataRoot。

注册范围只来自可信本机Codex `state_5.project_roots`读取器；不是MCP roots、cwd猜测或整个磁盘扫描。默认阻断registered bucket或无明确hash bucket的unrecognized文件。明确历史未注册hash bucket保留在完整快照中，但不播种。

已诊断为旧log/cache/diagnostic的例外使用**精确、plan绑定**的：

```json
{"sourceId":"main-local","path":"<exact relative path>","sha256":"<exact bytes SHA256>","classification":"diagnostic","reason":"<local diagnosis>"}
```

`classification`仅`log/cache/diagnostic`；path+sourceId+hash必须匹配当前unrecognized项，缺项或内容变化重新阻断。它们只完整归档，不继承为活跃业务。真实三项旧global log、完整看板cache与模拟host-context可由本机已核事实生成该清单，无须为已查清的非业务文件重新询问用户；新增未知项仍阻断。

## 计划、应用与切换顺序

```powershell
node adopt-runtime.mjs plan C:\private\options.json
# 先人工审核公开counts/版本/hash和私有paths、blockers。
node adopt-runtime.mjs apply C:\private\options.json.plan-<digest>.json "APPLY <digest>"
```

`plan`只读；返回公开counts/hash/版本/云兼容结果，私有plan另以新wx文件保存，不保存DPAPI内容。内存计划与返回对象隔离，修改返回的blockers不能绕过授权。`APPLY`必须与最新完整planDigest精确匹配，工具不替用户签字。

**live source盘点只是准备证据**。必须按已确定的手动更新门，在Codex正常退出、相关原main stdio producers全部消失后重做plan；不能拿活跃时的digest直接apply。apply再次检查全部输入、可信registry和源inode/hash/mtime，精确requestStop已计划的remote instance并等其释放，再用lifecycle独占fence。不会kill Codex或任意PID。每个关键阶段复核fence、source、caller、registry、撤销和ledger authority。

云兼容预检只对可信canonical `relayOrigin`固定无token GET `/healthz`：5秒timeout、16KiB上限、拒redirect，version须与target protocol1一致。网络/JSON不可验证或版本不兼容会block；应用前再核，不下载或“自动修复”云端。运行时协议握手仍是独立零dispatch防线，不能把它冒称更新前检查。

准备过程先做两源全量独立snapshot并验证，只播种已选定durable；再将整个固定包复制到全新version目录，全hash/adapter/catalog验证；SQLite backup、caller密文副本与临时COM快捷方式准备完毕后，才CAS canonical、Startup和Desktop。Startup精确指向包内`start-companion.ps1`、固定manifest和原canonical路径；Desktop复用既有client-launch原语。没有使用旧lifecycle未pin wrapper冒充完整包bootstrap。

所有被替换文件先backup；CAS用新建hard-link发表，不能覆盖并发出现的文件。每次CAS先保存intent，link一发表即登记proof，cleanup/后续读取失败也能在failure receipt认出已发表的自有inode/hash。用户并发修改保留，不 blanket restore；仅hash/身份仍匹配的自有文件才可恢复。中断/冲突保留generation、claimed文件、快照和诊断，不删除源目录。

## 显式启动与未知启动屏障

apply默认返回`adopted-stopped`，不启动任何组件。单独确认：

```powershell
node adopt-runtime.mjs start C:\private\generation\receipt.json "START <receipt SHA256>"
```

它只启动固定包companion，不启动真实Codex。默认进程只接受匹配父进程creation/命令hash与固定launch路径的确切owned instance，确认connected后记录证据；connected不是登录、宿主签名或HITL验收。默认启动环境将ledger的LOCALAPPDATA固定到真实KnownFolder。

START在派发前CAS占位持久attempt，第二个并发START不能覆盖pending证明。若超时仍无runtime，不能声称stopped：保存unknown屏障和spawn/proof，所有后续采用/回退阻断。若已知owned runtime验收失败，先exact stop并等释放；未证明的其他进程绝不停止。

```powershell
node adopt-runtime.mjs drain-start C:\private\canonical-pairing.json.adopt-start.json "DRAIN <attempt SHA256>"
```

DRAIN只处理持久记录对应的晚到owned实例；没有owner证明、spawn仍初始化或进程身份变化则继续block，保留诊断，不盲重试START。不会用任意PID kill消除屏障。

### Windows 重启前没有取得进程归属证明时

仅当正式启动记录为 `unknown`、原因为 `START_PROCESS_IDENTITY_UNAVAILABLE`、本机还没有该配对的运行实例时，可在同一次 Windows 开机期间保存检查点。选择本机私有目录中的新文件。检查点包含本机路径，请保留原件。

```powershell
node adopt-runtime.mjs checkpoint-start C:\private\canonical-pairing.json.adopt-start.json C:\private\pre-restart.json
```

Windows 正常重启后先预览。工具交叉核对原启动记录、安装回执、检查点哈希和文件时间，以及 Windows 的首次后续内核开机事件和当前系统开机时间。只有这些证据都通过时才返回确认摘要。

```powershell
node adopt-runtime.mjs retire-start C:\private\pre-restart.json
node adopt-runtime.mjs retire-start C:\private\pre-restart.json "RETIRE <上一步的 digest>"
```

确认会为该启动记录新增一份独立核验凭据。相同确认可以重复执行。原始启动结果保留为 `unknown`，在线实例继续工作。维护工具每次做计划都复核原件。在同一次开机中、检查点系重启后复制、或事件及原件已缺失时，屏障继续生效。请继续通过 `rollback-plan` 核对其他阻塞。已安装的旧维护工具仍遵循该固定版本原有规则。

## 回退与剩余真人门

```powershell
node adopt-runtime.mjs rollback-plan C:\private\generation\receipt.json
node adopt-runtime.mjs rollback C:\private\generation\receipt.json "ROLLBACK <rollback plan digest>"
```

回退先精确停新实例并等drain/释放，继续验证lease和ledger；只有文件仍为自己发表的身份才能恢复。stable旧包共享最新数据和journal，不覆盖任何新数据。legacy bf/v1只在完整当前durable catalog、registry及原sources都未变化、ledger未新增时允许；新增项目bucket、unknown、原代码篡改或撤销均block。失败receipt中的已发表CAS也能通过相同恢复闸核对；所有旧/新快照均保留。

手动更新和回退遵循 Q7–Q8。审核目标，正常退出 Codex 及相关进程，再核对停止后的新计划与对应的 APPLY、START 或 ROLLBACK 确认。Q9 固定基线，Q10 由用户在真实宿主完成最终验收。[部署架构、授权与验收边界](https://github.com/wozhendeshifwa/matt_pocock_plugin/issues/42)

## 验证

```powershell
node --test prototypes/remote-companion/adopt-runtime-test.mjs
```

测试只在临时fake KnownFolder/registry/process roots，使用真实Windows DPAPI、SQLite、临时COM `.lnk`和lifecycle control；healthz、启动归属仅可信本机stub。包含双源保留、source/registry ABA、unknown/冲突、精确archiveOnly、cloud拒绝、撤销、CAS发表异常、并发用户改动、新bucket/旧代码pin、缺ledger、junction、最新journal tombstone、stable最新业务、晚到/并发START及DRAIN。没有真实迁移、生产Startup、GUI或GitHub写。

一次完整隔离回归揭示真实Windows心跳`rename`返回`EPERM`并触发误停，旧候选因此撤回。修复只对心跳rename的`EPERM/EACCES/EBUSY`做有界重试，每次仍核同instance与closed；持久或其他错误继续拒绝。额外回归检查fd固定读取、`updatedAt`实际推进、持久失败、owner更换、close期间重试，以及停止请求始终绑定已审核A而不误停后继B。该证据只涉及隔离目录，不能外推正式迁移或HITL已通过。
