import { readFile, copyFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

// Deliberately avoid planConfig: this repair must preserve every other byte,
// including provider switches, server env, comments, BOM and line endings.
export function planToolTimeout(text) {
  const headers = [...text.matchAll(/^[\t \ufeff]*\[mcp_servers\.deck-sidebar-probe\][ \t]*(?:#[^\r\n]*)?(?=\r?$)/gm)];
  if (headers.length !== 1) throw new Error('Expected exactly one deck-sidebar-probe table');
  const start = headers[0].index + headers[0][0].length;
  const tail = text.slice(start);
  const nextTable = tail.search(/^[ \t]*\[/m);
  const end = nextTable < 0 ? text.length : start + nextTable;
  const section = text.slice(start, end);
  const fields = [...section.matchAll(/^[ \t]*tool_timeout_sec[ \t]*=[^\r\n]*/gm)];
  if (fields.length > 1) throw new Error('Duplicate tool_timeout_sec');
  let after;
  if (fields.length) {
    const field = fields[0];
    if (!/^[ \t]*tool_timeout_sec[ \t]*=[ \t]*\d+(?:\.\d+)?[ \t]*(?:#.*)?$/.test(field[0])) {
      throw new Error('Unrecognized timeout value; refusing to rewrite');
    }
    after = text.slice(0, start + field.index) + field[0].replace(/(=[ \t]*)\d+(?:\.\d+)?/, (_, prefix) => prefix + '320') + text.slice(start + field.index + field[0].length);
  } else {
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    after = text.slice(0, start) + eol + 'tool_timeout_sec = 320' + text.slice(start);
    if (start === text.length) after += eol;
  }
  return after;
}

export async function updateToolTimeout(configPath, apply = false) {
  const before = await readFile(configPath);
  const text = before.toString('utf8');
  if (!Buffer.from(text).equals(before)) throw new Error('Config is not valid UTF-8');
  const after = Buffer.from(planToolTimeout(text));
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const changed = !before.equals(after);
  let backup = null;
  if (apply && changed) {
    backup = configPath + '.issue34-' + Date.now() + '.bak';
    await copyFile(configPath, backup, 1); // COPYFILE_EXCL
    if (!(await readFile(backup)).equals(before)) throw new Error('Backup verification failed');
    if (!(await readFile(configPath)).equals(before)) throw new Error('Config changed during repair; retry');
    await writeFile(configPath, after);
    if (!(await readFile(configPath)).equals(after)) throw new Error('Readback failed; restore backup');
  }
  return { configPath, changed, applied: apply && changed, backup, beforeSha256: hash(before), afterSha256: hash(after), tool_timeout_sec: 320, restartVerified: false };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--apply') continue;
    if (args[i] === '--config' && args[i + 1] && !args[i + 1].startsWith('--')) { i++; continue; }
    throw new Error('Unknown or incomplete argument: ' + args[i]);
  }
  const configPath = args.includes('--config') ? args[args.indexOf('--config') + 1] : path.join(process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex'), 'config.toml');
  console.log(JSON.stringify(await updateToolTimeout(configPath, args.includes('--apply')), null, 2));
}
