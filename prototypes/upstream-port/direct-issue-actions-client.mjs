// Direct request consumer. Legacy editable drafts remain separate until their
// recovery entry and final panel removal land in the following slices.
export function DirectIssueActions({ st, issue, colorHex, narrow }) {
  const state = actionDraftState(st, issue.number, issue.effortId || '');
  const [status, setStatus] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const alive = React.useRef(true);
  React.useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const actions = ctx.get('codexActions');
  const available = canFillIssueActionDraft(actions, 'active');
  const run = async target => {
    if (pending) return;
    setPending(true);
    setStatus('正在核验来源…');
    try {
      const preparation = ctx.get('requestPreparation');
      if (!preparation) throw new Error('来源准备能力不可用，请补齐后重试');
      const request = issueActionRequest(issue, issueUrlFor(st, issue.number, issue.effortId || '') || '#' + issue.number);
      if (!state.directRequest || state.directRequest.baseText !== request.text) {
        const candidate = await preparation.prepare({ text: request.text });
        state.directRequest = { ...candidate, baseText: request.text };
      }
      const candidate = state.directRequest;
      if (candidate.dependenciesAllowed !== true) throw new Error('必要来源、工具或资料未核验，请先补齐；本次填入已停止');
      const checked = await preparation.check({ draftId: candidate.id, text: candidate.text });
      if (checked.allowed !== true || checked.status !== 'unchanged' || checked.dependenciesAllowed !== true) {
        throw new Error('技能来源或必要条件已变化，请核对后重新生成；本次出口已停止');
      }
      if (!alive.current) return;
      const result = await sendIssueActionDraft(st, target, candidate.text);
      if (!alive.current) return;
      setStatus(target === 'copy' ? '已复制' : result.status === 'filled' ? '已填入当前聊天' : '已请求，请检查输入框后发送');
    } catch (error) {
      if (alive.current) setStatus(error.code === 'draft-result-unknown' ? '无法确认是否填入，请先检查输入框。生成文本已保留。' : '操作失败：' + String(error.message || error) + '。生成文本已保留。');
    } finally {
      if (alive.current) setPending(false);
    }
  };
  return React.createElement('span', { 'data-issue-direct-actions': true, style: { display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 4, minWidth: 0 } }, [
    React.createElement('button', { key: 'active', type: 'button', className: 'dsws-btn primary', 'aria-label': '填入当前聊天', disabled: pending || !available, title: available ? '追加到可编辑输入框，不会自动发送' : actions?.capabilities?.reason || '当前聊天填入不可用，请主动选择复制', onClick: e => { e.stopPropagation(); run('active'); }, style: { background: colorHex, fontSize: 11 } }, '填入当前聊天'),
    React.createElement('button', { key: 'copy', type: 'button', className: 'dsws-btn ghost', disabled: pending, onClick: e => { e.stopPropagation(); run('copy'); }, style: { fontSize: 11 } }, '复制'),
    React.createElement('span', { key: 'status', role: 'status', 'aria-live': 'polite', style: { fontSize: 11, overflowWrap: 'anywhere' } }, status || (!available ? (actions?.capabilities?.reason || '当前聊天填入不可用') + '；可主动选择复制。' : '')),
  ]);
}

export function adaptDirectIssueActions(source) {
  const insert = 'const IssueDetail = function (props) {';
  if (source.split(insert).length !== 2) throw new Error('Direct Issue detail boundary changed');
  source = source.replace(insert, DirectIssueActions.toString() + '\n' + insert);
  const rowStart = source.indexOf('const mkRowAction = function');
  const rowReturn = source.indexOf('return h(Tip, { content: tipByLabel }', rowStart);
  const rowEnd = source.indexOf('      // v21：技能命令', rowReturn);
  if (rowStart < 0 || rowReturn < 0 || rowEnd < 0) throw new Error('Direct Issue row boundary changed');
  source = source.slice(0, rowReturn) + "return h(DirectIssueActions, { st: st, issue: x, colorHex: colorHex, narrow: narrow })\n      }\n" + source.slice(rowEnd);
  const lines = source.split('\n');
  const detail = lines.findIndex(line => line.includes("h(Tip, { content: primaryInfo.tip }") && line.includes('previewIssueAction(st, fakeIssue)'));
  if (detail < 0) throw new Error('Direct Issue primary boundary changed');
  lines[detail] = "            h(DirectIssueActions, { key: 'direct', st: st, issue: fakeIssue, colorHex: actColor }),";
  return lines.join('\n');
}
