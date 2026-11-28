import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,appendFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {once} from 'node:events';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {armRecovery,cancelRecovery} from './mcp-refresh-recovery.mjs';
import {watchConnectorRecovery,claimConnectorDispatch} from './mcp-refresh-connector-recovery.mjs';

const thread='11111111-1111-7111-8111-111111111111';
const turn='22222222-2222-7222-8222-222222222222';
const event=(type,extra={})=>JSON.stringify({type:'event_msg',payload:{type,turn_id:turn,...extra}})+'\n';
async function fixture(){
 const cwd=await mkdtemp(path.join(os.tmpdir(),'deck-connector-recovery-'));
 const rollout=path.join(cwd,'rollout.jsonl'),checkpoint=path.join(cwd,'checkpoint.md');
 await writeFile(checkpoint,'Continue the existing project; paused work stays paused.');
 await writeFile(rollout,JSON.stringify({type:'session_meta',payload:{id:thread,cwd}})+'\n'+event('task_started'));
 const {lease,record}=await armRecovery({cwd,rollout,checkpoint,thread,turn,mcpPid:12345,cli:process.execPath,ttlSeconds:10},{isAlive:()=>true});
 return {cwd,rollout,checkpoint,lease,record,dispose:()=>rm(cwd,{recursive:true,force:true})};
}
test('connector recovery produces one exact-thread request without claiming delivery or running a CLI',async()=>{
 const f=await fixture();try{
  await appendFile(f.rollout,event('turn_aborted',{reason:'interrupted'}));
  const result=await watchConnectorRecovery(f.lease,{isAlive:()=>false,settleMs:0,runCli:()=>{throw new Error('Must never run CLI');}});
  assert.equal(result.status,'connector-requested');assert.equal(result.resumeVerified,false);assert.equal(result.deliveryVerified,false);
  const request=JSON.parse(await readFile(f.lease+'.connector-request.json','utf8'));
  assert.equal(request.thread,thread);assert.equal(request.turn,turn);assert.equal(request.token,f.record.token);
  assert.ok(request.prompt.includes(f.record.checkpoint));assert.ok(request.prompt.includes(f.record.cwd));
  assert.equal((await watchConnectorRecovery(f.lease,{isAlive:()=>false,settleMs:0})).status,'already-watched');
 }finally{await f.dispose();}
});
test('one guardian can claim the exact original request, without claiming it has been sent',async()=>{
 const f=await fixture();try{
  await appendFile(f.rollout,event('turn_aborted',{reason:'interrupted'}));
  await watchConnectorRecovery(f.lease,{isAlive:()=>false,settleMs:0});
  const results=await Promise.all([claimConnectorDispatch(f.lease,{isAlive:()=>false}),claimConnectorDispatch(f.lease,{isAlive:()=>false})]);
  const claimed=results.find(r=>r.status==='claimed');
  assert.equal(results.filter(r=>r.status==='claimed').length,1);
  assert.equal(results.filter(r=>r.status==='already-claimed').length,1);
  assert.equal(claimed.thread,thread);assert.equal(claimed.deliveryVerified,false);assert.equal(claimed.resumeVerified,false);
  assert.match(claimed.prompt,/MCP-REFRESH-RECOVERY:/);
 }finally{await f.dispose();}
});
for(const [name,interrupted,dead] of [['no interruption',false,true],['backend still alive',true,false]]){
 test(name+' never creates a connector request',async()=>{
  const f=await fixture();try{
   let clock=f.record.createdAt;
   if(interrupted)await appendFile(f.rollout,event('turn_aborted',{reason:'interrupted'}));
   const result=await watchConnectorRecovery(f.lease,{now:()=>clock,sleep:async()=>{clock=f.record.expiresAt;},isAlive:()=>!dead});
   assert.equal(result.status,'expired');
   await assert.rejects(readFile(f.lease+'.connector-request.json'),{code:'ENOENT'});
  }finally{await f.dispose();}
 });
}
for(const terminal of ['cancelled','completed','superseded']){
 test(terminal+' prevents the watcher creating any request',async()=>{
  const f=await fixture();try{
   await appendFile(f.rollout,event('turn_aborted',{reason:'interrupted'}));
   if(terminal==='cancelled')await cancelRecovery(f.lease);
   if(terminal==='completed')await appendFile(f.rollout,event('task_complete'));
   if(terminal==='superseded')await appendFile(f.rollout,event('task_started',{turn_id:'33333333-3333-7333-8333-333333333333'}));
   if(terminal==='superseded')await assert.rejects(watchConnectorRecovery(f.lease,{isAlive:()=>false,settleMs:0}),/latest started turn/);
   else assert.equal((await watchConnectorRecovery(f.lease,{isAlive:()=>false,settleMs:0})).status,terminal);
   await assert.rejects(readFile(f.lease+'.connector-request.json'),{code:'ENOENT'});
  }finally{await f.dispose();}
 });
}
for(const terminal of ['cancelled','completed','superseded','expired','not-ready']){
 test('guardian rechecks '+terminal+' after the request was created',async()=>{
  const f=await fixture();try{
   await appendFile(f.rollout,event('turn_aborted',{reason:'interrupted'}));
   await watchConnectorRecovery(f.lease,{isAlive:()=>false,settleMs:0});
   if(terminal==='cancelled')await cancelRecovery(f.lease);
   if(terminal==='completed')await appendFile(f.rollout,event('task_complete'));
   if(terminal==='superseded')await appendFile(f.rollout,event('task_started',{turn_id:'33333333-3333-7333-8333-333333333333'}));
   const result=await claimConnectorDispatch(f.lease,{isAlive:()=>terminal==='not-ready',now:()=>terminal==='expired'?f.record.expiresAt:f.record.createdAt});
   assert.equal(result.status,terminal);assert.equal(result.prompt,undefined);
   await assert.rejects(readFile(f.lease+'.connector-claimed.json'),{code:'ENOENT'});
  }finally{await f.dispose();}
 });
}
test('guardian rejects a modified prompt, changed project identity, and a lease longer than 180 seconds',async()=>{
 const f=await fixture();try{
  await appendFile(f.rollout,event('turn_aborted',{reason:'interrupted'}));
  await watchConnectorRecovery(f.lease,{isAlive:()=>false,settleMs:0});
  const requestPath=f.lease+'.connector-request.json';
  const request=JSON.parse(await readFile(requestPath,'utf8'));
  await writeFile(requestPath,JSON.stringify({...request,prompt:'Unrelated instructions'}));
  await assert.rejects(claimConnectorDispatch(f.lease,{isAlive:()=>false}),/request does not match/);
  await writeFile(requestPath,JSON.stringify(request));
  const original=await readFile(f.rollout,'utf8');
  await writeFile(f.rollout,original.replace(thread,'33333333-3333-7333-8333-333333333333'));
  await assert.rejects(claimConnectorDispatch(f.lease,{isAlive:()=>false}),/identity/);
  await writeFile(f.rollout,original);
  await writeFile(f.lease,JSON.stringify({...f.record,expiresAt:f.record.createdAt+180001}));
  await assert.rejects(claimConnectorDispatch(f.lease,{isAlive:()=>false}),/bounded connector lease/);
  await assert.rejects(watchConnectorRecovery(f.lease,{isAlive:()=>false}),/bounded lease/);
 }finally{await f.dispose();}
});
test('request-file collision is a failure without replacing the original or retrying',async()=>{
 const f=await fixture();try{
  await writeFile(f.lease+'.connector-request.json','existing request');
  await appendFile(f.rollout,event('turn_aborted',{reason:'interrupted'}));
  assert.equal((await watchConnectorRecovery(f.lease,{isAlive:()=>false,settleMs:0})).status,'failed');
  assert.equal(await readFile(f.lease+'.connector-request.json','utf8'),'existing request');
  assert.equal((await watchConnectorRecovery(f.lease,{isAlive:()=>false,settleMs:0})).status,'already-watched');
 }finally{await f.dispose();}
});
test('independent watch and claim command entries use real files and backend exit without Codex',{timeout:8000},async()=>{
 const f=await fixture();
 const child=spawn(process.execPath,['-e',"process.stdin.resume();process.stdin.on('end',()=>process.exit(0));process.stdout.write('ready');"],{stdio:['pipe','pipe','ignore'],windowsHide:true});
 const exited=once(child,'exit');
 try{
  await once(child.stdout,'data');
  const {lease}=await armRecovery({cwd:f.cwd,rollout:f.rollout,checkpoint:f.checkpoint,thread,turn,mcpPid:child.pid,cli:process.execPath,ttlSeconds:10});
  await appendFile(f.rollout,event('turn_aborted',{reason:'interrupted'}));
  child.stdin.end();await exited;
  const script=fileURLToPath(new URL('./mcp-refresh-connector-recovery.mjs',import.meta.url));
  const run=promisify(execFile);
  const watched=JSON.parse((await run(process.execPath,[script,'watch','--lease',lease],{windowsHide:true,timeout:5000})).stdout);
  assert.equal(watched.status,'connector-requested');assert.equal(watched.deliveryVerified,false);
  const claimed=JSON.parse((await run(process.execPath,[script,'claim','--lease',lease],{windowsHide:true,timeout:2000})).stdout);
  assert.equal(claimed.status,'claimed');assert.equal(claimed.thread,thread);assert.equal(claimed.resumeVerified,false);
 }finally{if(child.exitCode===null)child.kill();await exited;await f.dispose();}
});
