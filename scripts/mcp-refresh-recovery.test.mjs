import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,appendFile,readFile,rm,realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {armRecovery,watchRecovery,cancelRecovery} from './mcp-refresh-recovery.mjs';

const thread='11111111-1111-7111-8111-111111111111';
const turn='22222222-2222-7222-8222-222222222222';
const event=(type,extra={})=>JSON.stringify({type:'event_msg',payload:{type,turn_id:turn,...extra}})+'\n';
async function fixture(){
 const cwd=await mkdtemp(path.join(os.tmpdir(),'deck-recovery-'));
 const rollout=path.join(cwd,'rollout.jsonl'),checkpoint=path.join(cwd,'checkpoint.md');
 await writeFile(checkpoint,'Continue the existing project; paused work stays paused.');
 await writeFile(rollout,JSON.stringify({type:'session_meta',payload:{id:thread,cwd}})+'\n'+event('task_started'));
 return {cwd,rollout,checkpoint,thread,turn,mcpPid:12345,cli:process.execPath,ttlSeconds:10,dispose:()=>rm(cwd,{recursive:true,force:true})};
}
test('queues one exact-thread recovery only after matching interruption and backend exit',async()=>{
 const f=await fixture();try{
  const {lease}=await armRecovery(f,{isAlive:()=>true});
  await appendFile(f.rollout,event('turn_aborted',{reason:'interrupted'}));
  const calls=[];
  const result=await watchRecovery(lease,{isAlive:()=>false,settleMs:0,runCli:async(cli,args)=>{calls.push({cli,args});return {stdout:`Queued message abc for thread ${thread}.`,stderr:''};}});
  assert.equal(result.status,'queued');assert.equal(result.resumeVerified,false);
  assert.equal(calls.length,1);assert.equal(calls[0].args[0],'queue');
  assert.equal(calls[0].args[calls[0].args.indexOf('--thread')+1],thread);
  assert.ok(calls[0].args.includes('--resume'));
  assert.ok(calls[0].args[calls[0].args.indexOf('--message')+1].includes(await realpath(f.checkpoint)));
 }finally{await f.dispose();}
});

test('cannot arm a turn that already ended',async()=>{
 const f=await fixture();try{
  await appendFile(f.rollout,event('turn_aborted',{reason:'interrupted'}));
  await assert.rejects(armRecovery(f,{isAlive:()=>true}),/already ended/);
 }finally{await f.dispose();}
});

test('normal completion prevents recovery even when interruption and backend exit were observed',async()=>{
 const f=await fixture();try{
  const {lease}=await armRecovery(f,{isAlive:()=>true});
  await appendFile(f.rollout,event('turn_aborted',{reason:'interrupted'})+event('task_complete'));
  let calls=0;
  const result=await watchRecovery(lease,{isAlive:()=>false,runCli:async()=>{calls++;return {};}});
  assert.equal(result.status,'completed');assert.equal(calls,0);
  await assert.rejects(armRecovery(f,{isAlive:()=>true}),/already ended/);
 }finally{await f.dispose();}
});

test('default CLI executor preserves exact arguments and project through a real fake-CLI subprocess',async()=>{
 const f=await fixture();try{
  // Node acts as the executable; its first argument is a temporary fake queue
  // command in the project cwd. No shell, real Codex or runCli replacement.
  await writeFile(path.join(f.cwd,'queue'),`const fs=require('node:fs');
const argv=process.argv.slice(2);
fs.writeFileSync('fake-cli-capture.json',JSON.stringify({argv,cwd:process.cwd()}));
const thread=argv[argv.indexOf('--thread')+1];
process.stdout.write('Queued message fake-child for thread '+thread+'.');
process.stderr.write('Warning: message was queued, but could not resume thread');
`);
  const {lease,record}=await armRecovery(f,{isAlive:()=>true});
  await appendFile(f.rollout,event('turn_aborted',{reason:'interrupted'}));
  const result=await watchRecovery(lease,{isAlive:()=>false,settleMs:0});
  assert.equal(result.status,'queued');assert.equal(result.resumeWarning,true);assert.equal(result.resumeVerified,false);
  const capture=JSON.parse(await readFile(path.join(f.cwd,'fake-cli-capture.json'),'utf8'));
  assert.equal(await realpath(capture.cwd),await realpath(f.cwd));
  assert.deepEqual(capture.argv.slice(0,3),['--thread',thread,'--message']);
  assert.equal(capture.argv.length,5);assert.equal(capture.argv[4],'--resume');
  assert.ok(capture.argv[3].includes('[MCP-REFRESH-RECOVERY:'+record.token+']'));
  assert.ok(capture.argv[3].includes(await realpath(f.checkpoint)));
  assert.ok(capture.argv[3].includes(await realpath(f.cwd)));
 }finally{await f.dispose();}
});

test('a newly resumed turn during settling cancels the pending recovery',async()=>{
 const f=await fixture();try{
  const {lease}=await armRecovery(f,{isAlive:()=>true});
  await appendFile(f.rollout,event('turn_aborted',{reason:'interrupted'}));
  let calls=0;
  const result=await watchRecovery(lease,{isAlive:()=>false,sleep:async()=>appendFile(f.rollout,event('task_started',{turn_id:'33333333-3333-7333-8333-333333333333'})),runCli:async()=>{calls++;return {stdout:''};}});
  assert.equal(result.status,'superseded');assert.equal(calls,0);
 }finally{await f.dispose();}
});

for(const [name,abort,dead] of [['manual interruption without a backend refresh',true,false],['backend exit without a matching interruption',false,true]]){
 test(name+' expires without sending',async()=>{
  const f=await fixture();try{
   let clock=1000,calls=0;
   const {lease}=await armRecovery({...f,ttlSeconds:.1},{isAlive:()=>true,now:()=>clock});
   if(abort)await appendFile(f.rollout,event('turn_aborted',{reason:'interrupted'}));
   const result=await watchRecovery(lease,{now:()=>clock,sleep:async ms=>{clock+=ms;},isAlive:()=>!dead,pollMs:50,runCli:async()=>{calls++;return {};}});
   assert.equal(result.status,'expired');assert.equal(calls,0);
  }finally{await f.dispose();}
 });
}

test('a wrong turn interruption never wakes another turn',async()=>{
 const f=await fixture();try{
  let clock=1000,calls=0;
  const {lease}=await armRecovery({...f,ttlSeconds:.1},{isAlive:()=>true,now:()=>clock});
  await appendFile(f.rollout,event('turn_aborted',{turn_id:'33333333-3333-7333-8333-333333333333',reason:'interrupted'}));
  const result=await watchRecovery(lease,{now:()=>clock,sleep:async ms=>{clock+=ms;},isAlive:()=>false,pollMs:50,runCli:async()=>{calls++;return {};}});
  assert.equal(result.status,'expired');assert.equal(calls,0);
 }finally{await f.dispose();}
});

test('cancelled intent cannot send, even after interruption and backend exit',async()=>{
 const f=await fixture();try{
  const {lease}=await armRecovery(f,{isAlive:()=>true});
  assert.equal((await cancelRecovery(lease)).status,'cancelled');
  await appendFile(f.rollout,event('turn_aborted',{reason:'interrupted'}));
  let calls=0;
  assert.equal((await watchRecovery(lease,{isAlive:()=>false,runCli:async()=>{calls++;return {};}})).status,'cancelled');
  assert.equal(calls,0);
 }finally{await f.dispose();}
});

test('concurrent and repeated watchers send at most once; cancellation reports a consumed dispatch',async()=>{
 const f=await fixture();try{
  const {lease}=await armRecovery(f,{isAlive:()=>true});
  await appendFile(f.rollout,event('turn_aborted',{reason:'interrupted'}));
  let calls=0;
  const io={isAlive:()=>false,settleMs:0,runCli:async()=>{calls++;assert.equal((await cancelRecovery(lease)).status,'already-consumed');return {stdout:`Queued message one for thread ${thread}.`,stderr:''};}};
  const results=await Promise.all([watchRecovery(lease,io),watchRecovery(lease,io)]);
  assert.equal(calls,1);assert.equal(results.filter(r=>r.status==='queued').length,1);
  assert.equal((await watchRecovery(lease,io)).status,'already-watched');assert.equal(calls,1);
 }finally{await f.dispose();}
});

test('CLI resume warning is queued evidence, never verified recovery',async()=>{
 const f=await fixture();try{
  const {lease}=await armRecovery(f,{isAlive:()=>true});
  await appendFile(f.rollout,event('turn_aborted',{reason:'interrupted'}));
  const result=await watchRecovery(lease,{isAlive:()=>false,settleMs:0,runCli:async()=>({stdout:`Queued message one for thread ${thread}.`,stderr:'Warning: message was queued, but could not resume thread'})});
  assert.equal(result.status,'queued');assert.equal(result.resumeWarning,true);assert.equal(result.resumeVerified,false);
  assert.deepEqual(JSON.parse(await readFile(lease+'.result.json','utf8')),result);
 }finally{await f.dispose();}
});

test('CLI failure is persisted and never retried',async()=>{
 const f=await fixture();try{
  const {lease}=await armRecovery(f,{isAlive:()=>true});
  await appendFile(f.rollout,event('turn_aborted',{reason:'interrupted'}));
  let calls=0;const io={isAlive:()=>false,settleMs:0,runCli:async()=>{calls++;throw new Error('Controlled CLI unavailable');}};
  const result=await watchRecovery(lease,io);assert.equal(result.status,'failed');assert.match(result.error,/Controlled CLI/);
  await watchRecovery(lease,io);assert.equal(calls,1);
 }finally{await f.dispose();}
});

test('wrong thread, cwd and external checkpoint refuse arming',async()=>{
 const f=await fixture(),other=await fixture();try{
  await assert.rejects(armRecovery({...f,thread:'33333333-3333-7333-8333-333333333333'},{isAlive:()=>true}),/identity/);
  await assert.rejects(armRecovery({...f,cwd:other.cwd,checkpoint:other.checkpoint},{isAlive:()=>true}),/identity/);
  await assert.rejects(armRecovery({...f,checkpoint:other.checkpoint},{isAlive:()=>true}),/inside the project/);
  await assert.rejects(armRecovery({...f,ttlSeconds:181},{isAlive:()=>true}),/180/);
 }finally{await f.dispose();await other.dispose();}
});

test('an edited lease cannot extend recovery beyond the maximum lifetime',async()=>{
 const f=await fixture();try{
  const {lease,record}=await armRecovery(f,{isAlive:()=>true});
  await writeFile(lease,JSON.stringify({...record,expiresAt:record.createdAt+3600000}));
  await appendFile(f.rollout,event('turn_aborted',{reason:'interrupted'}));
  await assert.rejects(watchRecovery(lease,{isAlive:()=>false,settleMs:0,runCli:async()=>({stdout:''})}),/bounded lease/);
 }finally{await f.dispose();}
});

test('real backend subprocess exit and appended rollout unlock the one queue call',{timeout:5000},async()=>{
 const f=await fixture();
 const child=spawn(process.execPath,['-e',"process.stdin.resume();process.stdin.on('end',()=>process.exit(0));process.stdout.write('ready');"],{stdio:['pipe','pipe','ignore'],windowsHide:true});
 const exited=once(child,'exit');
 try{
  await once(child.stdout,'data');
  const {lease}=await armRecovery({...f,mcpPid:child.pid});
  let calls=0;
  const watching=watchRecovery(lease,{settleMs:0,pollMs:10,runCli:async()=>{calls++;return {stdout:`Queued message real-boundary for thread ${thread}.`,stderr:''};}});
  await appendFile(f.rollout,event('turn_aborted',{reason:'interrupted'}));
  child.stdin.end();await exited;
  assert.equal((await watching).status,'queued');assert.equal(calls,1);
 }finally{if(child.exitCode===null)child.kill();await exited;await f.dispose();}
});
