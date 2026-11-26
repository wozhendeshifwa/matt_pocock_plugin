import { contextRequest, CONTEXT_REQUEST_IDS } from './context-requests.mjs';

export function adaptContextRequests(source) {
  function once(before, after) {
    if (source.split(before).length !== 2) throw new Error('Context request boundary changed: '+before.slice(0,100));
    source=source.replace(before,()=>after);
  }
  const start=source.indexOf('    const PROMPTS = {');
  const end=source.indexOf('    // 当前语言',start);
  if(start<0 || end<0)throw new Error('Context request catalog boundary changed');
  const legacy=source.slice(start,end);
  const oldIds=[...legacy.matchAll(/^\s*"([^"]+)":/gm)].map(m=>m[1]);
  for(const id of oldIds)if(!CONTEXT_REQUEST_IDS.includes(id))throw new Error('Unreviewed request purpose: '+id);
  source=source.slice(0,start)+'    const codexContextRequest = '+contextRequest.toString()+';\n    const PROMPTS = '+JSON.stringify(Object.fromEntries(CONTEXT_REQUEST_IDS.map(id=>[id,{version:2}])))+';\n'+source.slice(end);
  once("      let s = (promptLang() === 'en' && p.en) ? p.en : (p.zh || '')", "      let s = codexContextRequest(id, params || {}, promptLang())");
  once("    const promptTextFor = function (st, id, params) { return promptText(id, backendParamsFor(st, params)) }", `    const codexRequestParams = function (st, params) {
      const nav = st && typeof peekNav === 'function' ? peekNav(st) : null;
      const related = nav ? issueUrlFor(st, nav.n, nav.effortId) : '';
      return Object.assign({ project: st && (st.cwd || st.snapshot && st.snapshot.workspaceRoot) || '', repo: st && st.repo || '', related:related }, params || {});
    }
    const promptTextFor = function (st, id, params) { return promptText(id, backendParamsFor(st, codexRequestParams(st, params))) }
    const codexSkillRequest = function (st, name) {
      const nav = typeof peekNav === 'function' ? peekNav(st) : null;
      const related = nav && typeof issueUrlFor === 'function' ? issueUrlFor(st, nav.n, nav.effortId) : '';
      return promptTextFor(st, 'skill', {skill:name, related:related});
    };`);
  once("    const tplText = (id, st) => templates[id] || (TPL_DEFAULT[id] ? TPL_DEFAULT[id](st) : '')", "    const tplText = (id, st) => TPL_DEFAULT[id] ? TPL_DEFAULT[id](st) : ''");
  // Keep configuration bytes intact as recovery material. Do not migrate old
  // custom values into an active catalog or overwrite them while reading.
  once('    migrateStartCfg()', '    // Legacy template migration is disabled; saved values remain recovery-only.');
  const prefixStart=source.indexOf('    const withWayfinderPrefix = function (body) {');
  const prefixEnd=source.indexOf('    const startText =',prefixStart);
  if(prefixStart<0||prefixEnd<0)throw new Error('Request prefix boundary changed');
  source=source.slice(0,prefixStart)+'    const withWayfinderPrefix = function (body) { return body }\n'+source.slice(prefixEnd);
  const mapStart=source.indexOf('    const completePrompt = function');
  const mapEnd=source.indexOf('    const FIXATE_PROMPT',mapStart);
  if(mapStart<0||mapEnd<0)throw new Error('Map request boundary changed');
  source=source.slice(0,mapStart)+`    const completePrompt = function (st, num, title, total, closed) {
      return promptTextFor(st,'complete',{url:issueUrlFor(st,String(num||'')),n:num,title:title,total:total,closed:closed});
    }
    const inspectPrompt = function (st,num,title) { return promptTextFor(st,'mapInspect',{url:issueUrlFor(st,String(num||'')),n:num,title:title}); }
`+source.slice(mapEnd);
  once("return '/wayfinder ' + url + '\\n\\n' + promptTextFor(st, 'mapExecute', { n: String(t.number || ''), title: (t.title || ''), url: url })", "return promptTextFor(st, 'mapExecute', { n: String(t.number || ''), title: (t.title || ''), url: url })");
  once("    const handoffPrompt = function (ts) {\n      return renderTemplate('handoff1', { ts: ts })", "    const handoffPrompt = function (ts, st) {\n      return renderTemplate('handoff1', codexRequestParams(st, { ts: ts }), st)");
  once('const text = handoffPrompt(st.handoffTs)', 'const text = handoffPrompt(st.handoffTs, st)');
  once("return renderTemplate('handoff2', { path: absHandoffPath(cwd, file), file: file })", "return renderTemplate('handoff2', { project:cwd, path: absHandoffPath(cwd, file), file: file })");
  // Preserve target-supplied placeholders until the existing renderTemplate
  // supplies them, while all direct calls get project data from their store.
  once("inject(s, '$' + sk.name)", "inject(s, codexSkillRequest(s, sk.name))");
  once('inject(st, "$" + name);', 'inject(st, codexSkillRequest(st, name));');
  // Backend-provided setup descriptions are context, not an alternate active
  // instruction catalog. Route all helper entry points through the same one.
  const helperStart=source.indexOf('const promptFor = function (st, key) {');
  const helperEnd=source.indexOf('// 初始化那一步',helperStart);
  if(helperStart<0||helperEnd<0)throw new Error('Auxiliary request boundary changed');
  source=source.slice(0,helperStart)+`const promptFor = function (st, key) { return key ? promptTextFor(st,key) : '' }\n\n`+source.slice(helperEnd);
  once("if (!guide) { try { guide = String(promptTextFor(st, key) || '') } catch (_) {} }", "try { guide = String(promptTextFor(st, key) || '') } catch (_) { guide = '' }");
  once("if (p && typeof inject === 'function') inject(st, p);", "if (typeof inject === 'function') inject(st, promptTextFor(st,'cliInstall'));");
  once("if(tL&&typeof inject==='function') inject(st,tL)", "if(typeof inject==='function') inject(st,promptTextFor(st,'ghAuthLogin'))");
  const labelStart=source.indexOf("            const txt = (function(){",source.indexOf("const doInject = function(){",source.indexOf("const ppL=")));
  const labelEnd=source.indexOf("            if (txt && typeof inject",labelStart);
  if(labelStart<0||labelEnd<0)throw new Error('Label request boundary changed');
  source=source.slice(0,labelStart)+"            const txt = promptTextFor(st, 'ensureLabels')\n"+source.slice(labelEnd);
  return source;
}
