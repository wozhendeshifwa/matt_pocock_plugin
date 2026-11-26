import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createProjectHosts } from './project-hosts.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const output=path.join(root,'.scratch/performance-baseline');
await mkdir(output,{recursive:true});
const directory=await mkdtemp(path.join(output,'startup-cache-'));
let hosts=createProjectHosts(directory);
const rows=[];
async function measure(label,method){
  const start=performance.now();
  const reply=await hosts.call(root,method,{});
  rows.push({label,ms:performance.now()-start,ok:reply?.ok,cacheHit:!!reply?.value?.fromCache,records:reply?.value?.issues?.length});
  console.log(JSON.stringify(rows.at(-1)));
  return reply;
}
try{
  assert.equal((await measure('empty cache','portSnapshotCache')).value,null);
  assert.ok((await measure('first real snapshot','snapshot')).value.ok);
  await hosts.dispose();hosts=createProjectHosts(directory);
  const cached=await measure('new worker cache hydration','portSnapshotCache');
  assert.ok(cached.value?.ok && cached.value.fromCache);
  assert.ok((await measure('eventual real snapshot','snapshot')).value.ok);
}finally{
  await hosts.dispose();
  await writeFile(path.join(output,'startup-cache.json'),JSON.stringify({at:new Date().toISOString(),scope:'Real isolated project workers; excludes MCP/UI transport and paint',rows},null,2));
}
