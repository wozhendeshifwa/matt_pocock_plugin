import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { cp, mkdir, mkdtemp, realpath, readFile, writeFile, rm, symlink, stat } from 'node:fs/promises';
import { resolveAdapterDataLayout } from './local-data-layout.mjs';
import { createLocalWriteEffects } from './write-effects-local.mjs';
import { createPairing, loadPairing } from './lifecycle.mjs';

async function fixture(t) {
  const base = fileURLToPath(new URL('../../.scratch/', import.meta.url)); await mkdir(base, { recursive: true });
  const root = await realpath(await mkdtemp(path.join(base, 'local-layout-test-')));
  t.after(async () => {
    const actual = await realpath(root), parent = await realpath(base);
    assert.equal(path.dirname(actual).toLowerCase(), parent.toLowerCase());
    assert.ok(path.basename(actual).startsWith('local-layout-test-'));
    await rm(actual, { recursive: true, maxRetries: 5, retryDelay: 100 });
  });
  const shared = path.join(root, 'existing-local-state'), project = path.join(root, 'Project-A');
  await mkdir(shared); await mkdir(path.join(project, '.git'), { recursive: true });
  const vendorSource = fileURLToPath(new URL('../../vendor/mattskills-1.8.0-rc.7/', import.meta.url));
  const adapters = [];
  for (const name of ['release-a', 'release-b']) {
    const directory = path.join(root, name), adapter = path.join(directory, 'prototypes/upstream-port/sidebar-server.mjs');
    await mkdir(path.dirname(adapter), { recursive: true }); await writeFile(adapter, '// Isolated layout marker; never executed.\n');
    const vendor = path.join(directory, 'vendor/mattskills-1.8.0-rc.7');
    for (const relative of ['shared/refresh/chain.js', 'lib/workspaceKey.js', 'lib/refresh/sessionTickets.js']) {
      await mkdir(path.dirname(path.join(vendor, relative)), { recursive: true });
      await cp(path.join(vendorSource, relative), path.join(vendor, relative));
    }
    await writeFile(path.join(vendor, 'package.json'), '{"type":"module"}\n'); adapters.push(adapter);
  }
  return { root, shared, project, adapters };
}

test('explicit local layout keeps business file locations across two immutable adapter releases', async t => {
  const f = await fixture(t);
  const [a, b] = await Promise.all(f.adapters.map(adapterPath => resolveAdapterDataLayout({ adapterPath, localDataRoot: f.shared })));
  assert.equal(a.mode, 'explicit-local'); assert.equal(a.root, b.root); assert.equal(a.projectBase, b.projectBase);
  const readers = await Promise.all(f.adapters.map(adapterPath => createLocalWriteEffects({ adapterPath, localDataRoot: f.shared })));
  const first = await readers[0].dataRootFor(f.project), second = await readers[1].dataRootFor(f.project);
  assert.equal(first, second);
  const content = {
    '.dsh/mattskillsdeck/choices.json': '{"fixture":"selected-backend"}',
    'manual-naming.json': '{"fixture":"manual-state"}',
    '.dsh-mattskillsdeck-cache/session-tickets.json': '{"fixture":"durable-chain"}',
    '.dsh-mattskillsdeck-cache/log-switch.json': '{"enabled":false,"sampleRate":0.25}',
  };
  for (const [relative, bytes] of Object.entries(content)) {
    await mkdir(path.dirname(path.join(first, relative)), { recursive: true }); await writeFile(path.join(first, relative), bytes);
    assert.equal(await readFile(path.join(second, relative), 'utf8'), bytes);
  }
  const legacy = await Promise.all(f.adapters.map(adapterPath => resolveAdapterDataLayout({ adapterPath })));
  assert.notEqual(legacy[0].root, legacy[1].root); assert.equal(legacy[0].mode, 'legacy');
});

test('an inherited environment value cannot choose the reader layout without explicit local configuration', async t => {
  const f = await fixture(t), saved = process.env.DECK_LOCAL_DATA_ROOT;
  try {
    process.env.DECK_LOCAL_DATA_ROOT = f.shared;
    const layout = await resolveAdapterDataLayout({ adapterPath: f.adapters[0] });
    assert.equal(layout.mode, 'legacy'); assert.notEqual(layout.root, f.shared);
  } finally { if (saved === undefined) delete process.env.DECK_LOCAL_DATA_ROOT; else process.env.DECK_LOCAL_DATA_ROOT = saved; }
});

test('invalid or redirected explicit roots fail closed and do not seed empty data', async t => {
  const f = await fixture(t), adapterPath = f.adapters[0], missing = path.join(f.root, 'must-not-be-created');
  const file = path.join(f.root, 'not-directory'); await writeFile(file, 'fixture');
  for (const localDataRoot of ['', 'relative', null, missing, file, '\\\\untrusted.invalid\\share']) {
    await assert.rejects(resolveAdapterDataLayout({ adapterPath, localDataRoot }));
  }
  await assert.rejects(stat(missing), { code: 'ENOENT' });
  const link = path.join(f.root, 'redirected-state');
  await symlink(f.shared, link, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(resolveAdapterDataLayout({ adapterPath, localDataRoot: link }), /redirect/);
});

test('local pairing explicitly records existing data layout while preserving other configuration', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t), provider = path.join(f.root, 'provider-config.toml');
  const sentinel = '[model_providers.deepseek]\nbase_url="https://provider.example.invalid"\n[model_providers.openai]\nname="retained"\n';
  await writeFile(provider, sentinel);
  const file = path.join(f.root, 'new-pairing.json');
  const options = { file, adapterPath: f.adapters[0], journalPath: path.join(f.root, 'journal.sqlite'),
    relayOrigin: 'https://fixture.example.invalid', deviceToken: randomBytes(32).toString('hex'), localDataRoot: f.shared };
  const created = await createPairing(options); assert.equal(created.localDataRoot, await realpath(f.shared));
  assert.equal((await loadPairing(file)).localDataRoot, created.localDataRoot);
  const before = await readFile(file); await assert.rejects(createPairing(options), /already exists/);
  assert.deepEqual(await readFile(file), before); assert.equal(await readFile(provider, 'utf8'), sentinel);
  const invalid = JSON.parse(before); invalid.localDataRoot = path.join(f.root, 'absent-root');
  const invalidFile = path.join(f.root, 'invalid-pairing.json'); await writeFile(invalidFile, JSON.stringify(invalid));
  await assert.rejects(loadPairing(invalidFile));
  assert.equal(await readFile(provider, 'utf8'), sentinel);
});
