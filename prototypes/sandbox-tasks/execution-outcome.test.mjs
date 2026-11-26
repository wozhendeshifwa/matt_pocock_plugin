import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkEvidence, reconcileOutcome } from './execution-outcome.mjs';

test('normal failing checks remain failed evidence; infrastructure interruption is unknown', () => {
  const normal = checkEvidence('check', { exitCode: 9, stdout: 'failed assertion', stderr: '' });
  assert.equal(normal.state, 'failed');
  assert.equal(reconcileOutcome({ status: 'completed', checks: normal }).status, 'completed');
  assert.equal(checkEvidence('check', { exitCode: 137 }).state, 'failed');
  assert.equal(checkEvidence('check', { exitCode: 137 }, { containerUnavailable: true }).state, 'unknown');
  const abnormal = checkEvidence('check', { exitCode: 4294967295 });
  assert.equal(abnormal.state, 'unknown');
  assert.equal(reconcileOutcome({ status: 'failed', checks: abnormal }).status, 'interrupted');
  assert.equal(reconcileOutcome({ status: 'cancelled', checks: abnormal }).status, 'cancelled');
  assert.equal(reconcileOutcome({ status: 'failed', stopReason: 'timeout', checks: abnormal }).status, 'failed');
});
