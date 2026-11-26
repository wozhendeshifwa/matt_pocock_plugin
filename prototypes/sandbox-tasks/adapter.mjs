import { callService } from './service.mjs';
export const SANDBOX_READS = new Set(['list', 'prepare', 'detail', 'mergePreview', 'cleanPreview', 'shutdownPreview']);
export const SANDBOX_WRITES = new Set(['start', 'cancel', 'resume', 'limit', 'merge', 'clean', 'shutdown']);
export const sandboxTools = [
  { name: 'deck_sandbox_read', description: '读取本机沙箱任务或生成启动/合入/清理预览。仅当前聊天的可信项目。', annotations: { readOnlyHint: true } },
  { name: 'deck_sandbox_write', description: '用户在侧栏确认后启动、取消、恢复、合入或清理当前项目沙箱任务。', annotations: { readOnlyHint: false, destructiveHint: true } },
].map(tool => ({ ...tool, inputSchema: { type: 'object', required: ['method', 'expectedThreadId'], additionalProperties: false,
  properties: { method: { type: 'string' }, expectedThreadId: { type: 'string' }, input: { type: 'object' } } }, _meta: { ui: { visibility: ['app'] } } }));
export async function dispatchSandbox(name, args, project) {
  if (!project?.projectRoot || args.expectedThreadId !== project.threadId) throw new Error('项目或聊天已切换，请重新加载。');
  const methods = name === 'deck_sandbox_read' ? SANDBOX_READS : name === 'deck_sandbox_write' ? SANDBOX_WRITES : new Set();
  if (!methods.has(args.method)) throw new Error('沙箱操作的读写通道不匹配。');
  return callService(project.projectRoot, args.method, args.input ?? {});
}
