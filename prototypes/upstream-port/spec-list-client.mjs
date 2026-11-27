// This projection keeps the issue pool intact: search and actions still use
// each child's identity. Only verified native ownership folds a default row.
function specIdentity(row) {
  return String(row?.effortId || '') + '#' + String(row?.key || row?.number);
}
function buildSpecIndex(st, extras) {
  const snapshot = st.snapshot || {};
  const byId = new Map();
  const put = row => { if (row && row.number != null) byId.set(specIdentity(row), row); };
  const roots = (snapshot.issues || []).concat((snapshot.maps || []).flatMap(map => map.tickets || []), snapshot.specs || []);
  roots.forEach(row => (row.children || []).forEach(put));
  // Root/paginated rows own their full metadata; a nested projection must not
  // replace dependency or action information for the same issue identity.
  roots.forEach(put);
  (extras || []).forEach(put);
  const specs = new Map();
  const mapChildren = new Set();
  const childrenOf = new Map();
  for (const row of byId.values()) if (specTagged(row)) {
    specs.set(specIdentity(row), row);
    childrenOf.set(specIdentity(row), new Set((row.children || []).map(specIdentity)));
  }
  for (const map of snapshot.maps || []) for (const child of map.tickets || []) mapChildren.add(specIdentity(child));
  return { snapshot: st.snapshot, byId, specs, mapChildren, childrenOf, pool: [...byId.values()] };
}
function specIndex(st) {
  let index = specIndexes.get(st);
  if (!index || index.snapshot !== st.snapshot) {
    index = buildSpecIndex(st, issuePageRowsOf(st, 'list'));
    specIndexes.set(st, index);
  }
  return index;
}
function specTagged(row) {
  const labels = Array.isArray(row?.labels) ? row.labels : (row?.labels?.nodes || []);
  return !!row && labels.some(label => (typeof label === 'string' ? label : label.name) === 'spec') && row.type !== 'map' && !labels.some(label => (typeof label === 'string' ? label : label.name) === 'wayfinder:map');
}
function specFor(st, row) {
  if (!row || row.parentKey == null) return null;
  return specIndex(st).specs.get(specIdentity({ key: row.parentKey, effortId: row.effortId })) || null;
}
function specInfo(st, row) {
  if (!specTagged(row)) return null;
  return specIndex(st).specs.get(specIdentity(row)) || row;
}
function specDependenciesUnknown(st, row) {
  const current = specIndex(st).byId.get(specIdentity(row)) || row;
  return !!current?.dependenciesRead && current.dependenciesRead.state !== 'complete';
}
function specExecutionHeld(st, row) {
  const current = specIndex(st).byId.get(specIdentity(row)) || row;
  return specDependenciesUnknown(st, current) || !!current?.dependenciesRead?.openKeys?.length;
}
function specComplete(spec) {
  return !!spec && spec.childrenRead?.state === 'complete' && Number.isInteger(spec.childrenRead.total) && spec.childrenRead.total === (spec.children || []).length;
}
function specCount(spec) {
  if (!specComplete(spec)) return spec.childrenRead?.state === 'failed' ? '子票读取失败 · 完成数未知' : '子票读取不完整 · 已读取 ' + (spec.children || []).length + ' 张，完成数未知';
  return '子票 ' + (spec.children || []).filter(child => child.state === 'CLOSED').length + '/' + spec.childrenRead.total;
}
function specLabel(spec) {
  return specComplete(spec) ? 'spec ' + (spec.children || []).filter(child => child.state === 'CLOSED').length + '/' + spec.childrenRead.total : 'spec ?';
}
function specOpenWork(st, row) {
  const spec = specInfo(st, row);
  return !!spec && (!specComplete(spec) || (spec.children || []).some(child => child.state !== 'CLOSED'));
}
function specStateText(st, row) {
  const spec = specInfo(st, row);
  return (spec?.children || []).some(child => child.state !== 'CLOSED') ? '规格已关闭 · 还有未完成子票' : '规格已关闭 · 子票读取未完成';
}
function specListRows(st, rows) {
  const index = buildSpecIndex(st, rows);
  specIndexes.set(st, index);
  const pool = index.pool;
  const base = rows.concat(pool.filter(row => specTagged(row) || specFor(st, row)));
  const seen = new Set();
  const query = String(st.specSearch || '').trim().toLowerCase();
  return (query ? pool : base).filter(row => {
    const id = specIdentity(row);
    if (seen.has(id) || row.isPullRequest === true) return false;
    seen.add(id);
    if (query) return ('#' + row.number + ' ' + row.title).toLowerCase().includes(query);
    if (!specTagged(row) && index.mapChildren.has(id)) return false;
    const parent = specFor(st, row);
    const info = parent && specInfo(st, parent);
    return !specComplete(info) || !index.childrenOf.get(specIdentity(info))?.has(id);
  });
}

export function adaptSpecList(source) {
  const replace = (anchor, replacement) => {
    if (source.split(anchor).length !== 2) throw new Error('Spec boundary changed: ' + anchor.slice(0, 80));
    source = source.replace(anchor, replacement);
  };
  replace('const ListTab = ({ st, narrow }) => {', 'const specIndexes = new WeakMap();\n' + [specIdentity, buildSpecIndex, specIndex, specTagged, specFor, specInfo, specDependenciesUnknown, specExecutionHeld, specComplete, specCount, specLabel, specOpenWork, specStateText, specListRows].map(fn => fn.toString()).join('\n') + '\nconst ListTab = ({ st, narrow }) => {');
  replace("const fakeIssue = { number: issueNumber, ['title']: title, labels: labelArr.map(function (l) { return typeof l === 'string' ? { name: l } : l }), state: stateRaw }", "const fakeIssue = { number: issueNumber, effortId: issueEffort, ['title']: title, labels: labelArr.map(function (l) { return typeof l === 'string' ? { name: l } : l }), state: stateRaw, dependenciesRead: (specIndex(st).byId.get(specIdentity({ number: issueNumber, effortId: issueEffort })) || {}).dependenciesRead }");
  const listAnchor = "const issues = ticketRowsOf((st.snapshot && Array.isArray(st.snapshot.issues)) ? st.snapshot.issues : []).concat(issuePageRowsOf(st, 'list'))";
  replace(listAnchor, "const issues = specListRows(st, ticketRowsOf((st.snapshot && Array.isArray(st.snapshot.issues)) ? st.snapshot.issues : []).concat(issuePageRowsOf(st, 'list')))" );
  replace("const openIssues = issues.filter(function (x) { return x.state !== 'CLOSED' })", "const openIssues = issues.filter(function (x) { return x.state !== 'CLOSED' || specOpenWork(st, x) })");
  replace("const closedIssues = issues.filter(function (x) { return x.state === 'CLOSED' })", "const closedIssues = issues.filter(function (x) { return x.state === 'CLOSED' && (st.stateFilter === 'closed' || !specOpenWork(st, x)) })");
  replace("const showClosedList = st.stateFilter === 'closed'", "const showClosedList = st.stateFilter === 'closed' || !!String(st.specSearch || '').trim()");
  replace("(st.stateFilter === 'all' && closedRows.length) ?", "(st.stateFilter === 'all' && !String(st.specSearch || '').trim() && closedRows.length) ?");
  replace('      // KPI 行 + 环境提示（v18-30：可接/占用 = 列表 open issue 口径）', `      h('input', { type: 'search', 'aria-label': '搜索任务', 'data-spec-search': 1, placeholder: '搜索任务（含规格子票）', value: st.specSearch || '', onInput: function(e) { st.specSearch = e.target.value; emit(st) }, style: { width: '100%', boxSizing: 'border-box', marginBottom: 8, padding: '5px 8px', background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 6 } }),
      // KPI 行 + 环境提示（v18-30：可接/占用 = 列表 open issue 口径）`);
  replace("      const subNodes = (src.subIssues && src.subIssues.nodes) ? src.subIssues.nodes : []", "      const spec = specInfo(st, src)\n      const parentSpec = specFor(st, snapIssue || src)\n      const subNodes = spec ? (spec.children || []) : ((src.subIssues && src.subIssues.nodes) ? src.subIssues.nodes : [])");
  replace("      const subTotal = (src.subIssues && typeof src.subIssues.totalCount === 'number') ? src.subIssues.totalCount : subNodes.length", "      const subTotal = spec ? (spec.childrenRead && spec.childrenRead.total) : ((src.subIssues && typeof src.subIssues.totalCount === 'number') ? src.subIssues.totalCount : subNodes.length)");
  replace('        // sub-issues', `        parentSpec ? h('div', { 'data-parent-spec': 1, style: { padding: '6px 0', fontSize: 12 } }, ['所属规格：', h('a', { href: '#', onClick: function(e) { e.preventDefault(); pushNav(st, 'issue', parentSpec.number, effortOf(parentSpec)) } }, '#' + parentSpec.number + ' ' + parentSpec.title)]) : null,
        // sub-issues`);
  replace("        subNodes.length || subTotal ? h('div', { style: { padding: '6px 0' } }, [", "        (spec || subTotal > 0) ? h('div', { 'data-spec-children': spec ? 1 : undefined, style: { padding: '6px 0' } }, [");
  replace("'子票 ' + subTotal + (subNodes.length ? '' : '（无加载）')", "spec ? specCount(spec) : ('子票 ' + subTotal + (subNodes.length ? '' : '（无加载）'))");
  replace('      const labels = x.labels || []', "      const labels = specInfo(st, x) ? (x.labels || []).filter(label => label.name === 'spec').concat((x.labels || []).filter(label => label.name !== 'spec')) : (x.labels || [])");
  const labelRow = "return h('span', { key: i, className: 'dsws-chip', style: { fontSize: 10, background: hexA(l.color, 0.18) || 'rgba(188,140,255,.16)', color: l.color ? '#' + l.color : '#bc8cff', border: '1px solid ' + (darken(l.color, 0.16) || 'rgba(188,140,255,.6)') } }, l.name)";
  replace(labelRow, labelRow.replace("key: i, className:", "key: i, 'data-spec-count': l.name === 'spec' && specInfo(st, x) ? 1 : undefined, title: l.name === 'spec' && specInfo(st, x) ? specCount(specInfo(st, x)) : undefined, 'aria-label': l.name === 'spec' && specInfo(st, x) ? 'spec · ' + specCount(specInfo(st, x)) : undefined, className:").replace('}, l.name)', "}, l.name === 'spec' && specInfo(st, x) ? specLabel(specInfo(st, x)) : l.name)"));
  replace("          (isMap && mapObj && mapObj.stats && !mapClosed) ? ringOf(mapObj.stats) : null,", `          specInfo(st, x) && !specComplete(specInfo(st, x)) ? h('span', { style: { fontSize: 11 } }, specCount(specInfo(st, x))) : null,
          specOpenWork(st, x) && x.state === 'CLOSED' ? h('span', { 'data-spec-status': 1, style: { fontSize: 11 } }, specStateText(st, x)) : null,
          specFor(st, x) ? h('span', { 'data-spec-owner': 1, style: { fontSize: 11, flex: 'none' } }, '所属规格 #' + specFor(st, x).number) : null,
          specDependenciesUnknown(st, x) ? h('span', { 'data-dependencies-unknown': 1, style: { fontSize: 11 } }, '依赖读取未知 · 暂停执行') : null,
          !specDependenciesUnknown(st, x) && specExecutionHeld(st, x) ? h('span', { 'data-dependencies-blocked': 1, style: { fontSize: 11 } }, '被阻塞 · ' + (x.dependenciesRead?.openKeys || []).map(key => '#' + key).join('、')) : null,
          (isMap && mapObj && mapObj.stats && !mapClosed) ? ringOf(mapObj.stats) : null,`);
  return source;
}
