// Direct request consumer. Legacy editable drafts remain separate until their
// recovery entry and final panel removal land in the following slices.
export function DirectIssueActions({ st, issue, colorHex, narrow }) {
  const state = actionDraftState(st, issue.number, issue.effortId || '');
  const operations = ctx.get('draftOperations');
  React.useSyncExternalStore(operations.subscribe, operations.getSnapshot);
  const pending = operations.pending;
  const feedback = state.directFeedback || {};
  const status = feedback.status || '';
  const recovery = feedback.recovery;
  const update = next => { state.directFeedback = { ...(state.directFeedback || {}), ...next }; operations.changed(); };
  const actions = ctx.get('codexActions');
  const available = canFillIssueActionDraft(actions, 'active');
  const newAvailable = canFillIssueActionDraft(actions, 'new');
  const run = async (target, requestOverride, regenerate = false, pinnedIdentity) => {
    if (target === 'copy' && (pending || feedback.retry) && state.directRequest && (!requestOverride || requestOverride.text === state.directRequest.baseText)) {
      try { await sendIssueActionDraft(st, 'copy', state.directRequest.text); state.directCopyNote = '已复制'; }
      catch (error) { state.directCopyNote = '复制失败：' + String(error.message || error); }
      operations.changed();
      return;
    }
    const token = target === 'copy' ? null : operations.begin();
    if (target !== 'copy' && !token) return;
    if (target === 'copy') { state.directCopyNote = '正在准备复制…'; operations.changed(); }
    else { state.directCopyNote = ''; update({ status: '正在核验来源…', retry: null, retryConfirmed: false }); }
    let expectedIdentity;
    try {
      expectedIdentity = target === 'copy' ? undefined : pinnedIdentity || actions?.captureTarget?.();
      const preparation = ctx.get('requestPreparation');
      if (!preparation) throw new Error('来源准备能力不可用，请补齐后重试');
      const clickedIssue = state.latestActionIssue || issue;
      const request = requestOverride || issueActionRequest(clickedIssue, issueUrlFor(st, issue.number, issue.effortId || '') || '#' + issue.number);
      const cacheKey = target === 'copy' ? 'directCopyRequest' : 'directRequest';
      if (regenerate) { state[cacheKey] = null; update({ recovery: null }); }
      let candidate = state[cacheKey];
      if (target === 'copy' && !regenerate && !candidate && state.directRequest?.baseText === request.text) candidate = state.directRequest;
      if (!candidate || candidate.baseText !== request.text || candidate.preparation !== preparation) {
        const candidate = await preparation.prepare({ text: request.text });
        state[cacheKey] = { ...candidate, baseText: request.text, preparation };
      } else {
        state[cacheKey] = candidate;
      }
      candidate = state[cacheKey];
      const checked = await preparation.check({ draftId: candidate.id, text: candidate.text });
      if (checked.dependenciesAllowed !== true) throw new Error('必要来源、工具或资料未核验，请先补齐；本次填入已停止');
      if (checked.allowed !== true || checked.status !== 'unchanged' || checked.dependenciesAllowed !== true) {
        if (checked.dependenciesAllowed === true && (target !== 'copy' || !pending && !feedback.retry)) update({ recovery: { target, requestOverride, expectedIdentity } });
        throw new Error('技能来源或必要条件已变化，请核对后重新生成；本次出口已停止');
      }
      if (!requestOverride) {
        const reply = await ctx.get('connection').rpc.call('/api', 'dsws', { method: 'issueDetail', payload: { number: issue.number, effortId: issue.effortId || '', cwd: st.cwd } });
        const fresh = reply?.ok === true ? reply.value : null;
        const latest = fresh?.issue || fresh?.value?.issue;
        if (fresh?.ok !== true || latest?.number !== issue.number) throw new Error('无法重新核验推荐动作，请刷新后重试');
        const latestRequest = issueActionRequest(latest, issueUrlFor(st, issue.number, issue.effortId || '') || '#' + issue.number);
        const actionKey = value => JSON.stringify([value.kind, value.skill, value.goal]);
        if (actionKey(latestRequest) !== actionKey(request)) {
          state.latestActionIssue = latest;
          if (target === 'copy') { state.directCopyNote = '推荐动作已更新，请再次点击后按最新动作生成并复制。'; operations.changed(); }
          else update({ status: '推荐动作已更新，请再次点击后按最新动作生成并填入。', retry: null, recovery: null });
          return;
        }
      }
      const result = await sendIssueActionDraft(st, target, candidate.text, { expectedIdentity, operationToken: token });
      if (target === 'copy') { state.directCopyNote = '已复制'; operations.changed(); }
      else update({ status: result.status === 'filled' ? (target === 'new' ? '已填入新聊天' : '已填入当前聊天') : '已请求，请检查输入框后发送', retry: null, recovery: null });
    } catch (error) {
      if (target === 'copy') { state.directCopyNote = '复制已停止：' + String(error.message || error); operations.changed(); }
      else update({ status: error.code === 'draft-result-unknown' ? '无法确认是否填入，请先检查输入框。生成文本已保留。' : '操作失败：' + String(error.message || error) + (state.directRequest ? '。生成文本已保留。' : ''), retry: { target, requestOverride, expectedIdentity, unknown: error.code === 'draft-result-unknown' } });
    } finally {
      if (token) operations.end(token);
    }
  };
  return React.createElement('span', { 'data-issue-direct-actions': true, style: { display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 4, minWidth: 0 } }, [
    React.createElement('button', { key: 'active', type: 'button', className: 'dsws-btn primary', 'aria-label': '填入当前聊天', disabled: pending || !available, title: available ? '追加到可编辑输入框，不会自动发送' : actions?.capabilities?.reason || '当前聊天填入不可用，请主动选择复制', onClick: e => { e.stopPropagation(); run('active'); }, style: { background: colorHex, fontSize: 11 } }, '填入当前聊天'),
    React.createElement('button', { key: 'new', type: 'button', className: 'dsws-btn', 'aria-label': '填入新聊天', disabled: pending || !newAvailable, title: newAvailable ? '沿用来源项目及实际目录打开可编辑新草稿，不会自动发送' : actions?.capabilities?.newReason || actions?.capabilities?.reason || '新聊天填入不可用，请主动选择复制', onClick: e => { e.stopPropagation(); run('new'); }, style: { fontSize: 11 } }, '填入新聊天'),
    React.createElement('button', { key: 'copy', type: 'button', className: 'dsws-btn ghost', onClick: e => { e.stopPropagation(); run('copy'); }, style: { fontSize: 11 } }, '复制'),
    React.createElement(MoreIssueActions, { key: 'more-' + actionDraftKey(st, issue.number, issue.effortId || ''), st, issue, pending, run }),
    recovery ? React.createElement('button', { key: 'regenerate', type: 'button', className: 'dsws-btn', disabled: pending, onClick: e => { e.stopPropagation(); run(recovery.target, recovery.requestOverride, true, recovery.expectedIdentity); } }, '按最新来源重新生成并填入') : null,
    feedback.retry ? React.createElement('button', { key: 'retry', type: 'button', className: 'dsws-btn', disabled: pending, onClick: e => {
      e.stopPropagation();
      if (feedback.retry.unknown && !feedback.retryConfirmed) { update({ retryConfirmed: true, status: '请先检查原目标输入框，避免重复追加或重复创建新聊天；检查后再重试。' }); return; }
      run(feedback.retry.target, feedback.retry.requestOverride, false, feedback.retry.expectedIdentity);
    } }, feedback.retry.unknown && feedback.retryConfirmed ? '已检查输入框，重试' : '重试') : null,
    React.createElement('span', { key: 'status', role: 'status', 'aria-live': 'polite', style: { fontSize: 11, overflowWrap: 'anywhere' } }, [status || [!available ? (actions?.capabilities?.reason || '当前聊天填入不可用') + '；可主动选择复制。' : '', !newAvailable ? (actions?.capabilities?.newReason || '新聊天填入能力不可用') + '；可主动选择复制。' : ''].filter(Boolean).join(' '), state.directCopyNote || ''].filter(Boolean).join(' ')),
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
  for (let index = 0; index < lines.length; index++) {
    if (lines[index].includes('openInNewSession(st,') && lines[index].includes("tr('list.newSessionLabel')")) {
      lines[index] = lines[index].replaceAll("tr('list.newSessionLabel')", "'旧草稿预览'")
        .replace(/tr\('tip\.newSession',\s*\{[^}]*\}\)/g, "'旧草稿预览（兼容入口）'");
    }
  }
  const detail = lines.findIndex(line => line.includes("h(Tip, { content: primaryInfo.tip }") && line.includes('previewIssueAction(st, fakeIssue)'));
  if (detail < 0) throw new Error('Direct Issue primary boundary changed');
  lines[detail] = "            h(DirectIssueActions, { key: 'direct', st: st, issue: fakeIssue, colorHex: actColor }),";
  return lines.join('\n');
}
