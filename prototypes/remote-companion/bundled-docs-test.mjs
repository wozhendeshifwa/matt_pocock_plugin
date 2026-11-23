import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { freezeAdapter, OUTPUT_BASE } from './freeze-adapter.mjs';
import { createStdioAdapter } from './stdio.mjs';
import { DatabaseSync } from 'node:sqlite';
import { applyReadOverlay, unavailableUpdate } from './read-overlay.mjs';
import { parseSkillMarkdown } from '../upstream-port/skills-service.mjs';

const sourceRoot = fileURLToPath(new URL('../../../../', import.meta.url)), THREAD = '01a1b180-89f8-7291-beb2-43f569f3709c';
const inner = response => response.result?.structuredContent?.value ?? response.result?.structuredContent;
async function fixture(t) {
  await mkdir(OUTPUT_BASE, { recursive: true }); const directory = await realpath(await mkdtemp(path.join(OUTPUT_BASE, 'bundled-docs-test-')));
  let adapter;
  t.after(async () => { await adapter?.close(); const root = await realpath(directory), parent = await realpath(OUTPUT_BASE);
    assert.equal(path.dirname(root).toLowerCase(), parent.toLowerCase()); assert.ok(path.basename(root).startsWith('bundled-docs-test-'));
    await rm(root, { recursive: true, maxRetries: 10, retryDelay: 100 }); });
  const frozen = await freezeAdapter({ sourceRoot, outputRoot: path.join(directory, 'candidate') });
  const project = path.join(directory, 'owned-project'), home = path.join(directory, 'codex-home'), user = path.join(directory, 'user');
  for (const item of [project, home, user]) await mkdir(item);
  const db = new DatabaseSync(path.join(home, 'state_5.sqlite'));
  try { db.exec('CREATE TABLE threads(id TEXT PRIMARY KEY,cwd TEXT,rollout_path TEXT);CREATE TABLE project_roots(project_id TEXT,position INTEGER,path TEXT)');
    db.prepare('INSERT INTO threads VALUES(?,?,NULL)').run(THREAD, project); db.prepare('INSERT INTO project_roots VALUES(?,0,?)').run('docs-fixture', project); } finally { db.close(); }
  const foreign = path.join(user, '.dsh/profiles/web/node_modules/dsh-mattpocock-skills-deck/bundled-skills/profile-only/SKILL.md');
  await mkdir(path.dirname(foreign), { recursive: true }); await writeFile(foreign, 'Private profile copy must never be returned\n');
  const env = {};
  for (const key of ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP']) if (process.env[key]) env[key] = process.env[key];
  Object.assign(env, { CODEX_HOME: home, HOME: user, USERPROFILE: user, APPDATA: path.join(user, 'AppData/Roaming') });
  adapter = createStdioAdapter(frozen.adapterPath, { env }); let sequence = 0;
  const call = (method, payload = {}) => adapter.request({ jsonrpc: '2.0', id: ++sequence, method: 'tools/call', params: {
    name: 'deck_upstream_read', arguments: { method, payload: { ...payload, expectedThreadId: THREAD } }, _meta: { threadId: THREAD },
  } }, { projectRoot: project, threadId: THREAD });
  return { directory, frozen, project, user, call };
}

test('all 27 original skill documents and translations come from the same packaged directory as their registry', { timeout: 30000 }, async t => {
  const f = await fixture(t), bundled = path.join(f.frozen.directory, 'vendor/mattskills-1.8.0-rc.7/bundled-skills');
  const names = (await readdir(bundled, { withFileTypes: true })).filter(item => item.isDirectory()).map(item => item.name); assert.equal(names.length, 27);
  for (const name of names) {
    const doc = inner(await f.call('skill.readDoc', { name })), source = await readFile(path.join(bundled, name, 'SKILL.md'), 'utf8');
    assert.equal(doc?.ok, true, name); assert.equal(doc.md.trim(), parseSkillMarkdown(source).content.trim(), name);
    assert.equal(doc.path.toLowerCase(), path.join(bundled, name, 'SKILL.md').toLowerCase());
    const translation = await readFile(path.join(bundled, name, 'SKILL.zh.md'), 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (translation) { assert.equal(doc.mdZh.trim(), parseSkillMarkdown(translation)?.content?.trim() ?? translation.trim()); assert.equal(doc.pathZh.toLowerCase(), path.join(bundled, name, 'SKILL.zh.md').toLowerCase()); }
    else { assert.equal(doc.mdZh, null); assert.equal(doc.pathZh, null); }
  }
  for (const name of ['profile-only', '../wayfinder', 'wayfinder/../../private', 'x'.repeat(65)]) {
    assert.deepEqual(inner(await f.call('skill.readDoc', { name })), { ok: false, missing: true });
  }
});

test('only the original absent DSH update dependency becomes an honest manual-update result', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  for (const method of ['updateStatus', 'updateCheck', 'updateChangelog']) {
    const response = await f.call(method, method === 'updateChangelog' ? { version: '1.8.0-rc.7' } : {}), value = inner(response);
    assert.equal(response.result?.isError, undefined); assert.equal(value.ok, false); assert.equal(value.unsupported, true); assert.equal(value.errorKind, 'unsupported');
    assert.equal(value.snapshot, undefined); assert.match(value.error, /手动更新/); assert.equal(JSON.stringify(value).includes('Cannot find package'), false);
  }
});

test('the read adaptation preserves unrelated errors and refuses changed source anchors', () => {
  const modulePath = 'C:\\fixed\\vendor\\lib\\updateFromPackage.js', moduleUrl = 'file:///C:/fixed/vendor/lib/updateFromPackage.js';
  const known = { ok: false, error: { code: 'internal', message: "Cannot find package 'dsh-plugin-update' imported from " + modulePath } };
  assert.equal(unavailableUpdate('updateStatus', known, { modulePath, moduleUrl }).unsupported, true);
  for (const [method, result] of [['gitDiff', known], ['updateStatus', { ok: true }], ['updateStatus', { ...known, error: { ...known.error, code: 'network' } }],
    ['updateStatus', { ...known, error: { ...known.error, message: known.error.message + '.elsewhere' } }]]) assert.equal(unavailableUpdate(method, result, { modulePath, moduleUrl }), null);
  assert.throws(() => applyReadOverlay('vendor/mattskills-1.8.0-rc.7/lib/skillDoc.js', 'drift', '\n'), /anchor drift/);
});
