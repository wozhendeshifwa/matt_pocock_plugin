// Convert known skill invocations, never slash-delimited URLs or file paths.
export function codexSkillText(value) {
  const names = CODEX_SKILL_NAMES;
  const invocation = new RegExp('(^|[^A-Za-z0-9_./\\\\:$-])/(' + names.join('|') + ')(?![A-Za-z0-9_./\\\\-])', 'g');
  return String(value ?? '').replace(invocation, (_, before, name) => before + '$' + name);
}

export function adaptSkillPrefixes(source, names) {
  function replaceOnce(before, after) {
    if (source.split(before).length !== 2) throw new Error('Upstream skill boundary changed: ' + before);
    source = source.replace(before, () => after);
  }
  replaceOnce("const tr = (localeSvc", "const codexOriginalTr = (localeSvc");
  replaceOnce("    // 1. 技能目录 + 场景推荐映射", "    const tr = (...args) => codexSkillText(codexOriginalTr(...args));\n    // 1. 技能目录 + 场景推荐映射");
  replaceOnce("      return s\n    }\n    // #230", "      return codexSkillText(s)\n    }\n    // #230");
  for (const anchor of [
    'const inject = (st, text) => {',
    'const openTextInNewSession = function (st, text, title, opts) {',
    'const copyText = (st, text, okMsg) => {',
  ]) replaceOnce(anchor, anchor + '\n      text = codexSkillText(text);');
  replaceOnce('/^\\/wayfinder\\b/', '/^[\\/$]wayfinder\\b/');
  for (const name of ['triage', 'implement', 'grill-with-docs', 'research', 'prototype', 'handoff']) {
    replaceOnce('/^\\s*\\/' + name + '\\b/', '/^\\s*[\\/$]' + name + '\\b/');
  }
  for (const expression of ["'/' + sk.name", '"/" + r', '"/" + name', '"/" + p.name', '"/" + (d.name || "")']) {
    if (!source.includes(expression)) throw new Error('Upstream skill display changed: ' + expression);
    source = source.split(expression).join(expression.replace('/', '$'));
  }
  replaceOnce('const md = lang === "zh" ? d.mdZh : d.mdEn;', 'const md = codexSkillText(lang === "zh" ? d.mdZh : d.mdEn);');
  replaceOnce('text.charAt(0) === "/" ? text.slice(1) : text', '/^[/$]/.test(text) ? text.slice(1) : text');
  return 'const CODEX_SKILL_NAMES = ' + JSON.stringify(names) + ';\n' + codexSkillText.toString() + '\n' + source;
}
