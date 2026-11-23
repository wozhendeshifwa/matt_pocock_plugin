import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { ENABLED_WRITE_ENDPOINTS, DECK_TOOL_POLICY } from '../upstream-port/write-policy.mjs';

// Installation-level local authority, deliberately separate from per-pairing
// response caches. Reuse the same file across sessions, pairings and upgrades.
// No remote endpoint may call reconcile() or supply its evidence: a local
// operator/verifier must first inspect the actual Git/GitHub/local-state facts.
// Evidence validation below checks shape and correlation, not human approval.
const METHODS = new Set([...ENABLED_WRITE_ENDPOINTS,
  ...Object.entries(DECK_TOOL_POLICY).filter(([, policy]) => policy.category !== 'read').map(([name]) => name)]);
const HASH = /^[a-f0-9]{64}$/;
const OID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const digest = value => createHash('sha256').update(value).digest('hex');
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (plainObject(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function fail(code, message) { return Object.assign(new Error(message), { code }); }
function text(value, maximum = 4096) {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value);
}
function checkedOperationId(value) {
  if (!HASH.test(value ?? '')) throw fail('INVALID_OPERATION', 'Use the stable operation identifier');
  return value;
}
function projectHash(projectKey) {
  if (!text(projectKey)) throw fail('INVALID_PROJECT', 'Use the trusted canonical local project key');
  // The caller must derive this from its trusted local resolver. Do not include
  // thread, MCP session, pairing or repository selection in this key: all writes
  // to one project must encounter the same unresolved-write barrier.
  return digest(projectKey);
}
function ownerHash(scope) {
  if (!plainObject(scope) || !text(scope.pairingId, 256) || !text(scope.threadId, 256)) throw fail('INVALID_OWNER', 'Use a trusted local owner scope');
  const allowed = new Set(['pairingId', 'threadId', 'projectRoot', 'sessionId', 'principalId']);
  if (Object.entries(scope).some(([key, value]) => !allowed.has(key) || !text(value))) throw fail('INVALID_OWNER', 'Invalid owner scope');
  // Only this hash is persisted, never an environment or credential-bearing
  // object. Project ownership is additionally checked using projectHash.
  return digest(canonical(scope));
}
function relativeFile(value) {
  return text(value, 1024) && !path.posix.isAbsolute(value) && !path.win32.isAbsolute(value) &&
    !value.includes(':') && !value.split(/[\\/]/).some(part => part === '..' || part.toLowerCase() === '.git');
}
function target(value) {
  if (!plainObject(value) || Object.keys(value).length === 0) throw fail('INVALID_INTENT', 'A typed reconciliation target is required');
  const validators = {
    repository: value => text(value, 150) && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(value),
    issueNumber: value => Number.isSafeInteger(value) && value > 0,
    issueNumbers: value => Array.isArray(value) && value.length > 0 && value.length <= 128 && value.every(n => Number.isSafeInteger(n) && n > 0),
    branch: value => text(value, 256) && !value.startsWith('-') && !/[\s~^:?*\[\\]|\.\.|@\{/.test(value),
    remote: value => text(value, 100) && /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value),
    paths: value => Array.isArray(value) && value.length > 0 && value.length <= 128 && value.every(relativeFile),
    beforeOid: value => OID.test(value ?? ''),
    expectedAfterOid: value => OID.test(value ?? ''),
    commitOid: value => OID.test(value ?? ''),
    beforeStateSha256: value => HASH.test(value ?? ''),
    expectedStateSha256: value => HASH.test(value ?? ''),
    contentSha256: value => HASH.test(value ?? ''),
    parentIssueNumber: value => value === null || (Number.isSafeInteger(value) && value > 0),
    blockedByIssueNumbers: value => Array.isArray(value) && value.length <= 128 && value.every(n => Number.isSafeInteger(n) && n > 0),
    correlationKey: value => text(value, 160) && /^[A-Za-z0-9_.:-]+$/.test(value),
    localStateKey: value => ['session-tickets', 'log-switch', 'logs', 'binding', 'manual-naming', 'open-path'].includes(value),
  };
  if (Object.entries(value).some(([key, value]) => !validators[key]?.(value))) {
    throw fail('INVALID_INTENT', 'Only typed local reconciliation targets are stored; credentials and commands are not accepted');
  }
  return bounded(value);
}
function bounded(value) {
  const serialized = canonical(value);
  if (Buffer.byteLength(serialized) > 32768) throw fail('RECORD_TOO_LARGE', 'Local write record exceeds its size limit');
  return JSON.parse(serialized);
}
function intentRecord(value) {
  if (!plainObject(value) || !METHODS.has(value.method) || !HASH.test(value.parametersSha256 ?? '') ||
      Object.keys(value).some(key => !['method', 'parametersSha256', 'target'].includes(key))) {
    throw fail('INVALID_INTENT', 'Use a known write method, parameter fingerprint and typed target');
  }
  return bounded({ method: value.method, parametersSha256: value.parametersSha256, target: target(value.target) });
}
function resultRecord(value) {
  if (value === undefined) return null;
  if (!plainObject(value) || Object.keys(value).length === 0 || Object.keys(value).some(key => !['target', 'resultSha256', 'errorKind'].includes(key))) {
    throw fail('INVALID_RESULT', 'Store typed effect references instead of raw responses');
  }
  if (value.resultSha256 !== undefined && !HASH.test(value.resultSha256)) throw fail('INVALID_RESULT', 'Invalid result fingerprint');
  if (value.errorKind !== undefined && !['rejected', 'backend', 'partial', 'cancelled'].includes(value.errorKind)) throw fail('INVALID_RESULT', 'Invalid error classification');
  return bounded({ ...value, ...(value.target === undefined ? {} : { target: target(value.target) }) });
}
function evidenceRecord(value, intent) {
  if (!plainObject(value) || Object.keys(value).some(key => !['kind', 'verdict', 'observedAt', 'verificationSha256', 'target', 'executionStoppedAt', 'executionFenceSha256'].includes(key)) ||
      !['git-readback', 'github-readback', 'local-state-readback', 'combined-readback'].includes(value.kind) ||
      !['completed', 'not-executed'].includes(value.verdict) || !Number.isSafeInteger(value.observedAt) ||
      value.observedAt <= 0 || value.observedAt > Date.now() + 300000 || !HASH.test(value.verificationSha256 ?? '')) {
    throw fail('RECONCILIATION_EVIDENCE_REQUIRED', 'A local readback record is required; a confirmation flag cannot clear the barrier');
  }
  // Absence of an effect is not proof that a timed-out executor will never
  // produce it later. The local verifier must establish the execution fence
  // before a not-executed verdict can authorize another operation. These hashes
  // record the evidence bundle; they are not fabricated host-approval signatures.
  if (value.verdict === 'not-executed' && (!Number.isSafeInteger(value.executionStoppedAt) || value.executionStoppedAt <= 0 ||
      value.executionStoppedAt > value.observedAt || !HASH.test(value.executionFenceSha256 ?? ''))) {
    throw fail('EXECUTION_FENCE_REQUIRED', 'A missing result cannot prove non-execution; record the local execution-stop evidence first');
  }
  if ((value.executionStoppedAt !== undefined && (!Number.isSafeInteger(value.executionStoppedAt) || value.executionStoppedAt <= 0 || value.executionStoppedAt > value.observedAt)) ||
      (value.executionFenceSha256 !== undefined && !HASH.test(value.executionFenceSha256))) throw fail('EXECUTION_FENCE_REQUIRED', 'Invalid local execution-stop evidence');
  const checkedTarget = target(value.target);
  for (const [key, original] of Object.entries(intent.target)) {
    if (canonical(checkedTarget[key]) !== canonical(original)) throw fail('EVIDENCE_TARGET_MISMATCH', 'Readback evidence does not identify the recorded write target');
  }
  return bounded({ ...value, target: checkedTarget });
}

export class WriteLedger {
  constructor(file) {
    if (typeof file !== 'string' || !path.isAbsolute(file)) throw fail('PERSISTENT_FILE_REQUIRED', 'Select an absolute installation-level local database file');
    this.database = new DatabaseSync(file);
    this.closed = false;
    this.database.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA max_page_count=65536;
      CREATE TABLE IF NOT EXISTS write_ledger (
        operation_id TEXT PRIMARY KEY, project_hash TEXT NOT NULL, owner_hash TEXT NOT NULL,
        intent_json TEXT NOT NULL, intent_hash TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('running','unknown','completed','not-executed')),
        outcome TEXT, result_json TEXT, unknown_reason TEXT, evidence_json TEXT,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS one_unresolved_write_per_project ON write_ledger(project_hash)
        WHERE state IN ('running','unknown');`);
    // No startup UPDATE. Another process may still own a running execution;
    // after a crash that row remains a conservative, durable barrier as well.
  }
  transaction(callback) {
    this.database.exec('BEGIN IMMEDIATE');
    try { const result = callback(); this.database.exec('COMMIT'); return result; }
    catch (error) { try { this.database.exec('ROLLBACK'); } catch {} throw error; }
  }
  owned(operationId, projectKey, ownerScope) {
    const row = this.database.prepare('SELECT * FROM write_ledger WHERE operation_id=?').get(checkedOperationId(operationId));
    if (!row || row.project_hash !== projectHash(projectKey) || row.owner_hash !== ownerHash(ownerScope)) throw fail('OPERATION_NOT_FOUND', 'No operation belongs to this project and owner');
    return row;
  }
  reserve({ operationId, projectKey, intent, ownerScope }) {
    checkedOperationId(operationId);
    const project = projectHash(projectKey), owner = ownerHash(ownerScope), checked = intentRecord(intent);
    const serialized = canonical(checked), intentHash = digest(serialized);
    return this.transaction(() => {
      const previous = this.database.prepare('SELECT * FROM write_ledger WHERE operation_id=?').get(operationId);
      if (previous) {
        if (previous.project_hash !== project || previous.owner_hash !== owner || previous.intent_hash !== intentHash) {
          throw fail('OPERATION_CONFLICT', 'Operation identifier was reused with different ownership or intent');
        }
        return { reserved: false, operationId, state: previous.state, reason: 'already-recorded' };
      }
      const blocker = this.database.prepare("SELECT operation_id,state FROM write_ledger WHERE project_hash=? AND state IN ('running','unknown')").get(project);
      if (blocker) throw Object.assign(fail('PROJECT_WRITE_UNRESOLVED', 'This project has an unresolved write; inspect the local result before issuing another write'), {
        blockingOperationId: blocker.operation_id, state: blocker.state,
      });
      const now = Date.now();
      this.database.prepare("INSERT INTO write_ledger (operation_id,project_hash,owner_hash,intent_json,intent_hash,state,created_at,updated_at) VALUES (?,?,?,?,?,'running',?,?)")
        .run(operationId, project, owner, serialized, intentHash, now, now);
      return { reserved: true, operationId, state: 'running' };
    });
  }
  complete({ operationId, projectKey, ownerScope, outcome, result }) {
    // "failed" means a conclusively known terminal outcome, not an exception
    // or a tool isError flag whose side effects remain uncertain. Such cases
    // must use markUnknown(), retaining the project barrier.
    if (!['succeeded', 'failed'].includes(outcome)) throw fail('KNOWN_OUTCOME_REQUIRED', 'Record an explicit known terminal outcome');
    const checkedResult = resultRecord(result);
    return this.transaction(() => {
      const row = this.owned(operationId, projectKey, ownerScope);
      if (!['running', 'unknown'].includes(row.state)) throw fail('TERMINAL_RECORD', 'A completed operation cannot be rewritten or executed again');
      this.database.prepare("UPDATE write_ledger SET state='completed',outcome=?,result_json=?,updated_at=? WHERE operation_id=?")
        .run(outcome, checkedResult === null ? null : canonical(checkedResult), Date.now(), operationId);
      return { operationId, state: 'completed', outcome };
    });
  }
  markUnknown({ operationId, projectKey, ownerScope, reason }) {
    if (!['connection-lost', 'adapter-timeout', 'process-ended', 'partial-result', 'operator-uncertain'].includes(reason)) throw fail('INVALID_REASON', 'Use a bounded uncertainty classification');
    return this.transaction(() => {
      const row = this.owned(operationId, projectKey, ownerScope);
      if (!['running', 'unknown'].includes(row.state)) return { operationId, state: row.state, changed: false };
      this.database.prepare("UPDATE write_ledger SET state='unknown',unknown_reason=?,updated_at=? WHERE operation_id=?").run(reason, Date.now(), operationId);
      return { operationId, state: 'unknown', changed: true };
    });
  }
  inspect({ operationId, projectKey, ownerScope }) {
    let row;
    try { row = this.owned(operationId, projectKey, ownerScope); }
    catch (error) { if (error.code === 'OPERATION_NOT_FOUND') return { state: 'not-found' }; throw error; }
    return { operationId: row.operation_id, state: row.state, intent: JSON.parse(row.intent_json),
      createdAt: row.created_at, updatedAt: row.updated_at,
      ...(row.outcome ? { outcome: row.outcome } : {}),
      ...(row.result_json ? { result: JSON.parse(row.result_json) } : {}),
      ...(row.unknown_reason ? { unknownReason: row.unknown_reason } : {}),
      ...(row.evidence_json ? { evidence: JSON.parse(row.evidence_json) } : {}) };
  }
  // Local operator/verifier API only. Intentionally not exposed as an MCP tool,
  // config flag or network parameter. A remote `confirmed:true` is not evidence.
  // The verifier must actually establish the method-specific facts represented
  // by the stored target/state hashes. This module does not perform or attest
  // Git/GitHub queries, prove executor termination or obtain host approval.
  reconcile({ operationId, projectKey, evidence }) {
    checkedOperationId(operationId);
    const project = projectHash(projectKey);
    return this.transaction(() => {
      const row = this.database.prepare('SELECT * FROM write_ledger WHERE operation_id=? AND project_hash=?').get(operationId, project);
      if (!row) throw fail('OPERATION_NOT_FOUND', 'No operation belongs to this project');
      if (row.state === 'running') throw fail('RUNNING_WRITE_CANNOT_BE_RECONCILED', 'Do not clear an execution still registered as running; its executor must complete it or record uncertainty first');
      if (!['running', 'unknown'].includes(row.state)) throw fail('TERMINAL_RECORD', 'A terminal record cannot be replaced by reconciliation');
      const checked = evidenceRecord(evidence, JSON.parse(row.intent_json));
      const state = checked.verdict === 'completed' ? 'completed' : 'not-executed';
      this.database.prepare('UPDATE write_ledger SET state=?,outcome=?,evidence_json=?,updated_at=? WHERE operation_id=?')
        .run(state, checked.verdict === 'completed' ? 'readback-confirmed' : 'not-executed', canonical(checked), Date.now(), operationId);
      return { operationId, state, reconciled: true };
    });
  }
  close() { if (!this.closed) { this.closed = true; this.database.close(); } }
}
