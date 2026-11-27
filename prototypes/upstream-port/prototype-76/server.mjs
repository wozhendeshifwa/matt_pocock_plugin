// THROWAWAY #76: existing board route, three ?variant= renderings, stubbed host.
import {createServer} from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
if (process.env.NODE_ENV === 'production') throw new Error('Prototype is development-only');
const here = path.dirname(fileURLToPath(import.meta.url));
// Reuse installed dependencies without installing or editing configuration.
const source = path.resolve(process.argv[2] || path.join(here, '../../../..'));
const out = path.join(here, '.generated');
await mkdir(out, {recursive:true});
const build = spawnSync(process.execPath, [path.join(source,'prototypes/upstream-port/build.mjs'),'--outdir',out], {cwd:source,encoding:'utf8',windowsHide:true});
if(build.status !== 0) throw new Error(build.stderr || build.stdout);
let client = await readFile(path.join(out,'client.js'),'utf8');
const anchor = 'const BottomActionBar = function (props) {';
if(client.split(anchor).length !== 2) throw new Error('Prototype mount boundary changed');
// Replace the old panel in the disposable build. No product source is changed.
client = client.replace(anchor, anchor + " return React.createElement('div', {'data-prototype-actions': true});");
const files = {
 '/client.js':['text/javascript',client],
 '/theme.css':['text/css',await readFile(path.join(source,'prototypes/upstream-port/theme.css'))],
 '/demo.js':['text/javascript',await readFile(path.join(here,'demo.js'))],
 '/demo.css':['text/css',await readFile(path.join(here,'demo.css'))],
 '/':['text/html',`<!doctype html><html lang="zh-CN" data-theme="light"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>#76 · 移除草稿面板 · 抛弃式原型</title><link rel="stylesheet" href="/theme.css"><link rel="stylesheet" href="/demo.css"><body><header id="lab"></header><div id="canvas"><main id="root"></main></div><aside id="inspector"></aside><nav id="switcher" aria-label="原型方案切换"></nav><script src="/client.js"></script><script src="/demo.js"></script></body></html>`]
};
createServer((req,res)=>{const file=files[new URL(req.url,'http://localhost').pathname];res.writeHead(file?200:404,{'Content-Type':file?file[0]+'; charset=utf-8':'text/plain','Cache-Control':'no-store'});res.end(file?file[1]:'Not found');}).listen(4176,'127.0.0.1',()=>console.log('PROTOTYPE ONLY http://127.0.0.1:4176/?variant=A'));
