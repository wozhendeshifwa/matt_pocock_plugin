import { createDraftReview } from './draft-review-client.mjs';
// Scenario policy is shared by the existing list and detail actions. Labels
// describe facts; ambiguous combinations are handed to the agent, not ranked.
const ISSUE_ACTION_COMMON = '先读取最新正文、全部评论、标签、认领、父子与阻塞关系及已有实施记录，已完成先核验，新阻塞先处理；关联地图仅作背景，不扩大本次范围。Issue 操作优先 deck_ 工具，先认领并及时用 deck_issue_report 上报。技能按实际可用来源读取规则，技能名注入不等于已加载。结束前把真实状态及未完成的下一步写入正文；完成才关闭，关闭时在所属地图 Decisions so far 追加票名、链接与一句话结论。';

export function renderIssueActionRequest({ skill, target, goal, missing = [], facts = '' }) {
  const prefix = missing.length ? '先查证补齐：' + missing.join('、') + '；只能询问无法自行取得的信息，补齐前不执行本补充动作。' : skill ? '$' + skill : '';
  const header = '目标：' + target.title + '\nIssue：' + target.url + '\n标签事实：' + (target.labels.join('、') || '无标签');
  return (prefix ? prefix + '\n\n' : '') + header + (facts ? '\n' + facts : '') + '\n\n' + goal + '\n\n' + ISSUE_ACTION_COMMON;
}

const SUPPLEMENTAL_ACTIONS = {
  pr: { required: ['scope', 'branch'], goal: '生成或修订 PR 正文草稿，按 Summary、Evidence、Merge Danger 记录实际变化、前后证据、可逆性及影响范围。验证记录先查，缺失或未验证如实标注。仅起草正文，不发布正文、不创建 PR、不推送、不合并；这些需要另行明确指令。' },
  retro: { required: ['session', 'record'], recommend: ['stage'], goal: '读取指定编码会话原始证据，核对已有检查与指令，按严重程度列出证据、问题、环境改进建议及收益；先提供候选供用户选择，再决定修改文件或建票。不默认当前会话，不以项目目录冒充会话标识。' },
  'code-review': { required: ['scope', 'baseline'], goal: '审查指定范围的改动，进行中改动亦可；按仓库标准及来源规格报告可定位的证据和验证缺口，不擅自假设 main 或当前分支。修复进入统一 $implement-spec 流程，不能省略 implement-spec 自带最终审查。' },
};
const ACTION_CONTEXT_LABELS = { scope: '改动范围', branch: '分支或 PR', baseline: '比较基线', session: '目标编码会话', record: '原始会话记录', stage: '阶段／观察' };

function supplementalRequirements(skill, context) {
  const action = SUPPLEMENTAL_ACTIONS[skill];
  const missing = (action?.required || []).filter(name => !String(context[name] || '').trim());
  return { missing: missing.map(name => ACTION_CONTEXT_LABELS[name]), recommended: !!action && !missing.length && (action.recommend || []).every(name => String(context[name] || '').trim()), goal: action?.goal || '用户手动选择此技能；读取完整技能规则，并先查证其所需目标及上下文；目标不明确先澄清，不擅自扩大范围。' };
}

export function issueActionRequest(issue, url) {
  const labels = (issue.labels || []).map(l => typeof l === 'string' ? l : l.name).filter(Boolean);
  const has = label => labels.includes(label);
  const states = labels.filter(l => ['needs-triage', 'needs-info', 'ready-for-human', 'ready-for-agent', 'wontfix'].includes(l));
  const types = labels.filter(l => ['wayfinder:map', 'wayfinder:task', 'wayfinder:grilling', 'wayfinder:research', 'wayfinder:prototype'].includes(l));
  const roleConflict = has('wayfinder:map') && types.length > 1 || has('wayfinder:task') && types.some(t => ['wayfinder:grilling', 'wayfinder:research', 'wayfinder:prototype'].includes(t));
  const codePreparation = '代码工作（含小改动）统一 $implement-spec，缺规格先 $to-spec，缺实施票先 $to-tickets，只补缺项并复用有效产物；执行单位是明确规格及关联票图，采用集成分支、独立 worktree 子代理、依赖调度和最终审查。';
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
    else if (has('bug')) { skill = 'diagnosing-bugs'; kind = 'fix'; goal = '先复现并定位根因，记录证据。仅状态允许且规格及实施票齐备后，才用 $implement-spec 修复。' + codePreparation; }
    else if (has('wayfinder:task')) {
      skill = 'triage'; kind = 'execute'; goal = '先查证这是代码还是非代码任务，不凭 task 标签猜测。' + codePreparation + '非代码任务使用匹配专项技能，否则明确任务说明；类型不明先 $triage。';
    }
    if (has('ready-for-human')) {
      kind = 'takeover'; goal += ' 按工作类型选择方法，说明必要人工步骤的原因及验证点，AI 完成其余可做工作；仅适合交互脚本引导时才用 $wizard。';
    } else if (has('ready-for-agent')) {
      goal += ' 核对前置条件、执行范围及验收标准；ready-for-agent 不等于必须写代码。';
    } else if (has('wayfinder:task') || has('bug')) {
      goal += ' 缺明确就绪状态，先查证分流，不直接代码实施。';
    }
  }
  const request = { kind, skill, roleConflict, target: { title: String(issue.title || ''), url, labels }, goal };
  return { ...request, text: renderIssueActionRequest(request) };
}

export function supplementalActionRequest(skill, request, context) {
  const { missing, goal } = supplementalRequirements(skill, context);
  const facts = Object.entries(ACTION_CONTEXT_LABELS).map(([name, label]) => [label, String(context[name] || '').trim()]).filter(([, value]) => value).map(([label, value]) => label + '：' + value).join('\n');
  return renderIssueActionRequest({ skill, target: request.target, goal, missing, facts });
}

export async function sendIssueActionDraft(st, target, finalText) {
  if (target === 'copy') {
    await navigator.clipboard.writeText(finalText);
    return { status: 'copied', target: 'copy' };
  }
  const actions = ctx.get('codexActions');
  if (!actions || !actions.prefill || actions.capabilities?.reliableDraft !== true || actions.capabilities[target] === false) throw new Error('宿主未提供可靠的草稿读取与结果确认，请明确选择复制');
  const result = await actions.prefill(target, finalText);
  if (!result || result.status !== 'filled') throw new Error('宿主填入结果无法确认；草稿已保留');
  if (result.target !== target) throw new Error('宿主返回的目标与所选聊天不一致；草稿已保留');
  return result;
}

export function showIssueActionDraft(request, send) {
  const text = request.text;
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
  note.setAttribute('data-issue-action-status', '');
  note.setAttribute('role', 'status');
  note.setAttribute('aria-live', 'polite');
  note.textContent = '检查并编辑草稿，再选择可用出口；不会自动发送。';
  panel.append(note, editor);
  const choice = document.createElement('select');
  choice.setAttribute('data-issue-action-choice', '');
  choice.setAttribute('aria-label', '动作与全部技能');
  choice.add(new Option('标签主动作', 'main'));
  const supplements = document.createElement('optgroup');
  supplements.label = '补充动作';
  for (const [name, label] of [['pr', '撰写 PR 正文'], ['retro', '复盘编码会话'], ['code-review', '审查改动']]) supplements.append(new Option(label, name));
  choice.append(supplements);
  const menu = document.createElement('optgroup');
  menu.label = '全部技能';
  for (const name of CODEX_SKILL_NAMES) menu.append(new Option('$' + name, 'skill:' + name));
  choice.append(menu);
  const recommendations = document.createElement('div');
  recommendations.setAttribute('data-issue-action-recommendations', '');
  const fields = {};
  const contextBox = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = '补充动作上下文（明确提供，不推定当前分支或会话）';
  contextBox.append(summary);
  for (const [name, label] of [['scope', '改动范围'], ['branch', '分支或 PR'], ['baseline', '比较基线'], ['session', '目标编码会话'], ['record', '原始会话记录']]) {
    const input = document.createElement('input');
    input.setAttribute('data-issue-action-context', name);
    input.setAttribute('aria-label', label);
    input.placeholder = label;
    fields[name] = input;
    contextBox.append(input);
  }
  const stage = document.createElement('select');
  stage.setAttribute('data-issue-action-context', 'stage');
  stage.setAttribute('aria-label', '编码阶段或观察');
  for (const value of ['', '成功结束', '失败结束', '中止', '反复返工', '导航困难', '工具低效']) stage.add(new Option(value || '选择阶段或观察', value));
  fields.stage = stage;
  contextBox.append(stage);
  const readContext = () => Object.fromEntries(Object.entries(fields).map(([name, field]) => [name, field.value]));
  const updateRecommendations = () => {
    const c = readContext(), names = Object.keys(SUPPLEMENTAL_ACTIONS).filter(name => supplementalRequirements(name, c).recommended);
    recommendations.textContent = names.length ? '补充推荐：' + names.map(n => '$' + n).join('、') : '暂无补充推荐；可手动选择并查证缺项。';
  };
  for (const input of Object.values(fields)) { input.addEventListener('input', updateRecommendations); input.addEventListener('change', updateRecommendations); }
  let previousChoice = 'main', generated = text;
  const regenerate = () => {
    if (editor.value !== generated && !window.confirm('替换已编辑的草稿？取消将保留原文。')) { choice.value = previousChoice; return; }
    const skill = choice.value.replace(/^skill:/, '');
    generated = choice.value === 'main' ? text : supplementalActionRequest(skill, request, readContext());
    editor.value = generated;
    previousChoice = choice.value;
  };
  choice.addEventListener('change', regenerate);
  const applyContext = document.createElement('button');
  applyContext.textContent = '更新所选动作草稿';
  applyContext.setAttribute('data-issue-action-apply-context', '');
  applyContext.onclick = regenerate;
  updateRecommendations();
  panel.append(choice, recommendations, contextBox, applyContext);
  const actions = ctx.get('codexActions');
  const canFill = target => typeof actions?.prefill === 'function' && actions.capabilities?.reliableDraft === true && actions.capabilities[target] !== false;
  const unavailableChats = [['active', '当前聊天'], ['new', '新聊天']].filter(([target]) => !canFill(target));
  let availability;
  if (unavailableChats.length) {
    availability = document.createElement('p');
    availability.id = 'issue-action-chat-availability-' + Math.random().toString(36).slice(2);
    availability.setAttribute('data-issue-action-output-availability', '');
    availability.textContent = unavailableChats.map(([, label]) => label).join('／') + '填入暂不可用：' + (actions?.capabilities?.reason || '宿主未提供可靠的草稿读取、目标锁定与结果确认。') + ' 请明确选择复制，再自行粘贴到所需聊天。';
    panel.append(availability);
  }
  for (const [target, label] of [['active', '填入当前聊天'], ['new', '填入新聊天'], ['copy', '复制'], ['close', '返回']]) {
    const button = document.createElement('button');
    button.textContent = label;
    button.setAttribute('data-issue-action-export', target);
    if (['active', 'new'].includes(target) && !canFill(target)) {
      button.disabled = true;
      button.setAttribute('aria-describedby', availability.id);
      button.title = availability.textContent;
    }
    button.onclick = async () => {
      if (target === 'close') { panel.remove(); return; }
      try { await send(target, editor.value); note.textContent = target === 'copy' ? '已复制' : target === 'active' ? '已填入当前聊天' : '已填入新聊天'; }
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
    const previewIssueAction = (st, issue) => showIssueActionDraft(issueActionRequest(issue, issueUrlFor(st, issue.number) || '#' + issue.number), (target, finalText) => sendIssueActionDraft(st, target, finalText));`);
  replaceOnce('e.stopPropagation(); inject(st, text)', 'e.stopPropagation(); previewIssueAction(st, x)');
  replaceOnce('inject(st, primaryInfo.text)', 'previewIssueAction(st, fakeIssue)');
  replaceOnce('openTextInNewSession(st, text, title, kind ? { kind: kind } : null)', 'previewIssueAction(st, x)');
  // Empty/done map shortcuts must not bypass an unresolved role conflict.
  replaceOnce('const mapDone=!!(isMap&&', 'const mapDone=!!(!issueActionRequest(x, "").roleConflict&&isMap&&');
  replaceOnce('const mapEmpty=!!(isMap&&', 'const mapEmpty=!!(!issueActionRequest(x, "").roleConflict&&isMap&&');
  const anchor = '    // 1. 技能目录 + 场景推荐映射';
  replaceOnce(anchor, 'const ISSUE_ACTION_COMMON = ' + JSON.stringify(ISSUE_ACTION_COMMON) + ';\nconst SUPPLEMENTAL_ACTIONS = ' + JSON.stringify(SUPPLEMENTAL_ACTIONS) + ';\nconst ACTION_CONTEXT_LABELS = ' + JSON.stringify(ACTION_CONTEXT_LABELS) + ';\n' + renderIssueActionRequest.toString() + '\n' + supplementalRequirements.toString() + '\n' + issueActionRequest.toString() + '\n' + supplementalActionRequest.toString() + '\n' + sendIssueActionDraft.toString() + '\n' + createDraftReview.toString() + '\n' + showIssueActionDraft.toString() + '\n' + anchor);
  return source;
}
