import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, rmdir, stat, symlink, writeFile, utimes } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createLocalWriteEffects } from './write-effects-local.mjs';

const run = promisify(execFile);
const A = '01a1b180-89f8-7291-beb2-43f569f3709c';
const B = '01a1b180-89f8-7291-beb2-43f569f3709d';
const wrap = value => ({ jsonrpc: '2.0', id: 1, result: { structuredContent: { ok: true, value } } });
const good = (value, reason = 'Expected independent local effect evidence') => assert.match(value?.resultSha256 ?? '', /^[a-f0-9]{64}$/, reason);

async function fixture(t) {
  const base = fileURLToPath(new URL('../../.scratch/', import.meta.url));
  await mkdir(base, { recursive: true });
  const directory = await realpath(await mkdtemp(path.join(base, 'local-state-effects-test-')));
  t.after(async () => {
    const actual = await realpath(directory), parent = await realpath(base);
    assert.equal(path.dirname(actual).toLowerCase(), parent.toLowerCase());
    assert.ok(path.basename(actual).startsWith('local-state-effects-test-'));
    await rm(actual, { recursive: true, maxRetries: 5, retryDelay: 100 });
  });
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const runtime = path.join(directory, 'isolated-runtime'), vendor = path.join(runtime, 'vendor/mattskills-1.8.0-rc.7');
  for (const part of ['lib', 'shared']) await cp(path.join(root, 'vendor/mattskills-1.8.0-rc.7', part), path.join(vendor, part), { recursive: true });
  await writeFile(path.join(vendor, 'package.json'), '{"type":"module"}\n');
  const adapterPath = path.join(runtime, 'prototypes/upstream-port/sidebar-server.mjs');
  await mkdir(path.dirname(adapterPath), { recursive: true });
  await writeFile(adapterPath, '// Isolated layout marker, never executed.\n');
  await cp(path.join(root, 'prototypes/upstream-port/manual-naming.mjs'), path.join(path.dirname(adapterPath), 'manual-naming.mjs'));
  const runner = path.join(directory, 'original-local-writer.mjs');
  await writeFile(runner, `import * as native from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const input=JSON.parse(process.argv[2]), mod=relative=>import(pathToFileURL(path.join(input.vendor,relative)).href);
const {canonicalWorkspaceKey}=await mod('lib/workspaceKey.js');
const canonicalKey=root=>canonicalWorkspaceKey(root,{getPlatform:()=>({os:process.platform,path}),getFs:()=>({lstat:native.lstat}),getDefaultCwd:()=>root});
const rootKey=await canonicalKey(input.project);
const failed=file=>input.failName&&path.basename(file)===input.failName;
const fs={resolve:async(name,opts={})=>path.resolve(opts.cwd||input.project,name),lstat:native.lstat,stat:native.stat,
  readText:file=>native.readFile(file,'utf8'),listDir:async folder=>(await native.readdir(folder,{withFileTypes:true})).map(e=>({name:e.name})),
  mkdir:(folder,opts)=>native.mkdir(folder,{recursive:true,...opts}),
  unlink:async file=>{if(input.failUnlink||failed(file))throw new Error('isolated unlink fault');await native.unlink(file)},
  writeText:async(file,text)=>{if(input.failWrite||failed(file))throw new Error('isolated write fault');if(input.dropWrite)return;
    await native.mkdir(path.dirname(file),{recursive:true});await native.writeFile(file,text,'utf8')}};
const platform={os:process.platform,path,fs,getHome:async()=>input.data};
const timer={timeout:()=>0};
let value;
try {
  if(input.method.startsWith('log')){
    const {createLogStore}=await mod('lib/logPkg/store.js');
    const store=createLogStore({fs,timer,getCacheDir:async()=>path.join(input.data,'.dsh-mattskillsdeck-cache'),getPlatform:async()=>platform,DEFAULT_CWD:input.project});
    await store.loadSwitch();
    value=await store[{logSetSwitch:'handleLogSetSwitch',logClear:'handleLogClear',logGetSwitch:'handleLogGetSwitch'}[input.method]](input.args);
  }else if(input.method==='bind'||input.method==='bindingRead'){
    const {createChoiceStore}=await mod('lib/choiceStore.js');
    const choices=createChoiceStore({homeDir:input.data,isKnownBackend:id=>['github','gitlab','markdown'].includes(id),
      ...(input.failChoiceRename?{fs:{...native,rename:async()=>{throw new Error('isolated rename fault')}}}:{})});
    if(input.method==='bindingRead')value=await choices.getWorkspace(rootKey);
    else {
      const {createWorkspaceCwd}=await mod('lib/workspaceCwd.js');
      // Real host registration initializes the one default palette before the
      // leaf writer runs. Include that production dependency in this fixture.
      await mod('lib/tracker/backends/markdown/index.js');
      const {ensureLabelColors}=await mod('lib/tracker/backends/markdown/label-colors.js');
      const registry={bind(){},has:id=>['github','gitlab','markdown'].includes(id),
        get:id=>id==='markdown'?{ensureLabelColorsFile:(repo,context)=>ensureLabelColors(context,repo)}:{},
        describe:(handle,backend)=>({backend,refId:handle.cwd,name:'isolated',url:''})};
      const ctx={get:name=>name==='fs'?fs:name==='sessions'?{get:id=>id===input.thread?{id,cwd:input.project}:null,list:()=>[{id:input.thread,cwd:input.project}]}:
        name==='sandboxPolicy'?{resolve:()=>({mode:'isolated-test'})}:null};
      const writer=createWorkspaceCwd({ctx,DEFAULT_CWD:input.project,getPlatform:async()=>platform,getTrackerRegistry:async()=>registry,
        getWorkspaceStore:async()=>({invalidate(){}}),getChoiceStore:async()=>choices,canonicalKey,setCache(){},timer});
      value=await writer.handleBind({...input.args,cwd:input.project,sessionId:input.thread});
    }
  }else if(input.method==='handoffResolve'){
    const {createHandoffClaim}=await mod('lib/handoffClaim.js');
    const writer=createHandoffClaim({fs,DEFAULT_CWD:input.project,normCwd:canonicalKey});
    value=await writer.handleHandoffResolve({...input.args,cwd:input.project});
  }else{
    const {createManualNaming}=await import(pathToFileURL(input.manual).href);
    const writer=createManualNaming({dataRoot:input.data,workspaceRoot:input.project,
      sessionStore:{get:id=>id===input.thread?{id,cwd:input.project,title:'Isolated manual title'}:null},writeText:fs.writeText});
    value=input.method==='namingPlan'?await writer.plan(input.thread):await writer.cancel(input.thread,input.args.suggestionId);
  }
}catch{value={ok:false,error:{kind:'isolated-fault'}}}
process.stdout.write(JSON.stringify(value));
`);
  const effects = await createLocalWriteEffects({ adapterPath });
  let sequence = 0;
  async function project() {
    const project = path.join(directory, 'project-' + ++sequence);
    await mkdir(path.join(project, '.git'), { recursive: true });
    const data = await effects.dataRootFor(project); await mkdir(data, { recursive: true });
    const env = {};
    for (const name of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP']) if (process.env[name]) env[name] = process.env[name];
    async function call(method, args = {}, faults = {}) {
      const input = { project, data, vendor, thread: A, method, args,
        manual: path.join(path.dirname(adapterPath), 'manual-naming.mjs'), ...faults };
      const out = await run(process.execPath, [runner, JSON.stringify(input)], { windowsHide: true, env });
      return JSON.parse(out.stdout);
    }
    const prepare = (method, parameters = {}) => effects.prepareLocal({ method, projectRoot: project, threadId: A, parameters });
    return { project, data, call, prepare };
  }
  return { directory, vendor, effects, project };
}

test('local effects verify original writers against isolated restart state', async t => {
  const f = await fixture(t);
  await t.test('log switch uses durable enabled/rate, and preserves omitted rate on restart', async () => {
    const p = await f.project(), prepared = await p.prepare('logSetSwitch', { enabled: true, sampleRate: 0.25 });
    const response = await p.call('logSetSwitch', { enabled: true, sampleRate: 0.25 });
    good(await prepared.verify(wrap(response)));
    assert.deepEqual(await p.call('logGetSwitch'), { ok: true, enabled: true, sampleRate: 0.25 });
    const second = await p.prepare('logSetSwitch', { enabled: false });
    good(await second.verify(wrap(await p.call('logSetSwitch', { enabled: false }))));
    assert.equal((await p.call('logGetSwitch')).sampleRate, 0.25);
  });
  await t.test('silent switch persistence failure and stale/mismatched disk remain unknown', async () => {
    const p = await f.project();
    await p.call('logSetSwitch', { enabled: false, sampleRate: 0.5 });
    const prepared = await p.prepare('logSetSwitch', { enabled: true, sampleRate: 0.1 });
    const response = await p.call('logSetSwitch', { enabled: true, sampleRate: 0.1 }, { failWrite: true });
    assert.equal(response.ok, true); assert.equal(response.enabled, true);
    assert.equal(await prepared.verify(wrap(response)), null);
    assert.equal((await p.call('logGetSwitch')).enabled, false);
  });
  await t.test('log clear backs up exact isolated files and verifies deletion without affecting other dates', async () => {
    const p = await f.project(), logs = path.join(p.data, '.dsh-mattskillsdeck-cache/logs');
    await mkdir(logs, { recursive: true });
    const selected = path.join(logs, '2026-11-23.log'), retained = path.join(logs, '2026-11-24.log');
    await writeFile(selected, 'recoverable selected log\n'); await writeFile(retained, 'retained date\n');
    const backup = path.join(p.project, 'local-log-backup'); await mkdir(backup);
    await cp(selected, path.join(backup, path.basename(selected)));
    assert.deepEqual(await readFile(path.join(backup, path.basename(selected))), await readFile(selected));
    const prepared = await p.prepare('logClear', { date: '2026-11-23' });
    const response = await p.call('logClear', { date: '2026-11-23' });
    assert.equal(response.removed, 1); good(await prepared.verify(wrap(response)));
    await assert.rejects(stat(selected), { code: 'ENOENT' });
    assert.equal(await readFile(retained, 'utf8'), 'retained date\n');
    await cp(path.join(backup, path.basename(selected)), selected);
    assert.equal(await readFile(selected, 'utf8'), 'recoverable selected log\n');
  });
  await t.test('all-log clear accepts original empty-file fallback but rejects partial failure', async () => {
    const p = await f.project(), logs = path.join(p.data, '.dsh-mattskillsdeck-cache/logs');
    await mkdir(logs, { recursive: true });
    for (const name of ['2026-11-22.log', '2026-11-23.log']) await writeFile(path.join(logs, name), 'backup-worthy local log\n');
    const backup = path.join(p.project, 'all-log-backup'); await cp(logs, backup, { recursive: true });
    const prepared = await p.prepare('logClear', { date: 'all' });
    const partial = await p.call('logClear', { date: 'all' }, { failName: '2026-11-23.log' });
    assert.equal(partial.ok, true); assert.equal(partial.removed, 1);
    assert.equal(await prepared.verify(wrap(partial)), null);
    await cp(backup, logs, { recursive: true });
    const fallback = await p.prepare('logClear', { date: 'all' });
    const response = await p.call('logClear', { date: 'all' }, { failUnlink: true });
    assert.equal(response.removed, 2); good(await fallback.verify(wrap(response)));
    assert.equal((await stat(path.join(logs, '2026-11-23.log'))).size, 0);
    assert.equal(await readFile(path.join(backup, '2026-11-23.log'), 'utf8'), 'backup-worthy local log\n');
  });
  await t.test('manual cancellation is scoped to the thread and survives a fresh original instance', async () => {
    const p = await f.project(), suggestion = (await p.call('namingPlan')).suggestions[0];
    const args = { suggestionId: suggestion.id }, prepared = await p.prepare('cancelNewSessionWatcher', args);
    good(await prepared.verify(wrap(await p.call('cancelNewSessionWatcher', args))));
    assert.deepEqual((await p.call('namingPlan')).suggestions, []);
    await assert.rejects(f.effects.prepareLocal({ method: 'cancelNewSessionWatcher', projectRoot: p.project, threadId: A,
      parameters: { ...args, sessionId: B } }), /another thread/);
  });
  await t.test('original no-matching-suggestion false is a known no-op only while disk is unchanged', async () => {
    const p = await f.project(), args = { suggestionId: '0'.repeat(24) };
    const prepared = await p.prepare('cancelNewSessionWatcher', args);
    const response = await p.call('cancelNewSessionWatcher', args);
    assert.deepEqual(response, { ok: true, cancelled: false });
    const terminal = await prepared.verify(wrap(response));
    assert.equal(terminal.outcome, 'failed'); assert.equal(terminal.result.errorKind, 'rejected'); good(terminal.result);
    await assert.rejects(stat(path.join(p.data, 'manual-naming.json')), { code: 'ENOENT' });
    assert.equal(await prepared.verify(wrap({ ok: false, cancelled: false })), null, 'Generic business failure is not evidence of non-execution');
    await writeFile(path.join(p.data, 'manual-naming.json'), JSON.stringify({ [B]: { cancelled: args.suggestionId } }));
    assert.equal(await prepared.verify(wrap(response)), null, 'A false response cannot certify a changed disk as no-op');
  });
  await t.test('manual cancellation success with dropped write cannot pass; other thread disk row cannot substitute', async () => {
    const p = await f.project(), suggestion = (await p.call('namingPlan')).suggestions[0];
    const args = { suggestionId: suggestion.id }, prepared = await p.prepare('cancelNewSessionWatcher', args);
    const response = await p.call('cancelNewSessionWatcher', args, { dropWrite: true });
    assert.equal(response.cancelled, true); assert.equal(await prepared.verify(wrap(response)), null);
    await writeFile(path.join(p.data, 'manual-naming.json'), JSON.stringify({ [B]: { cancelled: suggestion.id } }));
    assert.equal(await prepared.verify(wrap(response)), null);
  });
  await t.test('bind persists choice revision plus new workspace file; restart reads the chosen backend', async () => {
    const p = await f.project(), prepared = await p.prepare('bind', { backendId: 'github' });
    const response = await p.call('bind', { backendId: 'github' });
    assert.equal(response.persisted, true); assert.equal(response.workspaceFile.placed, true);
    good(await prepared.verify(wrap(response)));
    const restarted = await p.call('bindingRead');
    assert.equal(restarted.backendId, 'github'); assert.equal(restarted.rev, response.rev);
    const second = await p.prepare('bind', { backendId: 'gitlab' });
    const switched = await p.call('bind', { backendId: 'gitlab' });
    assert.equal(switched.workspaceFile.reason, 'exists'); good(await second.verify(wrap(switched)));
    const saved = JSON.parse(await readFile(path.join(p.project, 'docs/agents/workspace.json'), 'utf8'));
    assert.equal(saved.backendId, 'github', 'The first shared default remains unchanged after a personal switch');
  });
  await t.test('markdown binding places original default colors and preserves existing config byte for byte', async () => {
    const p = await f.project(), prepared = await p.prepare('bind', { backendId: 'markdown' });
    const response = await p.call('bind', { backendId: 'markdown' });
    assert.equal(response.labelColorsFile.placed, true); good(await prepared.verify(wrap(response)));
    const config = path.join(p.project, 'docs/agents/workspace.json'), colors = path.join(p.project, 'docs/agents/label-colors.json');
    const configBefore = await readFile(config), colorsBefore = await readFile(colors);
    assert.ok(Object.keys(JSON.parse(colorsBefore.toString('utf8'))).length > 0, 'The real backend must initialize its default palette, never an empty leaf-module table');
    const repeated = await p.prepare('bind', { backendId: 'markdown' });
    const repeatedResponse = wrap(await p.call('bind', { backendId: 'markdown' }));
    good(await repeated.verify(repeatedResponse));
    assert.deepEqual(await readFile(config), configBefore); assert.deepEqual(await readFile(colors), colorsBefore);
    await writeFile(config, Buffer.concat([configBefore, Buffer.from('\n')]));
    assert.equal(await repeated.verify(repeatedResponse), null, 'Existing-file retention must be byte-for-byte evidence');
  });
  await t.test('bind choice/workspace/colors partial failures remain unknown despite top-level ok', async () => {
    for (const faults of [{ failChoiceRename: true }, { failName: 'workspace.json' }, { failName: 'label-colors.json' }]) {
      const p = await f.project(), prepared = await p.prepare('bind', { backendId: 'markdown' });
      const response = await p.call('bind', { backendId: 'markdown' }, faults);
      assert.equal(response.ok, true); assert.equal(await prepared.verify(wrap(response)), null);
    }
    const p = await f.project(), ephemeral = await p.prepare('bind', { backendId: null });
    const response = await p.call('bind', { backendId: null });
    assert.equal(response.backendId, null);
    assert.equal(await ephemeral.verify(wrap(response)), null, 'A response without a live same-worker read remains uncertain');
    const invalid = await f.project(), colors = path.join(invalid.project, 'docs/agents/label-colors.json');
    await mkdir(path.dirname(colors), { recursive: true }); await writeFile(colors, '{invalid existing colors');
    const prepared = await invalid.prepare('bind', { backendId: 'markdown' });
    const partial = await invalid.call('bind', { backendId: 'markdown' });
    assert.equal(partial.ok, true); assert.equal(partial.labelColorsFile.ok, false);
    assert.equal(await prepared.verify(wrap(partial)), null);
    assert.equal(await readFile(colors, 'utf8'), '{invalid existing colors');
  });
  await t.test('explicit-none executes baseline memory bind; live original selection proves known partial, never durable success', async () => {
    const p = await f.project();
    await p.call('bind', { backendId: 'github' });
    const load = relative => import(pathToFileURL(path.join(f.vendor, relative)).href);
    const [{ createWorkspaceCwd }, { createChoiceStore }, { createRegistry }, { canonicalWorkspaceKey }] = await Promise.all([
      load('lib/workspaceCwd.js'), load('lib/choiceStore.js'), load('lib/tracker/registryCore.js'), load('lib/workspaceKey.js'),
    ]);
    const registry = createRegistry();
    const choices = createChoiceStore({ homeDir: p.data, isKnownBackend: () => true });
    const canonicalKey = root => canonicalWorkspaceKey(root, { getPlatform: () => ({ os: process.platform, path }),
      getFs: () => ({ lstat: stat }), getDefaultCwd: () => root });
    const writer = createWorkspaceCwd({ ctx: { get: () => null }, DEFAULT_CWD: p.project,
      getPlatform: async () => ({ os: process.platform, path }), canonicalKey,
      getTrackerRegistry: async () => registry, getWorkspaceStore: async () => ({ invalidate() {} }), getChoiceStore: async () => choices, setCache() {} });
    const input = { method: 'bind', projectRoot: p.project, threadId: A, parameters: { backendId: null } };
    const prepared = await f.effects.prepareLocal({ ...input, readBinding: scope => writer.handleSelection({ cwd: scope.projectRoot }) });
    const response = await writer.handleBind({ cwd: p.project, backendId: null });
    assert.equal(response.persisted, false); assert.equal(response.ok, true);
    const terminal = await prepared.verify(wrap(response));
    assert.equal(terminal.outcome, 'failed'); assert.equal(terminal.result.errorKind, 'partial'); good(terminal.result);
    assert.equal((await writer.handleSelection({ cwd: p.project })).selection.source, 'explicit');
    const restarted = await p.call('bindingRead');
    assert.equal(restarted.backendId, 'github', 'The original previous disk choice survives; null did not become a persistent choice');
    const freshRegistry = createRegistry();
    assert.equal((await freshRegistry.select({ cwd: await canonicalKey(p.project) }, {})).source, 'fallback');
    const unproven = await f.effects.prepareLocal({ ...input,
      readBinding: async () => ({ ok: true, selection: { backendId: null, source: 'fallback' } }) });
    assert.equal(await unproven.verify(wrap(response)), null);
  });
  await t.test('handoff selector verifies exact/prefix/latest/missing against unchanged disk, without opening anything', async () => {
    const p = await f.project(), folder = path.join(p.project, '.scratch/handoff');
    await mkdir(folder, { recursive: true });
    const old = '20261123-000000-000-old.md', latest = '20261124-000000-000-latest.MD';
    await writeFile(path.join(folder, old), '# Old isolated handoff\n'); await writeFile(path.join(folder, latest), '# Latest isolated handoff\n');
    await utimes(path.join(folder, old), new Date(1000), new Date(1000));
    for (const args of [{ name: old }, { name: '20261124*' }, {}, { name: 'missing.md' }]) {
      const prepared = await p.prepare('handoffResolve', args);
      good(await prepared.verify(wrap(await p.call('handoffResolve', args))));
    }
    const prepared = await p.prepare('handoffResolve', { name: latest });
    const response = await p.call('handoffResolve', { name: latest });
    await writeFile(path.join(folder, latest), '# Changed after response\n');
    assert.equal(await prepared.verify(wrap(response)), null);
    await assert.rejects(p.prepare('openFolder', { path: p.project }), /not implemented/);
  });
  await t.test('error wrappers do not become success when the target disk already matches', async () => {
    const p = await f.project(), prepared = await p.prepare('logSetSwitch', { enabled: true });
    const response = wrap(await p.call('logSetSwitch', { enabled: true }));
    good(await prepared.verify(response));
    response.result.isError = true;
    assert.equal(await prepared.verify(response), null);
  });
  await t.test('a worker data directory redirected to another project cannot supply local effect evidence', async () => {
    const p = await f.project(), other = await f.project();
    const prepared = await p.prepare('logClear', { date: 'all' });
    await rmdir(p.data);
    await symlink(other.data, p.data, process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal(await prepared.verify(wrap({ ok: true, removed: 0 })), null);
  });
});
