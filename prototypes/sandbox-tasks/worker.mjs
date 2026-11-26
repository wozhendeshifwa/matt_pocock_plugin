import fs from 'node:fs';
import path from 'node:path';
import { createSandbox, codex } from '@ai-hero/sandcastle';
import { TaskEngine, atomicJson, git, prepareTaskRepository, writeDiff, writeRetainedDiff } from './engine.mjs';
import { isolateHostGit } from './windows-exec.mjs';
import { checkEvidence } from './execution-outcome.mjs';

const { task, config } = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const engine = new TaskEngine(config);
const root = engine.root(task);
isolateHostGit();
const abort = new AbortController();
let sandbox, settled = false, status = 'preparing', reason = null;
const started = Date.now();
let heartbeatError = false;
let consecutiveWriteErrors = 0;
const heartbeat = setInterval(() => {
  try {
    atomicJson(path.join(root, 'heartbeat.json'), { id: task.id, nonce: task.nonce, pid: process.pid, time: Date.now(), status });
    consecutiveWriteErrors = 0;
    const cancelled = fs.existsSync(path.join(root, 'cancel.json'));
    if (!settled && (cancelled || Date.now() - started > task.minutes * 60000)) {
      reason ??= cancelled ? 'cancelled' : 'timeout'; status = 'stopping'; abort.abort(new Error(reason));
      // Stop the owned sandbox as well: a hung hook/check must not keep running.
      if (sandbox?.sandboxId) void import('node:child_process').then(({ execFile }) => execFile(config.dockerPath ?? 'docker', ['stop', '--timeout', '5', sandbox.sandboxId], { windowsHide: true }, () => {}));
    }
  } catch (error) {
    heartbeatError = true; consecutiveWriteErrors++;
    if (consecutiveWriteErrors >= 20) abort.abort(new Error(`无法持续持久化执行状态：${error.code ?? 'write-failed'}`));
  }
}, 500);
let outcome;
let checks = { state: 'not-run' };
let checkStarted = false;
try {
  const repo = prepareTaskRepository(task.project, root, task.base);
  if (abort.signal.aborted) throw abort.signal.reason;
  const branch = `codex/sandbox-${task.id}`;
  sandbox = await createSandbox({ cwd: repo, branch, baseBranch: task.base,
    sandbox: (await import('@ai-hero/sandcastle/sandboxes/docker')).docker({
      imageName: config.image, containerUid: 1000, containerGid: 1000, capDrop: ['ALL'], selinuxLabel: false,
      mounts: [{ hostPath: config.authDirectory, sandboxPath: '/home/agent/.codex' }], env: { CODEX_HOME: '/home/agent/.codex' },
    }),
  });
  atomicJson(path.join(root, 'sandbox.json'), { nonce: task.nonce, container: sandbox.sandboxId, worktree: sandbox.worktreePath });
  status = 'running';
  const execution = await sandbox.run({ agent: codex(task.model, { effort: task.effort, captureSessions: false }), prompt: task.prompt,
    maxIterations: 1, signal: abort.signal, logging: { type: 'file', path: path.join(root, 'agent.log') } });
  if (task.check && !abort.signal.aborted) {
    checkStarted = true;
    const checked = await sandbox.exec(task.check);
    checks = checkEvidence(task.check, checked, { containerUnavailable: engine.containerRunning(sandbox.sandboxId) !== true });
    if (checks.state === 'unknown') {
      reason ??= 'interrupted';
      throw new Error('检查执行被系统或运行环境中断，现场保留。');
    }
  }
  if (abort.signal.aborted) throw abort.signal.reason;
  // A normally finished agent can leave edits uncommitted. Capture them only
  // inside this private task branch, never in the user's source repository.
  if (git(sandbox.worktreePath, ['status', '--porcelain'])) {
    const commit = await sandbox.exec('git add -A && git -c user.name="Sandbox Task" -c user.email="sandbox-task@localhost" commit -m "Capture sandbox task result"');
    if (commit.exitCode !== 0) throw new Error('无法保存任务结果提交。');
  }
  const sha = git(repo, ['rev-parse', branch]);
  const changed = writeDiff(repo, [task.base, sha, '--'], path.join(root, 'result.diff'));
  settled = true;
  outcome = { status: 'completed', summary: execution.stdout.slice(-16000), checks, result: { repo, branch, sha, changed } };
} catch (error) {
  if (!reason && fs.existsSync(path.join(root, 'cancel.json'))) reason = 'cancelled';
  if (!reason && sandbox?.sandboxId && engine.containerRunning(sandbox.sandboxId) !== true) reason = 'interrupted';
  if (checkStarted && checks.state === 'not-run') checks = checkEvidence(task.check, { exitCode: null, stderr: String(error.message ?? error) });
  fs.writeFileSync(path.join(root, 'failure.json'), JSON.stringify({ name: error.name, message: error.message, stack: error.stack, detail: String(error) }, null, 2));
  settled = true;
  outcome = { status: reason === 'cancelled' ? 'cancelled' : reason === 'interrupted' ? 'interrupted' : 'failed', stopReason: reason, message: reason === 'timeout' ? '运行超时，已请求停止并保留现场。' : String(error.message ?? error), checks };
  if (sandbox) {
    try { writeRetainedDiff(sandbox.worktreePath, task.base, path.join(root, 'result.diff')); }
    catch { outcome.diffMessage = '现场差异收集不完整；原文件和分支保留，请核对本地现场。'; }
  }
} finally {
  clearInterval(heartbeat);
  try {
    if (outcome.status === 'completed') await sandbox?.close();
    else if (sandbox?.sandboxId) await engine.stopOwnedContainer(task, sandbox.sandboxId);
    // Failed/cancelled/interrupted worktrees are retained even if host Git
    // cannot inspect their dirty state during shutdown. Cleanup is explicit.
  } catch (error) { outcome.message = `${outcome.message ?? ''}\n现场保留；停止沙箱待核实：${error.message}`; }
  atomicJson(path.join(root, 'result.json'), { id: task.id, nonce: task.nonce, outcome, heartbeatError, container: sandbox?.sandboxId });
}
