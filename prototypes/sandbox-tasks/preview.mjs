// Development acceptance surface, bound to one disposable project. It is not
// the production transport (which uses a local named pipe and host identity).
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { callService } from './service.mjs';
import { SANDBOX_READS, SANDBOX_WRITES } from './adapter.mjs';
const require = createRequire(new URL('../upstream-port/package.json', import.meta.url));
const { build } = require('esbuild');
const project = process.argv[2], config = process.argv[3];
const key = randomUUID();
const bundle = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {createSandboxTaskView} from ${JSON.stringify(fileURLToPath(new URL('view.mjs', import.meta.url)))};const View=createSandboxTaskView(React);const service={call:async(method,input)=>{const r=await fetch('/${key}/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,input})});const j=await r.json();if(j.error)throw new Error(j.error);return j.value;},loadIssue:async()=>({number:53,title:'UI验收夹具',body:'只读演练任务预览'})};createRoot(document.getElementById('root')).render(React.createElement(View,{sandboxTasks:service}));`, resolveDir: fileURLToPath(new URL('../upstream-port/', import.meta.url)), loader: 'js' }, bundle: true, write: false, format: 'iife', define: { 'process.env.NODE_ENV': '"production"' } });
const script = bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font:14px system-ui;background:#f6f7f8;color:#24292f}#root{max-width:850px;margin:auto}</style><main id="root"></main><script>${script}</script></html>`;
const server = http.createServer(async (request, response) => {
  if (request.url === `/${key}` && request.method === 'GET') { response.setHeader('Content-Type', 'text/html;charset=utf-8'); response.end(html); return; }
  if (request.url !== `/${key}/rpc` || request.method !== 'POST' || request.headers.origin !== `http://127.0.0.1:${server.address().port}`) { response.writeHead(403); response.end(); return; }
  let raw = '';
  for await (const bytes of request) { raw += bytes; if (raw.length > 80000) { response.writeHead(413); response.end(); return; } }
  try { const input = JSON.parse(raw); if (!SANDBOX_READS.has(input.method) && !SANDBOX_WRITES.has(input.method)) throw new Error('未知操作'); const value = await callService(project, input.method, input.input, config); response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ value })); }
  catch (error) { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ error: error.message })); }
});
server.listen(0, '127.0.0.1', () => console.log(`http://127.0.0.1:${server.address().port}/${key}`));
