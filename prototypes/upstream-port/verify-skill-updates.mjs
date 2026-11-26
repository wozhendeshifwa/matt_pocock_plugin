import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rename, symlink, unlink, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createSkillUpdateManager } from './skill-updates.mjs';

const root = await mkdtemp(path.join(os.tmpdir(), 'deck-skill-updates-'));
const dataRoot = path.join(root, 'data');
const source = path.join(root, 'source');
const targetRoot = path.join(root, 'skills');
await Promise.all([dataRoot, source, targetRoot].map(dir => mkdir(dir)));
const name = 'tdd';
const text = revision => `---\nname: tdd\ndescription: Test driven development\n---\n# Revision ${revision}\nRead [rules](rules.md).`;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function publish(revision, body = text(revision)) {
  const files = [['SKILL.md', body], ['rules.md', '# Necessary rule']];
  await mkdir(path.join(source, name), { recursive: true });
  for (const [file, content] of files) await writeFile(path.join(source, name, file), content);
  const manifest = { sourceId: 'confirmed-origin', revision,
    skills: [{ name, files: files.map(([file, content]) => ({ path: file, size: Buffer.byteLength(content), sha256: digest(content), url: name + '/' + file })) }],
  };
  await writeFile(path.join(source, 'manifest.json'), JSON.stringify(manifest));
  return manifest;
}
const binding = { id: 'existing-binding', sourceId: 'confirmed-origin', projectRoot: root, kind: 'host', targetRoot, manifestUrl: pathToFileURL(path.join(source, 'manifest.json')).href };
const options = { dataRoot, workspaceRoot: root, frozenBundledDir: path.join(root, 'frozen'),
  getBindings: async () => [binding],
  assessRequirements: async () => ({ complete: true, tools: [] }),
};
try {
  await publish('v1');
  const manager = createSkillUpdateManager(options);
  const result = await manager.prepare({ reason: 'startup' });
  assert.equal(result.bindings[0].status, 'updated');
  assert.equal(await readFile(path.join(targetRoot, name, 'SKILL.md'), 'utf8'), text('v1'));
  const again = await manager.prepare({ name, reason: 'before-use' });
  assert.equal(again.bindings[0].status, 'up-to-date');
  assert.equal(again.bindings[0].downloadedFiles, 0);
  assert.equal(again.actualLoad, 'unknown');
  await rename(path.join(source, name, 'SKILL.md'), path.join(source, name, 'SKILL.offline'));
  assert.equal((await manager.prepare({ name })).bindings[0].status, 'up-to-date', 'manifest check succeeds even while unchanged remote body is unavailable');
  await rename(path.join(source, name, 'SKILL.offline'), path.join(source, name, 'SKILL.md'));
  console.log('PASS startup installs and before-use checks without re-downloading unchanged rules');

  await publish('v2');
  const upgrade = await manager.prepare({ name });
  assert.equal(upgrade.bindings[0].status, 'updated');
  assert.equal(await readFile(path.join(targetRoot, '.mattskills-maintenance', upgrade.bindings[0].backupId, 'backup', name, 'SKILL.md'), 'utf8'), text('v1'));
  await publish('v3');
  await writeFile(path.join(source, name, 'SKILL.md'), 'corrupt download');
  const corrupt = await manager.prepare({ name });
  assert.equal(corrupt.bindings[0].status, 'check-failed');
  assert.equal(corrupt.bindings[0].usable, true);
  assert.equal(corrupt.bindings[0].latest, false);
  assert.equal(await readFile(path.join(targetRoot, name, 'SKILL.md'), 'utf8'), text('v2'));
  const brokenSource = createSkillUpdateManager({ ...options, getBindings: async () => [{ ...binding, manifestUrl: pathToFileURL(path.join(source, 'missing.json')).href }] });
  assert.equal((await brokenSource.prepare({ name })).bindings[0].status, 'check-failed');
  const unbound = createSkillUpdateManager({ ...options, getBindings: async () => [] });
  assert.equal((await unbound.prepare({ name })).status, 'source-unbound');
  console.log('PASS updates back up rules and failed checks/downloads preserve usable versions');

  const duplicate = createSkillUpdateManager({ ...options, getBindings: async () => [binding, { ...binding, id: 'another' }] });
  assert.equal((await duplicate.prepare({ name })).status, 'binding-invalid');
  const overlap = createSkillUpdateManager({ ...options, getBindings: async () => [binding, { ...binding, id: 'nested', targetRoot: path.join(targetRoot, name) }] });
  assert.equal((await overlap.prepare({ name })).status, 'binding-invalid');
  const wrongProject = createSkillUpdateManager({ ...options, getBindings: async () => [{ ...binding, projectRoot: source }] });
  assert.equal((await wrongProject.prepare({ name })).status, 'binding-invalid');
  const frozen = createSkillUpdateManager({ ...options, frozenBundledDir: targetRoot });
  assert.equal((await frozen.prepare({ name })).status, 'binding-invalid');
  const bundleWrong = createSkillUpdateManager({ ...options, getBindings: async () => [{ ...binding, kind: 'bundled' }] });
  assert.equal((await bundleWrong.prepare({ name })).status, 'binding-invalid');
  const malicious = await publish('bad');
  malicious.skills[0].files[0].path = '../outside.md';
  await writeFile(path.join(source, 'manifest.json'), JSON.stringify(malicious));
  assert.equal((await manager.prepare({ name })).bindings[0].latest, false);
  assert.equal(await readFile(path.join(targetRoot, name, 'SKILL.md'), 'utf8'), text('v2'));
  await mkdir(path.join(targetRoot, 'unrelated'));
  await writeFile(path.join(targetRoot, 'unrelated', 'SKILL.md'), 'Leave me alone');
  await assert.rejects(manager.prepare({ name: 'unrelated', targetRoot: root }), /out-of-scope/);
  await publish('v4');
  await manager.prepare({ name });
  await writeFile(path.join(targetRoot, name, 'old-removed.md'), 'not in new manifest');
  const removedFile = await manager.prepare({ name });
  assert.equal(removedFile.bindings[0].status, 'updated');
  await assert.rejects(readFile(path.join(targetRoot, name, 'old-removed.md')), /ENOENT/);
  assert.equal(await readFile(path.join(targetRoot, 'unrelated', 'SKILL.md'), 'utf8'), 'Leave me alone');
  console.log('PASS duplicate bindings, frozen/bundled targets and path traversal fail closed; unrelated skills preserved');

  const control = path.join(targetRoot, '.mattskills-maintenance');
  const interrupted = '12345678-1234-1234-1234-123456789abc';
  await mkdir(path.join(control, interrupted, 'backup'), { recursive: true });
  await mkdir(path.join(control, interrupted, 'stage'), { recursive: true });
  await rename(path.join(targetRoot, name), path.join(control, interrupted, 'backup', name));
  await mkdir(path.join(targetRoot, name));
  await writeFile(path.join(targetRoot, name, 'SKILL.md'), text('incomplete-new-version'));
  await writeFile(path.join(control, 'transaction.json'), JSON.stringify({ id: interrupted, phase: 'switching', operations: [{ name, hadOld: true }] }));
  await writeFile(path.join(control, 'lock.json'), JSON.stringify({ pid: 2147483647, token: 'dead-owner' }));
  const recoverViaPublicEntry = await brokenSource.prepare({ name });
  assert.equal(recoverViaPublicEntry.bindings[0].status, 'check-failed');
  assert.equal(recoverViaPublicEntry.bindings[0].usable, true);
  assert.equal(await readFile(path.join(targetRoot, name, 'SKILL.md'), 'utf8'), text('v4'));
  console.log('PASS next prepare recovers interrupted replacement before a failing source check');

  const fallbackRoot = path.join(root, 'frozen');
  await mkdir(path.join(fallbackRoot, name), { recursive: true });
  await writeFile(path.join(fallbackRoot, name, 'SKILL.md'), text('frozen-backup'));
  await writeFile(path.join(fallbackRoot, name, 'rules.md'), '# Necessary rule');
  const missingTarget = path.join(root, 'missing-target');
  const fallback = createSkillUpdateManager({ ...options, getBindings: async () => [{ ...binding, targetRoot: missingTarget, manifestUrl: pathToFileURL(path.join(source, 'missing.json')).href }] });
  const fallbackResult = await fallback.prepare({ name });
  assert.equal(fallbackResult.bindings[0].status, 'check-failed');
  assert.equal(fallbackResult.bindings[0].usable, true);
  assert.equal(fallbackResult.bindings[0].availability[0].mode, 'bundled-readonly');
  console.log('PASS installation failure can retain a complete verified frozen read-only fallback');

  const outside = path.join(root, 'outside-skill');
  await mkdir(outside);
  await writeFile(path.join(outside, 'SKILL.md'), text('outside'));
  const realTarget = path.join(targetRoot, name + '-preserved');
  await rename(path.join(targetRoot, name), realTarget);
  await symlink(outside, path.join(targetRoot, name), process.platform === 'win32' ? 'junction' : 'dir');
  try {
    const rejectedLink = await manager.prepare({ name });
    assert.equal(rejectedLink.bindings[0].errorKind, 'symlink-target');
    assert.equal(await readFile(path.join(outside, 'SKILL.md'), 'utf8'), text('outside'));
  } finally { await unlink(path.join(targetRoot, name)); await rename(realTarget, path.join(targetRoot, name)); }
  console.log('PASS symlink/junction skill targets are rejected without reading or changing outside rules');

  await publish('managed-bundle');
  const bundleManager = createSkillUpdateManager({ ...options,
    getBindings: async () => [{ ...binding, kind: 'bundled', targetRoot: undefined }],
  });
  assert.equal((await bundleManager.prepare({ name })).bindings[0].status, 'updated');
  assert.equal(await readFile(path.join(bundleManager.managedBundledDir, name, 'SKILL.md'), 'utf8'), text('managed-bundle'));
  assert.equal(await readFile(path.join(fallbackRoot, name, 'SKILL.md'), 'utf8'), text('frozen-backup'));
  console.log('PASS maintained bundled copy lives in dataRoot while frozen reference stays unchanged');

  await publish('http-v1');
  let bodyRequests = 0;
  let blockBodies = false;
  let releaseManifest;
  let announce;
  const started = new Promise(resolve => { announce = resolve; });
  const holding = new Promise(resolve => { releaseManifest = resolve; });
  let holdFirst = true;
  const server = createServer(async (request, response) => {
    try {
      if (request.url === '/manifest.json' && holdFirst) { holdFirst = false; announce(); await holding; }
      if (!['/manifest.json', '/tdd/SKILL.md', '/tdd/rules.md'].includes(request.url)) { response.writeHead(404).end(); return; }
      if (request.url !== '/manifest.json') { bodyRequests++; if (blockBodies) { response.writeHead(503).end(); return; } }
      response.end(await readFile(path.join(source, request.url.slice(1))));
    } catch { response.writeHead(500).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const httpBinding = { ...binding, targetRoot: path.join(root, 'http-skills'), manifestUrl: `http://127.0.0.1:${server.address().port}/manifest.json` };
  const childOptions = { dataRoot, workspaceRoot: root, frozenBundledDir: options.frozenBundledDir };
  const code = `import {createOriginalHost} from ${JSON.stringify(new URL('./node-host.mjs', import.meta.url).href)};
    import {readFile} from 'node:fs/promises'; import path from 'node:path';
    const options=${JSON.stringify(childOptions)}; const binding=${JSON.stringify(httpBinding)};
    process.chdir(options.dataRoot);
    const host=await createOriginalHost({...options,skillHost:{getUpdateBindings:async()=>[binding],resolveSkill:async()=>({projectRoot:options.workspaceRoot,path:path.join(binding.targetRoot,'tdd','SKILL.md'),sourceId:binding.sourceId,binding}),assessRequirements:async()=>({complete:true,tools:[]})}});
    console.log(JSON.stringify({initial:(await host.call('skill.readDoc',{name:'tdd'})).value.update.status}));
    const prepared=(await host.call('skill.prepare',{name:'tdd'})).value;
    const doc=(await host.call('skill.readDoc',{name:'tdd'})).value;
    const events=(await readFile(path.join(options.dataRoot,'write-audit.jsonl'),'utf8')).trim().split('\\n').map(JSON.parse).filter(row=>row.method==='skill.prepare');
    console.log(JSON.stringify({prepared,doc,events})); host.dispose(); process.exit(0);`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CODEX_HOME: path.join(root, 'isolated-codex-home') } });
  let output = '', errors = '';
  let initialReady;
  const initialLine = new Promise(resolve => { initialReady = resolve; });
  child.stdout.on('data', chunk => { output += chunk; if (output.includes('\n')) initialReady(); }); child.stderr.on('data', chunk => { errors += chunk; });
  const completed = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(new Error(errors))); });
  const timeout = setTimeout(() => child.kill(), 15000);
  try {
    await Promise.race([started, completed.then(() => { throw new Error('child-finished-before-manifest: ' + output); })]);
    await Promise.race([initialLine, completed]);
    assert.equal(JSON.parse(output.trim().split('\n')[0]).initial, 'checking', 'read-only host creation and skill details do not wait for the held source');
    const competitor = createSkillUpdateManager({ ...options, getBindings: async () => [httpBinding] });
    assert.equal((await competitor.prepare({ name })).bindings[0].status, 'busy');
    releaseManifest(); await completed;
    const completedHost = JSON.parse(output.trim().split('\n')[1]);
    assert.equal(completedHost.prepared.bindings[0].status, 'up-to-date');
    assert.ok(completedHost.doc.md.includes('# Revision http-v1'));
    assert.equal(completedHost.doc.source.actualLoad, 'unknown');
    assert.ok(completedHost.events.some(row => row.stage === 'startup' && row.category === 'skill-maintenance'));
    assert.ok(completedHost.events.some(row => row.stage === 'before-use' && row.confirmation === 'automatic-library-policy'));
    assert.ok(completedHost.events.every(row => !JSON.stringify(row).includes(root)));
    const count = bodyRequests;
    blockBodies = true;
    assert.equal((await competitor.prepare({ name })).bindings[0].status, 'up-to-date');
    assert.equal(bodyRequests, count, 'unchanged HTTP manifest does not request blocked body endpoints');
    await publish('http-v2');
    const outage = await competitor.prepare({ name });
    assert.equal(outage.bindings[0].status, 'check-failed');
    assert.equal(outage.bindings[0].usable, true);
    assert.equal(await readFile(path.join(httpBinding.targetRoot, name, 'SKILL.md'), 'utf8'), text('http-v1'));
    console.log('PASS HTTP source checks avoid body requests; cross-process lock rejects overlap and outages preserve rules');
  } finally {
    clearTimeout(timeout); releaseManifest(); child.kill(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
} finally {
  await rm(root, { recursive: true, force: true });
}
