import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { HOST_GIT_CONFIG, hostGitArgs } from './engine.mjs';

// Host Git must not inherit the supervisor/host console's control events.
// STATUS_CONTROL_C_EXIT during setup otherwise aborts a Git child even though
// its independent task worker is still alive. The patch is restricted to this
// task process and Git executable; agent commands remain inside Docker.
let isolated = false;
export function isolateHostGit() {
  if (isolated) return;
  isolated = true;
  // Sandcastle also issues host Git calls. Command environment overrides local
  // repository config even after the agent edits its writable private .git.
  let count = Number(process.env.GIT_CONFIG_COUNT ?? 0);
  for (const value of HOST_GIT_CONFIG) {
    const split = value.indexOf('=');
    process.env[`GIT_CONFIG_KEY_${count}`] = value.slice(0, split);
    process.env[`GIT_CONFIG_VALUE_${count}`] = value.slice(split + 1);
    count++;
  }
  process.env.GIT_CONFIG_COUNT = String(count);
  const original = childProcess.execFile;
  childProcess.execFile = function (file, args, options, callback) {
    if (typeof options === 'function') { callback = options; options = {}; }
    if (/(?:^|[/\\])git(?:\.exe)?$/i.test(file)) args = hostGitArgs(args, options?.cwd, options?.env);
    if (process.platform === 'win32' && /(?:git|docker)(?:\.exe)?$/i.test(file)) {
      return original.call(this, file, args, { ...options, windowsHide: true, detached: true }, callback);
    }
    return original.call(this, file, args, options, callback);
  };
  const originalSpawn = childProcess.spawn;
  childProcess.spawn = function (file, args, options) {
    if (/(?:^|[/\\])git(?:\.exe)?$/i.test(file)) args = hostGitArgs(args, options?.cwd, options?.env);
    if (process.platform === 'win32' && /(?:git|docker)(?:\.exe)?$/i.test(file)) return originalSpawn.call(this, file, args, { ...options, windowsHide: true, detached: true });
    return originalSpawn.call(this, file, args, options);
  };
  syncBuiltinESMExports();
}
