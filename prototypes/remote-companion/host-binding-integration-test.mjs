import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, realpath, writeFile, readFile, cp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { freezeAdapter, OUTPUT_BASE } from './freeze-adapter.mjs';
import { createStdioAdapter } from './stdio.mjs';
import { createLocalWriteEffects } from './write-effects-local.mjs';
import { resolveExecutable } from '../upstream-port/executables.mjs';

const run = promisify(execFile), THREAD = '01a1b180-89f8-7291-beb2-43f569f3709c', repository = 'fixture/a';
const enterprise = 'ghe.example.invalid:8443', ambient = 'ambient.example.invalid';
const mainRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const inner = response => response?.result?.structuredContent?.value ?? response?.result?.structuredContent;

// Real child processes execute this fixed local Node fixture in place of gh.
// Host states are independent, so a silent enterprise-to-public fallback is an
// observable wrong write. This script has no networking or subprocess APIs.
const fakeGh = String.raw`
const fs=require('node:fs'),path=require('node:path');
const command=path.basename(process.argv[1]),args=process.argv.slice(2),file=process.env.DECK_HOST_FIXTURE_STATE;
const state=JSON.parse(fs.readFileSync(file,'utf8')),host=process.env.GH_HOST,selected=state.hosts[host];
if(!selected)throw new Error('Unknown fixture host');
fs.appendFileSync(file+'.calls',JSON.stringify({command,args,host})+'\n');
const labels=()=>Object.entries(selected.labels).map(([name,color])=>({name,color,description:'host-separated fixture'}));
const print=value=>process.stdout.write(typeof value==='string'?value:JSON.stringify(value));
const repo={id:1,full_name:'fixture/a',name:'a',owner:{login:'fixture'},private:true,has_issues:true,permissions:{admin:true,push:true,triage:true},default_branch:'master',url:'https://'+host+'/api/v3/repos/fixture/a'};
if(command==='label'&&args[0]==='list')print(labels());
else if(command==='label'&&args[0]==='edit'){
 const name=args[1],colorAt=args.indexOf('--color'),repoAt=args.indexOf('--repo');
 if(repoAt<0||args[repoAt+1]!=='fixture/a'||colorAt<0||!Object.hasOwn(selected.labels,name))throw new Error('Invalid fixture label write');
 selected.labels[name]=args[colorAt+1];fs.appendFileSync(file+'.edits',JSON.stringify({host,repository:'fixture/a',name,color:selected.labels[name]})+'\n');fs.writeFileSync(file,JSON.stringify(state));
}else if(command==='auth')print('Authenticated local fixture');
else if(command==='repo'&&args[0]==='view')print({...repo,id:'R_FIXTURE',nameWithOwner:'fixture/a',hasIssuesEnabled:true,isPrivate:true,viewerPermission:'ADMIN',defaultBranchRef:{name:'master'},url:'https://github.com/fixture/a'});
else if(command==='issue'&&args[0]==='list')print([]);
else if(command==='api'){
 const endpoint=args[0]||'';
 if(endpoint==='user')print({login:'fixture',id:1});
 else if(endpoint==='rate_limit')print({resources:{core:{limit:5000,remaining:4999,reset:4102444800},graphql:{limit:5000,remaining:4999,reset:4102444800}}});
 else if(endpoint==='graphql')print({data:{rateLimit:{limit:5000,remaining:4999,cost:1,resetAt:'2100-01-01T00:00:00Z'},repository:{id:'R_FIXTURE',nameWithOwner:'fixture/a',hasIssuesEnabled:true,viewerPermission:'ADMIN',issues:{nodes:[],pageInfo:{hasNextPage:false,endCursor:null}},labels:{nodes:labels(),pageInfo:{hasNextPage:false,endCursor:null}}}}});
 else if(/\/labels(?:\?|$)/.test(endpoint))print(labels());
 else if(/\/issues(?:\?|$)/.test(endpoint))print([]);
 else print(repo);
}else print({});
`;

async function fixture(t) {
  await mkdir(OUTPUT_BASE, { recursive: true }); const directory = await realpath(await mkdtemp(path.join(OUTPUT_BASE, 'host-binding-integration-test-'))); let adapter;
  t.after(async () => { await adapter?.close(); const actual = await realpath(directory), base = await realpath(OUTPUT_BASE); assert.equal(path.dirname(actual).toLowerCase(), base.toLowerCase()); assert.ok(path.basename(actual).startsWith('host-binding-integration-test-')); await rm(actual, { recursive: true, maxRetries: 20, retryDelay: 100 }); });
  const frozen = await freezeAdapter({ sourceRoot: mainRoot, outputRoot: path.join(directory, 'candidate') });
  const project = path.join(directory, 'project'), home = path.join(directory, 'codex-home'), emptyHome = path.join(directory, 'empty-home'), ghConfig = path.join(directory, 'empty-gh');
  await Promise.all([project, home, emptyHome, ghConfig].map(folder => mkdir(folder)));
  const database = new DatabaseSync(path.join(home, 'state_5.sqlite'));
  try { database.exec('CREATE TABLE threads(id TEXT PRIMARY KEY,cwd TEXT,rollout_path TEXT,title TEXT); CREATE TABLE project_roots(project_id TEXT,position INTEGER,path TEXT);'); database.prepare('INSERT INTO threads VALUES(?,?,NULL,?)').run(THREAD, project, 'Host binding fixture'); database.prepare('INSERT INTO project_roots VALUES(?,0,?)').run('host-fixture', project); } finally { database.close(); }
  const git = await resolveExecutable('git'); assert.ok(git); const emptyConfig = path.join(directory, 'empty-git-config'); await writeFile(emptyConfig, '');
  const gh = path.join(directory, process.platform === 'win32' ? 'gh.exe' : 'gh'); await cp(process.execPath, gh);
  const stateFile = path.join(directory, 'host-state.json'); await writeFile(stateFile, JSON.stringify({ hosts: { [ambient]: { labels: { 'wayfinder:map': '111111' } }, [enterprise]: { labels: { 'wayfinder:map': '222222' } }, 'github.com': { labels: { 'wayfinder:map': '333333' } } } }));
  await writeFile(stateFile + '.calls', ''); await writeFile(stateFile + '.edits', '');
  const env = {}; for (const key of ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP']) if (process.env[key]) env[key] = process.env[key];
  Object.assign(env, { CODEX_HOME: home, USERPROFILE: emptyHome, HOME: emptyHome, APPDATA: path.join(emptyHome, 'AppData/Roaming'), GH_CONFIG_DIR: ghConfig, GH_HOST: ambient,
    DECK_GH: gh, DECK_GIT: git, DECK_HOST_FIXTURE_STATE: stateFile, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: emptyConfig, GIT_CONFIG_SYSTEM: emptyConfig, GIT_TERMINAL_PROMPT: '0' });
  env.PATH = directory + path.delimiter + (env.PATH ?? env.Path ?? ''); delete env.Path;
  await run(git, ['-C', project, 'init', '--quiet'], { env, windowsHide: true, timeout: 10000 }); await run(git, ['-C', project, 'remote', 'add', 'origin', 'https://github.com/' + repository + '.git'], { env, windowsHide: true, timeout: 10000 });
  const local = await createLocalWriteEffects({ adapterPath: frozen.adapterPath }), dataRoot = await local.dataRootFor(project); await mkdir(dataRoot, { recursive: true });
  for (const folder of [project, dataRoot]) for (const command of ['api', 'label', 'repo', 'auth', 'issue', 'pr']) await writeFile(path.join(folder, command), fakeGh);
  adapter = createStdioAdapter(frozen.adapterPath, { env }); let sequence = 0;
  const call = (method, payload, hostname, write = true) => adapter.request({ jsonrpc: '2.0', id: ++sequence, method: 'tools/call', params: {
    name: write ? 'deck_upstream_write' : 'deck_upstream_read', arguments: { method, payload: { ...payload, expectedThreadId: THREAD } }, _meta: { threadId: THREAD },
  } }, { projectRoot: project, threadId: THREAD, ...(hostname ? { tracker: { backendId: 'github', repository, hostname } } : {}) });
  const state = async () => { const result = JSON.parse(await readFile(stateFile, 'utf8')); result.calls = (await readFile(stateFile + '.calls', 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line)); result.edits = (await readFile(stateFile + '.edits', 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line)); return result; };
  return { call, state };
}

test('original stdio/node host pins enterprise writes without changing ordinary read GH_HOST or touching public state', { timeout: 90000 }, async t => {
  const f = await fixture(t); assert.equal(inner(await f.call('bind', { backendId: 'github' }))?.persisted, true);
  assert.equal(inner(await f.call('listLabels', {}, undefined, false))?.ok, true);
  const first = await f.state(); assert.ok(first.calls.some(call => call.host === ambient), 'ordinary original reads retain the selected ambient host');
  const changed = await f.call('setLabelColors', { changes: [{ name: 'wayfinder:map', color: 'abcdef' }] }, enterprise); assert.equal(inner(changed)?.ok, true, JSON.stringify(changed)); assert.deepEqual(inner(changed)?.failed, []);
  const after = await f.state(); assert.deepEqual(after.edits, [{ host: enterprise, repository, name: 'wayfinder:map', color: 'abcdef' }]);
  assert.equal(after.hosts[enterprise].labels['wayfinder:map'], 'abcdef'); assert.equal(after.hosts[ambient].labels['wayfinder:map'], '111111'); assert.equal(after.hosts['github.com'].labels['wayfinder:map'], '333333');
  assert.ok(after.calls.filter(call => call.command === 'label' && call.args[0] === 'edit').every(call => call.host === enterprise));
  await assert.rejects(Promise.resolve().then(() => f.call('setLabelColors', { changes: [{ name: 'wayfinder:map', color: '555555' }] }, 'https://attacker.example.invalid')), /hostname/);
  assert.deepEqual((await f.state()).edits, after.edits, 'invalid local host must not dispatch another writer');
});
