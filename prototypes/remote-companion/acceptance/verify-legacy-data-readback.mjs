import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyFrozenAdapter } from '../freeze-adapter.mjs';

// Rehearse both recovery choices with synthetic data and the reviewed old readers.
// No production data, pairing file or runtime process is an input.
const [directory, expectedManifestSha256] = process.argv.slice(2);
assert.ok(directory && expectedManifestSha256, 'Expected a frozen adapter directory and its reviewed manifest SHA-256');
await verifyFrozenAdapter({ directory, expectedManifestSha256 });
const library = path.resolve(directory, 'vendor/mattskills-1.8.0-rc.7/lib');
const { createChoiceStore } = await import(pathToFileURL(path.join(library, 'choiceStore.js')));
const { createLogStore } = await import(pathToFileURL(path.join(library, 'logPkg/store.js')));
const parent = await fs.realpath(os.tmpdir());
const root = await fs.mkdtemp(path.join(parent, 'deck-recovery-readback-'));
const logDate = '2026-11-24';
const logFile = path.join('.dsh-mattskillsdeck-cache', 'logs', logDate + '.log');
const logBase = 'fixture common event\n';
const auditBase = '{"fixture":"before"}\n';
const auditLatest = auditBase + '{"fixture":"after"}\n';
const native = { ...fs, resolve: async file => path.resolve(file), readText: file => fs.readFile(file, 'utf8') };

try {
  const project = path.join(root, 'project');
  await fs.mkdir(project);
  const projectKey = process.platform === 'win32' ? project.toLowerCase() : project;
  const choices = homeDir => createChoiceStore({ homeDir, isKnownBackend: id => id === 'github' });
  const original = path.join(root, 'baseline');
  await fs.mkdir(path.join(original, path.dirname(logFile)), { recursive: true });
  assert.equal((await choices(original).rememberWorkspace(projectKey, 'github')).ok, true);
  assert.equal((await choices(original).rememberLayout(projectKey, 'single')).ok, true);
  await fs.writeFile(path.join(original, logFile), logBase);
  await fs.writeFile(path.join(original, 'write-audit.jsonl'), auditBase);

  const legacy = path.join(root, 'legacy'), stable = path.join(root, 'stable');
  await fs.cp(original, legacy, { recursive: true });
  await fs.cp(original, stable, { recursive: true });
  assert.equal((await choices(legacy).rememberLayout(projectKey, 'multi')).ok, true);
  await fs.writeFile(path.join(legacy, 'write-audit.jsonl'), auditLatest);
  for (const [folder, event] of [[legacy, 'legacy event'], [stable, 'stable event']]) {
    await fs.appendFile(path.join(folder, logFile), event + '\n');
  }

  // A single date maps to one path in the old reader. Use independent
  // candidate directories so both branches can be exported without merging.
  for (const [branch, source] of [['legacy', legacy], ['stable', stable]]) {
    const candidate = path.join(root, 'candidate-' + branch);
    await fs.cp(legacy, candidate, { recursive: true, errorOnExist: true, force: false });
    if (source === stable) await fs.copyFile(path.join(stable, logFile), path.join(candidate, logFile));
    const business = choices(candidate);
    assert.equal((await business.getWorkspace(projectKey)).backendId, 'github');
    assert.equal((await business.getLayout(projectKey)).layout, 'multi');
    assert.equal(await fs.readFile(path.join(candidate, 'write-audit.jsonl'), 'utf8'), auditLatest);
    const log = createLogStore({ fs: native, getCacheDir: async () => path.join(candidate, '.dsh-mattskillsdeck-cache'),
      getPlatform: async () => ({ path, fs: native }), DEFAULT_CWD: project });
    const exported = await log.handleLogExport({ date: logDate });
    assert.equal(exported.ok, true);
    assert.equal(exported.text, logBase + branch + ' event\n');
  }
  assert.equal((await choices(original).getLayout(projectKey)).layout, 'single');
  assert.equal(await fs.readFile(path.join(original, 'write-audit.jsonl'), 'utf8'), auditBase);
  assert.equal(await fs.readFile(path.join(original, logFile), 'utf8'), logBase);
  for (const [source, branch] of [[legacy, 'legacy'], [stable, 'stable']]) {
    assert.equal(await fs.readFile(path.join(source, logFile), 'utf8'), logBase + branch + ' event\n');
  }
  console.log(JSON.stringify({ status: 'verified', adapterManifest: expectedManifestSha256, readableLogVariants: 2,
    latestBusinessAndAuditPreserved: true, baselineAndSourceLogsPreserved: true }));
} finally {
  const actual = await fs.realpath(root);
  assert.equal(path.dirname(actual), parent);
  assert.equal(actual, root);
  assert.ok(path.basename(actual).startsWith('deck-recovery-readback-'));
  await fs.rm(actual, { recursive: true, maxRetries: 3 });
}
