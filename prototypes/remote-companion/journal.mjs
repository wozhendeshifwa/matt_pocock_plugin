import { DatabaseSync } from 'node:sqlite';
import { requestHash, digest, rpcError, canonical } from './protocol.mjs';

const scopeHash = scope => digest(canonical(typeof scope === 'string' ? { threadId: scope } : scope));

// Local authority. A cloud restart cannot erase completed/uncertain executions
// or undo revocation. Payloads/results never go into cloud storage.
export class Journal {
  constructor(file) {
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=2000; PRAGMA max_page_count=32768;
      CREATE TABLE IF NOT EXISTS operations (
        id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, thread TEXT NOT NULL,
        state TEXT NOT NULL, response TEXT, updated INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      UPDATE operations SET state='unknown' WHERE state='running';`);
  }
  get revoked() { return this.db.prepare("SELECT value FROM settings WHERE key='revoked'").get()?.value === 'true'; }
  revoke() { this.db.prepare("INSERT OR REPLACE INTO settings VALUES ('revoked','true')").run(); }
  begin(id, request, scope) {
    if (this.revoked) throw new Error('Pairing revoked locally');
    const fingerprint = requestHash(request);
    const previous = this.db.prepare('SELECT * FROM operations WHERE id=?').get(id);
    if (previous) {
      if (previous.fingerprint !== fingerprint || previous.thread !== scopeHash(scope)) throw new Error('Operation id was reused with different input or project ownership');
      return { fresh: false, response: previous.response ? JSON.parse(previous.response) :
        rpcError(request.id, -32004, 'Prior operation result is unavailable or in progress; do not replay', { operationId: id, state: previous.state }) };
    }
    this.db.prepare("INSERT INTO operations VALUES (?,?,?,'running',NULL,?)").run(id, fingerprint, scopeHash(scope), Date.now());
    return { fresh: true };
  }
  finish(id, response) {
    const text = JSON.stringify(response);
    this.db.prepare('UPDATE operations SET state=?,response=?,updated=? WHERE id=?').run(
      response.error || response.result?.isError ? 'failed' : 'completed', Buffer.byteLength(text) <= 1024 * 1024 ? text : null, Date.now(), id);
    // Keep durable tombstones even when cached results expire. Dropping an old
    // record would incorrectly make the same operation executable again.
    this.db.prepare(`UPDATE operations SET response=NULL WHERE response IS NOT NULL AND
      (updated < ? OR id NOT IN (SELECT id FROM operations WHERE response IS NOT NULL ORDER BY updated DESC LIMIT 128))`).run(Date.now() - 86400000);
  }
  uncertain(id) { this.db.prepare("UPDATE operations SET state='unknown',updated=? WHERE id=? AND state='running'").run(Date.now(), id); }
  status(id, scope) {
    const row = this.db.prepare('SELECT id,state,updated,thread FROM operations WHERE id=?').get(id);
    if (!row || row.thread !== scopeHash(scope)) return { state: 'not-found' };
    return { operationId: row.id, state: row.state, updated: row.updated };
  }
  summary() {
    return { revoked: this.revoked, operations: this.db.prepare('SELECT state,count(*) AS count FROM operations GROUP BY state').all() };
  }
  close() { this.db.close(); }
}
