import assert from 'node:assert/strict';
if (!process.argv.includes('--baseline')) await import('./upstream-host.mjs');
const {ghPreflight}=await import('../../vendor/mattskills-1.8.0-rc.7/lib/tracker/backends/github/preflight.js');
let release;
let authGate=new Promise(r=>release=r);
let authFail=false, repoFail=false, accessFail=false;
const calls=[];
const ctx={cwd:'C:/fixture',platform:{resolveExecutable:async()=>'/gh'},exec:async(cmd,args)=>{
  calls.push([...args]);
  if(args[0]==='auth'){await authGate;if(authFail)throw Error('not logged in');return {stdout:'ok',code:0};}
  if(args[0]==='repo'){if(repoFail)throw Error('network unavailable');return {stdout:'fixture/repo',code:0};}
  if(accessFail)throw Error('HTTP 403: forbidden');
  return {stdout:'{}',code:0};
}};
const pending=ghPreflight({},ctx);
await new Promise(r=>setTimeout(r,20));
try{
  assert.ok(calls.some(a=>a[0]==='repo'),'repo lookup must start before auth finishes');
  assert.ok(!calls.some(a=>a[0]==='api'),'repository access must wait for successful auth');
}finally{release();}
assert.equal((await pending).ok,true);
assert.deepEqual(calls.map(a=>a[0]).sort(),['api','auth','repo']);
calls.length=0;authFail=true;
assert.equal((await ghPreflight({},ctx)).ok,false);
assert.ok(!calls.some(a=>a[0]==='api'),'invalid auth must not trigger access check');
authFail=false;repoFail=true;calls.length=0;
assert.equal((await ghPreflight({},ctx)).ok,false);
assert.ok(!calls.some(a=>a[0]==='api'));
repoFail=false;calls.length=0;
assert.equal((await ghPreflight({refId:'explicit/repo'},ctx)).ok,true);
assert.ok(!calls.some(a=>a[0]==='repo'),'explicit binding must not be resolved again');
assert.ok(calls.some(a=>a[1]==='repos/explicit/repo'));
accessFail=true;
assert.equal((await ghPreflight({refId:'explicit/repo'},ctx)).ok,false);
calls.length=0;
assert.equal((await ghPreflight({}, {...ctx,platform:{resolveExecutable:async()=>null}})).ok,false);
assert.equal(calls.length,0,'missing gh must not execute commands');
console.log('PASS auth/repo overlap; auth-before-access; auth, lookup, permission and missing CLI failures; explicit binding');
