import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createLocalWriteEffects } from './write-effects-local.mjs';

const run = promisify(execFile);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const A = '01a1b180-89f8-7291-beb2-43f569f3709c';
const B = '01a1b180-89f8-7291-beb2-43f569f3709d';
const repository = { backend: 'github', refId: 'isolated/fixture', name: 'isolated/fixture', url: 'https://github.com/isolated/fixture' };

async function fixture(t) {
  const base = fileURLToPath(new URL('../../.scratch/', import.meta.url));
  await mkdir(base, { recursive: true });
  const directory = await realpath(await mkdtemp(path.join(base, 'report-durable-test-')));
  t.after(async () => {
    const actual = await realpath(directory), expectedParent = await realpath(base);
    assert.equal(path.dirname(actual).toLowerCase(), expectedParent.toLowerCase());
    assert.ok(path.basename(actual).startsWith('report-durable-test-'));
    await rm(actual, { recursive: true, maxRetries: 5, retryDelay: 100 });
  });
  const adapterRoot = path.join(directory, 'Frozen-Runtime');
  const adapterPath = path.join(adapterRoot, 'prototypes/upstream-port/sidebar-server.mjs');
  const vendor = path.join(adapterRoot, 'vendor/mattskills-1.8.0-rc.7');
  await mkdir(path.dirname(adapterPath), { recursive: true });
  await writeFile(adapterPath, '// Isolated entrypoint marker; never executed.\n');
  const source = fileURLToPath(new URL('../../vendor/mattskills-1.8.0-rc.7/', import.meta.url));
  // Import the actual frozen-compatible writer and normalization modules. No
  // backend, authentication, real project or running adapter is copied/opened.
  for (const relative of ['shared/refresh/chain.js', 'lib/workspaceKey.js', 'lib/refresh/sessionTickets.js']) {
    await mkdir(path.dirname(path.join(vendor, relative)), { recursive: true });
    await cp(path.join(source, relative), path.join(vendor, relative));
  }
  await writeFile(path.join(vendor, 'package.json'), '{"type":"module"}\n');
  const project = path.join(directory, 'Project-A'), otherProject = path.join(directory, 'Project-B');
  for (const root of [project, otherProject]) await mkdir(path.join(root, '.git'), { recursive: true });
  const runner = path.join(directory, 'original-writer.mjs');
  await writeFile(runner, `import {lstat} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const input=JSON.parse(process.argv[2]);
const {createSessionTickets}=await import(pathToFileURL(input.writer).href);
const {canonicalWorkspaceKey}=await import(pathToFileURL(input.workspace).href);
const canonicalKey=root=>canonicalWorkspaceKey(root,{getPlatform:()=>({os:process.platform,path}),getFs:()=>({lstat}),getDefaultCwd:()=>root});
const writer=createSessionTickets({cacheDir:input.cacheDir,canonicalKey,now:()=>input.at,
  ...(input.failWrite?{writeText:async()=>{throw new Error('isolated disk fault')}}:{})});
if(input.restore){const out=await writer.restore({rootKey:await canonicalKey(input.root)});process.stdout.write(JSON.stringify({out,snapshot:writer.snapshot()}));}
else {const out=await writer.note({sessionId:input.thread,rootKey:input.root,backend:input.backend,
  tool:input.tool||'deck_issue_report',source:'tool-args',tier:'write-confirmed',reason:'tool.deck-write',
  verb:'report',ticketKey:input.key,effortId:input.effort,args:{key:input.key}});
  process.stdout.write(JSON.stringify({out,stats:writer.stats()}));}
`);
  const effects = await createLocalWriteEffects({ adapterPath });
  const location = await effects.locateReportChain(project);
  async function write(options = {}) {
    const root = options.root ?? project;
    const target = await effects.locateReportChain(root);
    const input = { writer: path.join(vendor, 'lib/refresh/sessionTickets.js'), workspace: path.join(vendor, 'lib/workspaceKey.js'),
      cacheDir: path.dirname(target.file), root, thread: A, backend: 'github', key: '38', effort: '', at: Date.now() - 100,
      ...options };
    const { stdout } = await run(process.execPath, [runner, JSON.stringify(input)], { windowsHide: true });
    return JSON.parse(stdout);
  }
  async function args(options = {}) {
    const root = options.projectRoot ?? project;
    const place = await effects.locateReportChain(root);
    const request = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'deck_issue_report',
      arguments: { key: '#00038' }, _meta: { threadId: A } } };
    const response = { jsonrpc: '2.0', id: 1, result: { structuredContent: {
      ok: true, status: 'ok', tool: 'deck_issue_report', workspace: { root: place.rootKey, key: 'local-fixture' },
      backend: { id: 'github', source: 'local-fixture' }, repo: { ...repository },
      data: { key: '38', backendId: 'github', effortId: '', chain: { recorded: true } },
    } } };
    return { projectRoot: root, threadId: A, request, response, startedAt: Date.now() - 1000,
      expectedBackendId: 'github', expectedRepo: { ...repository }, ...options };
  }
  return { directory, adapterRoot, adapterPath, vendor, project, otherProject, effects, location, write, args };
}

test('project data seam uses actual server cwd hash separately from canonical chain root', async t => {
  const f = await fixture(t);
  const root = await realpath(f.adapterRoot), cwd = await realpath(f.project);
  const expected = path.join(root, '.scratch/upstream-sidebar', hash(root.toLowerCase()).slice(0, 16), 'projects', hash(cwd));
  assert.equal(await f.effects.dataRootFor(f.project), expected);
  assert.deepEqual(await f.effects.locateProjectData(f.project), { cwd, dataRoot: expected });
  assert.equal(f.location.rootKey, process.platform === 'win32' ? cwd.toLowerCase() : cwd);
  await assert.rejects(stat(expected), { code: 'ENOENT' });
  if (process.platform === 'win32') assert.equal(await f.effects.dataRootFor(f.project.toLowerCase()), expected);
  const child = path.join(f.project, 'selected-child'); await mkdir(child);
  const nested = await f.effects.locateReportChain(child);
  assert.equal(nested.rootKey, f.location.rootKey);
  assert.notEqual(nested.dataRoot, f.location.dataRoot);
});

test('original writer persists report; independent process restore and fresh verifier both read disk', async t => {
  const f = await fixture(t);
  const noted = await f.write();
  assert.equal(noted.out.recorded, true); assert.equal(noted.stats.flushes, 1);
  const restored = await f.write({ restore: true });
  assert.equal(restored.out.restored, 1); assert.equal(restored.snapshot[0].entries[0].action, 'report');
  const fresh = await createLocalWriteEffects({ adapterPath: f.adapterPath });
  const verdict = await fresh.verifyReport(await f.args());
  assert.equal(verdict.knownSuccess, true, verdict.reason);
  assert.equal(verdict.evidence.kind, 'local-state-readback');
  assert.equal(verdict.result.resultSha256, hash(await readFile(f.location.file)));
  assert.equal(JSON.stringify(verdict).includes(f.project), false);
  assert.equal(JSON.stringify(verdict).includes(A), false);
  assert.equal(JSON.stringify(verdict).includes('isolated/fixture'), false);
});

test('original writer and verifier agree when a selected subdirectory anchors to the parent repo', async t => {
  const f = await fixture(t), child = path.join(f.project, 'Sub-Workspace');
  await mkdir(child);
  await f.write({ root: child });
  const location = await f.effects.locateReportChain(child);
  assert.equal(location.rootKey, f.location.rootKey);
  assert.equal((await f.effects.verifyReport(await f.args({ projectRoot: child }))).knownSuccess, true);
  await assert.rejects(stat(f.location.file), { code: 'ENOENT' });
});

test('recorded true with failed original flush and stale previous disk row remains unknown', async t => {
  const f = await fixture(t);
  const first = await f.write({ failWrite: true });
  assert.equal(first.out.recorded, true); assert.equal(first.stats.flushes, 0);
  assert.equal((await f.effects.verifyReport(await f.args())).knownSuccess, false);
  const oldAt = Date.now() - 2000;
  await f.write({ at: oldAt });
  const diskBefore = await readFile(f.location.file);
  const failed = await f.write({ failWrite: true, at: Date.now() - 10 });
  assert.equal(failed.out.recorded, true);
  assert.deepEqual(await readFile(f.location.file), diskBefore);
  assert.equal((await f.effects.verifyReport(await f.args({ startedAt: oldAt + 1 }))).knownSuccess, false);
});

test('wrong root, thread, key, backend, effort and action cannot prove this report', async t => {
  const f = await fixture(t);
  await f.write();
  const original = await f.args();
  assert.equal((await f.effects.verifyReport(original)).knownSuccess, true);
  const wrongRoot = await f.args({ projectRoot: f.otherProject });
  assert.equal((await f.effects.verifyReport(wrongRoot)).knownSuccess, false);
  const otherLocation = await f.effects.locateReportChain(f.otherProject);
  await mkdir(path.dirname(otherLocation.file), { recursive: true });
  await cp(f.location.file, otherLocation.file);
  assert.equal((await f.effects.verifyReport(wrongRoot)).reason, 'report-chain-scope-mismatch');
  const wrongThread = structuredClone(original); wrongThread.threadId = B; wrongThread.request.params._meta.threadId = B;
  assert.equal((await f.effects.verifyReport(wrongThread)).knownSuccess, false);
  const wrongKey = structuredClone(original); wrongKey.request.params.arguments.key = '39'; wrongKey.response.result.structuredContent.data.key = '39';
  assert.equal((await f.effects.verifyReport(wrongKey)).knownSuccess, false);
  const wrongBackend = structuredClone(original); wrongBackend.expectedBackendId = 'markdown';
  wrongBackend.expectedRepo.backend = 'markdown'; wrongBackend.response.result.structuredContent.repo.backend = 'markdown';
  wrongBackend.response.result.structuredContent.backend.id = 'markdown'; wrongBackend.response.result.structuredContent.data.backendId = 'markdown';
  assert.equal((await f.effects.verifyReport(wrongBackend)).knownSuccess, false);
  const wrongEffort = structuredClone(original); wrongEffort.response.result.structuredContent.data.effortId = 'other-effort';
  assert.equal((await f.effects.verifyReport(wrongEffort)).knownSuccess, false);
  await f.write({ tool: 'deck_issue_patch' });
  assert.equal((await f.effects.verifyReport(await f.args())).knownSuccess, false);
});

test('untrusted response context and unsuccessful wrappers are rejected despite correct durable row', async t => {
  const f = await fixture(t); await f.write();
  for (const mutate of [
    input => { input.expectedBackendId = undefined; },
    input => { input.expectedRepo = undefined; },
    input => { input.response.result.structuredContent.repo.refId = 'other/repository'; },
    input => { input.response.result.structuredContent.workspace.root = f.otherProject; },
    input => { input.response.result.structuredContent.data.chain.recorded = false; },
    input => { input.response.result.isError = true; },
    input => { input.response.id = 2; },
    input => { input.request.params._meta.threadId = B; },
  ]) {
    const input = await f.args(); mutate(input);
    assert.equal((await f.effects.verifyReport(input)).knownSuccess, false);
  }
});

test('explicit effort is normalized and bound to actual persisted effort', async t => {
  const f = await fixture(t); await f.write({ effort: 'work-unit' });
  const input = await f.args(); input.request.params.arguments.effortId = ' work-unit ';
  input.response.result.structuredContent.data.effortId = 'work-unit';
  assert.equal((await f.effects.verifyReport(input)).knownSuccess, true);
  input.request.params.arguments.effortId = 'other-unit';
  assert.equal((await f.effects.verifyReport(input)).knownSuccess, false);
  input.request.params.arguments.effortId = '../work-unit';
  assert.equal((await f.effects.verifyReport(input)).knownSuccess, false);
});

test('report identity uses the connection protocol, including conflict rejection', async t => {
  const f = await fixture(t); await f.write();
  const input = await f.args();
  input.request.params._meta = { thread_id: A };
  assert.equal((await f.effects.verifyReport(input)).knownSuccess, true);
  input.request.params._meta.threadId = B;
  assert.equal((await f.effects.verifyReport(input)).knownSuccess, false);
});

test('same-millisecond row needs local pre-dispatch evidence and unchanged row is never new proof', async t => {
  const f = await fixture(t), at = Date.now() - 100;
  const before = await f.effects.captureReportBefore({ projectRoot: f.project, threadId: A });
  await f.write({ at });
  const input = await f.args({ startedAt: at });
  assert.equal((await f.effects.verifyReport(input)).reason, 'report-chain-time-ambiguous');
  assert.equal((await f.effects.verifyReport({ ...input, before: {} })).knownSuccess, false);
  assert.equal((await f.effects.verifyReport({ ...input, before })).knownSuccess, true);
  const stale = await f.effects.captureReportBefore({ projectRoot: f.project, threadId: A });
  assert.equal((await f.effects.verifyReport({ ...input, before: stale })).reason, 'report-chain-entry-unchanged');
});

test('malformed or excessive disk input stays unknown and constructor cannot select arbitrary script', async t => {
  const f = await fixture(t); await mkdir(path.dirname(f.location.file), { recursive: true });
  await writeFile(f.location.file, '{broken');
  assert.equal((await f.effects.verifyReport(await f.args())).knownSuccess, false);
  await writeFile(f.location.file, 'x'.repeat(4 * 1024 * 1024 + 1));
  assert.equal((await f.effects.verifyReport(await f.args())).reason, 'chain-file-size');
  await assert.rejects(createLocalWriteEffects({ adapterPath: path.join(f.directory, 'original-writer.mjs') }), /verified frozen sidebar/);
});
