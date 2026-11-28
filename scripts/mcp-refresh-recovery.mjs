import {readFile,writeFile,mkdir,realpath,stat,open} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';

const execFileAsync=promisify(execFile);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const samePath=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
const inside=(root,file)=>{const rel=path.relative(root,file);return !rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel);};
const alive=pid=>{try{process.kill(pid,0);return true;}catch(e){if(e.code==='ESRCH')return false;if(e.code==='EPERM')return true;throw e;}};
const exists=async file=>{try{await stat(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
const json=async file=>JSON.parse(await readFile(file,'utf8'));
const save=(file,value)=>writeFile(file,JSON.stringify(value,null,2)+'\n');
const events=text=>text.split('\n').flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
export const buildRecoveryPrompt=record=>`[MCP-REFRESH-RECOVERY:${record.token}] 刷新后端后的同一会话恢复。目标会话 ${record.thread}，项目 ${record.cwd}。先读取进度记录 ${record.checkpoint}，核对会话、项目、最新来源与已完成工作，再接续必要任务。保留现有草稿、模型、授权边界和明确暂停项；不要重新执行已完成动作。此为用户已授权的一次性自动恢复。`;
function terminalEvent(tail,turn){
 if(tail.some(e=>e.type==='event_msg'&&e.payload?.type==='task_started'&&e.payload.turn_id!==turn))return 'superseded';
 if(tail.some(e=>e.type==='event_msg'&&e.payload?.type==='task_complete'&&e.payload.turn_id===turn))return 'completed';
}

async function validateIdentity(record){
 if(!uuid.test(record.thread)||!uuid.test(record.turn))throw new Error('Explicit thread and turn UUIDs are required');
 const cwd=await realpath(record.cwd),checkpoint=await realpath(record.checkpoint),rollout=await realpath(record.rollout);
 if(!inside(cwd,checkpoint)||(await stat(checkpoint)).isFile()!==true)throw new Error('Checkpoint must be a file inside the project');
 const lines=events(await readFile(rollout,'utf8'));
 const meta=lines.find(e=>e.type==='session_meta')?.payload;
 if(meta?.id!==record.thread||!meta.cwd||!samePath(await realpath(meta.cwd),cwd))throw new Error('Rollout thread/project identity does not match');
 const starts=lines.filter(e=>e.type==='event_msg'&&e.payload?.type==='task_started');
 if(starts.at(-1)?.payload?.turn_id!==record.turn)throw new Error('Expected turn is not the latest started turn');
 if(!Number.isSafeInteger(record.mcpPid)||record.mcpPid<=0||record.mcpPid===process.pid)throw new Error('Explicit backend process identity is required');
 return {cwd,checkpoint,rollout,lines};
}

/** Prepare one bounded recovery intent; this does not refresh any server. */
export async function armRecovery(options,io={}){
 const {cwd,checkpoint,rollout,lines}=await validateIdentity(options);
 if(lines.some(e=>e.type==='event_msg'&&['turn_aborted','task_complete'].includes(e.payload?.type)&&e.payload.turn_id===options.turn))throw new Error('Expected turn already ended');
 if(!(io.isAlive??alive)(options.mcpPid))throw new Error('Backend process must still be alive when arming');
 const ttlSeconds=Number(options.ttlSeconds??120);
 if(!Number.isFinite(ttlSeconds)||ttlSeconds<=0||ttlSeconds>180)throw new Error('Recovery lease must expire within 180 seconds');
 const cli=await realpath(options.cli);
 const now=(io.now??Date.now)();
 const directory=path.join(cwd,'.scratch','mcp-refresh-recovery',options.thread);
 await mkdir(directory,{recursive:true});
 const token=randomUUID(),lease=path.join(directory,token+'.json');
 const record={version:1,token,thread:options.thread,turn:options.turn,cwd,checkpoint,rollout,mcpPid:options.mcpPid,cli,createdAt:now,expiresAt:now+ttlSeconds*1000,offset:(await stat(rollout)).size};
 await writeFile(lease,JSON.stringify(record,null,2)+'\n',{flag:'wx'});
 return {lease,record};
}

/** Cancellation is acknowledged only while dispatch has not been consumed. */
export async function cancelRecovery(lease){
 const record=await json(lease);
 await save(lease+'.cancelled',{token:record.token,cancelledAt:Date.now()});
 return {status:await exists(lease+'.consumed')?'already-consumed':'cancelled'};
}

async function appendedEvents(record){
 const handle=await open(record.rollout,'r');
 try{
  const size=(await handle.stat()).size;
  if(size<record.offset)throw new Error('Rollout was truncated after arming');
  if(size-record.offset>8*1024*1024)throw new Error('Recovery event window exceeded its bounded size');
  const bytes=Buffer.alloc(size-record.offset);
  await handle.read(bytes,0,bytes.length,record.offset);
  return events(bytes.toString('utf8'));
 }finally{await handle.close();}
}

/** Independent watcher; the only external mutation is one official queue call. */
export async function watchRecovery(lease,io={}){
 const record=await json(lease);
 if(record.version!==1||!uuid.test(record.token)||!Number.isSafeInteger(record.offset)||record.offset<0||!Number.isFinite(record.createdAt)||!Number.isFinite(record.expiresAt)||record.expiresAt<=record.createdAt||record.expiresAt-record.createdAt>180000)throw new Error('Invalid bounded lease');
 const identity=await validateIdentity(record);
 if(!inside(identity.cwd,await realpath(lease)))throw new Error('Lease must stay inside its project');
 const now=io.now??Date.now,sleep=io.sleep??(ms=>new Promise(r=>setTimeout(r,ms))),isAlive=io.isAlive??alive;
 const finish=async result=>{const value={token:record.token,thread:record.thread,...result};await save(lease+'.result.json',value);return value;};
 try{await mkdir(lease+'.watch-lock');}catch(e){if(e.code==='EEXIST')return {status:'already-watched'};throw e;}
 await save(lease+'.ready.json',{token:record.token,pid:process.pid,readyAt:now()});
 while(now()<record.expiresAt){
  if(await exists(lease+'.cancelled'))return finish({status:'cancelled'});
  const tail=await appendedEvents(record);
  const terminal=terminalEvent(tail,record.turn);if(terminal)return finish({status:terminal});
  const interrupted=tail.some(e=>e.type==='event_msg'&&e.payload?.type==='turn_aborted'&&e.payload.turn_id===record.turn&&e.payload.reason==='interrupted');
  if(interrupted&&!isAlive(record.mcpPid)){
   await sleep(io.settleMs??2000);
   if(now()>=record.expiresAt)return finish({status:'expired'});
   if(await exists(lease+'.cancelled'))return finish({status:'cancelled'});
   const settled=terminalEvent(await appendedEvents(record),record.turn);if(settled)return finish({status:settled});
   try{await writeFile(lease+'.consumed',record.token,{flag:'wx'});}catch(e){if(e.code==='EEXIST')return {status:'already-consumed'};throw e;}
   if(await exists(lease+'.cancelled'))return finish({status:'cancelled'});
   const message=buildRecoveryPrompt(record);
   try{
    const result=await (io.runCli??((cli,args)=>execFileAsync(cli,args,{cwd:record.cwd,windowsHide:true,timeout:15000,maxBuffer:65536})))(record.cli,['queue','--thread',record.thread,'--message',message,'--resume']);
    const stdout=String(result.stdout??''),stderr=String(result.stderr??'');
    const acknowledged=stdout.includes('Queued message ')&&stdout.includes('for thread '+record.thread);
    return finish({status:acknowledged?'queued':'unconfirmed',resumeRequested:true,resumeVerified:false,resumeWarning:/could not resume|cannot resume/i.test(stderr),stdout,stderr,dispatchedAt:now()});
   }catch(error){return finish({status:'failed',resumeVerified:false,error:error.message,stdout:String(error.stdout??''),stderr:String(error.stderr??'')});}
  }
  await sleep(io.pollMs??250);
 }
 return finish({status:'expired'});
}

async function main(){
 const [command,...argv]=process.argv.slice(2),args={};
 for(let i=0;i<argv.length;i+=2){if(!argv[i]?.startsWith('--')||argv[i+1]===undefined)throw new Error('Expected --name value pairs');args[argv[i].slice(2)]=argv[i+1];}
 if(command==='arm')console.log(JSON.stringify(await armRecovery({thread:args.thread,turn:args.turn,cwd:args.cwd??process.cwd(),checkpoint:args.checkpoint,rollout:args.rollout,mcpPid:Number(args['mcp-pid']),cli:args.cli,ttlSeconds:args['ttl-seconds']??120})));
 else if(command==='watch')console.log(JSON.stringify(await watchRecovery(args.lease)));
 else if(command==='cancel')console.log(JSON.stringify(await cancelRecovery(args.lease)));
 else throw new Error('Usage: node scripts/mcp-refresh-recovery.mjs arm|watch|cancel --name value ...');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});
