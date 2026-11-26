// THROWAWAY preview server. No writes or live GitHub/host calls.
// Run: node prototypes/upstream-port/preview-visual.mjs
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
const here = new URL('.', import.meta.url);
const rows = [
  ['26','确认 Codex 风格的列表、详情与加载反馈','原型',[],['wozhendeshifwa'],'在现有操作习惯下，比较列表、详情和加载反馈的代表效果。',['展示明暗主题与窄侧栏。','覆盖加载、空列表、错误与重试。','记录用户真实反馈；确认后才推广。']],
  ['27','测量完整操作链的性能基线','任务',[],[],'测量面板打开、切页、滚动、详情、项目切换与刷新。',['区分首次启动与网络等待。','记录当前仓库与约 500 张任务的基线。']],
  ['28','推广已确认的 Codex 视觉与交互适配','任务',['26'],[],'将用户确认的代表方案推广到面板其他页面。',['先取得原型确认。','保留原有功能与草稿语义。']],
  ['29','依据实测优化完整操作链流畅度','任务',['28','27'],[],'用性能基线确定优化点，并复测完整操作链。',['点击及时反馈，网络等待仍可操作。','明确证据与未达到目标的取舍。']],
  ['31','确认新视觉适配与完整操作链流畅度','验收',['29','28'],[],'在真实 Codex 桌面中完成新视觉与性能的人工验收。',['核对明暗主题与窄栏。','覆盖完整操作链与项目切换。']],
];
const issues = rows.map(([key,title,kind,blockedBy,assignees,summary,acceptance])=>({key,title,kind,blockedBy,assignees,summary,acceptance,url:`https://github.com/wozhendeshifwa/matt_pocock_plugin/issues/${key}`}));
const anchor = '      Panel,\n      Settings,';
let runtime = (await readFile(new URL('browser-runtime.mjs',here),'utf8')).replaceAll('\r\n','\n');
if (runtime.split(anchor).length !== 2) throw new Error('PanelShell mount anchor changed');
runtime = `import { VisualPrototype } from './visual-prototype.mjs';\n` + runtime.replace(anchor,`      Panel: props => React.createElement(VisualPrototype, { ...props, connection: hostServices.connection, codexActions: hostServices.codexActions }),\n      Settings,`);
const bundle = await build({stdin:{contents:runtime,resolveDir:fileURLToPath(here),sourcefile:'visual-preview-runtime.mjs'},bundle:true,write:false,format:'iife',platform:'browser',define:{'process.env.NODE_ENV':'"development"'}});
const client = bundle.outputFiles[0].text + '\n' + await readFile(new URL('../../vendor/mattskills-1.8.0-rc.7/lib/client.js',here),'utf8');
const css = await readFile(new URL('theme.css',here),'utf8') + '\n' + await readFile(new URL('visual-prototype.css',here),'utf8');
const boot = `const issues=${JSON.stringify(issues)};
const session={id:'visual-preview-only',cwd:'C:/Users/27263/Desktop/matt_pocock_'};
const sessionList={current:session.id,byId:{[session.id]:session},items:[session]};
window.MattSkillsCodex.mount(document.getElementById('root'),{
 sessions:{get:()=>session,list:{getSnapshot:()=>sessionList,subscribe:()=>()=>{}}},
 codexActions:{prefill:async()=>{}},
 connection:{rpc:{call:async(c,e,r)=>r.method==='snapshot'?{ok:true,value:{issues}}:r.method==='issueDetail'?{ok:true,value:{issue:issues.find(i=>i.key===r.key)}}:{ok:true,value:{ok:false,error:{message:'该页面不在原型范围内'}}}}}
},{sessionId:session.id,session,useSessions:s=>typeof s==='function'?s(sessionList):sessionList});`;
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MattSkills · 视觉原型</title><link rel="stylesheet" href="/preview.css"><body><div id="preview-label">MattSkills 视觉原型 · 仅替换看板呈现 · 样例截至 2026-11-07 · 不连接真实写入</div><main id="root"></main><script src="/client.js"></script><script src="/boot.js"></script></body></html>`;
const resources = {'/':['text/html',html],'/preview.css':['text/css',css],'/client.js':['text/javascript',client],'/boot.js':['text/javascript',boot]};
const server=createServer((req,res)=>{ const entry=resources[new URL(req.url,'http://localhost').pathname]; if(!entry){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':entry[0]+'; charset=utf-8','Cache-Control':'no-store'});res.end(entry[1]); });
server.listen(Number(process.env.VISUAL_PREVIEW_PORT||43126),'127.0.0.1',()=>console.log(`Visual prototype: http://127.0.0.1:${server.address().port}/?variant=A`));
