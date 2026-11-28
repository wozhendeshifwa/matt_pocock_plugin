// Presentation hooks for upstream inline surfaces. Fail at build time if an
// upgrade moves a boundary; do not change navigation, data or action handlers.
export function adaptNativeVisualSurfaces(source) {
  const replace = (before, after) => {
    if (source.split(before).length !== 2) throw new Error('Native visual surface boundary changed: ' + before.slice(0, 80));
    source = source.replace(before, () => after);
  };
  replace("return h('div', null, [\n        // 顶部操作行拆到 MapDetailTop.js", "return h('div', { 'data-native-map': true }, [\n        // 顶部操作行拆到 MapDetailTop.js");
  replace("h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 4, fontSize: 12, color: '#4ade80', margin: '4px 0 2px' } }", "h('div', { 'data-native-map-destination': true, style: { display: 'flex', alignItems: 'flex-start', gap: 4, fontSize: 12, color: '#4ade80', margin: '4px 0 2px' } }");
  return source;
}
