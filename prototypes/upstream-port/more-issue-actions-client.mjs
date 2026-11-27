// Explicit supplemental requests share the direct outlet; remembered choices
// never become the label-driven primary action.
export function MoreIssueActions({ st, issue, pending, run }) {
  const state = actionDraftState(st, issue.number, issue.effortId || '');
  const saved = state.moreAction || (state.moreAction = {
    choice: state.choice && state.choice !== 'main' ? state.choice : '',
    context: { ...(state.context || {}) },
  });
  // Pre-upgrade fields can have been edited after the first menu render.
  // Preserve explicit supplemental values while recovering untouched fields.
  saved.context = { ...(state.context || {}), ...(saved.context || {}) };
  const [open, setOpen] = React.useState(false);
  const [choice, setChoice] = React.useState(saved.choice);
  const [context, setContext] = React.useState(saved.context);
  const [legacyStatus, setLegacyStatus] = React.useState('');
  const [copyingLegacy, setCopyingLegacy] = React.useState(false);
  const legacyText = typeof state.text === 'string' ? state.text : '';
  const copyLegacy = async () => {
    if (copyingLegacy || !legacyText.length) return;
    setCopyingLegacy(true);
    try {
      await navigator.clipboard.writeText(legacyText);
      setLegacyStatus('已复制旧草稿原文');
    } catch (error) {
      setLegacyStatus('旧草稿复制失败：' + String(error.message || error) + '。原文已保留。');
    } finally {
      setCopyingLegacy(false);
    }
  };
  const skill = choice.replace(/^skill:/, '');
  const action = SUPPLEMENTAL_ACTIONS[skill];
  const required = action?.required || [];
  const fields = [...required, ...(skill === 'retro' ? ['stage'] : [])];
  const ready = !!choice && !supplementalRequirements(skill, context).missing.length;
  const choose = value => { saved.choice = value; setChoice(value); };
  const change = (name, value) => {
    const next = { ...context, [name]: value };
    saved.context = next;
    setContext(next);
  };
  const execute = target => {
    if (!ready || target !== 'copy' && pending) return;
    const base = issueActionRequest(issue, issueUrlFor(st, issue.number, issue.effortId || '') || '#' + issue.number);
    const selectedContext = Object.fromEntries(fields.map(name => [name, context[name] || '']));
    run(target, { ...base, skill, text: supplementalActionRequest(skill, base, selectedContext) });
  };
  const h = React.createElement;
  const actions = ctx.get('codexActions');
  return h('span', { 'data-issue-more-actions': true, onClick: e => e.stopPropagation(), style: { minWidth: 0 } }, [
    h('button', { key: 'toggle', type: 'button', className: 'dsws-btn ghost', 'aria-label': '更多动作', title: '更多动作', 'aria-expanded': String(open), onClick: () => setOpen(!open) }, h('span', { 'aria-hidden': 'true', style: { fontSize: 18, lineHeight: 1 } }, '⋯')),
    open ? h('span', { key: 'options', role: 'group', 'aria-label': '更多动作', style: { display: 'flex', flexWrap: 'wrap', gap: 4, minWidth: 0 } }, [
      legacyText.length ? h('button', { key: 'legacy-copy', type: 'button', className: 'dsws-btn ghost', disabled: copyingLegacy, onClick: copyLegacy }, '复制旧草稿原文') : null,
      legacyStatus ? h('span', { key: 'legacy-status', role: 'status', 'aria-live': 'polite' }, legacyStatus) : null,
      h('select', { key: 'choice', 'aria-label': '选择其他动作', value: choice, disabled: pending, onChange: e => choose(e.target.value), style: { maxWidth: '100%' } }, [
        h('option', { key: 'empty', value: '' }, '选择其他动作'),
        h('optgroup', { key: 'supplements', label: '补充动作' }, [
          h('option', { key: 'pr', value: 'pr' }, '撰写 PR 正文'),
          h('option', { key: 'retro', value: 'retro' }, '复盘编码会话'),
          h('option', { key: 'code-review', value: 'code-review' }, '审查改动'),
        ]),
        h('optgroup', { key: 'skills', label: '全部技能' }, CODEX_SKILL_NAMES.map(name => h('option', { key: name, value: 'skill:' + name }, '$' + name))),
      ]),
      ...fields.map(name => name === 'stage'
        ? h('select', { key: name, 'aria-label': '阶段／观察', value: context[name] || '', disabled: pending, onChange: e => change(name, e.target.value) }, ['', '成功结束', '失败结束', '中止', '反复返工', '导航困难', '工具低效'].map(value => h('option', { key: value, value }, value || '选择阶段／观察')))
        : h('input', { key: name, 'aria-label': ACTION_CONTEXT_LABELS[name], placeholder: ACTION_CONTEXT_LABELS[name], value: context[name] || '', disabled: pending, required: true, onInput: e => change(name, e.target.value), style: { minWidth: 0, maxWidth: '100%' } })),
      choice && !ready ? h('span', { key: 'missing', role: 'status' }, '请补齐：' + supplementalRequirements(skill, context).missing.join('、')) : null,
      ...[['active', '填入当前聊天'], ['new', '填入新聊天']].map(([target, label]) => h('button', { key: target, type: 'button', className: 'dsws-btn', disabled: !ready || target !== 'copy' && (pending || !canFillIssueActionDraft(actions, target)), onClick: () => execute(target) }, label)),
      h('button', { key: 'cancel', type: 'button', className: 'dsws-btn ghost', onClick: () => setOpen(false) }, '取消'),
    ]) : null,
  ]);
}

export function adaptMoreIssueActions(source) {
  const anchor = 'function DirectIssueActions(';
  if (source.split(anchor).length !== 2) throw new Error('More Issue actions boundary changed');
  return source.replace(anchor, () => MoreIssueActions.toString() + '\n' + anchor);
}
