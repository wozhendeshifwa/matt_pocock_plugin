# 故障注入与自动检查闸门

2026-11-26，承接 [Sandcastle 实施票](https://github.com/wozhendeshifwa/matt_pocock_plugin/issues/53) 的 retrospective 前两项。既有混合工作区保留，仅修改本次范围；本地备份在 `.scratch/retro-guardrails-53/backup/`。

## 有界故障注入

正式 `service.mjs` 不创建故障租约，启动日志明确报告 `faultInjection.enabled=false`。只有显式启动 `fault-service.mjs` 验收入口才安装故障控制。控制只影响观察/回包，不替换真实执行器、持久记录或授权检查。

专用验收入口启动时生成新session，并清除任何遗留控制；旧版无范围布尔开关不生效。每个控制绑定当前session、规范化项目及一个具体任务ID，丢启动回包则绑定一个具体启动预览的SHA256。默认有效期60秒，上限5分钟；逐次查询和空闲计时器均检查有效期，到期将关闭状态写回。一次性启动回包故障消费前先持久关闭，重试仍查询原任务；正常退出清理控制，异常退出遗留控制也不能被下一进程重用。

在独立、可抛弃项目准备好正式本机配置后，手动使用以下本地命令。控制文件及事件日志应放入Git忽略的本机临时目录，路径参数需由操作者明确指定。

```text
node prototypes/sandbox-tasks/fault-service.mjs serve <验收项目> <控制文件> <事件文件>
node prototypes/sandbox-tasks/fault-service.mjs arm <控制文件> hold-observation <任务UUID> 60000
node prototypes/sandbox-tasks/fault-service.mjs arm <控制文件> disconnect <任务UUID> 60000
node prototypes/sandbox-tasks/fault-service.mjs arm <控制文件> drop-start-reply <启动预览令牌SHA256> 60000
```

`disconnect` 只丢指定任务的detail回包，保持其他任务与项目查询可用。启动预览哈希可用模块导出的 `startTokenHash` 在本机计算；不将原始令牌写入事件日志。旧 `.scratch/native-final-53/fault-service.mjs` 已改为委托同一受保护入口，原脚本有备份。

## 自动检查

依赖按现有两个lockfile安装后，在仓库根目录运行 `npm run check`。统一入口依次执行：

1. 自有脚本与两个模块的JavaScript语法检查。
2. 沙箱模块已有全部 `*.test.mjs` 回归，包括本轮故障租约和真实私有IPC检查。
3. 原有侧栏构建。
4. 原有项目切换/旧草稿路由、RPC清单、写操作策略检查。

每步失败立即返回非零，单步最长120秒。默认闸门无需正式后台、ChatGPT登录、真实代理任务或GitHub写入权限。构建仍会生成既有dist文件。不是静态样式lint，也不替代真实原生桌面A–L验收。

`.github/workflows/check.yml` 在push、pull_request和手动触发时运行同一入口，Windows/Linux双平台、Node26，只授予contents读取权限，不含发布、凭据或正式本机配置。CI是否成功以实际远端运行结果为准。若后续要求PR合入硬性阻断，还需把该检查配置为仓库分支保护的required check，不能用workflow存在代替该配置。

## 验证结果

- 根目录 `npm run check` 最终通过：112个自有JS文件语法通过；沙箱27项测试中26通过、1项Windows符号链接权限跳过、0失败；侧栏构建、项目切换/草稿路由、56项RPC注册覆盖和技能前缀检查通过。
- 已核验镜像的隔离Linux环境（非root、capDrop ALL、断网、只读挂载测试模块）中，故障租约、真实私有IPC、差异/过滤器及真实符号链接7项全部通过。该镜像Node22只用于这些兼容测试，不冒充Node26完整CI闸门。
- 反例验证：只在本轮新建scripts目录写一个独占临时语法错误夹具，实际统一入口退出1，且未进入测试；finally移除夹具后完整入口通过。证据 `.scratch/retro-guardrails-53/negative-check.json`。
- 确认全机无受影响任务后，正式预览/退出并隐藏重载服务，连接正常、并发2、当前项目两条历史保留；正式启动日志读回 `faultInjection.enabled=false`。没有启动真实模型任务或改写provider/config。
- 原生桌面验收和远端GitHub Actions运行未在本次冒充完成。原实施票保持open；本次retro两项实施与本地验证完成。

## 隔离发布范围

按用户后续授权，在远端默认分支上创建独立提交分支。此前整个沙箱模块尚未提交，先纳入统一检查必需的运行模块和回归作为依赖，再单独提交故障租约与CI配置。真实模型验收脚本、本机配置、认证、日志和其他侧栏/Render修改均不随本次提交发布。原工作区和暂存区保留。

为保证检查可以在干净检出运行，默认闸门选用远端已存在的写操作策略检查；尚未提交的技能前缀改动仍留在原工作区，不成为本次CI的隐性依赖。早期本地112文件/技能前缀检查记录仅是原混合工作区证据，独立提交的最终结果以干净检出和远端Actions为准。
