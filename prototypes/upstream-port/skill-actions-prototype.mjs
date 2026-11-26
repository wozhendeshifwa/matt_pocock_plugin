// THROWAWAY #57. Layouts differ structurally; all actions and fixtures live in memory.
import * as React from 'react';
const h = React.createElement;
const issueUrl = 'https://github.com/wozhendeshifwa/matt_pocock_plugin/issues/57';
const variants = { A: '详情内联', B: '底部动作栏', C: '分步面板' };
const skills = ['implement-spec','retro','pr','code-review','prototype','grill-with-docs','grilling','research','triage','diagnosing-bugs','tdd','to-spec','to-tickets','wayfinder','domain-modeling','codebase-design','writing-for-agents','ask-matt','setup-matt-pocock-skills','improve-codebase-architecture','grill-me','handoff','teach','to-questionnaire','wait-what','wizard','implement'];
const cases = {
  prototype: { title: '确认技能按钮布局、推荐与草稿预览交互', labels: ['wayfinder:prototype'], skill: 'prototype', action: '制作交互原型', why: '原型票：先回答设计问题，再由用户反馈确定取舍。', scope: '仅本票交互原型；关联地图不扩大范围', refs: '#54 地图 · #60 动作策略 · #61 上下文规则', missing: [], body: '选定动作及上下文规则在插件现有界面中应如何呈现，才能容易发现并清楚知道点击结果？\n\n覆盖窄侧栏、无适用动作、上下文不完整及三个草稿出口。\n\n仅服务于交互决策，经用户反馈后确定方案。' },
  implement: { title: '实施技能动作与上下文注入（模拟票）', labels: ['ready-for-agent','wayfinder:task'], skill: 'implement-spec', action: '按规格实施', why: '代码任务已就绪；执行单位为明确的一份规格及关联实施票图。', scope: '模拟规格 P-01 及其实施票 P-02/P-03', refs: 'P-01 规格 · P-02 → P-03 依赖图（均为模拟）', missing: [], body: '目标规格及关联实施票已明确。\n\n本页仅展示交互，不实际实施产品。', extra: true },
  missing: { title: '实施范围尚未明确（模拟票）', labels: ['ready-for-agent','wayfinder:task'], skill: 'implement-spec', action: '查证实施范围', why: '已知代码任务，尚不能确定目标规格及票图。', scope: '先定位目标规格及关联实施票；不直接实施', refs: '仅已知本票', missing: ['目标规格','关联实施票及依赖范围'], body: '请完善技能动作。\n\n规格及实施范围尚未确定，先查证原始来源；不能默认接管整张地图。' },
  bug: { title: '操作后卡住，缺少复现信息（模拟票）', labels: ['needs-info','bug'], skill: 'grilling', action: '补齐故障信息', why: 'needs-info 限制当前动作：先查事实，必要时再询问。', scope: '查证现有故障证据，补齐缺口后回到分流', refs: '本票及原始记录', missing: ['复现条件','原始错误记录'], body: '用户报告界面卡住，尚无可靠复现证据。\n\n当前动作不是直接修复，也不因 bug 标签跳过补信息。' },
  none: { title: '已决定不做的功能（模拟票）', labels: ['wontfix','bug'], skill: null, action: null, why: '已决定不做：默认不提供实施动作。', scope: '不启动实施；重评需明确提出', refs: '本票不做原因', missing: [], body: '该需求目前不在项目范围内。\n\n保留不做原因。用户明确要求重新评估时才分流。' },
  pr: { title: '为已有 PR 起草修订正文（模拟票）', labels: ['wayfinder:task'], skill: 'pr', action: '撰写 PR 正文', why: '存在明确 PR 及改动范围，可起草正文；验证记录仍有缺口。', scope: '模拟 PR P-12 的正文修订草稿', refs: 'P-12 PR · PR 目标分支及实际 diff（模拟）', missing: ['验证记录未取得，正文须如实标注'], body: '已有 PR 及明确的改动范围。\n\n缺验证记录不阻止起草，但必须记录缺口。发布、推送和合并另需明确指令。', evidenceOnly: true },
  retro: { title: '排障结束，复盘会话尚未定位（模拟票）', labels: ['wayfinder:task'], skill: 'retro', action: '定位复盘会话', why: '排障阶段已结束，但目标编码会话及原始记录待查证。', scope: '先查关联编码会话及原始记录，不默认当前规划聊天', refs: '本票关联记录', missing: ['目标编码会话','可追溯原始记录'], body: '排障阶段结束，需要复盘环境改进机会。\n\n先定位原始编码会话，多候选无法确定再询问。' },
  conflict: { title: '地图与任务角色冲突（模拟票）', labels: ['wayfinder:map','wayfinder:task'], skill: 'grilling', action: '确认任务层级', why: '地图与具体任务角色冲突，先查证并确认层级。', scope: '仅确认本票角色，不推进整个地图', refs: '本票及父子关系', missing: ['地图或具体任务的角色'], body: '同一票同时标有 map 与 task。\n\n不能按固定优先级静默选择任务层级。' }
};
const sourceStates = {
  host: '宿主项目来源 · 已解析（模拟）；加载和执行尚未验证',
  unknown: '来源待确认 · 先查证当前宿主为项目解析的版本',
  fallback: '宿主不可用 · 完整随包正文及引用可读，可只读备用；不代表宿主已加载',
  failed: '更新失败 · 保留现有可用技能；未确认最新',
  unavailable: '安装失败且无合格备用 · 暂停依赖步骤',
  tools: '必要工具或引用缺失 · 暂停依赖步骤'
};
const button = (text, onClick, props = {}) => h('button', { type: 'button', className: 'dsws-btn', onClick, ...props }, text);
function requestFor(c, selected) {
  if (!selected) return '';
  const shared = `读取 ${issueUrl} 的最新正文、关系及必要来源；优先使用 deck_ 工具，及时 deck_issue_report，结束前将真实状态写入正文。遵循技能自身规则，有实质需求缺口先澄清。`;
  return `$${selected}\n\n目标：${selected === c.skill ? c.action : '手动使用所选技能，先核实是否适用于当前任务'}。\n范围：${c.scope}。\n来源：${c.refs}。\n${c.missing.length ? `待查证：${c.missing.join('；')}。${c.evidenceOnly ? '缺验证证据如实标注，仍可起草。' : '先查证并补齐前置条件，满足后才继续。'}\n` : ''}${shared}`;
}
function ContextView({ m }) {
  const c = m.contextCase || m.c;
  return h('div', { className: 'p57-context' },
    h('strong', null, '本次任务'), h('p', null, c.scope),
    h('div', { className: 'p57-muted' }, '必要来源：' + c.refs),
    c.missing.length ? h('div', { className: 'p57-notice', role: 'status' }, h('strong', null, c.evidenceOnly ? '证据缺口' : '需要先查证'), h('p', null, c.missing.join(' · ')), '草稿会要求先查原始来源；无法自行确定时再询问。') : null,
    h('div', { className: 'p57-source', role: 'status' }, h('strong', null, '技能来源与更新'), h('p', null, sourceStates[m.source]), h('small', null, '自动管理限本插件技能；仅新版模板。此处状态为模拟。')));
}
function ActionPicker({ m }) {
  return h('div', { className: 'p57-picker' },
    m.c.action ? button(m.c.action, () => m.choose(m.c.skill), { className: 'dsws-btn primary', 'aria-pressed': m.selected === m.c.skill }) : h('strong', null, '无适用主动作'),
    h('p', { className: 'p57-muted' }, m.c.why),
    m.c.extra ? h('div', { className: 'p57-supplement' }, h('small', null, '补充动作（模拟上下文已具备）'), ...[['pr','撰写 PR 正文'],['code-review','审查改动'],['retro','复盘编码会话']].map(([skill,label]) => button(label, () => m.choose(skill)))) : null,
    h('label', null, '全部技能 ', h('select', { 'aria-label': '全部技能', value: m.selected || '', onChange: e => m.choose(e.target.value || null) }, h('option', { value: '' }, '手动选择技能'), ...skills.map(s => h('option', { key: s, value: s }, s)))),
    !m.c.action ? h('p', { className: 'p57-muted' }, '手动选择不会自动推翻不做决定；草稿先核实适用性。') : null);
}
function DraftView({ m }) {
  return h('div', { className: 'p57-draft' }, h('label', { htmlFor: 'p57-draft' }, '草稿预览 · 可编辑'),
    h('textarea', { id: 'p57-draft', value: m.draft, placeholder: '选择动作后生成草稿', onChange: e => m.setDraft(e.target.value) }),
    m.blocked ? h('p', { className: 'p57-notice' }, '依赖技能的步骤暂停；仍可生成查证缺口的请求。') : null,
    h('div', { className: 'p57-exits' }, ...[['active','放入当前聊天'],['new','放入新聊天'],['copy','复制草稿']].map(([target,label]) => button(label, () => m.output(target), { key: target, disabled: !m.draft.trim() }))),
    h('small', { className: 'p57-muted' }, '聊天出口仅放入可编辑草稿，由你发送；复制不执行。'),
    m.result ? h('div', { className: 'p57-result', role: 'status' }, m.result) : null);
}
export function VariantA({ m }) {
  return h('section', { className: 'p57-actions p57-inline', 'aria-label': 'A 详情内联' }, h('h3', null, '推荐动作'), h(ActionPicker, { m }), h(ContextView, { m }), h(DraftView, { m }));
}
export function VariantB({ m }) {
  return h('section', { className: 'p57-actions p57-bottom', 'aria-label': 'B 底部动作栏' },
    m.expanded ? h('div', { className: 'p57-sheet' }, h('div', { className: 'p57-row' }, h('strong', null, '动作与草稿'), button('收起', () => m.setExpanded(false))), h(ActionPicker, { m }), h(ContextView, { m }), h(DraftView, { m })) : null,
    h('div', { className: 'p57-bottom-bar' }, h('div', null, h('strong', null, m.c.action || '无适用主动作'), h('small', null, m.c.missing.length ? '上下文待查证' : '点击后预览草稿')), button('选择动作 / 预览', () => { m.setExpanded(!m.expanded); }, { className: 'dsws-btn primary' })));
}
export function VariantC({ m }) {
  const names = ['选择动作', '核对上下文', '草稿与出口'];
  return h('section', { className: 'p57-actions p57-steps', 'aria-label': 'C 分步面板' },
    h('nav', { className: 'p57-step-nav', 'aria-label': '草稿步骤' }, ...names.map((name,i) => button(`${i+1} ${name}`, () => m.setStep(i), { key: name, 'aria-current': m.step === i ? 'step' : undefined, disabled: i > 0 && !m.selected }))),
    m.step === 0 ? h(ActionPicker, { m }) : m.step === 1 ? h(ContextView, { m }) : h(DraftView, { m }),
    h('div', { className: 'p57-row' }, button('上一步', () => m.setStep(m.step-1), { disabled: m.step === 0 }), button(m.step === 0 ? '核对上下文 →' : '预览草稿 →', () => m.setStep(m.step+1), { disabled: m.step === 2 || !m.selected })));
}
function PrototypeSwitcher({ variant, change }) {
  if (process.env.NODE_ENV === 'production') return null;
  const keys = Object.keys(variants);
  const cycle = delta => change(keys[(keys.indexOf(variant)+delta+3)%3]);
  React.useEffect(() => {
    const key = e => {
      if (e.target.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])')) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); cycle(e.key === 'ArrowLeft' ? -1 : 1); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [variant]);
  return h('nav', { className: 'p57-switcher', 'aria-label': '原型变体切换' }, button('←', () => cycle(-1), { 'aria-label': '上一个变体' }), h('strong', { 'aria-live': 'polite' }, `${variant} · ${variants[variant]}`), button('→', () => cycle(1), { 'aria-label': '下一个变体' }));
}
function ActionSlot() {
  const { m, variant } = window.Issue57Model;
  return h({ A:VariantA, B:VariantB, C:VariantC }[variant], { m });
}
window.Issue57ActionSlot = ActionSlot;
export function SkillActionsPrototype({ OriginalDetail }) {
  const params = new URLSearchParams(location.search);
  const [variant, setVariant] = React.useState(variants[params.get('variant')] ? params.get('variant') : 'A');
  const [scenario, setScenario] = React.useState(cases[params.get('case')] ? params.get('case') : 'prototype');
  const [source, setSource] = React.useState('host');
  const [width, setWidth] = React.useState(460);
  const [dark, setDark] = React.useState(false);
  const [selected, setSelected] = React.useState(null);
  const [draft, setDraft] = React.useState('');
  const [step, setStep] = React.useState(0);
  const [expanded, setExpanded] = React.useState(false);
  const [result, setResult] = React.useState('');
  const [lastOutput, setLastOutput] = React.useState(null);
  const c = cases[scenario];
  const blocked = source === 'unavailable' || source === 'tools';
  const reset = () => { setSelected(null); setDraft(''); setStep(0); setExpanded(false); setResult(''); setLastOutput(null); };
  const changeVariant = value => { const url = new URL(location); url.searchParams.set('variant',value); history.replaceState(null,'',url); setVariant(value); setResult(''); };
  const contextFor = skill => c.extra && skill === 'pr' ? cases.pr : c.extra && skill === 'retro' ? { ...cases.retro, action:'复盘编码会话', missing:[], scope:'模拟编码会话 S-01 的排障阶段', refs:'S-01 原始编码记录（模拟，非当前规划聊天）' } : c.extra && skill === 'code-review' ? { ...c, skill:'code-review', action:'审查改动', scope:'模拟分支 feature/prompt 相对基线 BASE-01 的改动', refs:'BASE-01 基线 · feature/prompt · P-01 规格 · 仓库标准（模拟）', missing:[] } : c;
  const contextCase = contextFor(selected);
  const choose = skill => { setSelected(skill); setDraft(requestFor(contextFor(skill),skill)); setResult(''); setLastOutput(null); };
  const output = target => {
    const prefix = blocked ? `技能依赖步骤已暂停。先查证并补齐${source === 'tools' ? '必要工具或引用' : '可用技能来源'}；不执行依赖步骤。\n\n` : '';
    const text = prefix + draft;
    // Simulate all three exits, including clipboard. Nothing leaves the page.
    setLastOutput({target,text,send:false,simulated:true});
    setResult(target === 'copy' ? '模拟：草稿已放入内存剪贴板，可在下方状态中查看。' : `模拟：已放入${target === 'active' ? '当前' : '新'}聊天输入框，等待用户发送。`);
  };
  const m = { c, contextCase, source, blocked, selected, choose, draft, setDraft, output, step, setStep, expanded, setExpanded, result };
  // Upstream renders this slot between its original labels and body.
  window.Issue57Model = { m, variant };
  const detail = { number:57, title:c.title, state:'OPEN', labels:c.labels.map(name=>({name,color:'8250df'})), assignees:[], body:c.body, updatedAt:'2026-11-26T07:00:00Z' };
  const state = { variant,scenario,viewportWidth:width,source,sourceDescription:sourceStates[source],selectedSkill:selected,step:variant==='C'?step:null,sheetExpanded:variant==='B'?expanded:null,task:{target:issueUrl,scope:contextCase.scope,refs:contextCase.refs,missing:contextCase.missing},draft,blocked,lastOutput,persistence:'memory only' };
  React.useEffect(() => { console.info('#57 prototype state',state); }, [variant,scenario,width,source,selected,step,expanded,draft,lastOutput]);
  return h('div', { className: 'p57-lab' },
    h('header', { className: 'p57-lab-header' }, h('strong', null, '#57 抛弃式交互原型'), h('p', null, '问题：哪种动作布局让你容易发现下一步，并看清点击结果？'), h('small', null, '原版 Issue 详情 + 局部动作变体 · 所有案例/来源/出口均为模拟 · 未连接真实宿主')),
    h('section', { className: 'p57-controls', 'aria-label': '原型场景控制' },
      h('label', null, '场景 ', h('select', { value:scenario, onChange:e=>{setScenario(e.target.value);const url=new URL(location);url.searchParams.set('case',e.target.value);history.replaceState(null,'',url);reset();} }, ...Object.entries(cases).map(([id,item])=>h('option',{key:id,value:id},item.title)))),
      h('label', null, '技能状态 ', h('select', { value:source, onChange:e=>{setSource(e.target.value);setLastOutput(null);setResult('');} }, ...Object.entries(sourceStates).map(([id,text])=>h('option',{key:id,value:id},text)))),
      h('label', null, '侧栏宽度 ', h('select', { value:width, onChange:e=>setWidth(Number(e.target.value)) }, ...[320,380,460,620].map(w=>h('option',{key:w,value:w},w+' px')))),
      button(dark?'切换浅色':'切换深色',()=>{setDark(!dark);document.documentElement.dataset.theme=dark?'light':'dark';}), button('重置本场景',reset)),
    h('div', { className: 'p57-workbench' },
      h('div', { className: 'p57-panel', style:{'--p57-width':width+'px',width}, 'data-variant':variant }, h(OriginalDetail,{issue:detail})),
      h('aside', { className: 'p57-inspector' }, h('h3',null,'完整相关状态 · 实时'), h('p',null,'切换布局保留当前选择和编辑；切换场景清空草稿。三出口为模拟，复制内容见 lastOutput.text。'), h('pre',{'data-prototype-state':true},JSON.stringify(state,null,2)))),
    h(PrototypeSwitcher,{variant,change:changeVariant}));
}
