const names = { queued: '排队', preparing: '准备中', running: '运行中', stopping: '停止中', completed: '已完成', failed: '失败', cancelled: '已取消', interrupted: '已中断' };
const terminal = status => ['completed', 'failed', 'cancelled', 'interrupted'].includes(status);
export function createSandboxTaskView(React) {
  const h = React.createElement;
  return function SandboxTasks({ sandboxTasks: service }) {
    const [data, setData] = React.useState({ tasks: [], models: [], limit: 2 });
    const [selected, select] = React.useState(null), [detail, setDetail] = React.useState(null);
    const [tab, setTab] = React.useState('summary'), [error, setError] = React.useState('');
    const [connectionError, setConnectionError] = React.useState('');
    const [busy, setBusy] = React.useState(false), [form, setForm] = React.useState({ prompt: '', model: '', effort: 'medium', minutes: 60, check: '', source: '手填描述' });
    const [preview, setPreview] = React.useState(null), [action, setAction] = React.useState(null), [unchecked, setUnchecked] = React.useState(false);
    const [issueNumber, setIssueNumber] = React.useState(''), [limit, setLimit] = React.useState(2);
    const [diffOffset, setDiffOffset] = React.useState(0), [previousOffsets, setPreviousOffsets] = React.useState([]);
    const requestedDiffOffset = React.useRef(0);
    const mounted = React.useRef(true), selection = React.useRef(null);
    const initialized = React.useRef(false);
    selection.current = selected;
    const call = (method, input) => service.call(method, input);
    async function refresh() {
      try {
        const snapshot = await call('list');
        if (!mounted.current) return;
        setData(snapshot);
        if (!initialized.current) { initialized.current = true; setForm(current => ({ ...current, ...snapshot.preferences })); setLimit(snapshot.limit); }
        const id = selection.current;
        const offset = requestedDiffOffset.current;
        if (id) { const item = await call('detail', { id, diffOffset: offset }); if (mounted.current && selection.current === id && requestedDiffOffset.current === offset) setDetail(item); }
        if (mounted.current) setConnectionError('');
      } catch (e) { if (mounted.current) setConnectionError(`连接中断或操作失败：${e.message}。现有任务不会自动重启。`); }
    }
    React.useEffect(() => { mounted.current = true; void refresh(); const timer = setInterval(refresh, 2000); return () => { mounted.current = false; clearInterval(timer); }; }, [service]);
    async function perform(fn) {
      if (busy) return;
      setBusy(true); setError('');
      try { await fn(); await refresh(); } catch (e) { if (mounted.current) setError(e.message); }
      finally { if (mounted.current) setBusy(false); }
    }
    function edit(key, value) { setPreview(null); setForm(current => ({ ...current, [key]: value })); }
    function showDiffPage(offset, history) {
      requestedDiffOffset.current = offset; setDiffOffset(offset); setPreviousOffsets(history); setDetail(null); void refresh();
    }
    const button = (text, onClick, props = {}) => h('button', { type: 'button', disabled: busy, onClick, ...props }, text);
    const field = (label, input) => h('label', {}, h('span', {}, label), input);
    const input = (key, type = 'text') => h('input', { type, value: form[key], onChange: e => edit(key, e.target.value) });
    const pre = text => h('pre', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 360, overflow: 'auto' } }, text || '暂无记录');
    async function loadIssue(number) {
      const issue = await service.loadIssue(number);
      setPreview(null); setForm(current => ({ ...current, rerunId: null, latest: false, prompt: `${issue.title ?? ''}\n\n${issue.body ?? ''}`, source: `Issue ${issue.number ?? number ?? ''}` }));
    }
    const selectedTask = detail?.id === selected ? detail : data.tasks.find(t => t.id === selected);
    return h('section', { className: 'sandbox-tasks', 'aria-label': '沙箱任务' },
      h('style', {}, '.sandbox-tasks{padding:12px;overflow:auto;height:100%;font-size:13px}.sandbox-tasks button,.sandbox-tasks input,.sandbox-tasks select,.sandbox-tasks textarea{font:inherit;color:inherit;background:var(--bg-secondary,transparent);border:1px solid var(--border-color,#8886);border-radius:5px;padding:6px;margin:3px}.sandbox-tasks label{display:block;margin:8px 0}.sandbox-tasks label>span{display:block;opacity:.75}.sandbox-tasks textarea{width:95%;min-height:90px}.sandbox-tasks input{max-width:96%}.sandbox-tasks .facts{padding:10px;border:1px solid #8885;border-radius:6px;margin:10px 0}.sandbox-tasks .task-row{display:block;width:97%;text-align:left}.sandbox-tasks button:disabled{opacity:.45}.sandbox-tasks [aria-selected=true]{outline:1px solid currentColor}'),
      h('h2', {}, '沙箱任务'),
      h('p', {}, '任务在本机隔离执行；关闭侧栏或切换聊天后继续。完成、检查结果与是否合入分别记录。'),
      error ? h('p', { role: 'alert' }, error) : null,
      connectionError ? h('p', { role: 'alert' }, connectionError, button('重新连接', refresh)) : null,
      h('details', { open: true }, h('summary', {}, '新建或重新运行任务'),
        button('新任务（使用当前已提交基线）', () => { setPreview(null); setForm(current => ({ ...current, rerunId: null, latest: false, source: '手填描述' })); }),
        button('从当前 Issue 载入', () => perform(() => loadIssue(null))),
        h('input', { 'aria-label': 'Issue 编号', placeholder: '或输入 Issue 编号', value: issueNumber, onChange: e => setIssueNumber(e.target.value) }),
        button('载入 Issue', () => perform(() => loadIssue(Number(issueNumber))), { disabled: busy || !Number(issueNumber) }),
        h('p', {}, `来源：${form.source}`),
        field('任务内容（启动前可编辑）', h('textarea', { 'aria-label': '任务内容', value: form.prompt, onChange: e => edit('prompt', e.target.value) })),
        field('模型', h('select', { 'aria-label': 'Codex 模型', value: form.model || data.defaultModel || '', onChange: e => edit('model', e.target.value) }, data.models.map(model => h('option', { key: model }, model)))),
        field('推理强度', h('select', { value: form.effort, onChange: e => edit('effort', e.target.value) }, (data.modelEfforts?.[form.model || data.defaultModel] ?? ['low', 'medium', 'high', 'xhigh']).map(value => h('option', { key: value }, value)))),
        field('运行上限（分钟；排队不计时）', input('minutes', 'number')),
        field('检查命令（可选，在沙箱执行；留空标为未运行）', input('check')),
        button('编辑后预览', () => perform(async () => setPreview(await call('prepare', { ...form, model: form.model || data.defaultModel }))), { disabled: busy || !form.prompt.trim() }),
        preview ? h('div', { className: 'facts', 'aria-label': '启动预览' },
          h('strong', {}, '确认启动范围'), h('p', {}, `项目：${preview.projectName}；已提交基线：${preview.base}`),
          h('p', {}, preview.dirty ? `排除 ${preview.excluded} 项未提交或未跟踪内容；原工作树和暂存区保持原样。` : '从已提交版本启动。'),
          h('p', {}, `独立代码和分支；模型 ${preview.model} / ${preview.effort}；上限 ${preview.minutes} 分钟；允许任务内编辑、命令和依赖联网。结果合入另行确认。`),
          pre(preview.prompt),
          h('p', {}, `检查命令：${preview.check || '未设置（标为未运行）'}`),
          button('确认启动', () => perform(async () => { const task = await call('start', { token: preview.token }); requestedDiffOffset.current = 0; setDiffOffset(0); setPreviousOffsets([]); select(task.id); setPreview(null); })),
          button('返回编辑', () => setPreview(null))) : null),
      h('details', {}, h('summary', {}, `整机并发上限：${data.limit}`), h('input', { 'aria-label': '整机并发上限', type: 'number', min: 1, max: 8, value: limit, onChange: e => setLimit(Number(e.target.value)) }),
        button('确认调整整机上限', () => perform(() => call('limit', { value: limit }))),
        button('预览退出后台', () => perform(async () => setAction({ kind: 'shutdown', ...await call('shutdownPreview') })))),
      action?.kind === 'shutdown' ? h('div', { className: 'facts' }, h('strong', {}, '退出将停止正在执行的任务，排队任务暂停等待下次确认。'),
        pre(action.affected.map(task => `${task.projectName}: ${names[task.status]} ${task.id.slice(0, 8)}`).join('\n') || '当前没有受影响任务'),
        button('确认停止任务并退出后台', () => perform(async () => { await call('shutdown', { token: action.token }); setAction(null); setError('后台正在停止；下次可从本机启动入口重新打开。'); })), button('保持后台运行', () => setAction(null))) : null,
      h('h3', {}, '本项目任务'),
      data.tasks.length ? data.tasks.map(task => button(`${names[task.status]}${task.paused ? ' · 等待确认恢复' : ''}${task.unverified ? ' · 状态待核实' : ''} — ${task.prompt?.slice(0, 48) ?? task.id.slice(0, 8)}`, () => { requestedDiffOffset.current = 0; setDiffOffset(0); setPreviousOffsets([]); select(task.id); setDetail(null); setAction(null); }, { key: task.id, className: 'task-row', 'aria-selected': selected === task.id })) : h('p', {}, '暂无任务'),
      selectedTask ? h('article', { className: 'facts', 'aria-label': '任务详情' },
        h('h3', {}, `${names[selectedTask.status]}${selectedTask.unverified ? ' · 待核实' : ''}`),
        h('p', {}, `任务基线 ${selectedTask.base}；检查：${selectedTask.checks?.state ?? 'not-run'}；${selectedTask.merged ? '结果已合入' : '结果未合入'}`),
        ...['summary', 'log', 'diff', 'checks'].map(value => button({ summary: '摘要', log: '实时日志', diff: '代码差异', checks: '检查证据' }[value], () => setTab(value), { key: value, 'aria-selected': tab === value })),
        tab === 'summary' ? pre(selectedTask.summary || selectedTask.message || '任务执行中，连接状态与执行状态分别核实。') :
          tab === 'checks' ? pre(JSON.stringify(selectedTask.checks, null, 2)) : pre(selectedTask[tab]),
        tab === 'diff' && selectedTask.diffMessage ? h('p', { role: 'alert' }, selectedTask.diffMessage) : null,
        tab === 'diff' && selectedTask.diffPage ? h('div', { 'aria-label': '差异分页' },
          h('p', {}, `字节 ${selectedTask.diffPage.offset}–${selectedTask.diffPage.nextOffset ?? selectedTask.diffPage.totalBytes} / 共 ${selectedTask.diffPage.totalBytes} 字节`),
          button('上一页差异', () => showDiffPage(previousOffsets.at(-1), previousOffsets.slice(0, -1)), { disabled: busy || !previousOffsets.length }),
          button('下一页差异', () => showDiffPage(selectedTask.diffPage.nextOffset, [...previousOffsets, diffOffset]), { disabled: busy || selectedTask.diffPage.nextOffset == null })) : null,
        !terminal(selectedTask.status) ? button('取消任务', () => perform(() => call('cancel', { id: selectedTask.id }))) : null,
        selectedTask.paused ? button('确认恢复排队', () => perform(() => call('resume', { id: selectedTask.id }))) : null,
        terminal(selectedTask.status) && !selectedTask.unverified ? h('div', {},
          button('重新运行（沿用原基线）', () => { setForm({ prompt: selectedTask.prompt, model: selectedTask.model, effort: selectedTask.effort, minutes: selectedTask.minutes, check: selectedTask.check ?? '', source: selectedTask.source, rerunId: selectedTask.id }); setPreview(null); }),
          form.rerunId ? field('重新运行改用最新已提交版本', h('input', { type: 'checkbox', checked: Boolean(form.latest), onChange: e => edit('latest', e.target.checked) })) : null,
          selectedTask.status === 'completed' && selectedTask.result?.changed && !selectedTask.merged ? button('预览合入当前目标分支', () => perform(async () => { setUnchecked(false); setAction({ kind: 'merge', ...await call('mergePreview', { id: selectedTask.id }) }); })) : null,
          button('预览清理', () => perform(async () => setAction({ kind: 'clean', ...await call('cleanPreview', { id: selectedTask.id }) })))) : null,
        action && action.kind !== 'shutdown' ? h('div', { className: 'facts', 'aria-label': '结果操作确认' },
          h('strong', {}, action.kind === 'merge' ? `合入目标：${action.targetBranch}，目标版本 ${action.targetHead}` : '清理范围'),
          h('p', {}, action.scope || '确认的结果和目标若变化，必须重新预览。冲突保留结果，不自动解决或推送。'),
          action.kind === 'merge' && action.checks?.state !== 'passed' ? field('检查失败或未运行：我仍确认合入该结果', h('input', { type: 'checkbox', checked: unchecked, onChange: e => setUnchecked(e.target.checked) })) : null,
          button(action.kind === 'merge' ? '确认合入' : '确认清理', () => perform(async () => { const result = await call(action.kind, { token: action.token, allowUnchecked: unchecked }); if (result.conflict) throw new Error(result.message); setAction(null); if (result.cleaned) { select(null); setDetail(null); } })),
          button('取消操作', () => setAction(null))) : null) : null);
  };
}
