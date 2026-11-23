# 完整本机 runtime release 的打包与审阅

此工具只生成**供手动安装审阅的不可变文件包**。它不安装、不更新配对、不迁移业务数据、不写快捷方式或Startup、不下载依赖、不启动Codex或真实companion。现有六文件caller release及生产readonly组件保持原样。

## 固定输入与产物

`build-runtime-release.mjs`只读本机Git对象，必须传完整40位commit，不接受HEAD、分支或worktree快照。`prototypes/remote-companion`的平层非test `.mjs`来自该commit；measure/benchmark、credential文件名、state JSON、未跟踪文件、脏文件、node_modules、Git元数据均不复制。禁止lazy fetch和replacement objects，逐blob核对Git对象hash并在捕获前后核对固定对象。

适配器只接受`verifyFrozenAdapter`验证成功、manifest SHA256固定的450文件候选。450项原字节与`frozen-adapter.json`复制到同一release根，`prototypes/upstream-port`和`vendor`相对布局保留，两个上游LICENSE也必须存在。候选内已有的开发静态文件保持候选原样；它们不被执行，也不自动安装其开发依赖。

固定Git源的`freeze-adapter.mjs`必须静态明确声明与候选相同的`OVERLAY_VERSION`，`protocol.mjs`必须静态声明`VERSION = 1`。检查不import来源Git代码：V8 `SourceTextModule`只编译、不link/evaluate；检查静态relative import/export、literal dynamic import及既有adapter/vendor导入配方的文件闭包。任意源代码不会作为验证器执行。

输出为全新目录，拒绝覆盖。捕获后保留`INCOMPLETE`，直到源前后hash、复制字节、adapter/catalog检查完成；最后复用`verifyClientRelease`验证全包，再校验adapter、闭包及PowerShell语法。失败保留或恢复`INCOMPLETE`，不得拿失败目录当新版本。

`client-release.json`沿用现有`deck-client-launcher-release` kind和`client-launch.mjs` entrypoint，同时增加`sourceCommit`、`runtimeEntrypoint`、`adapterRelativePath`、`adapterManifestSha256`、`overlayVersion`、`protocolVersion`及全文件bytes/SHA256。仍受2000文件、总64MiB、单文件32MiB、manifest 2MiB限制。manifest的独立SHA256由结果返回，必须在包外保存并审核；不使用自指digest文件。输出没有时间戳或机器路径，固定输入可重复得到相同manifest。

本机执行打包器的`buildToolSha256`另行返回。它与包内代码`sourceCommit`是不同证据；未提交的打包器不能假称来自所选commit。打包器在捕获前后也核对自身hash。

## 可复现CLI

需Windows、支持现有node:sqlite的Node版本、本机Git和Windows PowerShell。PowerShell仅用于只解析启动脚本，不执行它。以下命令只读源并写新输出目录：

```powershell
node prototypes/remote-companion/build-runtime-release.mjs build `
  "C:\Users\27263\Desktop\matt_pocock_\.scratch\wayfinder-render-44" `
  70aa02f91dd5670b805c8862fe9e187faf4f8910 `
  "C:\Users\27263\Desktop\matt_pocock_\.scratch\wayfinder-render-44\.scratch\frozen-adapter-20261124-docs-v6-reviewed" `
  dc04813e34b463827667f8bca236ffc6c31ec847959a414c334d4ead9e756e10 `
  "C:\Users\27263\Desktop\matt_pocock_\.scratch\wayfinder-render-44\.scratch\runtime-releases\new-reviewed-output"

# 必须填写上一步实际返回、已在包外审核固定的manifestSha256
node prototypes/remote-companion/build-runtime-release.mjs verify `
  "C:\Users\27263\Desktop\matt_pocock_\.scratch\wayfinder-render-44\.scratch\runtime-releases\new-reviewed-output" `
  <manifestSha256>
```

第二次build使用同一输出路径会拒绝；要对比可重复性，使用另一个新目录。不要删除或覆盖现有安装来满足这个要求。

## 启动前的状态边界

全包catalog会拒绝未列文件，legacy adapter却会往release下的`.scratch`生成业务状态，因此该完整包的启动脚本**拒绝legacy dataRoot**。手动启动前必须先完成受控迁移/配对，准备：

* 包外已存在的配对文件；`adapterPath`精确指向本包sidebar，`baseline.directory`指本包根，baseline的manifest SHA256等于本包记录的adapter manifest。
* 显式、已存在且与release不重叠的`localDataRoot`；已有业务状态应先按受控迁移/恢复流程核对，而不是新建空根冒充迁移。
* 包外journal及已存在的parent目录；安装级write ledger保持原固定位置，配对不能覆盖其路径。
* pairing sidecar/backup、caller record、caller launcher及其他可变备份也在包外。caller由独立client-launch处理，其既有验证器也拒绝caller放进该release。

`start-companion.ps1`严格复用`CLIENT_LAUNCH_TEMPLATE`的.NET SHA256和全catalog检查段。之后只读检查上述配对、协议、baseline、adapter hash、外置dataRoot/journal/default ledger，无解密、无配置写入；错误只报阶段，不打印DPAPI字段。最终只调用`launch.mjs --pairing <本机配对路径>`。它不会种入配置、创建dataRoot或移动旧状态。NodeExe、PairingFile、ReleaseDirectory和manifest digest都是路径或公开标识，不承载token。

准备通过也**不表示可直接拿现有生产配对启动**：必须先审核其baseline和状态选择。此任务没有执行脚本、切换配对或启动真实组件。

## 与现有更新器的区别

现有`local-update.mjs`切换的是配对中adapter baseline及相关受控状态/快照；它不替换companion代码、caller release、Startup目标或整个runtime包。打包器提供完整固定文件集，**不等于“完整runtime更新/回退已实施”**。后续安装、完整版本切换、失败回退和真人宿主验收仍应单独受控完成，保留已有installation ledger、配置和其他provider。

## 验收

```powershell
node --test prototypes/remote-companion/runtime-release-test.mjs
```

隔离测试只创建本地临时Git（无origin、空配置/hooks）、450项最小冻结夹具和无害PowerShell stub。覆盖固定commit忽略WIP/未跟踪文件、可重复manifest、不执行Git输入代码、拒绝HEAD/protocol/overlay/闭包错误、拒覆盖/篡改/多余文件、源中途漂移保持INCOMPLETE、路径含空格、PS语法与配对/数据/journal/default ledger外置闸门；不创建真实聊天或网络业务数据。

首个本机`runtime-70aa02f-v6-review`只是审阅阶段产物，其生成器曾被PS语法测试拒绝，已加`INCOMPLETE`撤回且从未安装。后续修正加入生成脚本语法硬检查，最终产物使用另一个新目录，不能把被撤回目录当成最终发布。

## 本次实际固定包

5/5隔离测试通过，随后按上述固定commit/candidate在两个新目录各实际打包一次：

* `.scratch/runtime-releases/runtime-70aa02f-v6-complete-a`
* `.scratch/runtime-releases/runtime-70aa02f-v6-complete-b`

两包manifest SHA256完全相同：`10c3befde71d6352b1a6938df4d0338cc52a1f7ec840373f2d053e1c2f64f344`。各479文件、8,554,162字节，353模块只编译未求值，709相对导入闭包引用和133动态导入配方核对通过，原`verifyClientRelease`及adapter验证也通过。

本机打包工具SHA256为`052397fc45f636c92993e362869e885e9990037895673ed5400900846f5d47f5`；该工具当时尚未进入源commit `70aa02f...`，因此包内源与构建工具证据明确分开。[包外构建证据](../../.scratch/runtime-releases/runtime-70aa02f-v6-build-evidence.json)记录上述结果。当前产物没有执行真实启动或安装；后续SDK读流水线、受控状态迁移和实际版本切换应独立记录，不能从此打包结果推定完成。
