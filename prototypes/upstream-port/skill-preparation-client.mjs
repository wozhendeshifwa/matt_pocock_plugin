import { invokedSkillNames } from './request-preparation.mjs';

export function adaptSkillPreparation(source) {
  const helper = `    const codexPrepareSkillUse = async function (st, text) {
      const names = (${invokedSkillNames.toString()})(text, CODEX_SKILL_NAMES);
      if (!names.length) return true;
      const preparation = ctx.get('skillPreparation');
      if (!preparation) { st.skillPreparation = { status: 'source-unbound', reason: 'host-capability-unavailable' }; return true; }
      try {
        const results = [];
        for (const name of names) results.push(await preparation.prepare(name));
        st.skillPreparation = { names: names, results: results };
        if (typeof emit === 'function') emit(st);
        const updated = results.some(function (result) { return (result.bindings || []).some(function (binding) { return binding.status === 'updated' }) });
        const failed = results.some(function (result) { return !['checked','source-unbound','binding-invalid'].includes(result.status) });
        if (updated || failed) {
          const retained = results.some(function (result) { return (result.bindings || []).some(function (binding) { return binding.usable }) });
          flash(st, updated ? '技能状态已变化，请先核对草稿再重试；旧出口已停止。' : retained ? '技能检查未通过，现有可用规则已保留；请先核对来源与草稿再重试。' : '技能检查未通过，尚无已核验可用来源；请先查证缺项，旧出口已停止。', 'warn');
          return false;
        }
        return true;
      } catch (error) {
        st.skillPreparation = { status: 'prepare-failed' };
        flash(st, String(error && error.message || '技能更新状态无法核验；旧出口已停止。'), 'warn');
        return false;
      }
    };
`;
  const first = '    const openTextInNewSession = function (st, text, title, opts) {';
  if (source.split(first).length !== 2) throw new Error('Skill preparation boundary changed');
  source = source.replace(first, helper + first);
  for (const [before, after] of [
    ['const inject = (st, text) => {', 'const inject = async (st, text) => {'],
    ['const openTextInNewSession = function (st, text, title, opts) {', 'const openTextInNewSession = async function (st, text, title, opts) {'],
    ['const copyText = (st, text, okMsg) => {', 'const copyText = async (st, text, okMsg) => {'],
  ]) {
    if (source.split(before).length !== 2) throw new Error('Skill preparation outlet boundary changed: ' + before);
    source = source.replace(before, after + '\n      if (!await codexPrepareSkillUse(st, text)) return false;');
  }
  return source;
}
