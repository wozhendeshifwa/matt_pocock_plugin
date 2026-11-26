// Keep source notices outside the frozen vendor bundle. Missing anchors fail the
// build so an upstream upgrade cannot silently drop the provenance boundary.
export function adaptSkillSourceDisplay(source) {
  function replace(before, after) {
    if (source.split(before).length !== 2) throw new Error('Skill source display boundary changed: ' + before);
    source = source.replace(before, () => after);
  }
  replace('const cached = pixelDetailCache[name];', 'const cached = null; // Re-read current project source on every detail open.');
  replace('h("div", { key: "rows" }, items.map(function(it) {',
    'h("p", { key: "source-notice", role: "note", "data-skill-source-notice": true }, tr("sd.listTitle").includes("技能") ? "目录列出本插件技能；当前项目来源请看详情。随包正文是参考，不代表宿主已加载。" : "Plugin skill catalog. See details for this project’s source. Bundled rules are reference material, not proof of host loading."),\n    h("div", { key: "rows" }, items.map(function(it) {');
  return source;
}

