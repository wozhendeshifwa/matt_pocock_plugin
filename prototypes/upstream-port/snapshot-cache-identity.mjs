import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import path from 'node:path';
import { resolveExecutable } from './executables.mjs';

const execute = promisify(execFile);
// Local validation only: do not run GitHub environment checks before showing a
// previously fetched project snapshot. Hash effective Git config so remote,
// includeIf and worktree configuration changes all invalidate old snapshots.
export function createSnapshotCacheIdentity(workspaceRoot) {
  return async () => {
    try {
      const root = await realpath(workspaceRoot);
      const git = await resolveExecutable('git');
      if (!git) return null;
      const { stdout } = await execute(git, ['-C', root, 'config', '--null', '--list', '--show-origin'], { windowsHide: true, timeout: 2000, maxBuffer: 2 * 1024 * 1024 });
      const home = homedir();
      const ghDirectory = process.env.GH_CONFIG_DIR || (process.env.APPDATA ? path.join(process.env.APPDATA, 'GitHub CLI') : path.join(home, '.config/gh'));
      const files = [
        path.join(root, 'docs/agents/workspace.json'), path.join(root, 'docs/agents/issue-tracker.md'),
        path.join(home, '.dsh/mattskillsdeck/choices.json'),
        path.join(ghDirectory, 'hosts.yml'), path.join(ghDirectory, 'config.yml'),
      ];
      const hash = createHash('sha256').update(root.toLowerCase()).update('\0').update(stdout);
      for (const file of files) {
        let contents;
        try { contents = await readFile(file); } catch (error) { if (error.code !== 'ENOENT') return null; contents = Buffer.from('<missing>'); }
        if (contents.length > 2 * 1024 * 1024) return null;
        hash.update(file).update('\0').update(contents).update('\0');
      }
      // Never persist or log credential values; only the combined identity
      // digest is stored, so changing explicit auth invalidates cache reuse.
      for (const name of ['GH_TOKEN','GITHUB_TOKEN','GH_ENTERPRISE_TOKEN','GITHUB_ENTERPRISE_TOKEN','GH_HOST','DECK_GH']) hash.update(name).update(process.env[name] || '').update('\0');
      return hash.digest('hex');
    } catch { return null; }
  };
}
