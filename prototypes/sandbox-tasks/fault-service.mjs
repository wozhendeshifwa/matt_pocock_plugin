import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { serve, loadConfig } from './service.mjs';
import { TaskEngine } from './engine.mjs';
import { FaultLease, armFault } from './fault-lease.mjs';

export async function startFaultService({ project, controlFile, eventsFile, config = loadConfig() }) {
  const event = item => fs.appendFileSync(eventsFile, JSON.stringify({ at: new Date().toISOString(), ...item }) + '\n');
  const faults = new FaultLease({ project, file: controlFile, onEvent: event });
  class ObservedEngine extends TaskEngine {
    async inspect(task) {
      if (faults.matches('hold-observation', task.project, task.id)) return { state: 'unknown' };
      return super.inspect(task);
    }
  }
  try { return await serve(config, { engine: new ObservedEngine(config), faults }); }
  catch (error) { faults.close(); throw error; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, file, mode, target, ttl] = process.argv.slice(2);
  if (command === 'arm') {
    const state = armFault(file, { mode, ...(mode === 'drop-start-reply' ? { tokenHash: target } : { taskId: target }), ttlMs: ttl ? Number(ttl) : 60000 });
    console.log(JSON.stringify({ enabled: true, mode: state.mode, expiresAt: state.expiresAt }));
  } else if (command === 'serve') {
    const app = await startFaultService({ project: file, controlFile: mode, eventsFile: target });
    let stopping = false;
    for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
      if (stopping) return; stopping = true;
      app.close({ stop: true }).then(() => process.exit(0)).catch(error => { stopping = false; console.error(error.message); });
    });
  } else throw new Error('用法：fault-service.mjs serve <验收项目> <控制文件> <事件文件>；arm <控制文件> <模式> <任务ID或预览SHA256> [有效毫秒]');
}
