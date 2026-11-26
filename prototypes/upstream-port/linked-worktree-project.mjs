import {readFile, realpath} from 'node:fs/promises';
import path from 'node:path';
const same = (a,b) => a.replace(/\\/g,'/').toLowerCase() === b.replace(/\\/g,'/').toLowerCase();
// Only Git's registered linked-worktree metadata can associate a checkout
// outside the project's root; a guessed common path or stale rollout cannot.
export async function linkedWorktreeProject(cwd, roots) {
  for (let directory = cwd; ; directory = path.dirname(directory)) {
    try {
      const marker = path.join(directory, '.git');
      const match = /^gitdir: (.+)\s*$/m.exec(await readFile(marker,'utf8'));
      if (match) {
        const gitdir = await realpath(path.resolve(directory, match[1].trim()));
        const common = await realpath(path.resolve(gitdir,(await readFile(path.join(gitdir,'commondir'),'utf8')).trim()));
        if (!same(path.dirname(path.dirname(gitdir)), common) || path.basename(path.dirname(gitdir)) !== 'worktrees') return null;
        const backlink = await realpath((await readFile(path.join(gitdir,'gitdir'),'utf8')).trim());
        if (!same(backlink, await realpath(marker))) return null;
        for (const root of roots) {
          try {
            if (same(await realpath(path.join(root.path,'.git')),common)) return root;
          } catch {}
        }
        return null;
      }
    } catch {}
    const parent = path.dirname(directory);
    if (parent === directory) return null;
  }
}
