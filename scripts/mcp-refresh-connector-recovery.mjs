import {readFile,writeFile,realpath,stat} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {watchRecovery,buildRecoveryPrompt} from './mcp-refresh-recovery.mjs';

const json=async file=>JSON.parse(await readFile(file,'utf8'));
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const exists=async file=>{try{await stat(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
const inside=(root,file)=>{const rel=path.relative(root,file);return !path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+path.sep);};
const samePath=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
const alive=pid=>{try{process.kill(pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;if(error.code==='EPERM')return true;throw error;}};
const events=text=>text.split('\n').flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});

/** Delegate the existing bounded watcher to a request file, never a CLI. */
export async function watchConnectorRecovery(lease,io={}){
 const record=await json(lease);
 let requested=false;
 const result=await watchRecovery(lease,{...io,runCli:async(_cli,args)=>{
  const prompt=args[args.indexOf('--message')+1];
  const request={version:1,token:record.token,thread:record.thread,turn:record.turn,cwd:record.cwd,checkpoint:record.checkpoint,expiresAt:record.expiresAt,prompt};
  await writeFile(lease+'.connector-request.json',JSON.stringify(request,null,2)+'\n',{flag:'wx'});
  requested=true;
  return {stdout:'',stderr:''};
 }});
 const value={...result,...(requested?{status:'connector-requested',resumeRequested:false}:{}),deliveryVerified:false,resumeVerified:false};
 if(result.status!=='already-watched'&&result.status!=='already-consumed')await writeFile(lease+'.result.json',JSON.stringify(value,null,2)+'\n');
 return value;
}

/** Claim once immediately before the guardian uses the supported thread tool.
 * The claim is never evidence of connector delivery or resumed execution.
 */
export async function claimConnectorDispatch(lease,io={}){
 const record=await json(lease),request=await json(lease+'.connector-request.json');
 const now=io.now??Date.now;
 if(record.version!==1||![record.token,record.thread,record.turn].every(value=>typeof value==='string'&&uuid.test(value))||!Number.isSafeInteger(record.offset)||record.offset<0||!Number.isSafeInteger(record.mcpPid)||record.mcpPid<=0||!Number.isFinite(record.createdAt)||!Number.isFinite(record.expiresAt)||record.expiresAt<=record.createdAt||record.expiresAt-record.createdAt>180000)throw new Error('Invalid bounded connector lease');
 const cwd=await realpath(record.cwd),checkpoint=await realpath(record.checkpoint);
 if(!inside(cwd,checkpoint)||!(await stat(checkpoint)).isFile()||!inside(cwd,await realpath(lease)))throw new Error('Connector lease and checkpoint must stay inside the project');
 if(request.version!==1||['token','thread','turn','cwd','checkpoint','expiresAt'].some(key=>request[key]!==record[key])||request.prompt!==buildRecoveryPrompt(record))throw new Error('Connector request does not match its lease');
 if(await readFile(lease+'.consumed','utf8')!==record.token)throw new Error('Watcher has not consumed this recovery');
 const eligible=async()=>{
  if(await exists(lease+'.cancelled'))return 'cancelled';
  if(now()<record.createdAt||now()>=record.expiresAt)return 'expired';
  const bytes=await readFile(record.rollout);
  if(bytes.length<record.offset||bytes.length-record.offset>8*1024*1024)throw new Error('Invalid bounded rollout window');
  const all=events(bytes.toString('utf8')),meta=all.find(e=>e.type==='session_meta')?.payload;
  if(meta?.id!==record.thread||!meta.cwd||!samePath(await realpath(meta.cwd),cwd))throw new Error('Rollout thread/project identity does not match');
  const tail=events(bytes.subarray(record.offset).toString('utf8'));
  if(tail.some(e=>e.type==='event_msg'&&e.payload?.type==='task_started'&&e.payload.turn_id!==record.turn))return 'superseded';
  if(tail.some(e=>e.type==='event_msg'&&e.payload?.type==='task_complete'&&e.payload.turn_id===record.turn))return 'completed';
  const latest=all.filter(e=>e.type==='event_msg'&&e.payload?.type==='task_started').at(-1);
  if(latest?.payload?.turn_id!==record.turn)throw new Error('Expected turn is not the latest started turn');
  if(!tail.some(e=>e.type==='event_msg'&&e.payload?.type==='turn_aborted'&&e.payload.turn_id===record.turn&&e.payload.reason==='interrupted')||(io.isAlive??alive)(record.mcpPid))return 'not-ready';
 };
 const result=status=>({status,token:record.token,thread:record.thread,deliveryVerified:false,resumeVerified:false});
 const before=await eligible();if(before)return result(before);
 try{await writeFile(lease+'.connector-claimed.json',JSON.stringify({token:record.token,claimedAt:now()})+'\n',{flag:'wx'});}catch(error){if(error.code==='EEXIST')return result('already-claimed');throw error;}
 const after=await eligible();if(after)return result(after);
 return {...request,...result('claimed')};
}

async function main(){
 const [command,flag,lease,...extra]=process.argv.slice(2);
 if(flag!=='--lease'||!lease||extra.length)throw new Error('Usage: node scripts/mcp-refresh-connector-recovery.mjs watch|claim --lease <lease>');
 if(command==='watch')console.log(JSON.stringify(await watchConnectorRecovery(lease)));
 else if(command==='claim')console.log(JSON.stringify(await claimConnectorDispatch(lease)));
 else throw new Error('Expected watch or claim');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
