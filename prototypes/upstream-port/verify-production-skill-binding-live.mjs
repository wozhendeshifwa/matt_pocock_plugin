// Explicit live acceptance of the fixed production source. Writes only plugin data.
import { fork } from 'node:child_process';
import * as fs from 'node:fs/promises';
import path from 'node:path';
const [data,project]=process.argv.slice(2);
if(!data||!project||!path.isAbsolute(data)||!path.isAbsolute(project)) throw Error('Usage: node verify-production-skill-binding-live.mjs ABS_DATA_ROOT ABS_PROJECT_ROOT');
await fs.mkdir(data,{recursive:true});
const child=fork(new URL('./project-worker.mjs',import.meta.url),[project],{cwd:data,execArgv:[],windowsHide:true,stdio:['ignore','ignore','pipe','ipc']});
let sequence=0;const pending=new Map();
child.stderr.on('data',()=>{});
child.on('message',message=>{const entry=pending.get(message.id);if(entry){pending.delete(message.id);message.error?entry.reject(Error(message.error)):entry.resolve(message.result);}});
child.on('exit',()=>{for(const item of pending.values())item.reject(Error('worker-exited'));});
function call(method,payload={}){return new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});child.send({id,method,payload});});}
const timer=setTimeout(()=>child.kill(),120000);
try {
 const first=(await call('skill.prepare',{name:'tdd'})).value;
 const second=(await call('skill.prepare',{name:'tdd'})).value;
 const document=(await call('skill.readDoc',{name:'tdd'})).value;
 console.log(JSON.stringify({first,second,document:{path:document.path,source:document.source,execution:document.execution}},null,2));
 if(!first.latest||!second.latest)process.exitCode=1;
} finally {clearTimeout(timer);child.kill();}
