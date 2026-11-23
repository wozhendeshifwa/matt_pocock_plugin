import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const run = promisify(execFile);
const REPO = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/;

export function parseRepositories(value) {
  const repositories = [...new Set(String(value ?? '').split(',').map(s => s.trim()).filter(Boolean))];
  if (!repositories.length || repositories.length > 20 || repositories.some(s => !REPO.test(s) || s.endsWith('/.') || s.endsWith('/..'))) {
    throw new Error('DECK_REPOSITORIES must contain 1–20 comma-separated GitHub owner/repo names.');
  }
  return repositories;
}

// These are managed GitHub bindings, not copies of a user's local checkout.
// No repository code, hooks, dependencies or scripts are downloaded or run.
export function createRepositoryStore({ repositories, directory, execute = run }) {
  const pending = new Map();
  const canonical = name => repositories.find(repo => repo.toLowerCase() === String(name).toLowerCase());
  async function prepare(name) {
    const repo = canonical(name);
    if (!repo) throw new Error('Repository is not in DECK_REPOSITORIES.');
    const key = createHash('sha256').update(repo.toLowerCase()).digest('hex');
    const root = path.join(directory, key);
    // Verify GitHub access before accepting a selection, including cached bindings.
    try {
      await execute('gh', ['api', `repos/${repo}`, '--jq', '.full_name'], { timeout: 30000, windowsHide: true, maxBuffer: 65536 });
    } catch (error) {
      if (/EOF|TLS|timeout|timed out|ENOTFOUND|ECONN/i.test(String(error.stderr ?? '') + error.message)) {
        throw new Error('GitHub network connection failed. Retry after connectivity is restored.');
      }
      throw new Error('Cannot access this GitHub repository. Check GH_TOKEN and repository permissions.');
    }
    if (await stat(path.join(root, '.git')).then(s => s.isDirectory()).catch(() => false)) return { repository: repo, root };
    await mkdir(directory, { recursive: true });
    const temporary = await mkdtemp(path.join(directory, 'binding-'));
    try {
      await execute('git', ['init', '--quiet', temporary], { timeout: 10000, windowsHide: true });
      await execute('git', ['-C', temporary, 'remote', 'add', 'origin', `https://github.com/${repo}.git`], { timeout: 10000, windowsHide: true });
      await mkdir(path.join(temporary, 'docs', 'agents'), { recursive: true });
      await writeFile(path.join(temporary, 'docs', 'agents', 'workspace.json'), JSON.stringify({ version: 1, backendId: 'github', pickedAt: Date.now(), source: 'user' }) + '\n');
      await rename(temporary, root);
    } finally {
      // mkdtemp's path is generated directly under the managed directory.
      await rm(temporary, { recursive: true, force: true });
    }
    return { repository: repo, root };
  }
  return {
    list: () => [...repositories],
    async select(name) {
      const repo = canonical(name);
      if (!repo) throw new Error('Repository is not in DECK_REPOSITORIES.');
      if (!pending.has(repo)) pending.set(repo, prepare(repo).catch(error => { pending.delete(repo); throw error; }));
      return pending.get(repo);
    },
  };
}
