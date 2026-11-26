import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { reconcileOutcome } from './execution-outcome.mjs';

export function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  try {
    for (let attempt = 0; ; attempt++) {
      try { fs.renameSync(temp, file); break; }
      catch (error) {
        if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code) || attempt >= 10) throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
      }
    }
  } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
const exists = file => { try { return fs.existsSync(file); } catch { return false; } };
export const HOST_GIT_CONFIG = ['core.fsmonitor=false', 'core.hooksPath=/dev/null', 'core.pager=cat', 'core.attributesFile=/dev/null'];
export function hostGitArgs(args, cwd, env) {
  // Read key names through a command that cannot invoke content filters.
  // Keep this outside git() to avoid recursive hardening queries.
  let keys = '';
  try {
    keys = execFileSync('git', [...HOST_GIT_CONFIG.flatMap(value => ['-c', value]), 'config', '--null', '--name-only', '--get-regexp', '^filter[.]'],
      { cwd, env, encoding: 'utf8', timeout: 10000, windowsHide: true, detached: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) { if (error.status !== 1) throw error; }
  const filters = keys.split('\0').filter(name => /[.](clean|process|smudge|required)$/i.test(name));
  const overrides = filters.flatMap(name => ['-c', `${name}=${name.toLowerCase().endsWith('.required') ? 'false' : ''}`]);
  const index = args.indexOf('diff');
  return [...overrides, ...(index < 0 ? args : [...args.slice(0, index + 1), '--no-ext-diff', '--no-textconv', ...args.slice(index + 1)])];
}
export function git(cwd, args, options = {}) {
  return execFileSync('git', [...HOST_GIT_CONFIG.flatMap(value => ['-c', value]), ...hostGitArgs(args, cwd, options.env)], { cwd, encoding: 'utf8', timeout: 30000, windowsHide: true, detached: process.platform === 'win32', maxBuffer: 8 * 1024 * 1024, ...options })?.trimEnd() ?? '';
}
export function writeDiff(repo, args, file) {
  const descriptor = fs.openSync(file, 'w');
  try { git(repo, ['diff', ...args], { stdio: ['ignore', descriptor, 'pipe'] }); }
  finally { fs.closeSync(descriptor); }
  return fs.statSync(file).size > 0;
}
export function writeRetainedDiff(repo, base, file) {
  // Compare with the confirmed input, including commits already made by the
  // agent. Do not stage files or run clean filters in the host process.
  const descriptor = fs.openSync(file, 'w');
  try { git(repo, ['diff', '--binary', base, '--'], { stdio: ['ignore', descriptor, 'pipe'] }); }
  finally { fs.closeSync(descriptor); }
  const untracked = git(repo, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean);
  const append = fs.openSync(file, 'a');
  try {
    for (const name of untracked) {
      try {
        git(repo, ['diff', '--no-index', '--binary', '--', '/dev/null', name], { stdio: ['ignore', append, 'pipe'] });
      } catch (error) {
        // git diff --no-index returns 1 when it successfully finds changes.
        if (error.status !== 1) throw error;
      }
    }
  } finally { fs.closeSync(append); }
  return fs.statSync(file).size > 0;
}
const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function prepareTaskRepository(project, root, base) {
  const repo = path.join(root, 'repo');
  git(root, ['clone', '--no-hardlinks', '--no-checkout', project, repo]);
  git(repo, ['remote', 'remove', 'origin']);
  // Docker does not inherit the host's system/global Git settings. Persist
  // checkout normalization in this private repo so container add/status use
  // the same rules as the Windows host that produced the working files.
  const setting = (name, fallback) => { try { return git(repo, ['config', '--get', name]); } catch { return fallback; } };
  git(repo, ['config', 'core.autocrlf', setting('core.autocrlf', 'false')]);
  const eol = setting('core.eol', 'native');
  git(repo, ['config', 'core.eol', eol === 'native' ? process.platform === 'win32' ? 'crlf' : 'lf' : eol]);
  git(repo, ['checkout', '--detach', base]);
  git(repo, ['config', 'user.name', 'Sandbox Task']);
  git(repo, ['config', 'user.email', 'sandbox-task@localhost']);
  return repo;
}
export class TaskEngine {
  constructor(config) {
    this.config = config;
    this.directory = config.directory;
    fs.mkdirSync(path.join(this.directory, 'tasks'), { recursive: true });
    if (config.dockerPath) process.env.PATH = `${path.dirname(config.dockerPath)}${path.delimiter}${process.env.PATH}`;
  }
  root(task) {
    if (!/^[0-9a-f-]{36}$/.test(task.id)) throw new Error('任务标识无效。');
    return path.join(this.directory, 'tasks', task.id);
  }
  async prepare(project, input) {
    if (fs.realpathSync(project) !== fs.realpathSync(git(project, ['rev-parse', '--show-toplevel']))) throw new Error('沙箱任务须关联项目的Git仓库根目录。');
    const base = git(project, ['rev-parse', '--verify', `${input.base ?? 'HEAD'}^{commit}`]);
    if (!/^[0-9a-f]{40,64}$/.test(base)) throw new Error('无法锁定已提交代码基线。');
    const model = input.model || this.config.defaultModel;
    if (!this.config.models?.includes(model)) throw new Error('该模型尚未通过本地支持核验，请先配置可用模型。');
    if (this.config.modelEfforts && !this.config.modelEfforts[model]?.includes(input.effort)) throw new Error('该模型不支持所选推理强度，请重新选择。');
    if (!exists(path.join(this.config.authDirectory, 'auth.json'))) throw new Error('沙箱专用ChatGPT登录不可用，请先完成本地登录。');
    execFileSync(this.config.dockerPath ?? 'docker', ['image', 'inspect', this.config.image], { stdio: 'pipe', windowsHide: true, timeout: 10000 });
    const dirty = git(project, ['status', '--porcelain=v1', '--untracked-files=all']);
    return { base, model, dirty: Boolean(dirty), excluded: dirty.split('\n').filter(Boolean).length, projectName: path.basename(project) };
  }
  async launch(task) {
    const root = this.root(task);
    fs.mkdirSync(root, { recursive: true });
    // The request is immutable and written before dispatch. No second worker
    // can be launched for the same task after an uncertain process outcome.
    const request = path.join(root, 'request.json');
    if (exists(request)) throw new Error('该任务已有执行请求，须先核实。');
    fs.writeFileSync(request, JSON.stringify({ task, config: this.config }), { flag: 'wx', mode: 0o600 });
    const output = fs.openSync(path.join(root, 'worker.log'), 'a');
    const child = spawn(process.execPath, [fileURLToPath(new URL('worker.mjs', import.meta.url)), request], {
      detached: true, windowsHide: true, stdio: ['ignore', output, output], env: { ...process.env },
    });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    atomicJson(path.join(root, 'dispatch.json'), { pid: child.pid, nonce: task.nonce });
    child.unref(); fs.closeSync(output);
  }
  async inspect(task) {
    const root = this.root(task);
    const read = file => { try { return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')); } catch { return null; } };
    const result = read('result.json');
    if (result?.nonce === task.nonce && result.id === task.id) {
      if (result.container) {
        try {
          const inspected = JSON.parse(execFileSync(this.config.dockerPath ?? 'docker', ['inspect', result.container], { encoding: 'utf8', timeout: 10000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }))[0];
          if (inspected.State.Running) return { state: 'unknown' };
        } catch (error) { if (!/no such/i.test(String(error.stderr))) return { state: 'unknown' }; }
      }
      return { state: 'terminal', result: reconcileOutcome(result.outcome) };
    }
    const heartbeat = read('heartbeat.json');
    const dispatch = read('dispatch.json');
    // A crash may occur between spawn and its acknowledgement. Missing files
    // cannot prove that no worker/container was dispatched.
    if (exists(path.join(root, 'request.json')) && dispatch?.nonce !== task.nonce && heartbeat?.nonce !== task.nonce) return { state: 'unknown' };
    if (heartbeat?.nonce === task.nonce && Date.now() - heartbeat.time < 5000) return { state: 'running', status: heartbeat.status };
    let alive = false;
    const pid = dispatch?.nonce === task.nonce ? dispatch.pid : heartbeat?.nonce === task.nonce ? heartbeat.pid : null;
    if (pid) { try { process.kill(pid, 0); alive = true; } catch (error) { if (error.code !== 'ESRCH') return { state: 'unknown' }; } }
    if (alive) return { state: 'unknown' }; // PID presence alone is not ownership proof.
    const state = read('sandbox.json');
    // Container creation can finish before sandbox.json is saved. Inspect all
    // candidates by their exact task mount before declaring an execution absent.
    if (exists(path.join(root, 'request.json')) && state?.nonce !== task.nonce) {
      try {
        const ids = execFileSync(this.config.dockerPath ?? 'docker', ['ps', '-aq', '--filter', 'name=sandcastle-'], { encoding: 'utf8', timeout: 10000, windowsHide: true }).trim().split(/\s+/).filter(Boolean);
        const normalize = value => value.replaceAll('\\', '/').toLowerCase();
        for (const id of ids) {
          const container = JSON.parse(execFileSync(this.config.dockerPath ?? 'docker', ['inspect', id], { encoding: 'utf8', timeout: 10000, windowsHide: true }))[0];
          if (container.State.Running && container.Mounts.some(mount => normalize(mount.Source).startsWith(normalize(root) + '/repo/'))) return { state: 'unknown' };
        }
      } catch { return { state: 'unknown' }; }
    }
    if (state?.nonce === task.nonce && state.container) {
      try {
        const inspect = JSON.parse(execFileSync(this.config.dockerPath ?? 'docker', ['inspect', state.container], { encoding: 'utf8', timeout: 10000, windowsHide: true }))[0];
        if (inspect?.State?.Running) return { state: 'unknown' };
      } catch (error) {
        if (!/no such/i.test(String(error.stderr))) return { state: 'unknown' };
      }
    }
    return { state: 'absent' };
  }
  async cancel(task) {
    const root = this.root(task);
    atomicJson(path.join(root, 'cancel.json'), { id: task.id, nonce: task.nonce });
    let state;
    try { state = JSON.parse(fs.readFileSync(path.join(root, 'sandbox.json'), 'utf8')); } catch { return; }
    if (state.nonce !== task.nonce || !state.container) return;
    await this.stopOwnedContainer(task, state.container);
  }
  containerRunning(container) {
    try {
      return execFileSync(this.config.dockerPath ?? 'docker', ['inspect', '--format', '{{.State.Running}}', container], { encoding: 'utf8', timeout: 10000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim() === 'true';
    } catch (error) { return /no such/i.test(String(error.stderr)) ? false : null; }
  }
  async stopOwnedContainer(task, container, { remove = false } = {}) {
    const root = this.root(task);
    // This also stops an orphan container after a supervisor/worker crash, but
    // only after checking its exact task mount and configured image identity.
    try {
      const inspect = JSON.parse(execFileSync(this.config.dockerPath ?? 'docker', ['inspect', container], { encoding: 'utf8', timeout: 10000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }))[0];
      const normalize = p => p.replaceAll('\\', '/').toLowerCase();
      if (inspect.Config.Image !== this.config.image || !inspect.Mounts.some(m => normalize(m.Source).startsWith(normalize(root) + '/repo/'))) throw new Error('遗留容器身份不匹配，未停止。');
      if (inspect.State.Running) execFileSync(this.config.dockerPath ?? 'docker', ['stop', '--timeout', '5', container], { timeout: 15000, windowsHide: true, stdio: 'pipe' });
      if (remove) execFileSync(this.config.dockerPath ?? 'docker', ['rm', container], { timeout: 10000, windowsHide: true, stdio: 'pipe' });
    } catch (error) { if (!/no such/i.test(String(error.stderr))) throw error; }
  }
  async detail(task, { diffOffset = 0 } = {}) {
    if (!Number.isSafeInteger(diffOffset) || diffOffset < 0) throw new Error('差异分页位置无效。');
    const root = this.root(task);
    const tail = file => { try { const descriptor = fs.openSync(file, 'r'); try { const size = fs.fstatSync(descriptor).size; const bytes = Buffer.alloc(Math.min(size, 128 * 1024)); fs.readSync(descriptor, bytes, 0, bytes.length, Math.max(0, size - bytes.length)); return bytes.toString('utf8'); } finally { fs.closeSync(descriptor); } } catch { return ''; } };
    let diff = '', diffPage = { offset: 0, nextOffset: null, totalBytes: 0 };
    const file = path.join(root, 'result.diff');
    if (exists(file)) {
      const descriptor = fs.openSync(file, 'r');
      try {
        const totalBytes = fs.fstatSync(descriptor).size;
        const offset = Math.min(diffOffset, totalBytes);
        const bytes = Buffer.alloc(Math.min(128 * 1024, totalBytes - offset));
        let length = fs.readSync(descriptor, bytes, 0, bytes.length, offset);
        // End pages before a partial UTF-8 code point; the next request starts
        // at that exact byte so concatenating all pages loses no characters.
        if (offset + length < totalBytes && length) {
          let start = length - 1;
          while (start > 0 && (bytes[start] & 0xc0) === 0x80) start--;
          const lead = bytes[start];
          const needed = lead < 0x80 ? 1 : lead < 0xe0 ? 2 : lead < 0xf0 ? 3 : 4;
          if (length - start < needed) length = start;
        }
        diff = bytes.subarray(0, length).toString('utf8');
        diffPage = { offset, nextOffset: offset + length < totalBytes ? offset + length : null, totalBytes };
      } finally { fs.closeSync(descriptor); }
    }
    return { log: tail(path.join(root, 'agent.log')) + tail(path.join(root, 'worker.log')), diff, diffPage };
  }
  async mergePreview(task) {
    const project = task.project;
    if (git(project, ['status', '--porcelain=v1', '--untracked-files=all'])) throw new Error('目标工作区有未提交改动，请先自行处理。');
    const branch = git(project, ['symbolic-ref', '--short', 'HEAD']);
    const head = git(project, ['rev-parse', 'HEAD']);
    const result = task.result;
    if (!result?.sha || !result?.repo) throw new Error('没有可合入的结果。');
    if (git(result.repo, ['rev-parse', result.branch]) !== result.sha) throw new Error('结果分支已变化，请先核实。');
    return { targetBranch: branch, targetHead: head, resultSha: result.sha, fingerprint: fingerprint({ branch, head, result: result.sha }) };
  }
  async merge(task, preview) {
    const current = await this.mergePreview(task);
    if (current.fingerprint !== preview.fingerprint) throw new Error('目标或结果已变化，请重新预览确认。');
    git(task.project, ['fetch', '--no-tags', task.result.repo, task.result.sha]);
    // Fetch can take time: recheck the user worktree and exact target again.
    const afterFetch = await this.mergePreview(task);
    if (afterFetch.fingerprint !== preview.fingerprint) throw new Error('目标已变化，请重新预览。');
    try {
      git(task.project, ['merge', '--no-ff', '--no-edit', task.result.sha]);
      return { merged: true, sha: git(task.project, ['rev-parse', 'HEAD']) };
    } catch (error) {
      return { merged: false, conflict: true, message: '合入未完成。结果保留；请在目标项目检查冲突或Git错误，本工具未自动解决或推送。' };
    }
  }
  async clean(task) {
    const root = this.root(task);
    if (!exists(root)) return;
    const resolved = fs.realpathSync(root);
    const parent = fs.realpathSync(path.join(this.directory, 'tasks'));
    const relative = path.relative(parent, resolved);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('清理范围不属于任务目录。');
    let sandbox;
    try { sandbox = JSON.parse(fs.readFileSync(path.join(resolved, 'sandbox.json'), 'utf8')); } catch {}
    if (sandbox?.nonce === task.nonce && sandbox.container) await this.stopOwnedContainer(task, sandbox.container, { remove: true });
    fs.rmSync(resolved, { recursive: true });
  }
}
