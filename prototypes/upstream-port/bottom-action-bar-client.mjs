// Keep layout adaptation separate from the action and context policy owners.
export function adaptBottomActionBar(source) {
  source = source.replace(/\r\n/g, '\n');
  const once = (before, after) => {
    if (source.split(before).length !== 2) throw new Error('Bottom action bar boundary changed: ' + before.slice(0, 90));
    source = source.replace(before, () => after);
  };
  once('function showIssueActionDraft(request, send) {', 'function showIssueActionDraft(request, send, options = {}) {');
  once("  document.querySelector('[data-issue-action-preview]')?.remove();", "  if (!options.container) document.querySelector('[data-issue-action-preview]')?.remove();");
  once("  panel.setAttribute('role', 'dialog');", "  panel.setAttribute('role', options.container ? 'group' : 'dialog');");
  once('  editor.value = text;', "  editor.value = text + (options.sourceNotice ? '\\n\\n' + options.sourceNotice : '');");
  once("  let previousChoice = 'main', generated = text;", "  let previousChoice = 'main', generated = editor.value;");
  once("  panel.style.cssText = 'position:fixed;inset:8%;z-index:10000;background:var(--dsw-alias-background-primary,#202127);color:var(--dsw-alias-label-primary,#eee);padding:16px;display:flex;flex-direction:column;gap:8px;overflow:auto;border:1px solid #888;border-radius:8px';", "  panel.style.cssText = options.container ? 'display:flex;flex-direction:column;gap:8px;min-width:0;overflow:auto;max-height:60vh;padding:8px;box-sizing:border-box' : 'position:fixed;inset:8%;z-index:10000;background:var(--dsw-alias-background-primary,#202127);color:var(--dsw-alias-label-primary,#eee);padding:16px;display:flex;flex-direction:column;gap:8px;overflow:auto;border:1px solid #888;border-radius:8px';");
  once("      if (target === 'close') { panel.remove(); return; }", "      if (target === 'close') { if (options.onClose) options.onClose(); else panel.remove(); return; }");
  once('    editor.value = generated;', "    if (options.sourceNotice) generated += '\\n\\n' + options.sourceNotice;\n    editor.value = generated;");
  once('  document.body.append(panel);\n  editor.focus();', "  (options.container || document.body).append(panel);\n  if (options.container) {\n    const sourceNote = document.createElement('p');\n    sourceNote.setAttribute('data-issue-action-source', '');\n    sourceNote.textContent = '技能来源／更新：尚未核验；技能目录可见不代表宿主已加载。使用前查证当前项目来源及更新状态。';\n    panel.insertBefore(sourceNote, editor);\n    for (const control of panel.querySelectorAll('select,input,textarea,button')) control.style.maxWidth = '100%';\n    return panel;\n  }\n  editor.focus();\n  return panel;");
  once('    panel.insertBefore(sourceNote, editor);', `    panel.insertBefore(sourceNote, editor);
    let sourceGeneration = 0;
    const refreshSource = async function () {
      if (!options.inspectSkill) return;
      const generation = ++sourceGeneration;
      const name = choice.value === 'main' ? request.skill : choice.value.replace(/^skill:/, '');
      if (!name) { sourceNote.textContent = '本动作无默认技能；保留不做边界。'; return; }
      let notice;
      try {
        const result = await options.inspectSkill(name);
        if (generation !== sourceGeneration || !panel.isConnected) return;
        if (!result || result.ok !== true) throw new Error('没有可核验来源');
        const source = result.source || {};
        notice = '技能来源：' + (source.kind === 'host-resolved' ? '当前项目宿主解析' : '随包参考') + ' ' + (result.path || source.path || '路径未提供') + '；实际加载未核验；更新状态：' + (result.update?.status || '尚未核验') + '。';
        if (result.execution?.allowed === false) notice += '必要条件未满足：' + (result.execution.reasons || ['请查证工具及资料']).join('；') + '；暂停依赖步骤。';
      } catch (error) { notice = '技能来源／更新核验失败：' + String(error.message || error) + '；执行前查证，不把目录可见当作已加载。'; }
      if (generation !== sourceGeneration || !panel.isConnected) return;
      sourceNote.textContent = notice;
      if (notice === options.sourceNotice) return;
      if (editor.value !== generated && !window.confirm('技能来源状态已变化，更新已编辑的草稿预览？取消保留原文。')) { sourceNote.textContent += ' 来源变化尚未写入预览，请重新确认。'; return; }
      if (options.sourceNotice && generated.endsWith(options.sourceNotice)) generated = generated.slice(0, -options.sourceNotice.length).trimEnd();
      options.sourceNotice = notice;
      generated += '\\n\\n' + notice;
      editor.value = generated;
    };
    choice.addEventListener('change', refreshSource);
    const refresh = document.createElement('button');
    refresh.type = 'button'; refresh.textContent = '重新核验技能来源'; refresh.onclick = refreshSource;
    panel.insertBefore(refresh, editor);
    refreshSource();`);
  const preview = 'const previewIssueAction = (st, issue) => showIssueActionDraft(';
  once(preview, "const previewIssueAction = (st, issue) => {\n      const bottom = bottomActionControllers.get(st);\n      if (bottom) return bottom.open();\n      return showIssueActionDraft(");
  once("      await actions.prefill(target, finalText);\n    });", "      await actions.prefill(target, finalText);\n    });\n    };");
  const component = `
    const bottomActionControllers = new WeakMap();
    const BottomActionBar = function (props) {
      const st = props.st;
      const content = React.useRef(null);
      const mounted = React.useRef(null);
      const [open, setOpen] = React.useState(false);
      const request = issueActionRequest(props.issue, issueUrlFor(st, props.issue.number, props.effortId));
      const sourceNotice = '技能来源与更新状态尚未核验；执行前读取当前项目解析来源并检查更新，缺合格来源或必要工具时暂停依赖步骤，不将目录可见当作已加载。';
      const ensurePreview = function () {
        if (!mounted.current && content.current) {
          mounted.current = showIssueActionDraft(request, async function (target, finalText) {
            if (typeof codexPrepareSkillUse === 'function' && !await codexPrepareSkillUse(st, finalText)) throw new Error('技能状态已变化，请重新核验来源并审阅草稿后重试；本次出口已停止');
            if (target === 'copy') { await navigator.clipboard.writeText(finalText); return; }
            const actions = ctx.get('codexActions');
            if (!actions || !actions.prefill) throw new Error('宿主草稿出口不可用，请明确选择复制');
            if (actions.capabilities?.reliableDraft !== true || actions.capabilities[target] === false) throw new Error('宿主未提供可靠的草稿读取与结果确认，请明确选择复制');
            const result = await actions.prefill(target, finalText);
            return result;
          }, { container: content.current, sourceNotice: sourceNotice, inspectSkill: async function (name) {
            const preparation = ctx.get('skillPreparation');
            const update = preparation ? await preparation.prepare(name) : null;
            const doc = await host.call('skill.readDoc', { name: name });
            return update ? Object.assign({}, doc, { update: update }) : doc;
          }, onClose: function () { setOpen(false); } });
        }
      };
      React.useEffect(function () {
        const controller = { open: function () { ensurePreview(); setOpen(true); } };
        bottomActionControllers.set(st, controller);
        return function () { if (bottomActionControllers.get(st) === controller) bottomActionControllers.delete(st); };
      }, [st, props.issue.number, props.effortId]);
      return React.createElement('section', { 'data-bottom-action-bar': true, 'aria-label': 'Issue 动作栏', style: { marginTop: 8, padding: 8, borderTop: '1px solid var(--dsw-alias-border-l2,#444)', display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, flex: 'none', background: 'var(--dsw-alias-background-primary,#202127)' } }, [
        React.createElement('div', { key: 'header', style: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, minWidth: 0 } }, [
          React.createElement('strong', { key: 'action' }, props.label || '主动作'),
          React.createElement('span', { key: 'context', style: { fontSize: 11, overflowWrap: 'anywhere', flex: '1 1 120px' } }, '当前 Issue · ' + (request.skill ? '$' + request.skill : '保持不做边界') + '；先核对上下文与缺项'),
          React.createElement('button', { key: 'toggle', type: 'button', 'data-bottom-action-toggle': true, 'aria-expanded': String(open), onClick: function () { ensurePreview(); setOpen(!open); } }, open ? '收起动作／预览' : '选择动作／预览'),
        ]),
        React.createElement('div', { key: 'preview', ref: content, hidden: !open, style: { minWidth: 0 } }),
      ]);
    };
`;
  once('const IssueDetail = function (props) {', component + '\nconst IssueDetail = function (props) {');
  once("        // 图片放大浮层（渲染函数共用，状态放共享 store，点缩略图打开，点空白与关闭与退出键关闭）", "        h(BottomActionBar, { key: String(st.cwd) + ':' + issueEffort + ':' + issueNumber, st: st, issue: fakeIssue, effortId: issueEffort, label: primaryInfo.label }),\n        // 图片放大浮层（渲染函数共用，状态放共享 store，点缩略图打开，点空白与关闭与退出键关闭）");
  return source;
}
