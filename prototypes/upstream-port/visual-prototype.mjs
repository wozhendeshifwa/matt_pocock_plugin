// THROWAWAY: three board renderings on the existing board route (?variant=A/B/C).
// Uses the real PanelShell; only the board render subtree is replaced in preview.
import React from 'react';
import { MapPrototype } from './visual-map-prototype.mjs';
const h = React.createElement;
const names = { A: '紧凑列表', B: '任务卡片', C: '列表与详情并排' };
export function VisualPrototype({ connection, codexActions }) {
  const params = new URLSearchParams(location.search);
  const [view, setView] = React.useState(params.get('view') === 'map' ? 'map' : 'list');
  const [variant, setVariant] = React.useState(names[params.get('variant')] ? params.get('variant') : 'A');
  const [theme, setTheme] = React.useState(params.get('theme') === 'dark' ? 'dark' : 'light');
  const [width, setWidth] = React.useState(params.get('width') || '420');
  const [state, setState] = React.useState(params.get('state') || 'ready');
  const [items, setItems] = React.useState([]);
  const [selected, setSelected] = React.useState(null);
  const [draft, setDraft] = React.useState('');
  const [filter, setFilter] = React.useState('全部');
  const [search, setSearch] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const timer = React.useRef();
  React.useEffect(() => { connection.rpc.call('/api', 'dsws', { method: 'snapshot' }).then(r => setItems(r.value.issues)); return () => clearTimeout(timer.current); }, []);
  React.useEffect(() => {
    const u = new URL(location.href);
    for (const [k,v] of Object.entries({ variant, theme, width, state, view })) u.searchParams.set(k,v);
    history.replaceState(null, '', u);
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.setProperty('--preview-width', width + 'px');
  }, [variant, theme, width, state, view]);
  React.useEffect(() => { if(view==='map' && items.length && !selected) setSelected(items[0]); }, [view,items]);
  function cycle(delta) { const all = Object.keys(names); setVariant(v => all[(all.indexOf(v)+delta+3)%3]); }
  React.useEffect(() => {
    const key = e => { if (e.target.closest('input,textarea,select,[contenteditable]')) return; if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); cycle(e.key === 'ArrowRight' ? 1 : -1); } };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, []);
  function changeState(value) { clearTimeout(timer.current); setState(value); setNotice(''); }
  function retry() { changeState('refreshing'); timer.current = setTimeout(() => setState('ready'), 1200); }
  async function choose(item) { const r = await connection.rpc.call('/api', 'dsws', { method: 'issueDetail', key:item.key }); setSelected(r.value.issue); setNotice(''); }
  async function prefill(target) { const text = `请推进「${selected.title}」：先读取票面与阻塞关系，按验收条件完成任务。\n${selected.url}`; await codexActions.prefill(target,text); setDraft(text); setNotice(target === 'new' ? '新会话草稿预览（未发送）' : '当前聊天草稿预览（未发送）'); }
  const shown = items.filter(i => (filter !== '可接' || (!i.blockedBy.length && !i.assignees.length)) && (!search || i.title.includes(search)));
  const button = (label, onClick, props={}) => h('button', { type:'button', onClick, ...props }, label);
  const row = item => h('article', { key:item.key, 'data-status':item.blockedBy.length ? 'blocked' : item.assignees.length ? 'active' : 'ready', className:'vp-row' + (selected?.key === item.key ? ' selected' : '') },
    h('div',{className:'vp-row-meta'},h('span',{className:'vp-dot ' + (item.blockedBy.length ? 'blocked' : '')}), `#${item.key}`, h('span',null,item.blockedBy.length ? '等待前置' : item.assignees.length ? '进行中' : '可接')),
    button(item.title, () => choose(item), {className:'vp-title'}),
    h('div',{className:'vp-tags'}, h('span',null,item.kind), item.blockedBy.length ? h('span',null,'依赖 ' + item.blockedBy.map(k=>'#'+k).join(' · ')) : null),
    variant === 'B' ? button('查看详情 →', () => choose(item), {className:'vp-open'}) : null);
  const list = h('section',{className:'vp-list', 'aria-label':'任务列表'},shown.map(row), !shown.length ? h('p',{className:'vp-empty'},'没有匹配的任务。试试其他筛选。') : null);
  const detail = selected ? h('section',{className:'vp-detail','aria-label':'任务详情'},
    button(view==='map' ? '← 地图概览' : '← 返回列表',()=>{setSelected(null);setDraft('');setNotice('');},{className:'vp-back'}),
    h('div',{className:'vp-row-meta'},`#${selected.key} · Open · ${selected.kind}`),
    h('h2',null,selected.title),
    h('div',{className:'vp-dependencies'}, selected.blockedBy.length ? '等待：' + selected.blockedBy.map(k=>'#'+k).join('、') : '没有未完成的前置依赖'),
    h('h3',null,'目标'), h('p',null,selected.summary),
    h('h3',null,'验收条件'), h('ul',null,selected.acceptance.map((s,i)=>h('li',{key:i},s))),
    h('h3',null,'Notes'), h('p',null,'保留当前项目、可编辑草稿与权限边界。操作前读取完整票面。'),
    h('div',{className:'vp-actions'},button('执行',()=>prefill('active'),{className:'vp-primary',disabled:!!selected.blockedBy.length}),button('新会话',()=>prefill('new'),{disabled:!!selected.blockedBy.length})),
    h('p',{className:'vp-caption'},'生成可编辑草稿，由你确认发送。'),
    notice ? h('p',{role:'status'},notice) : null,
    draft ? h('label',{className:'vp-draft'},'草稿',h('textarea',{value:draft,onChange:e=>setDraft(e.target.value),rows:5})) : null
  ) : h('section',{className:'vp-detail vp-placeholder'},h('span',null,'选择一张任务'),h('p',null,'在这里阅读详情，列表保持可见。'));
  const special = state === 'loading' ? h('div',{className:'vp-loading',role:'status'},h('p',null,'正在读取当前项目…'),[1,2,3].map(i=>h('div',{key:i,className:'vp-skeleton'})))
    : state === 'empty' ? h('div',{className:'vp-empty'},h('h2',null,'当前项目暂无任务'),h('p',null,'任务加载成功后会出现在这里。'),button('刷新列表',retry))
    : state === 'error' ? h('div',{className:'vp-error',role:'alert'},h('h2',null,'暂时无法读取任务'),h('p',null,'连接中断。检查网络后可以重试。'),button('重试',retry)) : null;
  return h('div',{className:'vp-board', 'data-variant':variant},
    h('header',null,h('div',{className:'vp-project'},h('strong',null,'matt_pocock_'),h('span',null,'GitHub · 项目看板')),button('刷新',retry)),
    h('nav',{className:'vp-nav','aria-label':'看板导航'},['列表','地图','版本管理','拉取请求','技能','检查'].map(n=>button(n,()=>{ if(n==='地图'||n==='列表'){setView(n==='地图'?'map':'list');setNotice('');}else setNotice('该入口不在本次原型评审范围。'); },{'aria-current':n===(view==='map'?'地图':'列表')?'page':undefined,key:n}))),
    view==='list' ? h('div',{className:'vp-controls'},h('input',{'aria-label':'搜索任务',placeholder:'搜索任务…',value:search,onChange:e=>setSearch(e.target.value)}),h('div',null,['全部','可接'].map(n=>button(n,()=>setFilter(n),{'aria-pressed':filter===n,key:n})))) : null,
    view==='list' ? h('div',{className:'vp-section-title'},h('span',null,'视觉适配与性能优化'),h('span',null,state === 'empty' ? '0 项' : ['loading','error'].includes(state) ? '数量待获取' : `${shown.length} 项`)) : null,
    state === 'refreshing' ? h('div',{className:'vp-refresh',role:'status'},'正在刷新… 已有内容仍可查看') : null,
    !selected && notice ? h('p',{role:'status'},notice) : null,
    special || (view==='map' ? h(MapPrototype,{items,selected,choose,detail}) : h('div',{className:'vp-content'},variant==='C' ? [list,detail] : selected ? detail : list)),
    h('aside',{className:'vp-switcher','aria-label':'原型控制台'},
      h('div',{className:'vp-switch-line'},button('←',()=>cycle(-1),{'aria-label':'上一方案'}),h('strong',null,`${variant} · ${names[variant]}`),button('→',()=>cycle(1),{'aria-label':'下一方案'})),
      h('div',{className:'vp-switch-line'},
        h('label',null,'主题 ',h('select',{value:theme,onChange:e=>setTheme(e.target.value)},h('option',{value:'light'},'明亮'),h('option',{value:'dark'},'深色'))),
        h('label',null,'宽度 ',h('select',{value:width,onChange:e=>setWidth(e.target.value)},['320','420','760'].map(v=>h('option',{value:v,key:v},v+' px')))),
        h('label',null,'状态 ',h('select',{value:state,onChange:e=>changeState(e.target.value)},Object.entries({ready:'已加载',loading:'首次加载',refreshing:'后台刷新',empty:'空列表',error:'失败 / 重试'}).map(([v,n])=>h('option',{value:v,key:v},n))))),
      h('small',null,`可丢弃原型 · 冻结样例 · ${variant}/${theme}/${width}px/${state} · 不写远端`)));
}
