// Explicit acceptance harness only; the production entry point creates no lease.
import fs from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { atomicJson } from './engine.mjs';

export const MAX_FAULT_MS = 5 * 60 * 1000;
const modes = new Set(['drop-start-reply', 'disconnect', 'hold-observation']);
export const startTokenHash = token => createHash('sha256').update(token).digest('hex');

export function armFault(file, { mode, taskId, tokenHash, ttlMs = 60000 }, now = Date.now()) {
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!state.sessionId || !state.project || !modes.has(mode)) throw new Error('请先启动专用故障验收后台。');
  if (!Number.isInteger(ttlMs) || ttlMs < 1 || ttlMs > MAX_FAULT_MS) throw new Error('故障注入有效期须在1毫秒至5分钟内。');
  if (mode === 'drop-start-reply' ? !/^[a-f0-9]{64}$/.test(tokenHash ?? '') : !/^[a-f0-9-]{36}$/.test(taskId ?? '')) throw new Error('必须绑定具体任务或启动预览哈希。');
  const next = { version: 1, sessionId: state.sessionId, project: state.project, enabled: true, mode,
    taskId: mode === 'drop-start-reply' ? undefined : taskId, tokenHash: mode === 'drop-start-reply' ? tokenHash : undefined,
    issuedAt: now, expiresAt: now + ttlMs };
  atomicJson(file, next);
  return next;
}

export class FaultLease {
  constructor({ project, file, now = Date.now, onEvent = () => {} }) {
    this.project = fs.realpathSync(project); this.file = file; this.now = now; this.onEvent = onEvent;
    this.sessionId = randomUUID(); this.closed = false;
    // An old process's control file is never an authorization for a new run.
    this.disable('session-start');
    this.timer = setInterval(() => this.status(), 100);
    this.timer.unref();
  }
  disable(reason) {
    atomicJson(this.file, { version: 1, sessionId: this.sessionId, project: this.project, enabled: false, reason });
    this.onEvent({ kind: 'fault-disabled', reason });
    return { enabled: false, reason };
  }
  status() {
    if (this.closed) return { enabled: false, reason: 'closed' };
    try {
      const state = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!state.enabled) return { enabled: false, reason: state.reason ?? 'disabled' };
      const now = this.now();
      if (state.sessionId !== this.sessionId || state.project !== this.project || !modes.has(state.mode) ||
        !Number.isFinite(state.issuedAt) || !Number.isFinite(state.expiresAt) || state.issuedAt > now ||
        state.expiresAt <= now || state.expiresAt - state.issuedAt > MAX_FAULT_MS ||
        (state.mode === 'drop-start-reply' ? !/^[a-f0-9]{64}$/.test(state.tokenHash ?? '') : !/^[a-f0-9-]{36}$/.test(state.taskId ?? ''))) return this.disable('expired-or-invalid');
      return state;
    } catch {
      // Unreadable or unwritable control never enables a fault.
      return { enabled: false, reason: 'control-unavailable' };
    }
  }
  matches(mode, project, taskId) {
    const state = this.status();
    return state.enabled && state.mode === mode && project === this.project && taskId === state.taskId;
  }
  dropReply(request, value) {
    const state = this.status();
    if (!state.enabled || request.project !== this.project || !value) return false;
    const start = state.mode === 'drop-start-reply' && request.method === 'start' && value.id &&
      typeof request.input?.token === 'string' && state.tokenHash === startTokenHash(request.input.token);
    const disconnect = state.mode === 'disconnect' && request.method === 'detail' && request.input?.id === state.taskId;
    if (!start && !disconnect) return false;
    if (start) { try { this.disable('consumed'); } catch { return false; } }
    this.onEvent({ kind: start ? 'dropped-start-reply' : 'disconnected-detail', taskId: value.id });
    return true;
  }
  close() {
    clearInterval(this.timer);
    try { return this.disable('closed'); } finally { this.closed = true; }
  }
}
