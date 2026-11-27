// Plain generated requests go straight to the editable host draft.
export function DirectIssueActions({ st, issue, colorHex, narrow, toolbar = false }) {
  const state = actionDraftState(st, issue?.number || '', issue?.effortId || '');
  const operations = ctx.get('draftOperations');
  React.useSyncExternalStore(operations.subscribe, operations.getSnapshot);
  const pending = operations.pending;
  const update = next => {
    state.directFeedback = { ...(state.directFeedback || {}), ...next };
    operations.notice = { feedback: state.directFeedback, run, issueNumber: issue.number, scope: actionDraftKey(st, '', '') };
    operations.changed();
  };
  const actions = ctx.get('codexActions');
  const available = canFillIssueActionDraft(actions, 'active');
  const newAvailable = canFillIssueActionDraft(actions, 'new');
  const run = async (target, requestOverride, pinnedIdentity) => {
    const token = operations.begin();
    if (!token) return;
    let expectedIdentity;
    try {
      expectedIdentity = pinnedIdentity || actions?.captureTarget?.();
      const request = requestOverride || issueActionRequest(issue, issueUrlFor(st, issue.number, issue.effortId || '') || '#' + issue.number);
      state.directRequest = { baseText: request.text, text: request.text };
      update({ status: '正在填入…', retry: null, retryConfirmed: false });
      const result = await sendIssueActionDraft(st, target, request.text, { expectedIdentity, operationToken: token });
      update({ status: result.status === 'filled' ? '已填入' : '已请求填入', retry: null });
    } catch (error) {
      update({ status: error.code === 'draft-result-unknown' ? '无法确认是否填入，请先检查输入框。' : '填入失败：' + String(error.message || error), retry: { target, requestOverride, expectedIdentity, unknown: error.code === 'draft-result-unknown' } });
    } finally { operations.end(token); }
  };
  const h = React.createElement;
  const notice = operations.notice?.scope === actionDraftKey(st, '', '') ? operations.notice : null;
  React.useEffect(() => {
    if (!toolbar || !notice || notice.feedback.retry || notice.feedback.status === '正在填入…') return;
    const timer = setTimeout(() => { if (operations.notice === notice) { operations.notice = null; operations.changed(); } }, 3500);
    return () => clearTimeout(timer);
  }, [toolbar, notice]);
  if (toolbar) {
    const current = notice?.feedback;
    return h('span', { 'data-issue-toolbar-actions': '', style: { display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', gap: 4, minWidth: 0, maxWidth: '100%' } }, [
      issue ? h(MoreIssueActions, { key: actionDraftKey(st, issue.number, issue.effortId || ''), st, issue, pending, run }) : h('button', { key: 'disabled', className: 'dsws-btn', disabled: true, title: '请先打开一个 Issue', 'aria-label': '更多动作' }, '更多动作'),
      current?.status ? h('span', { key: 'toast', 'data-draft-toast': '', style: { position: 'fixed', bottom: 16, right: 16, zIndex: 1000, maxWidth: 'min(360px, calc(100vw - 32px))', boxSizing: 'border-box', padding: '8px 12px', borderRadius: 8, background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--foreground, inherit)', border: '1px solid var(--dsw-alias-border-l1)', boxShadow: '0 2px 12px #0002', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 } }, [
      current?.status ? h('span', { key: 'notice', role: 'status', 'aria-live': 'polite', style: { fontSize: 11, minWidth: 0, maxWidth: '100%', overflowWrap: 'anywhere' } }, '#' + notice.issueNumber + ' · ' + current.status) : null,
      current?.retry ? h('button', { key: 'retry', type: 'button', className: 'dsws-btn', disabled: pending, onClick: e => {
        e.stopPropagation();
        if (current.retry.unknown && !current.retryConfirmed) {
          current.retryConfirmed = true; current.status = '请先检查原目标输入框，避免重复填入。'; operations.changed(); return;
        }
        notice.run(current.retry.target, current.retry.requestOverride, current.retry.expectedIdentity);
      } }, current.retry.unknown && current.retryConfirmed ? '已检查输入框，重试' : '重试') : null,
      h('button', { key: 'close', className: 'dsws-btn ghost', 'aria-label': '关闭提示', onClick: () => { operations.notice = null; operations.changed(); } }, '×'),
      ]) : null,
    ]);
  }
  return h('span', { 'data-issue-direct-actions': true, style: { display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', gap: 4, minWidth: 0, maxWidth: '100%' } }, [
    h('button', { key: 'active', type: 'button', className: 'dsws-btn primary', 'aria-label': '填入当前聊天', disabled: pending || !available, title: available ? '填入当前聊天，不会自动发送' : actions?.capabilities?.reason || '当前聊天不可用', onClick: e => { e.stopPropagation(); run('active'); }, style: { background: colorHex, fontSize: 11, padding: '2px 6px' } }, pending ? '填入中…' : '填入当前聊天'),
    h('button', { key: 'new', type: 'button', className: 'dsws-btn', 'aria-label': '填入新聊天', disabled: pending || !newAvailable, title: newAvailable ? '填入新聊天，沿用来源项目及实际目录，不会自动发送' : actions?.capabilities?.newReason || actions?.capabilities?.reason || '新聊天不可用', onClick: e => { e.stopPropagation(); run('new'); }, style: { fontSize: 11, padding: '2px 6px' } }, '填入新聊天'),
  ]);
}

export function adaptDirectIssueActions(source) {
  const insert = 'const IssueDetail = function (props) {';
  if (source.split(insert).length !== 2) throw new Error('Direct Issue detail boundary changed');
  source = source.replace(insert, DirectIssueActions.toString() + '\n' + insert);
  // Let the two compact draft buttons wrap when a narrow row needs it.
  for (const before of [
    "h('div', { style: { display: 'flex', alignItems: 'center', gap: 3, flex: 'none', marginLeft: 'auto' } }, [",
    "t.state === 'OPEN' ? h('div', { style: { display: 'flex', gap: 4, alignItems: 'center', flex: 'none' } }, [",
  ]) {
    if (source.split(before).length !== 2) throw new Error('Direct Issue row sizing boundary changed');
    source = source.replace(before, before.replace("flex: 'none'", "flex: '0 1 auto', minWidth: 0, maxWidth: '100%', whiteSpace: 'normal'"));
  }
  const rowStart = source.indexOf('const mkRowAction = function');
  const rowReturn = source.indexOf('return h(Tip, { content: tipByLabel }', rowStart);
  const rowEnd = source.indexOf('      // v21：技能命令', rowReturn);
  if (rowStart < 0 || rowReturn < 0 || rowEnd < 0) throw new Error('Direct Issue row boundary changed');
  source = source.slice(0, rowReturn) + "return h(DirectIssueActions, { st: st, issue: x, colorHex: colorHex, narrow: narrow })\n      }\n" + source.slice(rowEnd);
  const lines = source.split('\n');
  // Remove the retired preview controls from every upstream list/detail variant.
  let retiredEntries = 0, retiredMapEntries = 0;
  for (let index = 0; index < lines.length; index++) {
    if (lines[index].includes('openInNewSession(st,') && lines[index].includes("tr('list.newSessionLabel')")) {
      retiredEntries++;
      if (lines[index].includes('isOpen && !blocked')) {
        lines[index] = "            isOpen && !blocked ? h('div', { style: { minWidth: 0 } }, mkRowAction(st,x,narrow,colorOf)) : null,";
      } else lines[index] = '';
    }
    if (lines[index].includes("h(Tip, { content: tr('map.newSessionTitle') }")) {
      retiredMapEntries++;
      lines.splice(index, 4); index--;
    }
  }
  if (retiredEntries !== 4 || retiredMapEntries !== 1) throw new Error('Retired Issue preview controls changed');
  const detail = lines.findIndex(line => line.includes("h(Tip, { content: primaryInfo.tip }") && line.includes('inject(st, primaryInfo.text)'));
  if (detail < 0) throw new Error('Direct Issue primary boundary changed');
  lines[detail] = "";
  if (lines.filter(line => line.includes("tr('tip.copyLink')")).length !== 3) throw new Error('Issue link clipboard boundary changed');
  source = lines.filter(line => !line.includes("tr('tip.copyLink')")).join('\n');
  const legacyStart = source.indexOf('const openInNewSession = function (st, x) {');
  const legacyEnd = source.indexOf('// 彻底移除：extractIssueRefs', legacyStart);
  if (legacyStart < 0 || legacyEnd < 0) throw new Error('Retired Issue preview boundary changed');
  source = source.slice(0, legacyStart) + source.slice(legacyEnd);
  // The old shim is not exposed; all Issue entry points use DirectIssueActions.
  return source;
}
