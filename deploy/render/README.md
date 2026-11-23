# MattSkillsDeck 云端 MCP（Render）

这是独立的云端入口：使用现有 MCP 工具、GitHub 后端和 React 看板，通过 Streamable HTTP 提供 `/mcp`，不读取用户电脑的 Codex 数据库。原有 stdio 入口和本机配置仍可使用。

## 使用范围

- 在 MCP 连接内调用 `deck_repository_list`，再调用 `deck_repository_select`；看板顶部也可以选择仓库。不同连接各自选择，互不串仓库。
- 复用 GitHub Issues、地图、技能等已有能力。默认只读；设置 `DECK_GITHUB_WRITES=true` 才开放已有 GitHub 写工具，原有写入校验仍生效。
- 云端为每个仓库建立仅含 Git remote 和后端配置的托管绑定，不下载或执行仓库代码，也不复制用户本机改动。Git 操作、打开文件夹、聊天命名与本机交接不可用，会返回明确错误。
- 一个部署面向一位使用者的多个设备。访问令牌相同的客户端具有相同仓库权限；不是多用户 SaaS，也没有 OAuth 登录。

## 环境变量

| 变量 | 用途 |
| --- | --- |
| `GH_TOKEN` | 在 Render 环境设置中填入 GitHub 凭据。建议 fine-grained PAT，仅授权需要的仓库，读取 Metadata、Issues 和 Pull requests；需要写操作时再授予 Issues 写权限。组织仓库还须完成组织授权。不要写入代码或聊天。 |
| `MCP_ACCESS_TOKEN` | 至少 32 字符的随机访问令牌，客户端通过 `Authorization: Bearer …` 发送。Blueprint 自动生成，部署后从 Render 环境设置复制到客户端。 |
| `DECK_REPOSITORIES` | 允许选择的 GitHub 仓库，逗号分隔，最多 20 个。默认仅本项目。 |
| `DECK_GITHUB_WRITES` | 默认 `false`；显式设置 `true` 开放已有写入能力。 |
| `PUBLIC_BASE_URL` | 可选，公开地址的 origin；Render 默认使用 `RENDER_EXTERNAL_URL` 检查浏览器 Origin。 |
| `DECK_DATA_ROOT` | 可选，默认 `/tmp/mattskills-cloud`，保存绑定、缓存和日志。 |
| `PORT` | Render 自动提供，默认 `10000`。 |

## Render 部署

仓库根目录的 `render.yaml` 配置一个 Singapore 区域的 Free Docker Web Service，健康检查 `/healthz`，自动部署关闭。Dockerfile 仅复制运行所需源码、vendor 和构建好的界面，安装锁定依赖，使用非 root 用户运行。

将部署分支推到 GitHub 后，在 Render 创建 Blueprint 并选择该分支。先审核资源计划；确认后应用，并在 Render 设置 `GH_TOKEN`。不要上传本机 `.codex`、登录数据或配置文件。

Free 实例会空闲休眠，恢复时客户端可能超时，需要重连；休眠、重启和重新部署会丢失缓存、日志和当前连接选择，GitHub 数据仍保存在 GitHub。正式长期使用可选付费实例；如果需要保留日志，另外挂载持久磁盘并配置 `DECK_DATA_ROOT`。本实现使用进程内 MCP 会话，先按单实例运行，重连后重新选仓库。

服务就绪后，使用支持 Bearer header 的 MCP 客户端连接 `https://<service>.onrender.com/mcp`。普通浏览器打开此地址不能完成 MCP 调用。需要 OAuth 的客户端须先增加 OAuth 支持，不能仅凭 URL 接入。

## 本地验证

需要 Node.js 26、Git、GitHub CLI；先在本目录和 `../../prototypes/upstream-port` 各执行 `npm ci`。运行 `npm test` 验证鉴权、真实 MCP HTTP 协议、资源返回、仓库隔离及旧面板请求拦截；原 stdio 入口可通过 `node ../../prototypes/upstream-port/doctor.mjs` 验证。

部署前参考：[Render Web Services](https://render.com/docs/web-services)、[Blueprint 规范](https://render.com/docs/blueprint-spec)、[Free 限制](https://render.com/docs/free)。
