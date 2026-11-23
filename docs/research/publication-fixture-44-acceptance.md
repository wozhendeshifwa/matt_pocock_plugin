# #44 publication2：原 SDK / 原 handler 私有 GitHub 验收

2026-11-24 北京时间。**`initPublish` 正常全成功、已知部分失败后的 `retryPush` 均已真实通过。** 这里使用手工 SDK metadata、fake Codex DB 和独立 owned 项目，是真实私有 GitHub 局部写验收，不是真实 Codex 聊天、宿主审批签名或 HITL。生产 grant、pairing、provider、原 readonly 组件和正式仓库均未改变。

## 固定版本与本机边界

使用新 reviewed v5 `.scratch/frozen-adapter-20261124-effects-v5-reviewed`，450文件，manifest SHA256 `c8eefb0f5865bbb6e76b3be47da8341b04f40be1d28027cd4b40eec2e8614ea4`。源与独立 `reviewed-runtime-c8eefb0f5865bbb6` 在 auth 前分别验证；结束后450项再验证通过。已withdraw的旧v5没有用于真实发布。

夹具目录：`C:\Users\27263\Desktop\matt_pocock_\.scratch\wayfinder-render-44\.scratch\publication-fixture-44`。

* 三个owned项目只含同一份通用 `README.md`，source tree逐项读回只有该文件；没有用户源码、CA、token、配置、hook或workflow进入提交。
* success/normal起初无`.git`，partial仅初始化空Git；`GIT_CEILING_DIRECTORIES`固定夹具根，防止“无仓库”探针误中外层worktree。原handler执行自己的init/add/initial commit/create/push。
* hooks、fake HOME、空系统/全局Git配置、空GH配置、fake Codex DB、稳定localDataRoot、固定安装ledger和journal均在项目外。第三项目追加前保存了原`local-context`副本，原UUID与两次失败历史保留。
* SDK → 127.0.0.1 loopback → companion → 真stdio → 原 `initPublish/retryPush` handler。每次本机grant仅这两个方法和当前owned root；最后另用零grant session复核。
* `GH_HOST`显式`github.com`。原 `gh auth token` 输出只在RAM，经child `GH_TOKEN`传递；Git credential helper只经 `GIT_CONFIG_COUNT`设置为空helper reset + 固定绝对路径的`gh auth git-credential`。没有持久化token、复制原GH配置或写用户credential配置。
* GitHub建仓只能原`initPublish`；原`retryPush`不创建仓库。Actions仅以固定REST recipe在每次新建返回后立即关闭，随后独立GET确认；这是夹具配置，不冒称产品publication2的附带功能。

## 实际结果

[三场景汇总](../../.scratch/publication-fixture-44/completion-1795465596405.json)和每次原回包、完整typed ledger、独立metadata/refs/HEAD证据全部保留。

| 私有实验仓库后缀 | Repository ID | 验收事实 | 唯一remote分支HEAD |
| --- | --- | --- | --- |
| `1795465033050-5998d366-ok` | `1469265629` | 空配置夹具的原init因schannel TLS失败；一次OpenSSL缺CA重试也失败；补齐现有系统信任后原retry成功，同repo/commit，无重建 | `2933d16a67a3666fea2af8f2b497c2c5c33782e8` |
| `1795465033050-5998d366-retry` | `1469273036` | 原init已创建私有远端和exact commit，但自有pre-push hook输出固定sentinel后exit1；verifier确认empty refs并记known partial；仅重命名自有hook为disabled后原retry成功 | `6f625d1276648a0fec6d7f1877d7e4efa4171523` |
| `1795465033050-5998d366-normal` | `1469273700` | 全新第三owned项目原init一次全成功，独立metadata/private/HEAD/完整refs读回一致 | `c685f1dbfce47330ec2f6b7261936c9869a5d41b` |

仓库完整前缀均为 `wozhendeshifwa/deck-remote-publication-44-`，三个仓库保留，不删除重建。分支均为`fixture-44`，无tags。每个创建前都独立REST确认404；所有已知partial均确认新仓ID、private、本地exact commit和空远端ref集合；重试后ID和commit原样保持。

固定安装ledger为 `installation/write-ledger.sqlite`，最终6条全部completed：3 succeeded、3 failed。failed分别是默认schannel TLS、OpenSSL缺CA、故意hook拒推；三次均是独立verifier证明的terminal partial，**没有running/unknown**。未删除/reset ledger、journal或marker，也没有对已创建仓库再次init。

## TLS 实测边界

本机Git安装系统配置使用schannel，当前到`github.com`的实际TLS叶证书由本机 **SteamTools Certificate / BeyondDimension** 签发。这是本机现有代理链，不是GitHub原站公开证书链。

| 阶段 | 实测 | 处理边界 |
| --- | --- | --- |
| 空Git系统/全局配置的fixture使用Windows schannel | `CRYPT_E_NO_REVOCATION_CHECK (0x80092012)`，创建已成但push失败 | 原失败回包和ledger保留；没有关闭revocation或sslVerify |
| fixture仅切OpenSSL、空Git系统/全局配置 | `unable to get local issuer certificate (20)` | 仍保持证书验证，显式原retry失败被诚实记入ledger |
| fixture OpenSSL + 固定公共CA bundle | 严格`-verify_hostname github.com -verify_return_error`链校验return code0，原retry/normal init成功 | 仅复用Windows已信任公开根到项目外；不修改用户Git或系统信任 |

[CA来源与严格TLS证据](../../.scratch/publication-fixture-44/installation/trust/ca-manifest.json)：

* 同一公开自签根已存在于 `LocalMachine/Root` 和 `CurrentUser/Root`；SHA1 thumbprint `02699A878599708F6E1161A3DEF09E06EB397715`，DER SHA256 `ed3dc55d2e5d1374acf50e2b4e2e5f41f15a96fa43d56bfc80ccb34eceee7360`。
* Subject/Issuer：`C=CN, O=BeyondDimension, OU=Technical Department, CN=SteamTools Certificate`；有效期为北京时间2026-10-14至2027-08-11。
* 只经只读X509Store取得`RawData`公开DER，没有调用私钥API/导出私钥；校验CA标记、自签签名、指纹和有效期。
* 原Git公共CA包为 `C:/Program Files/Git/mingw64/etc/ssl/certs/ca-bundle.crt`，185311字节，SHA256 `f345ac0d7dbd1a584dd80ff96eb2919e8dac68e962db2e7111401b434e888493`，内容未改。
* 新项目外bundle为 `installation/trust/ca-bundle.pem`，186711字节，SHA256 `77091576dd015333973df0285ced379a66df3f12a389a37ee4760997d616b944`，由原包原字节加该既有公开根组成；每次session在auth前再核对hash。
* 只在fixture child env设置 `http.sslBackend=openssl` 和该 `http.sslCAInfo`，未设置`sslVerify=false`、未改schannel revocation选项，也未将该环境调整写入产品默认行为。

因此本报告不能推断用户主工作区Git故障，也不能写成用户默认Windows发布已验收或原站公开链验证通过。已证实空配置fixture失败、诚实partial、现有系统信任在隔离OpenSSL环境中的安全复用，以及修复fixture环境后原流程成功。

补充的[真实主工作区只读预检](../../.scratch/actual-git-readonly-preflight-44.json)使用用户实际有效Git配置：backend为schannel，未额外设置sslVerify、schannelCheckRevoke或自定义CA；`git ls-remote --heads origin`成功读取3条分支。该检查没有push、没有改用户配置；它只证明当时真实配置的远程读取正常，不能把夹具的TLS错误扩写为用户环境异常，也不能把只读成功升级为真实发布通过。

## 可重复只读复核与一次性动作

```powershell
# 从44 worktree执行；零write grant，只GET/Git读取，不新建仓库或push
node .scratch/publication-fixture-44/verify-readonly.mjs
```

`prepare-local.mjs`只准备自有目录、fake身份和通用source；`prepare-trusted-ca.mjs`仅针对已核实的固定已信任公开根镜像/严格TLS复核，不是通用信任安装器。一次性写入口 `acceptance.mjs` 与 `complete-publication.mjs` 保存固定started marker，默认再次运行拒绝。两个显式恢复入口仅处理已有确切失败与空/known-terminal ledger，不是unknown自动重放。不得为了重复试验删marker、ledger、仓库或换同名仓重建。

首轮还在SDK包定位阶段出现过一次本机helper错误，**没有派发RPC或产生ledger/GitHub写**。修复为与D6相同的44/43锁定SDK依赖查找后，保留原marker，以ledger空且无dispatch intent/result、远端404为前提继续首次派发。它没有被计为产品发布或host-binding失败。

[最终450项/ledger/进程核验](../../.scratch/publication-fixture-44/final-verification-1795465723546.json)：副本manifest一致，所有6行completed，owned Node进程0。所有finally仅清理自身client、companion、stdio和loopback；没有访问Render relay或停止生产组件。

[零grant串行只读复核](../../.scratch/publication-fixture-44/readonly-verification-1795465935367.json)也已通过：三个仓库各自原ID/private/Actions false、唯一分支HEAD=本地HEAD、无tags、GitHub workflow总数0、README-only clean source、SDK manifest writesEnabled:false/allowedWriteMethods=[]，ledger仍6条known completed，最后owned Node=0。此前额外并发GET两次遇代理返回非JSON正文；仅调整只读诊断为串行即通过，没有重放或增加业务写，也没有因此改变产品闸门。

费用边界：仅三个private GitHub实验仓和少量README Git传输；Actions已关闭，没有workflow、CI、runner、Render服务、付费磁盘或其他付费资源创建。未证明Render免费额度或账户账单状态，未冒称真人审批/正式发布验收。
