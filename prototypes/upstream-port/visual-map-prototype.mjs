// THROWAWAY map presentation using the same frozen issues as the list preview.
import React from 'react';
const h = React.createElement;
export function MapPrototype({items, selected, choose, detail}) {
  const level = item => item.blockedBy.length ? 1 + Math.max(...item.blockedBy.map(key => level(items.find(i=>i.key===key)))) : 0;
  const stages = ['当前层 · 可开始','视觉落地','性能优化','最终验收'];
  const frontier = items.filter(i=>!i.blockedBy.length && !i.assignees.length);
  return h('section',{className:'vp-map','aria-label':'地图原型'},
    h('div',{className:'vp-map-hero'},h('div',{className:'vp-map-eyebrow'},'MAP 30 · 实施地图'),
      h('h1',null,'Codex 视觉适配与性能优化'),
      h('p',null,'保留既有功能与操作习惯，完成视觉适配和完整操作链优化，并通过真实桌面验收。'),
      h('div',{className:'vp-map-stats'},h('span',null,'0 / 5 已完成'),h('span',null,`${frontier.length} 可接`),h('span',null,'1 进行中'),h('span',null,'3 等待前置')),
      h('progress',{max:5,value:0,'aria-label':'地图完成进度'})),
    h('div',{className:'vp-map-frontier'},h('span',null,'当前可推进'),...frontier.map(i=>h('button',{key:i.key,type:'button',onClick:()=>choose(i)},i.title+' →'))),
    h('div',{className:'vp-map-columns'},
      h('section',{className:'vp-map-path','aria-label':'依赖层级'},h('div',{className:'vp-map-path-title'},'推进路径',h('span',null,'按前置关系分层')),
        stages.map((name,index)=>h('section',{key:name,className:'vp-map-stage'},
          h('h3',null,h('span',null,index+1),name),
          items.filter(i=>level(i)===index).map(i=>h('button',{type:'button',key:i.key,onClick:()=>choose(i),'aria-pressed':selected?.key===i.key,className:'vp-map-ticket','data-status':i.blockedBy.length?'blocked':i.assignees.length?'active':'ready'},
            h('div',{className:'vp-map-ticket-meta'},`#${i.key} · ${i.kind}`,h('span',null,i.blockedBy.length?'等待前置':i.assignees.length?'进行中':'可接')),
            h('strong',null,i.title),
            i.blockedBy.length ? h('small',null,'等待 '+i.blockedBy.map(key=>'#'+key).join('、')) : h('small',null,i.assignees.length?'已认领 · wozhendeshifwa':'未认领 · 可开始')))))),
      h('div',{className:'vp-map-inspector'},selected ? detail : h('div',{className:'vp-placeholder'},h('h2',null,'选择路径中的任务'),h('p',null,'详情显示在这里，依赖路径始终保留。')))),
    h('div',{className:'vp-map-notes'},
      h('details',null,h('summary',null,'已做决策',h('span',null,'0')),h('p',null,'尚无已关闭子票的决策记录。C 是当前首选视觉方向，地图效果仍待确认。')),
      h('details',null,h('summary',null,'尚未明确',h('span',null,'2')),h('ul',null,h('li',null,'首次启动和网络加载时限，等待性能基线后确定。'),h('li',null,'代表原型是否暴露额外布局与交互问题，等待用户反馈。'))),
      h('details',null,h('summary',null,'范围外'),h('p',null,'独立任务引擎、宿主不支持的原生入口、vendor 修改、版本升级及项目隔离语义变更。'))));
}
