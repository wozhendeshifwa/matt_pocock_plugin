# 底栏首版：续跑复核

日期：2026-11-26（Asia/Shanghai）。本轮复用 `codex/issue62-integration`，起点 `fe05a0b`，未修改产品代码。完整矩阵仍见 [最终审查与验收记录](issue62-final-review-and-acceptance.md)。

## 票面与阶段

已完整读取父规格、评论、标签、认领和关系，并读取所属地图及动作、上下文、原型和剩余验收票。父规格已经认领，没有 needs-triage。四张直属子票中底栏和草稿代码票关闭；可靠宿主出口与最终验收仍开放，最终验收仍被可靠宿主出口阻塞。本轮没有重复拆票、重复实施或关闭未通过的票。

## 本轮实际重跑

在集成工作树 `prototypes/upstream-port` 运行，均 exit 0：

- `node build.mjs`
- `node verify-issue-actions.mjs`
- `node verify-bottom-action-bar.mjs`
- `node verify-action-drafts.mjs`
- `node verify-reviewed-draft-outputs.mjs`
- `node --test verify-protected-draft-outputs.mjs`：8/8 通过。

覆盖生产动作到预览、底栏展开/收起与完整菜单、原文复制、失败保留、项目/聊天/Issue/仓库隔离、取消替换与清空、两种预览的可靠回执及来源变化后三出口保护。外部宿主为受控边界，不是原生聊天写入成功证据。构建后 `git status --short` 无改动；`git diff --check` 通过。Git 提示生成文件的 LF/CRLF 转换警告，没有内容差异。

## 当前宿主复核

主代理经只读 CIM 查询确认运行进程来自 `OpenAI.Codex_26.1120.6357.0_x64__2p2nqsd0c76g0`；当前匹配的侧栏服务命令行均未指向 `issue62/integration`。未切换服务或修改用户配置。

独立 exploration 子代理直接解析当前已安装 `app/resources/app.asar`（402897535 字节），并核对 AppxManifest 的版本为 `26.1120.6357.0`：

- `webview/assets/async/141674.c261c78fc6.js` 字符偏移 39891：公开 `openai/message` 参数仍是 strict 的 target(active/new)、send。
- 同文件偏移 91684：send:false 的当前聊天路径使用 append，新聊天使用 freshDraft，返回 `{}`；没有读取 composer、原子条件替换或可靠填入回执。
- 同文件偏移 115876：所检查能力声明没有新增可靠草稿入口。
- `webview/assets/async/180247.d39a51db31.js` 的 Y3OQ 模块偏移 8674：内部 replace 未通过上述公开入口暴露；freshDraft 路径没有显式 project/thread 绑定。来源插件草稿入口仅插入 mention。

当前工具清单也未提供 composer 读取或条件写入能力。未重新捕获完整 experimental 握手，不能将静态复查扩大为对一切实验能力的结论。没有触发实际宿主输入写入、发送或私有桥接。

## 真实状态与下一步

代码与上述受控检查仍通过，原生验收仍未完成。保留当前保护行为和用户明确选择的复制出口。完成可靠当前/新聊天出口，需要公开的 composer 状态、目标绑定、原子条件写入及可信回执，再接入适配器并在真实宿主逐项验收。

原生 UI/系统剪贴板、最窄宽度/缩放/输入法、真实切换及新产品生成请求后的原始 Agent 会话证据仍沿用最终矩阵的待验收状态。本轮没有把这些列为通过；单独完成布局或复制也不能消除可靠宿主出口的前置阻塞。所有必验项通过之前，父规格及剩余验收票保持开放。
