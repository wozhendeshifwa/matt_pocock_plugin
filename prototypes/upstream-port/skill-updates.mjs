import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { MATT_SKILL_PROBE_NAMES } from '../../vendor/mattskills-1.8.0-rc.7/shared/matt-skills.js';
import { createSkillsService, parseSkillMarkdown } from './skills-service.mjs';

const NAMES = new Set(MATT_SKILL_PROBE_NAMES);
const LIMIT = 200000;
const TOTAL_LIMIT = 8 * 1024 * 1024;
const CONTROL = '.mattskills-maintenance';
const hash = value => createHash('sha256').update(value).digest('hex');
const inside = (root, file) => { const rel = path.relative(root, file); return !path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep); };
const exists = async file => Boolean(await fs.lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; }));
const json = async file => JSON.parse(await fs.readFile(file, 'utf8'));
async function save(file, value) {
  const temporary = file + '.' + randomUUID() + '.tmp';
  await fs.writeFile(temporary, JSON.stringify(value), { flag: 'wx' });
  await fs.rename(temporary, file);
}
function relative(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('%') || value.includes(':') || value.startsWith('/') || value.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part)) || /[\x00-\x1f<>"|?*#]/.test(value)) throw new Error('invalid-path');
  return value;
}
async function noLinks(root, file) {
  if (!inside(root, file)) throw new Error('target-outside-root');
  for (let current = file; inside(root, current); current = path.dirname(current)) {
    const info = await fs.lstat(current).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (info?.isSymbolicLink()) throw new Error('symlink-target');
    if (current === root) break;
  }
}
async function bounded(url, limit) {
  if (url.protocol === 'file:') {
    const file = fileURLToPath(url);
    const info = await fs.stat(file);
    if (!info.isFile() || info.size > limit) throw new Error('source-size-limit');
    const bytes = await fs.readFile(file);
    if (bytes.length > limit) throw new Error('source-size-limit');
    return bytes;
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname))) throw new Error('unsupported-source-protocol');
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('source-http-' + response.status);
  const chunks = [];
  let size = 0;
  for await (const bytes of response.body) {
    size += bytes.length;
    if (size > limit) throw new Error('source-size-limit');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}
function manifestOf(bytes, binding) {
  const manifest = JSON.parse(bytes.toString('utf8'));
  if (manifest.sourceId !== binding.sourceId || typeof manifest.revision !== 'string' || !manifest.revision || manifest.revision.length > 256 || !Array.isArray(manifest.skills) || !manifest.skills.length || manifest.skills.length > 27) throw new Error('invalid-manifest');
  const seen = new Set();
  let size = 0;
  for (const skill of manifest.skills) {
    if (!NAMES.has(skill.name) || seen.has(skill.name) || !Array.isArray(skill.files) || !skill.files.length || skill.files.length > 64) throw new Error('manifest-skill-out-of-scope');
    seen.add(skill.name);
    const files = new Set();
    for (const file of skill.files) {
      const filePath = relative(file.path);
      if (files.has(filePath.toLowerCase()) || !Number.isSafeInteger(file.size) || file.size < 0 || file.size > LIMIT || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error('invalid-manifest-file');
      files.add(filePath.toLowerCase());
      relative(file.url);
      size += file.size;
    }
    if (!files.has('skill.md')) throw new Error('missing-skill-document');
  }
  if (size > TOTAL_LIMIT) throw new Error('manifest-size-limit');
  return manifest;
}
async function sourceFile(binding, file) {
  const base = new URL('.', binding.manifestUrl);
  const url = new URL(file.url, base);
  if (url.origin !== base.origin || url.protocol !== base.protocol || !url.pathname.startsWith(base.pathname)) throw new Error('source-origin-changed');
  if (url.protocol === 'file:') {
    const basePath = await fs.realpath(fileURLToPath(base));
    const filePath = await fs.realpath(fileURLToPath(url));
    if (!inside(basePath, filePath)) throw new Error('source-symlink-outside-root');
  }
  const bytes = await bounded(url, LIMIT);
  if (bytes.length !== file.size || hash(bytes) !== file.sha256) throw new Error('source-integrity-failed');
  return bytes;
}
function alive(pid) { if (!Number.isSafeInteger(pid) || pid <= 0) return true; try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } }
export async function acquireSkillMaintenanceLock(control) {
  const lock = path.join(control, 'lock.json');
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = randomUUID();
    const ownerPath = path.join(control, 'owner-' + token + '.json');
    await fs.writeFile(ownerPath, JSON.stringify({ pid: process.pid, token }), { flag: 'wx' });
    try {
      // Linking an already-written owner record atomically publishes ownership;
      // a crash cannot leave an empty lock file with an unknowable process.
      await noLinks(control, lock);
      await fs.link(ownerPath, lock);
      return async () => {
        if ((await json(lock).catch(() => null))?.token === token) await fs.unlink(lock);
        await fs.unlink(ownerPath).catch(() => {});
      };
    } catch (error) {
      await fs.unlink(ownerPath).catch(() => {});
      if (error.code !== 'EEXIST') throw error;
      const owner = await json(lock).catch(() => null);
      if (!owner || alive(owner.pid)) throw new Error('maintenance-busy');
      const reclaim = path.join(control, 'reclaim');
      await fs.mkdir(reclaim).catch(() => { throw new Error('maintenance-busy'); });
      try {
        const latest = await json(lock).catch(() => null);
        if (latest?.token === owner.token && !alive(latest.pid)) await fs.unlink(lock);
      } finally { await fs.rmdir(reclaim); }
    }
  }
  throw new Error('maintenance-busy');
}

export function createSkillUpdateManager({ dataRoot, workspaceRoot, frozenBundledDir, getBindings, assessRequirements, assessMaintenanceRequirements = assessRequirements, audit = async () => {} }) {
  const managedBundledDir = path.resolve(dataRoot, 'skill-library');
  let queue = Promise.resolve();
  let last = { status: 'not-checked', actualLoad: 'unknown', bindings: [] };
  async function inspectLocal(binding, name) {
    let target = null;
    try {
      await noLinks(path.parse(binding.targetRoot).root, path.join(binding.targetRoot, name));
      target = await createSkillsService({ bundledDir: binding.targetRoot, workspaceRoot, assessRequirements }).inspectForUse(name);
    } catch { /* A rejected target must not be followed even for availability. */ }
    const fallback = frozenBundledDir && await createSkillsService({ bundledDir: frozenBundledDir, workspaceRoot, assessRequirements }).inspectForUse(name);
    return { name, targetReadable: Boolean(target), fallbackReadable: Boolean(fallback),
      usable: Boolean(target?.execution.allowed || fallback?.execution.allowed),
      mode: target?.execution.allowed ? 'bound-files' : fallback?.execution.allowed ? 'bundled-readonly' : 'prerequisites-unverified' };
  }
  async function validateBindings(values) {
    if (!Array.isArray(values) || values.length > 27) throw new Error('invalid-bindings');
    const ids = new Set();
    const targets = new Set();
    const out = [];
    for (const input of values) {
      if (!input || typeof input.id !== 'string' || !input.id || typeof input.sourceId !== 'string' || !input.sourceId || !['host', 'bundled'].includes(input.kind)) throw new Error('invalid-binding');
      const currentProject = await fs.realpath(workspaceRoot);
      if (!input.projectRoot || await fs.realpath(input.projectRoot).catch(() => null) !== currentProject) throw new Error('wrong-project-binding');
      const targetRoot = input.kind === 'bundled' ? managedBundledDir : input.targetRoot;
      if (!path.isAbsolute(targetRoot ?? '') || targetRoot === path.parse(targetRoot).root) throw new Error('invalid-target-root');
      const target = path.resolve(targetRoot);
      if (input.kind === 'bundled' && input.targetRoot && path.resolve(input.targetRoot) !== managedBundledDir) throw new Error('invalid-bundled-target');
      if (frozenBundledDir && (inside(path.resolve(frozenBundledDir), target) || inside(target, path.resolve(frozenBundledDir)))) throw new Error('frozen-vendor-target');
      if (ids.has(input.id) || [...targets].some(existing => inside(existing, target.toLowerCase()) || inside(target.toLowerCase(), existing))) throw new Error('conflicting-bindings');
      const url = new URL(input.manifestUrl);
      if (url.username || url.password || url.hash) throw new Error('invalid-source-url');
      if (!['file:', 'https:'].includes(url.protocol) && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('unsupported-source-protocol');
      ids.add(input.id); targets.add(target.toLowerCase());
      out.push({ ...input, targetRoot: target, manifestUrl: url.href });
    }
    return out;
  }
  async function recover(control, targetRoot) {
    const file = path.join(control, 'transaction.json');
    if (!await exists(file)) return;
    const journal = await json(file);
    if (!/^[a-f0-9-]{36}$/.test(journal.id) || !['switching', 'committed'].includes(journal.phase) || !Array.isArray(journal.operations) || journal.operations.length > 27 || new Set(journal.operations.map(op => op.name)).size !== journal.operations.length || journal.operations.some(op => !NAMES.has(op.name) || typeof op.hadOld !== 'boolean')) throw new Error('invalid-recovery-journal');
    if (journal.phase === 'committed') { await fs.unlink(file); return; }
    let failed = false;
    for (const op of journal.operations.slice().reverse()) {
      try {
      const target = path.join(targetRoot, op.name);
      const backup = path.join(control, journal.id, 'backup', op.name);
      const staged = path.join(control, journal.id, 'stage', op.name);
      await noLinks(targetRoot, target); await noLinks(targetRoot, backup); await noLinks(targetRoot, staged);
      if (await exists(backup)) {
        if (await exists(target)) await fs.rename(target, path.join(control, journal.id, 'failed-' + op.name));
        await fs.rename(backup, target);
      } else if (!op.hadOld && !await exists(staged) && await exists(target)) {
        await fs.rename(target, path.join(control, journal.id, 'failed-' + op.name));
      }
      } catch { failed = true; }
    }
    if (failed) throw new Error('recovery-required');
    await fs.unlink(file);
  }
  async function update(binding, requested) {
    const result = { id: binding.id, sourceId: binding.sourceId, latest: false, downloadedFiles: 0, status: 'check-failed', actualLoad: 'unknown' };
    // Read the bound catalog before touching its target. A source legitimately
    // managing other skills is not a failure of this requested skill.
    let manifest, manifestError = binding.sourceError ? new Error(binding.sourceError) : undefined;
    if (requested && !manifestError) {
      try { manifest = manifestOf(await bounded(new URL(binding.manifestUrl), 1024 * 1024), binding); }
      catch (error) { manifestError = error; }
    }
    if (requested && manifest && !manifest.skills.some(skill => skill.name === requested)) return null;
    let release;
    let control;
    let selectedNames = requested ? [requested] : [];
    try {
      await noLinks(path.parse(binding.targetRoot).root, binding.targetRoot);
      await fs.mkdir(binding.targetRoot, { recursive: true });
      control = path.join(binding.targetRoot, CONTROL);
      await noLinks(binding.targetRoot, control);
      await fs.mkdir(control, { recursive: true });
      release = await acquireSkillMaintenanceLock(control);
      await recover(control, binding.targetRoot);
      const previous = await json(path.join(control, 'state.json')).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (previous && previous.sourceId !== binding.sourceId) throw new Error('bound-source-changed');
      // Even when the source is unavailable, recover an interrupted matching
      // target transaction before reporting the failed check.
      if (manifestError) throw manifestError;
      if (!manifest) manifest = manifestOf(await bounded(new URL(binding.manifestUrl), 1024 * 1024), binding);
      result.revision = manifest.revision;
      const selected = requested ? manifest.skills.filter(skill => skill.name === requested) : manifest.skills;
      if (!selected.length) throw new Error('skill-not-in-bound-source');
      selectedNames = selected.map(skill => skill.name);
      const changed = [];
      for (const skill of selected) {
        const dir = path.join(binding.targetRoot, skill.name);
        await noLinks(binding.targetRoot, dir);
        let equal = true;
        const expected = new Set(skill.files.map(file => file.path));
        let entriesSeen = 0;
        async function scan(directory, prefix = '') {
          for (const entry of await fs.readdir(directory, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; })) {
            if (++entriesSeen > 4096) throw new Error('installed-tree-size-limit');
            if (entry.isSymbolicLink()) throw new Error('symlink-target');
            const local = prefix + entry.name;
            if (entry.isDirectory()) await scan(path.join(directory, entry.name), local + '/');
            else if (!entry.isFile() || !expected.has(local)) equal = false;
          }
        }
        await scan(dir);
        for (const file of skill.files) {
          const local = path.join(dir, file.path);
          await noLinks(binding.targetRoot, local);
          const info = await fs.stat(local).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
          const bytes = info?.isFile() && info.size <= LIMIT ? await fs.readFile(local) : null;
          if (!bytes || bytes.length !== file.size || hash(bytes) !== file.sha256) equal = false;
        }
        if (!equal) changed.push(skill);
      }
      if (!changed.length) {
        result.status = 'up-to-date'; result.latest = true;
      } else {
        const id = randomUUID();
        const stageRoot = path.join(control, id, 'stage');
        const backupRoot = path.join(control, id, 'backup');
        await fs.mkdir(stageRoot, { recursive: true }); await fs.mkdir(backupRoot, { recursive: true });
        for (const skill of changed) {
          for (const file of skill.files) {
            const bytes = await sourceFile(binding, file);
            result.downloadedFiles++;
            const target = path.join(stageRoot, skill.name, file.path);
            await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, bytes, { flag: 'wx' });
          }
          const parsed = parseSkillMarkdown(await fs.readFile(path.join(stageRoot, skill.name, 'SKILL.md'), 'utf8'));
          if (parsed?.name !== skill.name) throw new Error('skill-name-mismatch');
          const entry = await createSkillsService({ bundledDir: stageRoot, workspaceRoot, assessRequirements: assessMaintenanceRequirements }).inspectForUse(skill.name);
          if (!entry?.execution.allowed) throw new Error('update-prerequisites-unverified');
        }
        const operations = [];
        for (const skill of changed) {
          const target = path.join(binding.targetRoot, skill.name);
          await noLinks(binding.targetRoot, target);
          operations.push({ name: skill.name, hadOld: await exists(target) });
        }
        const journal = { id, phase: 'switching', operations };
        await save(path.join(control, 'transaction.json'), journal);
        for (const op of operations) {
          const target = path.join(binding.targetRoot, op.name);
          await noLinks(binding.targetRoot, target);
          if (op.hadOld) await fs.rename(target, path.join(backupRoot, op.name));
          await fs.rename(path.join(stageRoot, op.name), target);
        }
        await save(path.join(control, 'transaction.json'), { ...journal, phase: 'committed' });
        await fs.unlink(path.join(control, 'transaction.json'));
        result.status = 'updated'; result.latest = true; result.backupId = id;
      }
      await save(path.join(control, 'state.json'), { sourceId: binding.sourceId, revision: manifest.revision, manifestHash: hash(JSON.stringify(manifest)), checkedAt: new Date().toISOString() });
    } catch (error) {
      if (release && control) await recover(control, binding.targetRoot).catch(() => { result.recoveryRequired = true; });
      result.status = error.message === 'maintenance-busy' ? 'busy' : 'check-failed';
      result.errorKind = /^[a-z0-9-]+$/.test(error.message) ? error.message : 'update-failed';
      result.latest = false;
    } finally { await release?.().catch(() => {}); }
    result.availability = [];
    for (const name of selectedNames) result.availability.push(await inspectLocal(binding, name));
    result.readable = result.availability.length > 0 && result.availability.every(item => item.targetReadable || item.fallbackReadable);
    result.usable = result.availability.length > 0 && result.availability.every(item => item.usable);
    if (result.status === 'check-failed' && requested && !result.usable) result.status = 'install-failed-no-usable-source';
    return result;
  }
  async function run(input = {}) {
    if (Object.keys(input).some(key => !['name', 'reason'].includes(key))) throw new Error('skill-prepare-out-of-scope');
    const { name, reason = 'before-use' } = input;
    if ((name != null && !NAMES.has(name)) || !['startup', 'before-use'].includes(reason)) throw new Error('skill-prepare-out-of-scope');
    last = { ...last, status: 'checking', latest: false };
    await audit({ reason, status: 'checking' });
    let bindings;
    try { bindings = await validateBindings(await getBindings?.({ projectRoot: workspaceRoot }) ?? []); }
    catch { last = { status: 'binding-invalid', bindings: [], checkedAt: new Date().toISOString(), actualLoad: 'unknown', latest: false }; await audit({ reason, status: last.status }); return last; }
    if (!bindings.length) { last = { status: 'source-unbound', bindings: [], checkedAt: new Date().toISOString(), actualLoad: 'unknown', latest: false }; await audit({ reason, status: last.status }); return last; }
    const results = [], resultTargets = [];
    for (const binding of bindings) {
      const result = await update(binding, name);
      if (result) { results.push(result); resultTargets.push(binding.targetRoot); }
    }
    const latest = results.length > 0 && results.every(item => item.latest);
    last = { status: !results.length ? 'source-unbound' : latest ? 'checked' : 'attention', latest,
      ...(!results.length ? { reason:'skill-not-in-bound-sources' } : {}), checkedAt: new Date().toISOString(), actualLoad: 'unknown', bindings: results };
    await audit({ reason, status: last.status, bindings: results.map((item, index) => ({ sourceHash: hash(item.sourceId).slice(0, 12), targetHash: hash(resultTargets[index]).slice(0, 12), status: item.status, errorKind: item.errorKind ?? '' })) });
    return last;
  }
  return {
    managedBundledDir,
    prepare(input) { const next = queue.then(() => run(input), () => run(input)); queue = next.catch(() => {}); return next; },
    status() { return structuredClone(last); },
  };
}
