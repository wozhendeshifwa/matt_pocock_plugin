// This projection keeps the issue pool intact: search and actions still use
// each child's identity. Only verified native ownership folds a default row.
function specPool(st, extras) {
  const snapshot = st.snapshot || {};
  const byId = new Map();
  const put = row => { if (row && row.number != null) byId.set(String(row.effortId || '') + '#' + row.number, row); };
  (snapshot.issues || []).forEach(row => { put(row); (row.children || []).forEach(put); });
  (snapshot.maps || []).forEach(map => (map.tickets || []).forEach(row => { put(row); (row.children || []).forEach(put); }));
  (snapshot.specs || []).forEach(spec => { put(spec); (spec.children || []).forEach(put); });
  (extras || []).forEach(put);
  return [...byId.values()];
}
function specTagged(row) {
  const labels = Array.isArray(row?.labels) ? row.labels : (row?.labels?.nodes || []);
  return !!row && labels.some(label => (typeof label === 'string' ? label : label.name) === 'spec') && row.type !== 'map';
}
function specFor(st, row) {
  if (!row || row.parentKey == null) return null;
  return specPool(st).find(parent => specTagged(parent) && String(parent.key || parent.number) === String(row.parentKey) && String(parent.effortId || '') === String(row.effortId || '')) || null;
}
function specInfo(st, row) {
  if (!specTagged(row)) return null;
  const id = String(row.key || row.number);
  const spec = (st.snapshot?.specs || []).find(item => String(item.key || item.number) === id && String(item.effortId || '') === String(row.effortId || ''));
  return spec || specPool(st).find(item => specTagged(item) && String(item.key || item.number) === id && String(item.effortId || '') === String(row.effortId || '') && item.childrenRead) || null;
}
function specListRows(st, rows) {
  const pool = specPool(st, rows);
  const base = rows.concat(pool.filter(specTagged));
  const seen = new Set();
  const query = String(st.specSearch || '').trim().toLowerCase();
  return (query ? pool : base).filter(row => {
    const id = String(row.effortId || '') + '#' + row.number;
    if (seen.has(id) || row.isPullRequest === true) return false;
    seen.add(id);
    if (query) return ('#' + row.number + ' ' + row.title).toLowerCase().includes(query);
    if (!specTagged(row) && (st.snapshot?.maps || []).some(map => String(map.effortId || '') === String(row.effortId || '') && (map.tickets || []).some(child => String(child.key || child.number) === String(row.key || row.number)))) return false;
    return !specFor(st, row);
  });
}

export function adaptSpecList(source) {
  const replace = (anchor, replacement) => {
    if (source.split(anchor).length !== 2) throw new Error('Spec boundary changed: ' + anchor.slice(0, 80));
    source = source.replace(anchor, replacement);
  };
  replace('const ListTab = ({ st, narrow }) => {', [specPool, specTagged, specFor, specInfo, specListRows].map(fn => fn.toString()).join('\n') + '\nconst ListTab = ({ st, narrow }) => {');
  const listAnchor = "const issues = ticketRowsOf((st.snapshot && Array.isArray(st.snapshot.issues)) ? st.snapshot.issues : []).concat(issuePageRowsOf(st, 'list'))";
  replace(listAnchor, "const issues = specListRows(st, ticketRowsOf((st.snapshot && Array.isArray(st.snapshot.issues)) ? st.snapshot.issues : []).concat(issuePageRowsOf(st, 'list')))" );
  replace("const showClosedList = st.stateFilter === 'closed'", "const showClosedList = st.stateFilter === 'closed' || !!String(st.specSearch || '').trim()");
  replace("(st.stateFilter === 'all' && closedRows.length) ?", "(st.stateFilter === 'all' && !String(st.specSearch || '').trim() && closedRows.length) ?");
  replace('      // KPI 行 + 环境提示（v18-30：可接/占用 = 列表 open issue 口径）', `      h('input', { type: 'search', 'aria-label': '搜索任务', 'data-spec-search': 1, placeholder: '搜索任务（含规格子票）', value: st.specSearch || '', onInput: function(e) { st.specSearch = e.target.value; emit(st) }, style: { width: '100%', boxSizing: 'border-box', marginBottom: 8, padding: '5px 8px', background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 6 } }),
      // KPI 行 + 环境提示（v18-30：可接/占用 = 列表 open issue 口径）`);
  replace("      const subNodes = (src.subIssues && src.subIssues.nodes) ? src.subIssues.nodes : []", "      const spec = specInfo(st, src)\n      const parentSpec = specFor(st, snapIssue || src)\n      const subNodes = spec ? (spec.children || []) : ((src.subIssues && src.subIssues.nodes) ? src.subIssues.nodes : [])");
  replace("      const subTotal = (src.subIssues && typeof src.subIssues.totalCount === 'number') ? src.subIssues.totalCount : subNodes.length", "      const subTotal = spec ? (spec.childrenRead && spec.childrenRead.total) : ((src.subIssues && typeof src.subIssues.totalCount === 'number') ? src.subIssues.totalCount : subNodes.length)");
  replace('        // sub-issues', `        parentSpec ? h('div', { 'data-parent-spec': 1, style: { padding: '6px 0', fontSize: 12 } }, ['所属规格：', h('a', { href: '#', onClick: function(e) { e.preventDefault(); pushNav(st, 'issue', parentSpec.number, effortOf(parentSpec)) } }, '#' + parentSpec.number + ' ' + parentSpec.title)]) : null,
        // sub-issues`);
  replace("        subNodes.length || subTotal ? h('div', { style: { padding: '6px 0' } }, [", "        (spec || subTotal > 0) ? h('div', { 'data-spec-children': spec ? 1 : undefined, style: { padding: '6px 0' } }, [");
  replace("'子票 ' + subTotal + (subNodes.length ? '' : '（无加载）')", "spec ? ('子票 ' + subNodes.filter(function(x) { return x.state === 'CLOSED' }).length + '/' + subTotal) : ('子票 ' + subTotal + (subNodes.length ? '' : '（无加载）'))");
  replace("          (isMap && mapObj && mapObj.stats && !mapClosed) ? ringOf(mapObj.stats) : null,", `          specInfo(st, x) ? h('span', { 'data-spec-count': 1, style: { fontSize: 11, flex: 'none' } }, '子票 ' + (specInfo(st, x).children || []).filter(function(c) { return c.state === 'CLOSED' }).length + '/' + specInfo(st, x).childrenRead.total) : null,
          specFor(st, x) ? h('span', { 'data-spec-owner': 1, style: { fontSize: 11, flex: 'none' } }, '所属规格 #' + specFor(st, x).number) : null,
          (isMap && mapObj && mapObj.stats && !mapClosed) ? ringOf(mapObj.stats) : null,`);
  return source;
}



