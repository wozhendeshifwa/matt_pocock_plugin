import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdir, mkdtemp, realpath, writeFile, readFile, cp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { freezeAdapter, OUTPUT_BASE } from './freeze-adapter.mjs';
import { createStdioAdapter } from './stdio.mjs';
import { createLocalWriteEffects } from './write-effects-local.mjs';
import { resolveExecutable } from '../upstream-port/executables.mjs';

const run = promisify(execFile);
const THREAD = '01a1b180-89f8-7291-beb2-43f569f3709c';
const MAIN_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const inner = response => response?.result?.structuredContent?.value ?? response?.result?.structuredContent;
const folded = value => process.platform === 'win32' ? value.toLowerCase() : value;

// This is a fixed local test transport, executed by a copy of Node named gh.
// It never imports an HTTP client or runs another program. Writes update this
// fixture's JSON counter only, so an unexpected repo is independently visible.
const fakeGh = String.raw`
const fs = require('node:fs');
const path = require('node:path');
const command = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const stateFile = process.env.DECK_TRACKER_FIXTURE_STATE;
const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
fs.appendFileSync(stateFile+'.calls', JSON.stringify({command,args,host:process.env.GH_HOST})+'\n');
const repoAt = args.findIndex(value => value === '--repo' || value === '-R');
let repository = repoAt < 0 ? 'fixture/a' : args[repoAt + 1];
const print = value => process.stdout.write(typeof value === 'string' ? value : JSON.stringify(value));
if (command === 'label' && args[0] === 'list') {
  print(Object.entries(state.labels[repository] || {}).map(([name,color]) => ({name,color,description:'isolated fixture'})));
} else if (command === 'label' && args[0] === 'edit') {
  const colorAt = args.indexOf('--color');
  if (!state.labels[repository] || colorAt < 0) process.exitCode = 2;
  else { const name = args[1], color = args[colorAt + 1]; fs.appendFileSync(stateFile+'.edits',JSON.stringify({repository,name,color})+'\n'); state.labels[repository][name] = color; fs.writeFileSync(stateFile,JSON.stringify(state)); }
} else if (command === 'auth') {
  print(args.includes('--show-token') ? 'refused' : 'Logged in to fixture.invalid as fixture');
} else if (command === 'repo' && args[0] === 'view') {
  repository = args[1] && !args[1].startsWith('-') ? args[1] : repository;
  print({id:'R_FIXTURE',nameWithOwner:repository,name:repository.split('/')[1],owner:{login:'fixture'},hasIssuesEnabled:true,isPrivate:true,viewerPermission:'ADMIN',defaultBranchRef:{name:'master'},url:'https://github.com/'+repository});
} else if (command === 'issue' && args[0] === 'list') {
  print([]);
} else if (command === 'issue' && args[0] === 'comment') {
  const bodyAt=args.indexOf('--body'), body=args[bodyAt+1];
  if (!state.labels[repository] || bodyAt < 0) process.exitCode=2;
  else {
    const event={kind:'issue-comment',repository,number:args[1],body};
    fs.appendFileSync(stateFile+'.edits',JSON.stringify(event)+'\n');
    state.comments=state.comments||[]; state.comments.push(event); fs.writeFileSync(stateFile,JSON.stringify(state));
    print('https://github.com/'+repository+'/issues/'+args[1]+'#issuecomment-'+(100+state.comments.length));
  }
} else if (command === 'api') {
  const endpoint = args[0] || '';
  const match = /^repos\/([^/]+\/[^/]+)/.exec(endpoint); if (match) repository=match[1];
  const comment=/^repos\/[^/]+\/[^/]+\/issues\/([0-9]+)\/comments$/.exec(endpoint);
  const methodAt=args.findIndex(value=>value==='--method'||value==='-X');
  if(comment && args[methodAt+1]==='POST') {
    if(state.failRest) { process.stderr.write('isolated REST refusal before mutation'); process.exitCode=1; }
    else {
      const bodyArg=args.find(value=>value.startsWith('body=')),body=bodyArg?bodyArg.slice(5):'';
      const event={kind:'api-comment',repository,number:comment[1],body};
      fs.appendFileSync(stateFile+'.edits',JSON.stringify(event)+'\n');
      state.comments=state.comments||[]; state.comments.push(event); fs.writeFileSync(stateFile,JSON.stringify(state));
      print({id:100+state.comments.length,body,user:{login:'fixture'},author_association:'OWNER',created_at:'2026-11-24T00:00:00Z',updated_at:'2026-11-24T00:00:00Z'});
    }
  } else if (endpoint === 'user') print({login:'fixture',id:1});
  else if (endpoint === 'rate_limit') print({resources:{core:{limit:5000,remaining:4999,reset:4102444800},graphql:{limit:5000,remaining:4999,reset:4102444800}}});
  else if (endpoint === 'graphql') print({data:{rateLimit:{limit:5000,remaining:4999,cost:1,resetAt:'2100-01-01T00:00:00Z'},repository:{id:'R_FIXTURE',nameWithOwner:repository,hasIssuesEnabled:true,viewerPermission:'ADMIN',issues:{nodes:[],pageInfo:{hasNextPage:false,endCursor:null}},labels:{nodes:Object.entries(state.labels[repository]||{}).map(([name,color])=>({name,color})),pageInfo:{hasNextPage:false,endCursor:null}}}}});
  else if (/\/labels(?:\?|$)/.test(endpoint)) print(Object.entries(state.labels[repository]||{}).map(([name,color])=>({name,color,description:'isolated fixture'})));
  else if (/\/issues(?:\?|$)/.test(endpoint)) print([]);
  else print({id:1,full_name:repository,name:repository.split('/')[1],owner:{login:'fixture'},private:true,has_issues:true,permissions:{admin:true,push:true,triage:true},default_branch:'master'});
} else print({});
`;

async function fixture(t) {
  await mkdir(OUTPUT_BASE, { recursive: true });
  const directory = await realpath(await mkdtemp(path.join(OUTPUT_BASE, 'tracker-dispatch-test-')));
  let adapter;
  t.after(async () => {
    await adapter?.close();
    const actual = await realpath(directory), base = await realpath(OUTPUT_BASE);
    assert.equal(folded(path.dirname(actual)), folded(base));
    assert.ok(path.basename(actual).startsWith('tracker-dispatch-test-'));
    await rm(actual, { recursive: true, maxRetries: 20, retryDelay: 100 });
  });
  const frozen = await freezeAdapter({ sourceRoot: MAIN_ROOT, outputRoot: path.join(directory, 'candidate') });
  const project = path.join(directory, 'project'), home = path.join(directory, 'codex-home');
  const emptyHome = path.join(directory, 'empty-home'), ghConfig = path.join(directory, 'empty-gh');
  for (const folder of [project, home, emptyHome, ghConfig]) await mkdir(folder);
  const database = new DatabaseSync(path.join(home, 'state_5.sqlite'));
  try {
    database.exec('CREATE TABLE threads(id TEXT PRIMARY KEY,cwd TEXT,rollout_path TEXT,title TEXT); CREATE TABLE project_roots(project_id TEXT,position INTEGER,path TEXT);');
    database.prepare('INSERT INTO threads VALUES(?,?,NULL,?)').run(THREAD, project, 'Isolated tracker test');
    database.prepare('INSERT INTO project_roots VALUES(?,0,?)').run('tracker-fixture', project);
  } finally { database.close(); }
  const git = await resolveExecutable('git'); assert.ok(git);
  const emptyConfig = path.join(directory, 'empty-git-config'); await writeFile(emptyConfig, '');
  const gh = path.join(directory, process.platform === 'win32' ? 'gh.exe' : 'gh');
  await cp(process.execPath, gh);
  const stateFile = path.join(directory, 'fake-gh-state.json');
  await writeFile(stateFile, JSON.stringify({ labels: { 'fixture/a': { 'wayfinder:map': 'aaaaaa' }, 'fixture/b': { 'wayfinder:map': 'bbbbbb' } }, calls: [], edits: [] }));
  await writeFile(stateFile + '.calls', ''); await writeFile(stateFile + '.edits', '');
  const env = {};
  for (const key of ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP']) if (process.env[key]) env[key] = process.env[key];
  Object.assign(env, { CODEX_HOME: home, USERPROFILE: emptyHome, HOME: emptyHome, APPDATA: path.join(emptyHome, 'AppData/Roaming'),
    GH_CONFIG_DIR: ghConfig, GH_HOST: 'other.example.invalid', DECK_GH: gh, DECK_GIT: git, DECK_TRACKER_FIXTURE_STATE: stateFile,
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: emptyConfig, GIT_CONFIG_SYSTEM: emptyConfig, GIT_TERMINAL_PROMPT: '0' });
  // The original spawn service may use the literal argv program rather than
  // its resolveExecutable hook. Pin PATH as well as DECK_GH, and keep just one
  // Windows case variant so that every actual gh child is this owned binary.
  env.PATH = directory + path.delimiter + (env.PATH ?? env.Path ?? ''); delete env.Path;
  const gitRun = args => run(git, ['-C', project, ...args], { env, windowsHide: true, timeout: 10000 });
  await gitRun(['init', '--quiet']); await gitRun(['remote', 'add', 'origin', 'https://github.com/fixture/a.git']);
  const local = await createLocalWriteEffects({ adapterPath: frozen.adapterPath });
  const dataRoot = await local.dataRootFor(project); await mkdir(dataRoot, { recursive: true });
  for (const folder of [project, dataRoot]) for (const command of ['api', 'label', 'repo', 'auth', 'issue', 'pr']) await writeFile(path.join(folder, command), fakeGh);
  let sequence = 0;
  const context = repository => ({ projectRoot: project, threadId: THREAD, ...(repository ? { tracker: { backendId: 'github', repository } } : {}) });
  async function restart() { await adapter?.close(); adapter = createStdioAdapter(frozen.adapterPath, { env }); }
  await restart();
  function rpcRequest(method, payload = {}, write = true) {
    return { jsonrpc: '2.0', id: ++sequence, method: 'tools/call', params: { name: write ? 'deck_upstream_write' : 'deck_upstream_read',
      arguments: { method, payload: { ...payload, expectedThreadId: THREAD } }, _meta: { threadId: THREAD } } };
  }
  const call = (method, payload, repository, write = true) => adapter.request(rpcRequest(method, payload, write), context(repository));
  const state = async () => {
    const value = JSON.parse(await readFile(stateFile, 'utf8'));
    for (const name of ['calls', 'edits']) value[name] = (await readFile(stateFile + '.' + name, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line));
    return value;
  };
  const setRemote = async repository => { await gitRun(['remote', 'set-url', 'origin', 'https://github.com/' + repository + '.git']); await restart(); };
  return { directory, project, dataRoot, frozen, gh, context, rpcRequest, call, state, setRemote, restart,
    async setRestFailure(failRest) { const value=JSON.parse(await readFile(stateFile,'utf8'));value.failRest=failRest;await writeFile(stateFile,JSON.stringify(value)); },
    request: (request, localContext) => adapter.request(request, localContext) };
}

test('frozen original node host binds actual GH label writes to the trusted tracker and rejects spoofing or backend drift', { timeout: 90000 }, async t => {
  const f = await fixture(t);
  const binding = await f.call('bind', { backendId: 'github' });
  assert.equal(inner(binding)?.persisted, true, JSON.stringify(binding));
  const labels = await f.call('listLabels', {}, undefined, false);
  assert.equal(inner(labels)?.ok, true, JSON.stringify(labels));
  const changed = await f.call('setLabelColors', { changes: [{ name: 'wayfinder:map', color: '112233' }] }, 'fixture/a');
  assert.equal(inner(changed)?.ok, true, JSON.stringify(changed));
  assert.deepEqual(inner(changed)?.failed, [], JSON.stringify(changed));
  assert.deepEqual((await f.state()).edits, [{ repository: 'fixture/a', name: 'wayfinder:map', color: '112233' }]);
  assert.ok((await f.state()).calls.length > 0);
  assert.ok((await f.state()).calls.filter(call => call.command === 'label' && call.args[0] === 'edit').every(call => call.host === 'github.com'), 'Actual GH writes use the prepared host, while ordinary reads retain their configured host');

  await f.setRemote('fixture/b');
  const before = await f.state();
  for (const [name, repository, spoof] of [
    ['different actual repo', 'fixture/a', false], ['no trusted tracker', undefined, false], ['spoofed reserved payload and envelope', 'fixture/a', true],
  ]) await t.test(name, async () => {
    const request = f.rpcRequest('setLabelColors', { changes: [{ name: 'wayfinder:map', color: '445566' }],
      ...(spoof ? { __deckLocalTracker: { backendId: 'github', repository: 'fixture/b' } } : {}) });
    if (spoof) request._deckLocalDispatch = { ...f.context('fixture/b') };
    const response = await f.request(request, f.context(repository));
    const value = inner(response);
    assert.ok(response.result?.isError || response.error || value?.ok === false || value?.failed?.length > 0, JSON.stringify(response));
    assert.deepEqual((await f.state()).edits, before.edits, 'No unexpected GH editor process may run');
    assert.equal((await f.state()).labels['fixture/b']['wayfinder:map'], 'bbbbbb');
  });

  const correctB = await f.call('setLabelColors', { changes: [{ name: 'wayfinder:map', color: '778899' }] }, 'fixture/b');
  assert.deepEqual(inner(correctB)?.failed, [], JSON.stringify(correctB));
  assert.equal((await f.state()).edits.length, 2);
  const markdown = await f.call('bind', { backendId: 'markdown' });
  assert.equal(inner(markdown)?.persisted, true, JSON.stringify(markdown));
  const colors = path.join(f.project, 'docs/agents/label-colors.json'), colorsBefore = await readFile(colors);
  const editsBefore = (await f.state()).edits;
  const drifted = await f.call('setLabelColors', { changes: [{ name: 'wayfinder:map', color: '000000' }] }, 'fixture/b');
  assert.ok(drifted.result?.isError || drifted.error || inner(drifted)?.ok === false || inner(drifted)?.failed?.length > 0, JSON.stringify(drifted));
  assert.deepEqual(await readFile(colors), colorsBefore, 'A Github-intended write cannot change Markdown project colors');
  assert.deepEqual((await f.state()).edits, editsBefore);
});

test('frozen GH label list read recipe is exact and does not permit extra fields or flags', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  const { classifyReadCommand } = await import(pathToFileURL(path.join(path.dirname(f.frozen.adapterPath), 'read-command.mjs')).href);
  const args = ['gh', 'label', 'list', '--repo', 'fixture/a', '--json', 'name,color,description', '--limit', '1000'];
  assert.ok(classifyReadCommand(args));
  for (const invalid of [
    [...args, '--jq', '.'], [...args.slice(0, -1), '1001'], [...args.slice(0, 6), 'name,color,url', ...args.slice(7)],
    ['gh', 'label', 'edit', '--repo', 'fixture/a', '--json', 'name,color,description', '--limit', '1000'],
    ['gh', 'label', 'list', '--repo', '--help', '--json', 'name,color,description', '--limit', '1000'],
  ]) assert.equal(classifyReadCommand(invalid), false, JSON.stringify(invalid));
});

test('frozen original comment RPC binds both REST and CLI fallback writes to the trusted repository', { timeout: 90000 }, async t => {
  const f=await fixture(t);
  assert.equal(inner(await f.call('bind',{backendId:'github'}))?.persisted,true);
  const firstBody='隔离 REST 评论\nbody';
  const posted=await f.call('commentIssue',{number:1,body:firstBody},'fixture/a');
  assert.equal(inner(posted)?.ok,true,JSON.stringify(posted));
  assert.equal(inner(posted)?.data?.id,'101',JSON.stringify(posted));
  assert.equal(inner(posted)?.data?.body,firstBody);
  assert.equal(inner(posted)?.data?.author?.login,'fixture');
  assert.deepEqual((await f.state()).edits,[{kind:'api-comment',repository:'fixture/a',number:'1',body:firstBody}]);

  // This generated transport declines REST before any mutation. The original
  // backend's existing fallback then uses its distinct fixed CLI recipe.
  await f.setRestFailure(true);
  const fallback=await f.call('commentIssue',{number:2,body:'isolated fallback'},'fixture/a');
  assert.equal(inner(fallback)?.ok,true,JSON.stringify(fallback));
  assert.equal(inner(fallback)?.data?.body,'isolated fallback');
  assert.deepEqual((await f.state()).edits.at(-1),{kind:'issue-comment',repository:'fixture/a',number:'2',body:'isolated fallback'});

  await f.setRemote('fixture/b');
  const before=await f.state();
  for(const [name,repository,spoof] of [
    ['different actual REST and fallback repo','fixture/a',false],
    ['missing tracker for REST and fallback',undefined,false],
    ['reserved payload and top-level spoof cannot retarget REST or fallback','fixture/a',true],
  ]) await t.test(name,async()=>{
    const request=f.rpcRequest('commentIssue',{number:3,body:'must not post to B',
      ...(spoof?{__deckLocalTracker:{backendId:'github',repository:'fixture/b'}}:{})});
    if(spoof) request._deckLocalDispatch=f.context('fixture/b');
    const response=await f.request(request,f.context(repository));
    assert.ok(response.error||response.result?.isError||inner(response)?.ok===false,JSON.stringify(response));
    const after=await f.state();
    assert.deepEqual(after.edits,before.edits,'Neither REST nor fallback may launch a mismatched editor process');
    const laterCalls=after.calls.slice(before.calls.length);
    assert.equal(laterCalls.some(call=>call.command==='api'&&call.args.some(value=>value==='POST')&&/^repos\/fixture\/b\/issues\//.test(call.args[0]??'')),false);
    assert.equal(laterCalls.some(call=>call.command==='issue'&&call.args[0]==='comment'),false);
  });
});
