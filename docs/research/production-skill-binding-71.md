# 生产插件参考技能来源绑定

2026-11-26，#61/#71。用户明确选择仅将插件专属副本绑定到已有 FeatherHunter 来源，不覆盖用户技能目录。

生产 project-worker 注入 createProductionSkillHost。固定上游为 FeatherHunter/dsh-mattpocock-skills-deck.git 的 main，仅接收 package/bundled-skills 下既定27项；上游内容只以git树和blob读取，不checkout或执行。插件数据目录保存首次绑定及原始备份，后续不一致/损坏拒绝；普通RPC无法选择源、目标或项目。

每次先在线ls-remote取得真实revision，成功且revision未变时复用有界文件快照，不fetch或重新读取blob。新revision用独立stage-UUID裸仓库，以depth=1和blob:limit=200001过滤取得固定SHA；GIT_NO_LAZY_FETCH禁止隐式补下超大blob。仅完整技能快照成功后发布，旧中断stage及repository.git/shallow.lock保留、不解锁且不再使用。每个Git命令限制45秒；超时按本次spawn拥有的PID清理整棵Git进程树，不先杀wrapper留下后代。离线返回source-refresh-failed而不是拿旧缓存声称最新。变更快照转换成原更新器的完整文件hash清单，目标仍只为dataRoot/skill-library，原来的备份、锁、阶段恢复与失败保留继续使用。源快照锁复用同一PID/token锁，崩溃可回收。合法绑定的网络失败仍进入原更新器恢复阶段，之后才报告失败。

维护前置与执行前置分开：参考副本维护核验完整文件及引用、git源读取；Agent技能使用的工具核验仍未知，保持execution.allowed=false/actualLoad=unknown，不伪造宿主加载或用户目录解析。首次绑定是本轮用户授权，不宣称此前已有用户目录绑定。

验证：新增verify-production-skill-binding.mjs先因模块缺失红，实施后绿。临时本地git源覆盖启动安装、使用前无变化0正文下载、更新备份、离线保留且恢复中断目标journal、可回收死PID源锁、错项目/坏绑定拒绝，真实createOriginalHost验证prepare/readDoc且执行前置仍未知、RPC额外source拒绝。沙箱内Git MSYS辅助进程受权限限制失败，主机侧该脚本通过；不将环境失败写成通过。

联网生产worker验收命令：node prototypes/upstream-port/verify-production-skill-binding-live.mjs ABS_PLUGIN_DATA_ROOT ABS_PROJECT_ROOT。它启动真实project-worker及固定批准源，输出两次使用前状态与来源/执行摘要，不打印规则全文。root负责真实源运行、独立双轴审查及票面收尾；本记录不冒称那些已完成。

2026-11-27长路径修复：真实生产数据目录叠加项目hash/stage后，WinGit报GIT_DIR too big，不能仅用短临时夹具证明生产通过。新增与真实生产相当长度的临时dataRoot测试先红，之后将仅用于读取上游的Git对象仓库放到OS短临时目录；绑定、锁、stage、manifest及最终技能副本仍保留真实dataRoot。失败临时仓库保留，stage中的source-repository.json保存恢复指针；成功发布后仅清理本次mkdtemp创建且绝对路径经核验属于OS临时根的mattskills-source目录。没有修改Windows全局配置、生产dataRoot或用户技能路径。长路径维护入口/真实node-host回归主机侧通过，联网现场验收仍由root执行。
