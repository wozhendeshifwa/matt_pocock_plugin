// Measure subprocess spans in the real adapter host, without logging argv,
// output, credentials, repository contents, or modifying production code.
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { mkdir, mkdtemp, writeFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const output=path.join(root,'.scratch/performance-baseline');
await mkdir(output,{recursive:true});
const reuse=process.argv.includes('--reuse');
let dataRoot;
if(reuse){
  const dirs=await Promise.all((await readdir(output)).filter(n=>/^read-path-[a-z0-9]+$/i.test(n)).map(async name=>({name,info:await stat(path.join(output,name))})));
  dirs.sort((a,b)=>b.info.mtimeMs-a.info.mtimeMs);
  if(!dirs.length)throw Error('Run a fresh measurement first');
  dataRoot=path.join(output,dirs[0].name);
}else dataRoot=await mkdtemp(path.join(output,'read-path-'));
const spans=[];
let phase='initialize';
const originalSpawn=childProcess.spawn;
childProcess.spawn=function(program,args,options){
  const span={phase,program:path.basename(String(program)),operation:['api','auth','repo','issue','pr'].includes(args?.[0])?args[0]:'local',start:performance.now()};
  spans.push(span);
  const child=originalSpawn.call(this,program,args,options);
  child.once('close',code=>{span.ms=performance.now()-span.start;span.code=code;});
  child.once('error',()=>{span.spawnError=true;});
  return child;
};
syncBuiltinESMExports();
const {createOriginalHost}=await import('./node-host.mjs');
process.chdir(dataRoot);
const report={at:new Date().toISOString(),reuseDiskCache:reuse,dataDirectory:path.basename(dataRoot),scope:'Real adapter host in isolated data directory; bypasses MCP and project-worker IPC. Spans contain program/category/timing only.',calls:[],spans};
let host;
const watchdog=setTimeout(()=>{host?.dispose();process.exitCode=1;},90000);
try{
  let start=performance.now();host=await createOriginalHost({dataRoot,workspaceRoot:root});
  report.initializeMs=performance.now()-start;
  for(const method of reuse?['snapshot','snapshot']:['snapshot','snapshot','refresh','snapshot','refresh']){
    phase=method+'-'+report.calls.length;start=performance.now();
    const reply=await host.call(method,{});
    const end=performance.now();
    const row={phase,method,start,ms:end-start,ok:reply.ok&&reply.value?.ok!==false,records:reply.value?.issues?.length};
    report.calls.push(row);console.log(JSON.stringify(row));
  }
}catch(error){report.error=error.message;process.exitCode=1;}
finally{
  clearTimeout(watchdog);host?.dispose();
  childProcess.spawn=originalSpawn;syncBuiltinESMExports();
  await writeFile(path.join(output,reuse?'read-path-reuse.json':'read-path.json'),JSON.stringify(report,null,2));
}
