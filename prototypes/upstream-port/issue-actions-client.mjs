// Scenario policy is shared by the existing list and detail actions. Labels
// describe facts; ambiguous combinations are handed to the agent, not ranked.
export function issueActionRequest(issue, url) {
  const labels = (issue.labels || []).map(l => typeof l === 'string' ? l : l.name).filter(Boolean);
  const has = label => labels.includes(label);
  const states = labels.filter(l => ['needs-triage', 'needs-info', 'ready-for-human', 'ready-for-agent', 'wontfix'].includes(l));
  const types = labels.filter(l => ['wayfinder:map', 'wayfinder:task', 'wayfinder:grilling', 'wayfinder:research', 'wayfinder:prototype'].includes(l));
  const roleConflict = has('wayfinder:map') && types.length > 1 || has('wayfinder:task') && types.some(t => ['wayfinder:grilling', 'wayfinder:research', 'wayfinder:prototype'].includes(t));
  let skill = 'triage', kind = 'diagnose', goal = '查证当前工作类型及就绪条件，完成分流；不默认实施。';
  if (roleConflict) {
    skill = 'grilling'; kind = 'discuss'; goal = '地图／任务角色或工作类型冲突，先查证，再请用户确认工作层级与实质意图；确认前不实施。';
  } else if (states.length > 1 || types.length > 1) {
    goal = '存在多个状态或具体工作类型。Agent 依据最新现状与证据自主选择主动作及必要阶段并记录依据，不使用固定优先级，不要求用户逐个选标签；实质需求缺口仍先查证，再用 $grilling 澄清。未明确就绪前不实施。';
  } else if (has('wontfix')) {
    skill = null;
    goal = '保持不做边界，不默认实施；只有用户明确要求重新评估时才使用 $triage。';
  } else if (has('needs-triage')) {
    goal = '先用 $triage 诊断：复现、核实已有实现与信息缺口并分流，不直接实施。';
  } else if (has('needs-info')) {
    skill = 'grilling'; kind = 'supplement'; goal = '先用工具查证可取得的事实，只用 $grilling 询问无法自行取得的信息；补齐前不实施，补齐后回到 $triage。';
  } else {
    if (has('wayfinder:grilling')) { skill = 'grill-with-docs'; kind = 'discuss'; goal = '围绕目标、范围、约束、取舍与验收讨论；人来定夺，确认后写正文，对齐后提醒 $to-spec；bug 背景不触发自动修复。'; }
    else if (has('wayfinder:research')) { skill = 'research'; kind = 'research'; goal = '围绕明确问题开展研究，提供可信来源、发现、不确定性及决策影响；bug 背景不触发自动修复。'; }
    else if (has('wayfinder:prototype')) { skill = 'prototype'; kind = 'prototype'; goal = '围绕明确设计问题制作抛弃式原型，以用户反馈确认取舍；不当作产品交付，bug 背景不触发自动修复。'; }
    else if (has('wayfinder:map')) { skill = 'wayfinder'; kind = 'execute'; goal = '读取 Destination、Notes 和最新 frontier，协调地图；具体票使用各自工作技能，不将整图当代码实施任务。'; }
    else if (has('bug')) { skill = 'diagnosing-bugs'; kind = 'fix'; goal = '先复现并定位根因，记录证据。仅状态允许且规格及实施票齐备后，才用 $implement-spec 修复。'; }
    else if (has('wayfinder:task')) {
      skill = 'triage'; kind = 'execute'; goal = '先查证这是代码还是非代码任务，不凭 task 标签猜测。代码工作（含小改动）统一 $implement-spec，缺规格先 $to-spec，缺实施票先 $to-tickets，只补缺项并复用有效产物；执行单位是明确规格及关联票图，采用集成分支、独立 worktree 子代理、依赖调度和最终审查。非代码任务使用匹配专项技能，否则明确任务说明；类型不明先 $triage。';
    }
    if (has('ready-for-human')) {
      kind = 'takeover'; goal += ' 按工作类型选择方法，说明必要人工步骤的原因及验证点，AI 完成其余可做工作；仅适合交互脚本引导时才用 $wizard。';
    } else if (has('ready-for-agent')) {
      goal += ' 核对前置条件、执行范围及验收标准；ready-for-agent 不等于必须写代码。';
    } else if (has('wayfinder:task') || has('bug')) {
      goal += ' 缺明确就绪状态，先查证分流，不直接代码实施。';
    }
  }
  return { kind, skill, text: (skill ? '$' + skill + '\n\n' : '') + '目标：' + String(issue.title || '') + '\nIssue：' + url + '\n标签事实：' + (labels.join('、') || '无标签') + '\n\n' + goal + '\n\n先读取最新正文、全部评论、标签、认领、父子与阻塞关系及已有实施记录，已完成先核验，新阻塞先处理；关联地图仅作背景，不扩大本次范围。Issue 操作优先 deck_ 工具，先认领并及时用 deck_issue_report 上报。技能按实际可用来源读取规则，技能名注入不等于已加载。结束前把真实状态及未完成的下一步写入正文；完成才关闭，关闭时在所属地图 Decisions so far 追加票名、链接与一句话结论。仅生成可编辑草稿，由用户发送，不自动执行。' };
}

export function showIssueActionDraft(text, send) {
  document.querySelector('[data-issue-action-preview]')?.remove();
  const panel = document.createElement('section');
  panel.setAttribute('data-issue-action-preview', '');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', '动作草稿预览');
  panel.style.cssText = 'position:fixed;inset:8%;z-index:10000;background:var(--dsw-alias-background-primary,#202127);color:var(--dsw-alias-label-primary,#eee);padding:16px;display:flex;flex-direction:column;gap:8px;overflow:auto;border:1px solid #888;border-radius:8px';
  const editor = document.createElement('textarea');
  editor.setAttribute('data-issue-action-draft', '');
  editor.setAttribute('aria-label', '可编辑动作草稿');
  editor.value = text;
  editor.style.cssText = 'width:100%;box-sizing:border-box;min-height:180px;flex:1';
  const note = document.createElement('div');
  note.textContent = '检查并编辑草稿，再选择出口；填入聊天后由你发送。';
  panel.append(note, editor);
  for (const [target, label] of [['active', '填入当前聊天'], ['new', '填入新聊天'], ['copy', '复制'], ['close', '返回']]) {
    const button = document.createElement('button');
    button.textContent = label;
    button.setAttribute('data-issue-action-export', target);
    button.onclick = async () => {
      if (target === 'close') { panel.remove(); return; }
      try { await send(target, editor.value); note.textContent = target === 'copy' ? '已复制' : '已请求填入聊天，请核实宿主结果；草稿已保留。'; }
      catch (error) { note.textContent = '操作失败：' + String(error.message || error) + '。草稿已保留。'; }
    };
    panel.append(button);
  }
  document.body.append(panel);
  editor.focus();
}

export function adaptIssueActions(source) {
  const replaceOnce = (anchor, replacement) => {
    if (source.split(anchor).length !== 2) throw new Error('Issue action boundary changed: ' + anchor.slice(0, 80));
    source = source.replace(anchor, () => replacement);
  };
  const replaceFunction = (start, end, replacement) => {
    const first = source.indexOf(start), last = source.indexOf(end, first);
    if (first < 0 || last < 0) throw new Error('Issue action function boundary changed');
    source = source.slice(0, first) + replacement + '\n    ' + source.slice(last);
  };
  replaceFunction('const rowActionKind = function (x) {', 'const actionColorOf =', 'const rowActionKind = x => issueActionRequest(x, "").kind;');
  replaceFunction('const rowActionText = function (st, x) {', '// v19：共享 —— 行级动作', `const rowActionText = (st, x) => issueActionRequest(x, issueUrlFor(st, x.number) || '#' + x.number).text;
    const previewIssueAction = (st, text) => showIssueActionDraft(text, async (target, finalText) => {
      if (target === 'copy') { await navigator.clipboard.writeText(finalText); return; }
      const actions = ctx.get('codexActions');
      if (!actions) throw new Error('宿主草稿出口不可用，请选择复制');
      await actions.prefill(target, finalText);
    });`);
  replaceOnce('e.stopPropagation(); inject(st, text)', 'e.stopPropagation(); previewIssueAction(st, text)');
  replaceOnce('inject(st, primaryInfo.text)', 'previewIssueAction(st, primaryInfo.text)');
  replaceOnce('openTextInNewSession(st, text, title, kind ? { kind: kind } : null)', 'previewIssueAction(st, text)');
  const anchor = '    // 1. 技能目录 + 场景推荐映射';
  replaceOnce(anchor, issueActionRequest.toString() + '\n' + showIssueActionDraft.toString() + '\n' + anchor);
  return source;
}
