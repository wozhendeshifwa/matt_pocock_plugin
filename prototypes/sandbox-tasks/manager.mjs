import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { interruptedCheck } from './execution-outcome.mjs';

export const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'interrupted']);
export const LIVE = new Set(['preparing', 'running', 'stopping']);
const fail = message => { throw new Error(message); };

// One daemon owns this database and the machine-wide scheduler. Long work is
// never awaited by an RPC: the durable record exists before an executor starts.
export class TaskManager {
  constructor({ directory, engine, now = Date.now }) {
    mkdirSync(directory, { recursive: true });
    this.engine = engine;
    this.now = now;
    this.db = new DatabaseSync(path.join(directory, 'tasks.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, project TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS previews(token TEXT PRIMARY KEY, project TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    this.watchers = new Set();
    this.closed = false;
    this.timer = null;
    this.merging = new Set();
    this.quiescing = false;
  }
  rows() { return this.db.prepare('SELECT body FROM tasks ORDER BY rowid').all().map(row => JSON.parse(row.body)); }
  save(task) {
    task.updatedAt = this.now();
    this.db.prepare('INSERT INTO tasks VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(task.id, task.project, JSON.stringify(task));
    return structuredClone(task);
  }
  task(project, id) {
    const row = this.db.prepare('SELECT body FROM tasks WHERE id=? AND project=?').get(id, project);
    if (!row) fail('任务不属于当前项目或不存在。');
    const task = JSON.parse(row.body);
    if (task.cleaned) fail('任务已清理。');
    return task;
  }
  limit() { return Number(this.db.prepare('SELECT value FROM settings WHERE key=?').get('limit')?.value ?? 2); }
  list(project) { return { tasks: this.rows().filter(t => t.project === project && !t.cleaned).reverse(), limit: this.limit(), preferences: JSON.parse(this.db.prepare('SELECT value FROM settings WHERE key=?').get(`preferences:${project}`)?.value ?? '{}') }; }
  token(project, kind, value) {
    this.db.prepare("DELETE FROM previews WHERE json_extract(body,'$.expires') < ? AND json_extract(body,'$.taskId') IS NULL AND json_extract(body,'$.done') IS NULL").run(this.now());
    const token = randomUUID();
    this.db.prepare('INSERT INTO previews VALUES(?,?,?)').run(token, project, JSON.stringify({ kind, value, expires: this.now() + 600000 }));
    return { token, ...value };
  }
  preview(project, token, kind) {
    const row = this.db.prepare('SELECT body FROM previews WHERE token=? AND project=?').get(token, project);
    if (!row) fail('确认预览不存在或属于其他项目。');
    const entry = JSON.parse(row.body);
    if (entry.kind !== kind) fail('确认类型不匹配。');
    if (!entry.taskId && !entry.done && entry.expires < this.now()) fail('预览已过期，请重新预览。');
    return entry;
  }
  async prepare(project, input) {
    const prompt = String(input.prompt ?? '').trim();
    if (!prompt || prompt.length > 40000) fail('请输入不超过40000字的任务描述。');
    const minutes = Number(input.minutes ?? 60);
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) fail('运行时限须为1至1440分钟。');
    const effort = input.effort ?? 'medium';
    if (!['low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(effort)) fail('不支持该推理强度。');
    if (input.model && !/^[a-zA-Z0-9._:-]{1,100}$/.test(input.model)) fail('模型名称无效。');
    let base;
    if (input.rerunId) {
      const original = this.task(project, input.rerunId);
      if (!TERMINAL.has(original.status) || original.unverified) fail('请先核实原任务执行结果。');
      if (!input.latest) base = original.base;
    }
    const facts = await this.engine.prepare(project, { ...input, base, effort });
    return this.token(project, 'start', { prompt, minutes, effort, model: input.model || facts.model,
      check: String(input.check ?? '').slice(0, 4000), source: input.source ? String(input.source).slice(0, 500) : '手填描述',
      rerunId: input.rerunId ?? null, ...facts });
  }
  start(project, token) {
    const entry = this.preview(project, token, 'start');
    if (entry.taskId) return this.rows().find(t => t.id === entry.taskId) ?? { id: entry.taskId, cleaned: true };
    if (this.quiescing) fail('后台正在停止，请稍后自行重新启动。');
    const task = { ...entry.value, project, id: randomUUID(), nonce: randomUUID(), status: 'queued',
      paused: false, createdAt: this.now(), checks: { state: 'not-run' }, result: null, merged: false };
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.save(task);
      this.db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(`preferences:${project}`, JSON.stringify({ model: task.model, effort: task.effort, minutes: task.minutes }));
      entry.taskId = task.id;
      this.db.prepare('UPDATE previews SET body=? WHERE token=?').run(JSON.stringify(entry), token);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    this.pump();
    return structuredClone(task);
  }
  async recover() {
    for (const task of this.rows()) {
      if (task.cleaned) continue;
      if (task.status === 'failed' && interruptedCheck(task.checks)) {
        // Older workers recorded Windows/container shutdown as a failed test.
        // Keep original evidence and re-check owned execution before correcting
        // the projection; an unavailable Docker engine must remain unverified.
        const pending = this.save({ ...task, status: 'stopping', unverified: true,
          reconciliation: { fromStatus: task.status, originalMessage: task.message, originalEndedAt: task.endedAt, reason: 'abnormal-check-exit', startedAt: this.now() } });
        this.watch(pending);
      }
      if (task.status === 'queued') this.save({ ...task, paused: true });
      else if (LIVE.has(task.status)) { task.unverified = true; this.save(task); this.watch(task); }
    }
    this.timer = setInterval(() => this.pump(), 500);
    this.timer.unref?.();
  }
  pump() {
    if (this.closed || this.quiescing) return;
    let live = this.rows().filter(t => LIVE.has(t.status) && !t.cleaned).length;
    for (const task of this.rows()) {
      if (live >= this.limit()) break;
      if (task.status !== 'queued' || task.paused || task.cleaned) continue;
      task.status = 'preparing'; this.save(task); live++;
      this.engine.launch(task).then(() => this.watch(task)).catch(error => {
        // Launch failures may have dispatched a process. Reconcile rather than
        // creating a second executor or inventing a terminal outcome.
        if (this.closed) return;
        const latest = this.task(task.project, task.id);
        this.save({ ...latest, unverified: true, message: error.message }); this.watch(latest);
      });
    }
  }
  watch(task) {
    if (this.watchers.has(task.id) || this.closed) return;
    this.watchers.add(task.id);
    const poll = async () => {
      try {
        if (this.closed) return;
        let latest = this.task(task.project, task.id);
        if (!LIVE.has(latest.status)) return;
        const observed = await this.engine.inspect(latest);
        if (this.closed) return;
        latest = this.task(task.project, task.id);
        if (!LIVE.has(latest.status)) return;
        if (observed.state === 'terminal') {
          latest = this.task(task.project, task.id);
          this.save({ ...latest, ...observed.result, unverified: false, endedAt: this.now() });
          this.pump(); return;
        }
        if (observed.state === 'absent') {
          this.save({ ...latest, status: 'interrupted', unverified: false, message: '已确认遗留执行不再运行，未自动重跑。', endedAt: this.now() });
          this.pump(); return;
        }
        if (observed.state === 'running') this.save({ ...latest, status: latest.status === 'stopping' ? 'stopping' : observed.status ?? 'running', unverified: false });
        else this.save({ ...latest, unverified: true });
      } catch {
        // Preserve execution and its scheduler slot, but do not present the
        // last successful observation as a verified current runtime state.
        if (!this.closed) {
          const latest = this.task(task.project, task.id);
          if (LIVE.has(latest.status)) this.save({ ...latest, unverified: true });
        }
      }
      finally { this.watchers.delete(task.id); }
      if (!this.closed) { const timer = setTimeout(() => this.watch(task), 750); timer.unref?.(); }
    };
    void poll();
  }
  async cancel(project, id) {
    const task = this.task(project, id);
    if (TERMINAL.has(task.status)) return task;
    if (task.status === 'queued') { const saved = this.save({ ...task, status: 'cancelled', endedAt: this.now() }); this.pump(); return saved; }
    this.save({ ...task, status: 'stopping' });
    await this.engine.cancel(task);
    this.watch(task);
    return this.task(project, id);
  }
  resume(project, id) {
    const task = this.task(project, id);
    if (task.status !== 'queued' || !task.paused) fail('该任务不在等待恢复的队列中。');
    this.save({ ...task, paused: false }); this.pump(); return this.task(project, id);
  }
  setLimit(value) {
    if (!Number.isInteger(value) || value < 1 || value > 8) fail('整机并发上限须为1至8。');
    this.db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('limit', String(value));
    this.pump(); return { limit: value };
  }
  async detail(project, id, options) { const task = this.task(project, id); return { ...task, ...await this.engine.detail(task, options) }; }
  async actionPreview(project, id, kind) {
    const task = this.task(project, id);
    if (kind === 'merge') {
      if (task.status !== 'completed' || !task.result?.changed || task.unverified) fail('仅已完成且存在代码改动的任务可合入。');
      if (task.merged) fail('该结果已合入。');
      return this.token(project, kind, { id, ...await this.engine.mergePreview(task), checks: task.checks });
    }
    if (!TERMINAL.has(task.status) || task.unverified) fail('运行中或状态待核实的任务不能清理。');
    return this.token(project, 'clean', { id, scope: '本任务记录、日志和独立结果代码；不会清理源项目或认证目录。' });
  }
  async confirm(project, token, kind, allowUnchecked = false) {
    const entry = this.preview(project, token, kind);
    if (entry.done) return entry.done;
    const task = this.task(project, entry.value.id);
    if (this.merging.has(project)) fail('此项目正在执行结果操作，请稍后重试。');
    this.merging.add(project);
    try {
      let result;
      if (kind === 'merge') {
        if (task.status !== 'completed' || !task.result?.changed || task.merged) fail('任务结果已改变，请重新预览。');
        if (task.checks.state !== 'passed' && !allowUnchecked) fail('检查未通过，须额外明确确认。');
        result = await this.engine.merge(task, entry.value);
        if (result.merged) this.save({ ...task, merged: true, mergedAt: this.now() });
      } else {
        if (!TERMINAL.has(task.status) || task.unverified) fail('任务状态已改变，请重新预览。');
        await this.engine.clean(task); this.save({ id: task.id, project, cleaned: true, status: task.status }); result = { cleaned: true };
        for (const row of this.db.prepare('SELECT token,body FROM previews WHERE project=?').all(project)) {
          const prior = JSON.parse(row.body);
          if (prior.taskId === task.id) this.db.prepare('UPDATE previews SET body=? WHERE token=?').run(JSON.stringify({ kind: 'start', taskId: task.id, value: {}, expires: prior.expires }), row.token);
        }
      }
      entry.done = result;
      this.db.prepare('UPDATE previews SET body=? WHERE token=?').run(JSON.stringify(entry), token);
      return result;
    } finally { this.merging.delete(project); }
  }
  close() { this.closed = true; clearInterval(this.timer); this.db.close(); }
}
