# 重建并验证私有远程兼容性探针

本说明修复[兼容性验证](https://github.com/wozhendeshifwa/matt_pocock_plugin/issues/43)审查中的可复现性缺口。插件是只读探针；完整业务桥接仍由[正式实施规格](https://github.com/wozhendeshifwa/matt_pocock_plugin/issues/44)承接。

## 版本及模板

2026-11-24 实测：Windows，Node `26.13.0`，Codex CLI `0.171.0-alpha.13`；MCP SDK 锁定 `1.32.2`。原先真实客户端证据的源码固定点为 `cae483234976f9a0f027c741046a83e838ef0065`，实际已部署运行代码为 `42ed7aaa4e0fb0f90091506bc94f99c393eb9307`，UI证据及边界见[客户端检查记录](../../docs/research/remote-plugin-client-checks-2026-11-24.md)。本补丁不重部署该服务。

从含本说明和模板的提交或分支检出；在仓库根目录运行后文命令。`plugin-template/` 是完整、无凭据的兼容布局来源：

```text
plugin-template/
├── .agents/plugins/marketplace.json
└── plugins/deck-remote-compat-probe/
    ├── .codex-plugin/plugin.json
    └── .mcp.json
```

marketplace 名为 `deck-remote-probe-43`；插件选择器始终为 `deck-remote-compat-probe@deck-remote-probe-43`，版本 `0.1.0`；服务名 `deck-remote-compat-probe`。`.mcp.json` 指向实际入口 `https://deck-compat-probe-43.onrender.com/mcp`，声明 `bearer_token_env_var: "DECK_PROBE_ACCESS_TOKEN"`。

**这份模板是依据同一身份和接口重建的脱敏可复现来源，不声称与历史已安装包字节相同。** 历史本机包含固定 Bearer 配置；新模板改用当前 CLI 已验证解析的环境变量引用，URL、插件 ID/版本、两个工具和 UI 契约不变。没有读取、复制旧包或旧密钥，也不把新模板安装验证当作原客户端全部交互重新通过。

## 一条命令验收新安装

前置：PATH 有上述版本或兼容版本的 `node`、`npm`、`codex`。先查看 `codex plugin marketplace add --help`、`codex plugin add --help`、`codex mcp list --help`；命令不受支持就停止，不直接改真实配置。

```powershell
npm ci --prefix prototypes/remote-compat-probe
node prototypes/remote-compat-probe/verify-install.mjs
```

脚本为每次运行创建全新 `.scratch/probe-install-*/codex-home`，只为子进程设置 `CODEX_HOME`，不改变当前终端或真实用户的 Codex home。它会：

1. 从版本化模板构建 marketplace，拒绝覆盖已有输出目录。
2. 给隔离 home 写入假 OpenAI/DeepSeek provider 哨兵，并在安装前备份该隔离配置。
3. 用官方 CLI `plugin marketplace add <generated-root> --json`、`plugin add deck-remote-compat-probe@deck-remote-probe-43 --json` 安装。
4. 用 `plugin list --marketplace deck-remote-probe-43 --json` 确认已启用；用 `mcp list --json` 确认 `streamable_http`、环境引用与 `bearer_token` 状态，不打印真实凭据。
5. 检查新缓存只存环境变量名，不存此次随机测试 token；确认 provider 哨兵和备份保留。
6. 读取自己刚生成的新缓存声明，以同一环境引用连接回环只读探针：缺 token、错 token 均 401，正确 token 能 initialize、列两项工具、调用身份工具及读 UI 资源。

预期输出 `status: "passed"`，以及 CLI 版本、插件 ID、版本、检查名与忽略目录的位置。随机测试 token 不输出，不写模板或缓存。这里的真实 HTTP 验证使用 SDK，不冒充 Codex 桌面实际调用；CLI 已验证的是安装、启用及连接配置解析。

默认沙箱若报回环 `EACCES`，应按执行工具的权限流程重跑同一命令，不能把权限错误当成探针不兼容。重复运行创建新目录；先前失败目录可保留作诊断。无需登录模型账号或发起模型回合。

现有 UI/协议回归另行运行：

```powershell
node --test prototypes/remote-compat-probe/test.mjs
```

这组测试的 JSDOM 依赖复用仓库 `prototypes/upstream-port` 开发依赖；干净检出先运行 `npm install --prefix prototypes/upstream-port`。服务线上运行不依赖 JSDOM。

## 手工重建与隔离安装

无需真实 token 即可构建、注册和检查配置：

```powershell
$reproRoot = Join-Path (Get-Location) '.scratch/probe-manual-reproduction'
node prototypes/remote-compat-probe/build-plugin.mjs $reproRoot
if ($LASTEXITCODE -ne 0) { throw '构建失败；请选择新的输出目录，勿覆盖旧目录' }
$priorCodexHome = $env:CODEX_HOME
try {
    $env:CODEX_HOME = Join-Path $reproRoot 'isolated-home'
    New-Item -ItemType Directory -Path $env:CODEX_HOME -ErrorAction Stop | Out-Null
    codex plugin marketplace add $reproRoot --json
    if ($LASTEXITCODE -ne 0) { throw 'marketplace注册失败' }
    codex plugin add 'deck-remote-compat-probe@deck-remote-probe-43' --json
    if ($LASTEXITCODE -ne 0) { throw '安装失败' }
    codex plugin list --marketplace deck-remote-probe-43 --json
    codex mcp list --json
} finally {
    $env:CODEX_HOME = $priorCodexHome
}
```

`build-plugin.mjs <新目录> [HTTPS入口]` 只重建声明，不复制 Node 依赖、服务代码、会话库或工作区。默认是真实入口；替换时只接受无用户名、密码、query/fragment 的 HTTPS URL。回环 HTTP 仅由验收脚本显式允许，CLI 生成器不接受远程明文 HTTP。

## 在真实客户端重现

本节是人工复验步骤，不由安装脚本自动执行。若已安装原探针，先检查原安装，不重复安装相同 ID、不覆盖其配置；只有决定验证新环境引用模板时才按以下步骤更换来源。保留现有 provider、DeepSeek 回退和其他插件。

1. **备份与记录**：记录当前客户端“关于”版本、CLI 版本、检出 commit、服务实际部署 commit/ID、插件 ID/版本和测试日期。在真实用户 home 的 `config.toml` 存在时，复制到带时间戳的私有备份目录；备份可能含秘密，不上传。记录当前 `CODEX_HOME`；本次脚本中的隔离 home 不能冒充真实桌面配置。
2. **令牌注入**：由持有者取得该探针服务的访问 token，不复用 GitHub token。`.mcp.json` 只声明环境变量名；Codex **进程启动时**必须有 `DECK_PROBE_ACCESS_TOKEN`，仅在当前终端设置不会修改已运行的桌面进程。可用下面的安全输入方式，令牌不会进入命令历史；从同一终端用本机已确认的桌面可执行文件路径启动客户端。不要将令牌写进模板、issue 或日志；退出后清除该终端变量。不要求设置永久用户环境变量。

   ```powershell
   $probeSecureToken = Read-Host '探针访问 token' -AsSecureString
   $env:DECK_PROBE_ACCESS_TOKEN = [System.Net.NetworkCredential]::new('', $probeSecureToken).Password
   # 用户自行完全退出桌面客户端后，用已核对的桌面 exe 绝对路径启动；不是 codex CLI 路径。
   # Start-Process -FilePath $desktopExe -WindowStyle Hidden
   # 验证结束且客户端已退出后：
   # Remove-Item Env:DECK_PROBE_ACCESS_TOKEN
   ```

3. **安装/重新加载**：在目标真实 home 下使用上节相同官方 marketplace/add 命令（不再设置隔离 `CODEX_HOME`），安装前确认 ID 未安装；若已有同 ID，按官方 remove/add 流程更新来源并保留备份。完全重启客户端加载插件；由用户操作，不自动关闭正在工作中的聊天。确认插件页已启用、模型侧出现 `open_remote_compat_probe` 与 `remote_compat_identity`。
4. **远程工具与身份**：实际调用身份工具，不手工注入 `_meta`。预期键名/有无 threadId/摘要可见，原始聊天 ID、路径及内容不回显。用同项目另一聊天、另一项目聊天和无项目聊天各重复两次，记录稳定与不同摘要；需创建聊天时先取得用户许可，已有测试聊天可复用。无项目也可能有 threadId，项目授权仍须本机解析，探针不作业务授权。
5. **界面/主题**：实际打开探针到侧栏，点击身份按钮，核对模型与 UI 的摘要。用户切换浅色/深色，分别记录 `themeSource` 和两个通知通道计数、页面颜色；不要把默认系统颜色或 SDK 资源读取当真实主题同步证据，最后恢复用户选择的主题。
6. **草稿**：用户点击“当前聊天测试草稿”和“新聊天测试草稿”，检查实际输入框、可编辑性、所属项目、未发送状态；不自动发送、清空或删除草稿。不以空 RPC 响应宣称实际落点通过；若落点只能由用户确认，标明证据来源。
7. **断线与边界**：重部署后重新调用只证明该场景可恢复；长休眠/复杂配对/撤销/未知写入不由本探针证明。现有本机旧请求回放属于本机路由证据，不升级为云端业务桥接。按实际观察填“通过/失败/未测”，有未测项就保留，不补写想当然结果。

## 清理与安全范围

生成包和安装缓存没有 token；真实配置备份、运行环境与客户端进程仍应按私有数据管理。隔离脚本只保留 `.scratch/probe-install-*` 证据目录，不注册到真实 home。手工安装的测试项使用同一 `CODEX_HOME` 下官方 `codex plugin remove deck-remote-compat-probe@deck-remote-probe-43` 与 `codex plugin marketplace remove deck-remote-probe-43` 清理；先确认 CLI 帮助和操作的 home。恢复时合并本次相关字段，不以旧整份配置覆盖并发修改。删除临时目录前核对解析后的绝对路径位于当前工作区 `.scratch`；无需清理即可继续工作。

格式依据：[官方插件打包与兼容布局文档](https://developers.openai.com/plugins/build/plugins)。本机 CLI 的实际解析与安装结果为上述字段在本客户端的验证证据；新客户端版本需重新运行验收，不把文档描述替代实际支持。
