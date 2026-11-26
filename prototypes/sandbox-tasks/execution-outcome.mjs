// Checks execute inside a POSIX container. A missing/invalid transport exit
// status is evidence of interruption, not a failed assertion or a passed test.
export function interruptedCheck(checks) {
  return checks != null && Object.hasOwn(checks, 'exitCode') &&
    (!Number.isInteger(checks.exitCode) || checks.exitCode < 0 || checks.exitCode > 255);
}
export function checkEvidence(command, checked, { containerUnavailable = false } = {}) {
  const evidence = { command, exitCode: checked.exitCode, stdout: (checked.stdout ?? '').slice(-64000), stderr: (checked.stderr ?? '').slice(-64000) };
  return { ...evidence, state: containerUnavailable || interruptedCheck(evidence) ? 'unknown' : checked.exitCode === 0 ? 'passed' : 'failed' };
}
export function reconcileOutcome(outcome) {
  if (!interruptedCheck(outcome.checks)) return outcome;
  const interrupted = ['failed', 'completed'].includes(outcome.status) && outcome.stopReason !== 'timeout';
  return { ...outcome, status: interrupted ? 'interrupted' : outcome.status,
    message: interrupted ? '检查执行被系统或运行环境中断，未取得正常退出结果；日志和代码现场保留。' : outcome.message,
    checks: { ...outcome.checks, state: 'unknown' } };
}
