// THROWAWAY #57: three action layouts inside the original IssueDetail, /?variant=A|B|C.
// Run: node prototypes/upstream-port/preview-skill-actions-prototype.mjs
// In-memory build and fixtures only; never writes dist or calls GitHub/Codex.
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
const here = new URL('.', import.meta.url);
let runtime = (await readFile(new URL('browser-runtime.mjs', here), 'utf8')).replaceAll('\r\n', '\n');
runtime = `import { SkillActionsPrototype } from './skill-actions-prototype.mjs';\n` + runtime;
runtime = runtime.replace('      Panel,\n      Settings,', '      Panel: props => React.createElement(SkillActionsPrototype, { ...props, OriginalDetail: window.Issue57OriginalDetail }),\n      Settings,');
const bundle = await build({ stdin: { contents: runtime, resolveDir: fileURLToPath(here), sourcefile: 'issue57-preview-runtime.mjs' }, bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"development"' } });
let original = (await readFile(new URL('../../vendor/mattskills-1.8.0-rc.7/lib/client.js', here), 'utf8')).replaceAll('\r\n', '\n');
// Adapt only the served in-memory source. Original vendor files stay intact.
const from = original.indexOf("            h(Tip, { content: primaryInfo.tip }");
const to = original.indexOf("            h(Tip, { content: tr('tip.copyLink')", from);
if (from < 0 || to < 0) throw new Error('Original IssueDetail action anchor changed');
original = original.slice(0, from) + original.slice(to);
const headerAnchor = '        // header\n';
const detailStart = original.indexOf('const IssueDetail = function');
const headerAt = original.indexOf(headerAnchor, detailStart);
if (headerAt < 0) throw new Error('Original IssueDetail header anchor changed');
// Put actions after the title/labels so the context remains visible above them.
const parentAt = original.indexOf("        parentMap ? h('div'", headerAt);
original = original.slice(0, parentAt) + "        h(window.Issue57ActionSlot),\n" + original.slice(parentAt);
original = original.replace('const fetchIssueDetail = function (st, n, opts) {', 'const fetchIssueDetail = function (st, n, opts) { return; // #57 fixture only\n');
const exportAnchor = '    // 6. 插槽注册';
if (!original.includes(exportAnchor)) throw new Error('Original component export anchor changed');
original = original.replace(exportAnchor, `
    window.Issue57OriginalDetail = withCx(function (props) {
      const [st] = React.useState(makeStore);
      const detail = props.issue;
      Object.assign(st, { cwd: 'PROTOTYPE', activeIssue: detail.number, activeEffortId: '', navStack: [{kind:'issue',n:detail.number}], issueMode:'real', issueDetail:detail, snapshot:{ issues:[detail], maps:[] }, repository:{name:'wozhendeshifwa/matt_pocock_plugin',url:'https://github.com/wozhendeshifwa/matt_pocock_plugin'}, selection:{backendId:'github',pending:false} });
      return h('div', {className:'dsws-body issue57-original'}, h(IssueDetail, {st:st}));
    });
` + exportAnchor);
original = original.replaceAll('localStorage', '__issue57MemoryStorage').replaceAll('sessionStorage', '__issue57MemoryStorage');
const css = await readFile(new URL('theme.css', here), 'utf8') + '\n' + await readFile(new URL('skill-actions-prototype.css', here), 'utf8');
const boot = `
window.__issue57MemoryStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
const session={id:'issue57-prototype',cwd:'PROTOTYPE'};
const sessionList={current:session.id,byId:{[session.id]:session},items:[session]};
window.MattSkillsCodex.mount(document.getElementById('root'),{
 sessions:{get:()=>session,list:{getSnapshot:()=>sessionList,subscribe:()=>()=>{}}},
 codexActions:{prefill:async()=>{throw new Error('Real host calls disabled in prototype')}},
 connection:{rpc:{call:async()=>({ok:false,error:{message:'仅原型：无真实后端'}})}}
},{sessionId:session.id,session,useSessions:s=>typeof s==='function'?s(sessionList):sessionList});`;
const html = `<!doctype html><html lang="zh-CN" data-theme="light"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>#57 技能动作交互 · 抛弃式原型</title><link rel="stylesheet" href="/prototype.css"><body><main id="root"></main><script>window.__issue57MemoryStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};</script><script src="/client.js"></script><script src="/boot.js"></script></body></html>`;
const resources = { '/': ['text/html', html], '/prototype.css': ['text/css', css], '/client.js': ['text/javascript', bundle.outputFiles[0].text + '\n;\n' + original], '/boot.js': ['text/javascript', boot] };
const server = createServer((req, res) => {
  const entry = resources[new URL(req.url, 'http://localhost').pathname];
  res.writeHead(entry ? 200 : 404, { 'Content-Type': (entry?.[0] || 'text/plain') + '; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'" });
  res.end(entry?.[1] || 'Prototype route not found');
});
server.listen(Number(process.env.SKILL_ACTIONS_PROTOTYPE_PORT || 43157), '127.0.0.1', () => console.log(`Issue #57 prototype: http://127.0.0.1:${server.address().port}/?variant=A`));
