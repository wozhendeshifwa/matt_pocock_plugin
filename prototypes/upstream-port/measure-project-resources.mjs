// Isolated project-host lifecycle baseline; two fixture workspace identities
// inside this repository. No GitHub mutations or user configuration writes.
import { createProjectHosts } from './project-hosts.mjs';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const directory=fileURLToPath(new URL('../../.scratch/performance-baseline/workers/',import.meta.url));
await mkdir(directory,{recursive:true});
const hosts=createProjectHosts(directory);
const projects=[fileURLToPath(new URL('../../',import.meta.url)),fileURLToPath(new URL('./',import.meta.url))];
function resources(){
  const command=`$items = @(Get-CimInstance Win32_Process -Filter 'ParentProcessId = ${process.pid}' | Where-Object { $_.Name -eq 'node.exe' } | ForEach-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue } | Select-Object WorkingSet64,PrivateMemorySize64,CPU); ConvertTo-Json -InputObject $items -Compress`;
  return JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',command],{encoding:'utf8',windowsHide:true}));
}
const samples=[];
try {
  for(const index of [0,1,0]){
    const start=performance.now();await hosts.call(projects[index],'__deck_tools_list__',{});
    const ms=performance.now()-start;
    samples.push({project:index,callMs:ms,workers:resources()});
  }
  await new Promise(r=>setTimeout(r,3000));
  samples.push({idleSeconds:3,workers:resources()});
  const report={at:new Date().toISOString(),scope:'Actual createProjectHosts, two simulated workspace identities within this repository; tools-list initialization only, not loaded GitHub datasets.',samples};
  await writeFile(new URL('../../.scratch/performance-baseline/project-resources.json',import.meta.url),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} finally {await hosts.dispose();}
