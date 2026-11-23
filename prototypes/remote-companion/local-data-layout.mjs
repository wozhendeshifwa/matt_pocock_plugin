import path from 'node:path';
import { lstat, realpath } from 'node:fs/promises';
import { legacyAdapterDataRoot } from './local-data-upgrade.mjs';

const comparable = value => {
  let result = path.resolve(value);
  if (process.platform === 'win32') {
    if (result.startsWith('\\\\?\\')) result = result.slice(4);
    result = result.toLowerCase();
  }
  return result;
};

// A local configuration seam, never an MCP path argument or inherited env
// fallback. This resolves layout only; it does not seed or activate an update.
export async function resolveAdapterDataLayout({ adapterPath, localDataRoot } = {}) {
  const legacy = await legacyAdapterDataRoot(adapterPath);
  if (localDataRoot === undefined) return { adapterRoot: legacy.adapterRoot, root: legacy.dataRoot,
    projectBase: path.join(legacy.dataRoot, 'projects'), mode: 'legacy' };
  if (typeof localDataRoot !== 'string' || !path.isAbsolute(localDataRoot) || /^\\\\(?!\?\\)/.test(localDataRoot) ||
      /[\u0000-\u001f\u007f]/.test(localDataRoot)) throw new Error('Explicit local data root must be an existing absolute local directory');
  const requested = path.resolve(localDataRoot), info = await lstat(requested), actual = await realpath(requested);
  if (!info.isDirectory() || info.isSymbolicLink() || comparable(actual) !== comparable(requested)) {
    throw new Error('Explicit local data root cannot redirect through another directory');
  }
  return { adapterRoot: legacy.adapterRoot, root: actual, projectBase: path.join(actual, 'projects'), mode: 'explicit-local' };
}
