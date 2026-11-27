// Shared identity retains pre-upgrade text/context without an editor or new store.
function actionDraftKey(st, number, effortId) {
  const snapshot = st.snapshot || {};
  const project = String(snapshot.workspaceRoot || st.cwd || '').replace(/\\/g, '/').replace(/\/+$/, '');
  const projectKey = /^[A-Za-z]:/.test(project) ? project.toLowerCase() : project;
  const repository = snapshot.repository || {};
  return JSON.stringify([projectKey, snapshot.selection?.backendId || repository.backend || '', repository.refId || repository.name || repoStr(st), effortId || '', String(number)]);
}

function actionDraftState(st, number, effortId) {
  const drafts = ctx.get('actionDrafts');
  const key = actionDraftKey(st, number, effortId);
  if (!drafts.has(key)) drafts.set(key, {});
  return drafts.get(key);
}

// Final A: actions follow detail content in normal flow; editing belongs to the host.
export function adaptBottomActionBar(source) {
  const anchor = 'const IssueDetail = function (props) {';
  if (source.split(anchor).length !== 2) throw new Error('Issue footer boundary changed');
  source = source.replace(anchor, actionDraftKey.toString() + '\n' + actionDraftState.toString() + '\n' + anchor);
  const footer = '        // 图片放大浮层（渲染函数共用，状态放共享 store，点缩略图打开，点空白与关闭与退出键关闭）';
  if (source.split(footer).length !== 2) throw new Error('Issue footer content boundary changed');
  return source.replace(footer, "        h('section', { 'data-bottom-action-bar': true, 'aria-label': 'Issue 动作栏', style: { marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--dsw-alias-border-l2)', minWidth: 0, flex: 'none' } }, h(DirectIssueActions, { key: actionDraftKey(st, issueNumber, issueEffort), st, issue: fakeIssue, colorHex: actColor })),\n" + footer);
}
