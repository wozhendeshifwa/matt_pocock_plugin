import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { homedir } from 'node:os';

// Deliberately limited acceptance slice, not the final write capability set.
export const TRIAL_WRITE_METHODS = Object.freeze(['deck_issue_report', 'gitStage']);
const methods = new Set(TRIAL_WRITE_METHODS);
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const samePath = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
export function normalizeWriteGrant(value) {
  if (value === undefined || value === null || value?.enabled === false) return null;
  if (!plainObject(value) || value.enabled !== true || Object.keys(value).some(key => !['enabled', 'projectRoots', 'methods'].includes(key)) ||
      !Array.isArray(value.projectRoots) || value.projectRoots.length === 0 || value.projectRoots.length > 32 ||
      value.projectRoots.some(root => typeof root !== 'string' || !path.isAbsolute(root) || /[\u0000-\u001f\u007f]/.test(root)) ||
      !Array.isArray(value.methods) || value.methods.length === 0 || value.methods.some(method => !methods.has(method))) {
    throw new Error('Invalid local write policy: explicit enabled grant and nonempty absolute project/method allowlists are required');
  }
  return Object.freeze({ enabled: true, projectRoots: Object.freeze([...new Set(value.projectRoots.map(root => path.resolve(root)))]),
    methods: Object.freeze([...new Set(value.methods)]) });
}
export async function assertWriteGranted(grant, projectRoot, method) {
  if (!grant?.enabled || !grant.methods.includes(method)) throw new Error('Remote write method is not granted locally');
  const project = samePath(await realpath(projectRoot));
  const allowed = await Promise.all(grant.projectRoots.map(async root => samePath(await realpath(root))));
  if (!allowed.includes(project)) throw new Error('Remote write project is not granted locally');
}
export function installationWriteLedgerFile() {
  const localRoot = process.env.LOCALAPPDATA || (process.platform === 'win32' ? path.join(homedir(), 'AppData', 'Local') : path.join(homedir(), '.local', 'share'));
  // No pairing, session, adapter version or project suffix. The installation
  // ledger survives all of them. Never accept this path from MCP/config fields.
  return path.resolve(localRoot, 'MattSkillsDeck', 'RemoteCompanion', 'write-ledger.sqlite');
}
