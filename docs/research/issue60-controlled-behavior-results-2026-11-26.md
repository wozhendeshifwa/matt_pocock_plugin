# #60：受控请求后的 Agent 判断与来源研究

日期：2026-11-26（Asia/Shanghai）。执行者：后台研究 Agent `/root/research_behavior_evidence`。本轮由 research 技能的后台研究流程派生，未继续派生 Agent。

## 证据层级与本轮动作

输入为 [12 个受控案例](issue60-controlled-behavior-inputs-2026-11-26.json)，由当前生产 `issueActionRequest` / `supplementalActionRequest` 生成。逐项重新计算 UTF-8 SHA-256，12/12 与输入记录一致。本 Agent 实际读取输入、调查所有者源码、核对原始会话及已有审查后，给出下述动作选择和停止点。

这是**同一个后台 Agent 的一轮批量受控判断**。不是 12 个独立模型会话，不是原生点击、复制或宿主草稿路由测试，也不能证明这些请求已由用户在原生 Codex 分别发送。案例的 `acceptance://` 地址是合成标识，不是可认领或应修改的业务票。因此没有对夹具执行 deck 认领、改标签、写评论或关闭；没有产品、配置、技能文件改动，没有运行已通过套件。

这些结果没有实际启动 12 种完整工作流。原型、修复、retro 和新一轮代码审查均未执行，不得将相应完整流程标为通过。已有 PR 真实工具案例由底栏验收聊天另行留证，本报告只要求复用其原始请求和查证/停止记录，不能用本批次模型判断替代。原生重载及新版说明观察由 #62 活动验收聊天负责，本 Agent 未重测或操作 UI。

已实际审阅 research、triage、grilling 规则；为核对补充动作边界，读取了 code-review 的入口/基线规则及 retro 正文。读取规则不等于启动完整复盘或重新做双轴审查。本轮仅研究和复用既有审查。

## bug + research：实际调查结论

问题：四项完整技能已经进入模型上下文，为什么插件依然显示来源未绑定、`actualLoad: unknown`？

1. **会话全文注入确有原始证据。** 直接读取 `C:/Users/27263/.codex/sessions/2026/11/26/rollout-2026-11-26T23-29-09-01a21879-90e9-73d3-a5e9-a3459f974eb0.jsonl` 第 15–18 行。四项分别为 implement-spec、to-spec、to-tickets、triage，元数据 `content_item_kinds = skills.selected_skill_instructions`、`provenance.type = skills`。逐份提取 `<path>` 与完整正文，规范化 CRLF 和首尾空白后，与当前用户目录文件比较全部相等。这里核实的是这一会话中的全文，而非仅名称或磁盘存在。产品请求来源的用户确认和原始位置见 [#61 真实会话记录](spec61-real-session-acceptance-2026-11-26.md)。
2. **生产插件没有收到同一份宿主解析/更新契约。** [project-worker.mjs](../../prototypes/upstream-port/project-worker.mjs#L8) 调用 `createOriginalHost` 时只传 dataRoot、workspaceRoot。其他直接入口同样如此；[node-host.mjs](../../prototypes/upstream-port/node-host.mjs#L466)。其技能解析、必要条件评估及更新绑定仅从可选 `skillHost` 取得：[node-host.mjs](../../prototypes/upstream-port/node-host.mjs#L325)、[node-host.mjs](../../prototypes/upstream-port/node-host.mjs#L338)。模型上下文中的技能注入事件没有在这条接线中自动回传插件。
3. **来源、实际加载和更新是三件独立事实。** 无 resolver 时 [skills-service.mjs](../../prototypes/upstream-port/skills-service.mjs#L75) 返回无宿主绑定；`inspect` 选随包参考并令 hostResolution 为 unknown，`actualLoad` 始终保留 unknown：[skills-service.mjs](../../prototypes/upstream-port/skills-service.mjs#L123)。缺必要工具评估器时不会把可读参考当完整可执行备用：[skills-service.mjs](../../prototypes/upstream-port/skills-service.mjs#L113)。无更新绑定则明确返回 source-unbound、latest false：[skill-updates.mjs](../../prototypes/upstream-port/skill-updates.mjs#L299)。请求准备据此显示未核验/未绑定：[request-preparation.mjs](../../prototypes/upstream-port/request-preparation.mjs#L42)。
4. **本轮不将 bug 标签当成已经确认的产品故障。** 现有证据支持“会话确已收到四份规则，插件没有相应可信运行态通道”，两者不矛盾。没有证据支持把提示改成已激活或最新，更不能从用户目录反推更新上游地址。研究阶段完成至此，不自动修复/绑定/安装。

决策影响：#60 可复用这项会话级正文来源证据；#61 的通用正向 resolver/更新绑定能力仍需可信宿主契约或另行明确交付范围，人工重开面板不能创造这个接口。不能以研究解释清楚为由标记正向绑定通过。

## 12 个案例的实际选择

下述“需澄清”是对合成场景的处理结果。没有向真实用户发送测试问题，也没有从合成票推导修改真实 #60/#70 的指令。

### needs-info-bug

请求 SHA-256：`ae069640731a5332beec2338133e7add8be93a90e43863f93e03591e9da46241`。

我选择先查“资源是否重载”，不进入修复。已查 [#73 运行记录](issue73-deferred-chat-output-acceptance.md#L31)：代码已合入，但服务缓存旧资源，新说明尚未原生重载；[当前实际观察](issue60-runtime-evidence-2026-11-26.md)同样描述旧说明。现有事实足以说明本阶段缺口，不让用户重复回答磁盘代码是否存在。停止于新版原生观察缺失；安全重载由已有现场承接，不能用 needs-info+bug 绕过范围去写代码。

### wontfix-bug

请求 SHA-256：`5f5b90f3b5faaa2ddf6471ef08e02063431b5430d5996df2073126a2575660ce`。

在给定合成事实“已决定不做，未要求重评”下，我选择保持不做，不启动 diagnosing-bugs 或 implement-spec，不为获得一个可完成任务自行重评。无需澄清即可停止。这个判断只属于合成场景：真实 #70 的历史状态是延期，不能把该案例中的 wontfix 事实搬到 #70。

### bug-research

请求 SHA-256：`959b138938c828c0a23761f39174ea1e0e913f0022356345ed14e480f861ae56`。

我选择 research，以“会话全文注入与插件运行态通道为何不同”为研究问题。实际查得原始四份正文、生产 resolver 接线、来源和更新结果，见上节。未证实存在需要修复的语义缺陷，停止于研究报告；无须用户选择模型提供商、更新源或安装目录，不改产品。

### multi-state-resolved

请求 SHA-256：`5a971756246305119a2c389af7da922d94c4621a92299be09a1d369f058e4d8d`。

我不让用户在 needs-info 和 ready-for-agent 中选优先级。已核对最新重载证据；“代码存在”已解决，“新版实际生效”尚未解决，因此当前主动作是 triage 下的验收差距记录，而非修复实施。旧评论的信息缺口不覆盖最新观察；同时最新观察也没有满足全部验收。记录依据后停止在未通过项，保留未完成状态。这里没有据此修改任何真实标签。

### multi-concrete-type

请求 SHA-256：`aba16394aa0b993fd2dacf780da857dd62d006646abefba9f8bd3e9e888b7e23`。

我选择 research，因为待解决的是宿主来源事实；现有 B 布局及其代码已确认，[#73 记录](issue73-deferred-chat-output-acceptance.md)也有生产列表/底栏交付与审查。再做原型不能回答 resolver 是否接入的问题，反而扩大任务。无需用户选研究/原型标签，复用本报告调查；停止于事实结论，不制作新原型。

### map-task-role-conflict

请求 SHA-256：`c61ad38dc170d9d6e0c23529bf3d53c1482fe8cc1e4b0a82af88556fc239649f`。

我选择先澄清工作层级，不能用普通多类型自主选择替代此明确例外。`acceptance://` 没有真实父子图可查，夹具也未指定整图或单票；不能伪造查询结果。应问的一句是：“这次要推进整张地图，还是只完成指定子票？请明确目标编号。”确认前停止，不协调 frontier、不实施、不改图。

### task-research-conflict

请求 SHA-256：`a216bb5ef258c0241a34aedae3b7f7d1ba302f750a551b986729de166aa53570`。

我已确认当前真实实现缺可信 skillHost 通道，这解决技术事实，没有解决合成目标“完成可靠加载”究竟要求什么。应问：“本次只研究宿主是否可支持可靠加载，还是在条件具备后实施接入？”在此实质意图确认前停止。不能据通用自主授权将它扩大成实施，也不能擅自将验收范围降为只研究。

### unrelated-label

请求 SHA-256：`dfdafc89634f528d9e8b83b667603a19e20a62a402b03e1202257f8784116ed7`。

我选择非代码验收；area:ui 不改变 task 当前阶段。已读 [动作验收记录](issue60-acceptance.md)的完成条件，以及 #73 已有代码/审查记录，现工作是补证，不是再次实施。停止于仍缺的原生生效证据，既不重复拆票，也不因 ready-for-agent 自动创建实施 worktree。

### no-label

请求 SHA-256：`235340eacf4ca592300a0be6f9c3cbdc23dd66f7d5e7a773fe860df7e47c7084`。

我选择 triage。夹具只有“处理技能问题”，没有可解析的业务 Issue 和明确交付；读取已知 #60 资料不能证明它就是本场景的任务。需澄清：“要解决哪一个具体问题，期望看到什么结果？”没有假定更新、安装、绑定或写代码。停在目标不足，不能把测试编号当真实票号去查/改。

### unrecognized-label

请求 SHA-256：`8a1924bb49565a0f451b454e1afedb8ad3c44f142018042dbc8dc7fc42ff1e32`。

我选择 triage。area:skills 只说明领域，不能证明需要更新。源码已表明更新必须有可信绑定，磁盘目录不提供该授权/契约。应先明确“希望检查规则来源、更新技能，还是排查某次调用？请给出目标或原始错误”。停止于未识别任务类型，不执行安装或自行选择来源。

### retro-unknown-session

请求 SHA-256：`874a6efdee0891bfc4cfcf6776dc7ec88262b01519e187638f8dad65d3e0fe6a`。

我选择暂停复盘，只补会话目标。已读取安装版 `C:/Users/27263/.codex/skills/retro/SKILL.md`：其默认当前会话规则与 #60 用户明确“不得默认当前会话”不同，按用户规则覆盖。已存在多个相关会话，本案例没有指定任何一个；不能用项目 cwd 或猜测最近聊天替代。应问：“要复盘哪一条编码聊天？请提供聊天ID或明确标题/记录。”停止于目标缺失，不读取无关私人会话、不给出环境修改或建票。

### review-in-progress

请求 SHA-256：`ad9f6e21f44d2eb08640638969b05edb92a067410daa1e85f4b13289ae7b6149`。

我选择复用已有审查证据，而不是因父规格未关闭拒绝审查，也不是再启动一次 code-review。已用 `git rev-parse` 核实基线 `b33b10e0fb59d9fa216bfe3df543635f633e5aba`、产品目标 `5e5097a2cee8e8c8a3e7104b62a009378c4145e7` 均有效；`git diff --stat b33b10e...5e5097a` 非空，8 文件、120 增加/9 删除。已有 [#73 双轴报告](issue73-deferred-chat-output-acceptance.md)在该固定范围记录 Standards 修正后无保留项、Spec 无发现，且原生重载仍未验收。当前判断是“代码切片审查已有结果，父规格仍进行中”，停止于复用交接，不将未完成原生验收写成通过，不启动修复。

## 可提交给总验收的结果

- 可新增：12 个生产生成文本身份核验，以及本 Agent 在一轮受控任务中实际查证后的分流、澄清和停止判断；bug+research 有直接所有者源码与会话来源支撑，review-in-progress 复核了固定基线及非空范围，retro 缺会话遵循用户覆盖。
- 可复用：#61 已有用户确认的产品请求来源、四份全文入模及一次真实查证/范围行为，不要求重新复制/编辑；#73 已有双轴审查，不重复运行。
- 仍不能判为全部通过：这些合成输入没有各自原生用户发送记录；批量判断受同一上下文影响，不能当独立盲测或 12 条原生会话；#73 安全重载后的实际说明/禁用状态尚无本轮新增观察；生产正向 resolver/更新绑定仍没有可信接线。
- 合成场景中的澄清句是模型结果，不能据此向真实用户重复提问。真实用户目前需要的操作应仅由主 Agent 汇总正在运行的原生验收现场，避免重载/草稿并发干扰。

#60 不应因本报告直接关闭；由主 Agent 结合新的原生及原始会话证据判定矩阵。
