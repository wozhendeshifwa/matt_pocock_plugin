# 环境检查与修复入口验收

2026-11-07，对应「任务：恢复环境检查与修复入口」。

现状是真实进展：此前的 RPC 读取、技能服务与宿主草稿适配已经接通检查页。本票无需另写检查逻辑，新增故障验收以核实上游行为；vendor 和运行时均未修改。

`node prototypes/upstream-port/verify-checks-page.mjs` 通过生产项目 worker 验证：

- 真实项目检查 10/10，detect 选择 GitHub；技能检查来源为 vendored skills。
- 子进程使用空 GH_CONFIG_DIR 和空 token，登录检查失败，返回具体描述与登录指引。用户凭据不变。
- 临时 Git 仓库指向不存在的 GitHub remote，仓库关联通过、访问失败，保留修复动作。
- 子进程代理指向不可连接的本地端口，仓库访问保持 pending；手动重查仍 pending，无修复成功假象。
- 故障 worker 后再查正常 worker，仍为 allDone，缓存没有串项目。

`node prototypes/upstream-port/verify-checks-ui.mjs` 通过真实 MCP 服务和原版面板的 JSDOM 验证：空登录配置下打开环境检查，点击登录指引生成含 gh auth login 的宿主草稿，`_meta.openai/message.send=false`；重新检查等待匹配的 chain 响应完成，并给该响应的登录行描述添加唯一标记，直到标记渲染才断言失败状态，避免旧 DOM 假通过。随后仅在测试消息桥内将第二次重查响应改为全绿，等待另一标记渲染，确认同一失败断言会抛出 ERR_ASSERTION。全绿是刻意注入的对抗数据，不是实际登录恢复。

运行这些检查需要 GitHub 网络可达和正常基准账号；网络受限沙箱不能用来证明健康环境。故障注入只在临时目录与测试子进程内进行，无远端写入。git 可执行文件解析已由版本管理读取票覆盖，本票不新增上游未定义的 git 检查行。票面 probeSkill 指内部探针；公开 RPC 是 probe，chain/detect 继续使用原内部探针。

这不是 Windows 原生侧栏视觉验收，窄栏布局和真实点击仍由「完成真实桌面全量验收」负责。
