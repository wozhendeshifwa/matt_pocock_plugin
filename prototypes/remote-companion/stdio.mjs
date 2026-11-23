import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

// A fixed, locally selected adapter. Neither its path, argv nor environment can
// be supplied by an MCP request. Stdout is protocol-only, stderr stays local.
export function createStdioAdapter(file, { env = process.env, timeout = 45000 } = {}) {
  const child = spawn(process.execPath, [file], { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map(); let sequence = 0, stopped = false;
  const failAll = () => {
    stopped = true;
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('Local adapter stopped; result may be unknown')); }
    pending.clear();
  };
  child.once('error', failAll); child.once('exit', failAll);
  child.stderr.on('data', chunk => process.stderr.write(chunk));
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    let message; try { message = JSON.parse(line); } catch { return; }
    const item = pending.get(message.id); if (!item) return;
    pending.delete(message.id); clearTimeout(item.timer); item.resolve(message);
  });
  return {
    request(request) {
      if (stopped) return Promise.reject(new Error('Local adapter is unavailable'));
      if (pending.size >= 32) return Promise.reject(new Error('Local adapter is busy'));
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('Local adapter result unknown')); }, timeout);
        pending.set(id, { resolve, reject, timer });
        child.stdin.write(JSON.stringify({ ...request, id }) + '\n', error => {
          if (error) { pending.delete(id); clearTimeout(timer); reject(new Error('Local adapter input failed')); }
        });
      });
    },
    async close() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      failAll(); lines.close(); child.stdin.end();
      await new Promise(resolve => {
        const timer = setTimeout(() => { child.kill(); }, 1000);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
      });
    },
  };
}
