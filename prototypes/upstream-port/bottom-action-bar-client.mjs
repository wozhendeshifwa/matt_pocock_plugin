// Keep layout adaptation separate from the action and context policy owners.
export function adaptBottomActionBar(source) {
  source = source.replace(/\r\n/g, '\n');
  const once = (before, after) => {
    if (source.split(before).length !== 2) throw new Error('Bottom action bar boundary changed: ' + before.slice(0, 90));
    source = source.replace(before, () => after);
  };
  once('function showIssueActionDraft(request, send) {', 'function showIssueActionDraft(request, send, options = {}) {\n  options.state = options.state || {};\n  let review;');
  once("  document.querySelector('[data-issue-action-preview]')?.remove();", "  if (!options.container) document.querySelector('[data-issue-action-preview]')?.remove();");
  once("  panel.setAttribute('role', 'dialog');", "  panel.setAttribute('role', options.container ? 'group' : 'dialog');");
  once('  editor.value = text;', "  editor.value = text + (options.sourceNotice ? '\\n\\n' + options.sourceNotice : '');");
  once("  let previousChoice = 'main', generated = text;", "  let previousChoice = 'main', generated = editor.value;");
  once("  choice.addEventListener('change', regenerate);", `  if (options.state && options.state.text !== undefined) {
    editor.value = options.state.text;
    generated = options.state.generated;
    choice.value = options.state.choice || 'main';
    previousChoice = choice.value;
    options.sourceNotice = options.state.sourceNotice ?? options.sourceNotice;
    for (const [name, value] of Object.entries(options.state.context || {})) if (fields[name]) fields[name].value = value;
  }
  const persist = function () {
    if (!options.state) return;
    Object.assign(options.state, { text: editor.value, generated: generated, choice: previousChoice, sourceNotice: options.sourceNotice, context: readContext() });
  };
  editor.addEventListener('input', persist);
  for (const input of Object.values(fields)) { input.addEventListener('input', persist); input.addEventListener('change', persist); }
  choice.addEventListener('change', regenerate);
  choice.addEventListener('change', persist);`);
  once('  applyContext.onclick = regenerate;', '  applyContext.onclick = function () { regenerate(); persist(); };');
  once("  panel.style.cssText = 'position:fixed;inset:8%;z-index:10000;background:var(--dsw-alias-background-primary,#202127);color:var(--dsw-alias-label-primary,#eee);padding:16px;display:flex;flex-direction:column;gap:8px;overflow:auto;border:1px solid #888;border-radius:8px';", "  panel.style.cssText = options.container ? 'display:flex;flex-direction:column;gap:8px;min-width:0;overflow:auto;max-height:60vh;padding:8px;box-sizing:border-box' : 'position:fixed;inset:8%;z-index:10000;background:var(--dsw-alias-background-primary,#202127);color:var(--dsw-alias-label-primary,#eee);padding:16px;display:flex;flex-direction:column;gap:8px;overflow:auto;border:1px solid #888;border-radius:8px';");
  once('background:var(--dsw-alias-background-primary,#202127);color:var(--dsw-alias-label-primary,#eee)', 'background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#111827)');
  once("      if (target === 'close') { panel.remove(); return; }", "      if (target === 'close') { if (options.onClose) options.onClose(); else panel.remove(); return; }");
  once("        const result = await send(target, editor.value);", "        if (!await review.validate()) throw new Error('技能来源变化需先审阅；本次出口已停止');\n        const result = await send(target, editor.value);");
  once('    editor.value = generated;', "    if (options.sourceNotice) generated += '\\n\\n' + options.sourceNotice;\n    editor.value = generated;");
  once('    previousChoice = choice.value;\n  };', '    previousChoice = choice.value;\n    if (options.state) options.state.cleared = false;\n  };');
  once('  document.body.append(panel);\n  editor.focus();', "  (options.container || document.body).append(panel);\n  {\n    const sourceNote = document.createElement('p');\n    sourceNote.setAttribute('data-issue-action-source', '');\n    sourceNote.textContent = '技能来源／更新：尚未核验；技能目录可见不代表宿主已加载。使用前查证当前项目来源及更新状态。';\n    panel.insertBefore(sourceNote, editor);\n    for (const control of panel.querySelectorAll('select,input,textarea,button')) control.style.maxWidth = '100%';\n    if (!options.container) editor.focus();\n    return panel;\n  }\n  editor.focus();\n  return panel;");
  once('    panel.insertBefore(sourceNote, editor);', `    panel.insertBefore(sourceNote, editor);
    options.state.sourceNotice = options.state.sourceNotice ?? options.sourceNotice ?? '';
    review = createDraftReview({ preparation: ctx.get('requestPreparation'), panel: panel, editor: editor, note: sourceNote, state: options.state,
      getGenerated: function () { return generated; }, setGenerated: function (value) { generated = value; options.sourceNotice = options.state.sourceNotice; }, persist: persist });
    choice.addEventListener('change', function () { review.invalidate(); review.refresh(); });
    applyContext.addEventListener('click', function () { review.invalidate(); review.refresh(); });
    const refresh = document.createElement('button');
    refresh.type = 'button'; refresh.textContent = '重新核验技能来源'; refresh.onclick = function () { review.refresh(); };
    panel.insertBefore(refresh, editor);
    const clear = document.createElement('button');
    clear.type = 'button'; clear.textContent = '清空草稿'; clear.setAttribute('data-issue-action-clear', '');
    clear.onclick = function () { editor.value = ''; generated = ''; if (options.state) options.state.cleared = true; review.invalidate(); persist(); };
    panel.insertBefore(clear, editor);
    review.refresh();`);
  const preview = 'const previewIssueAction = (st, issue) => showIssueActionDraft(';
  once(preview, "const previewIssueAction = (st, issue) => {\n      if (specExecutionHeld(st, issue)) { flash(st, '依赖尚未满足，暂停执行并保留查看入口', 'warn'); return; }\n      const bottom = bottomActionControllers.get(st);\n      if (bottom) return bottom.open();\n      return showIssueActionDraft(");
  once('(target, finalText) => sendIssueActionDraft(st, target, finalText));', "(target, finalText) => { if (specExecutionHeld(st, issue)) throw new Error('依赖未满足，本次出口已停止'); return sendIssueActionDraft(st, target, finalText); }, { state: actionDraftState(st, issue.number, issue.effortId || '') });\n    };");
  const component = `
    const bottomActionControllers = new WeakMap();
    const actionDraftKey = function (st, number, effortId) {
      const snapshot = st.snapshot || {};
      const project = String(snapshot.workspaceRoot || st.cwd || '').replace(/\\\\/g, '/').replace(/\\/+$/, '');
      const projectKey = /^[A-Za-z]:/.test(project) ? project.toLowerCase() : project;
      const repository = snapshot.repository || {};
      return JSON.stringify([projectKey, snapshot.selection?.backendId || repository.backend || '', repository.refId || repository.name || repoStr(st), effortId || '', String(number)]);
    };
    const actionDraftState = function (st, number, effortId) {
      const drafts = ctx.get('actionDrafts');
      const key = actionDraftKey(st, number, effortId);
      if (!drafts.has(key)) drafts.set(key, {});
      return drafts.get(key);
    };
    const BottomActionBar = function (props) {
      const st = props.st;
      const content = React.useRef(null);
      const mounted = React.useRef(null);
      const state = actionDraftState(st, props.issue.number, props.effortId);
      const [open, setOpen] = React.useState(!!state.expanded);
      const setExpanded = function (value) { state.expanded = value; setOpen(value); };
      const request = issueActionRequest(props.issue, issueUrlFor(st, props.issue.number, props.effortId));
      const sourceNotice = '技能来源与更新状态尚未核验；执行前读取当前项目解析来源并检查更新，缺合格来源或必要工具时暂停依赖步骤，不将目录可见当作已加载。';
      const ensurePreview = function () {
        if (specExecutionHeld(st, props.issue)) return;
        if (!mounted.current && content.current) {
          mounted.current = showIssueActionDraft(request, function (target, finalText) { if (specExecutionHeld(st, props.issue)) throw new Error('依赖未满足，本次出口已停止'); return sendIssueActionDraft(st, target, finalText); }, { container: content.current, state: state, sourceNotice: sourceNotice, onClose: function () { setExpanded(false); } });
        }
      };
      React.useEffect(function () {
        if (state.expanded) ensurePreview();
        const controller = { open: function () { ensurePreview(); setExpanded(true); } };
        bottomActionControllers.set(st, controller);
        return function () { if (bottomActionControllers.get(st) === controller) bottomActionControllers.delete(st); };
      }, [st, props.issue.number, props.effortId]);
      return React.createElement('section', { 'data-bottom-action-bar': true, 'aria-label': 'Issue 动作栏', style: { marginTop: 8, padding: 8, borderTop: '1px solid var(--dsw-alias-border-l2,#444)', display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, flex: 'none', background: 'var(--dsw-alias-bg-layer-1,#fff)', color: 'var(--dsw-alias-label-primary,#111827)' } }, [
        React.createElement('div', { key: 'header', style: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, minWidth: 0 } }, [
          React.createElement('strong', { key: 'action' }, props.label || '主动作'),
          React.createElement('span', { key: 'context', style: { fontSize: 11, overflowWrap: 'anywhere', flex: '1 1 120px' } }, '当前 Issue · ' + (request.skill ? '$' + request.skill : '保持不做边界') + '；先核对上下文与缺项'),
          React.createElement('button', { key: 'toggle', type: 'button', disabled: specExecutionHeld(st, props.issue), 'data-bottom-action-toggle': true, 'aria-expanded': String(open), onClick: function () { ensurePreview(); setExpanded(!open); } }, open ? '收起动作／预览' : '选择动作／预览'),
        ]),
        React.createElement('div', { key: 'preview', ref: content, hidden: !open, style: { minWidth: 0 } }),
      ]);
    };
`;
  once('const IssueDetail = function (props) {', component + '\nconst IssueDetail = function (props) {');
  once("        // 图片放大浮层（渲染函数共用，状态放共享 store，点缩略图打开，点空白与关闭与退出键关闭）", "        h(BottomActionBar, { key: actionDraftKey(st, issueNumber, issueEffort), st: st, issue: fakeIssue, effortId: issueEffort, label: primaryInfo.label }),\n        // 图片放大浮层（渲染函数共用，状态放共享 store，点缩略图打开，点空白与关闭与退出键关闭）");
  return source;
}
