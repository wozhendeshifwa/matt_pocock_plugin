import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { createHash, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { TaskManager, LIVE } from './manager.mjs';
import { TaskEngine } from './engine.mjs';

export const defaultConfigPath = () => process.env.DECK_SANDBOX_CONFIG || path.join(homedir(), '.codex', 'sandbox-tasks', 'config.json');
export function loadConfig(file = defaultConfigPath()) {
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!config.directory || !config.token || config.token.length < 40) throw new Error('请先在本机配置沙箱任务后台。');
  return config;
}
export function endpoint(config) {
  const key = createHash('sha256').update(path.resolve(config.directory).toLowerCase()).digest('hex').slice(0, 24);
  return process.platform === 'win32' ? `\\\\.\\pipe\\mattskills-sandbox-${key}` : path.join(tmpdir(), `mattskills-sandbox-${key}.sock`);
}
function authorized(actual, expected) { const a = Buffer.from(String(actual ?? '')), b = Buffer.from(expected); return a.length === b.length && timingSafeEqual(a, b); }
export async function callService(project, method, input = {}, file) {
  const config = loadConfig(file);
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint(config));
    let buffer = '';
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('本机沙箱后台连接超时，任务状态待核实，请勿重复启动。')); }, 55000);
    socket.on('error', () => { clearTimeout(timer); reject(new Error('本机沙箱后台未连接。请启动后台后重试；不会自动重新执行任务。')); });
    socket.on('connect', () => socket.write(JSON.stringify({ token: config.token, project, method, input }) + '\n'));
    socket.on('data', bytes => {
      buffer += bytes;
      if (buffer.length > 4 * 1024 * 1024) { socket.destroy(); clearTimeout(timer); reject(new Error('后台响应超过限制。')); return; }
      if (!buffer.includes('\n')) return;
      clearTimeout(timer); socket.end();
      try { const reply = JSON.parse(buffer.split('\n')[0]); if (reply.error) reject(new Error(reply.error)); else resolve(reply.value); } catch (error) { reject(error); }
    });
  });
}
export async function serve(config, { engine = new TaskEngine(config) } = {}) {
  let manager;
  const server = net.createServer(socket => {
    let buffer = '', used = false;
    socket.setTimeout(60000, () => socket.destroy());
    socket.on('error', () => {});
    socket.on('data', bytes => {
      if (used) return;
      buffer += bytes;
      if (buffer.length > 100000) { socket.destroy(); return; }
      if (!buffer.includes('\n')) return;
      used = true;
      void (async () => {
        let reply;
        try {
          const request = JSON.parse(buffer.split('\n')[0]);
          if (!authorized(request.token, config.token)) throw new Error('本机后台授权失败。');
          if (!manager) throw new Error('后台正在恢复状态，请稍后重试。');
          const project = fs.realpathSync(request.project);
          const input = request.input ?? {};
          let value;
          switch (request.method) {
            case 'list': value = { ...manager.list(project), models: config.models, modelEfforts: config.modelEfforts, defaultModel: config.defaultModel }; break;
            case 'prepare': value = await manager.prepare(project, input); break;
            case 'start': value = manager.start(project, input.token); break;
            case 'detail': value = await manager.detail(project, input.id, { diffOffset: input.diffOffset }); break;
            case 'cancel': value = await manager.cancel(project, input.id); break;
            case 'resume': value = manager.resume(project, input.id); break;
            case 'limit': value = manager.setLimit(input.value); break;
            case 'mergePreview': value = await manager.actionPreview(project, input.id, 'merge'); break;
            case 'cleanPreview': value = await manager.actionPreview(project, input.id, 'clean'); break;
            case 'merge': value = await manager.confirm(project, input.token, 'merge', input.allowUnchecked === true); break;
            case 'clean': value = await manager.confirm(project, input.token, 'clean'); break;
            case 'shutdownPreview': value = manager.token(project, 'shutdown', { affected: manager.rows().filter(t => !t.cleaned && !['completed', 'failed', 'cancelled', 'interrupted'].includes(t.status)).map(t => ({ id: t.id, projectName: path.basename(t.project), status: t.status })) }); break;
            case 'shutdown': {
              const preview = manager.preview(project, input.token, 'shutdown');
              const current = manager.rows().filter(t => !t.cleaned && !['completed', 'failed', 'cancelled', 'interrupted'].includes(t.status)).map(t => t.id).sort();
              if (JSON.stringify(current) !== JSON.stringify(preview.value.affected.map(t => t.id).sort())) throw new Error('受影响任务已变化，请重新预览。');
              manager.quiescing = true;
              for (const task of manager.rows()) {
                if (task.status === 'queued') manager.save({ ...task, paused: true });
                else if (LIVE.has(task.status)) await manager.cancel(task.project, task.id);
              }
              value = { stopping: true };
              const wait = setInterval(() => { if (!manager.rows().some(t => LIVE.has(t.status))) { clearInterval(wait); manager.close(); server.close(); } }, 500);
              break;
            }
            default: throw new Error('未知沙箱任务操作。');
          }
          reply = { value };
        } catch (error) { reply = { error: error.message }; }
        socket.end(JSON.stringify(reply) + '\n');
      })();
    });
  });
  // Bind the process-wide endpoint before opening/recovering durable state.
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(endpoint(config), resolve); });
  manager = new TaskManager({ directory: config.directory, engine });
  await manager.recover();
  return { manager, server, async close({ stop = false } = {}) {
    if (stop) {
      for (const task of manager.rows()) if (task.status === 'queued') manager.save({ ...task, paused: true });
      for (const task of manager.rows()) if (LIVE.has(task.status)) await manager.cancel(task.project, task.id);
      const deadline = Date.now() + 15000;
      while (manager.rows().some(t => LIVE.has(t.status)) && Date.now() < deadline) await new Promise(r => setTimeout(r, 200));
      if (manager.rows().some(t => LIVE.has(t.status))) throw new Error('仍有执行待核实，后台不会报告停止成功。');
    }
    manager.close(); await new Promise(resolve => server.close(resolve));
  } };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const app = await serve(loadConfig(process.argv[2]));
  // Closing Codex or the sidebar never sends this process a stop request.
  // A normal explicit stop must wait until owned executions have stopped.
  let stopping = false;
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
    if (stopping) return; stopping = true;
    app.close({ stop: true }).then(() => process.exit(0)).catch(error => { stopping = false; process.stderr.write(error.message + '\n'); });
  });
}
