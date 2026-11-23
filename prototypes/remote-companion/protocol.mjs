import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const VERSION = 1;
export const MAX_BYTES = 8 * 1024 * 1024;
export const METHODS = new Set(['initialize', 'ping', 'tools/list', 'tools/call', 'resources/list', 'resources/templates/list', 'resources/read']);
export const digest = value => createHash('sha256').update(value).digest('hex');
export const mac = (secret, value) => createHmac('sha256', secret).update(value).digest('hex');
export function equal(left, right) {
  return typeof left === 'string' && typeof right === 'string' && timingSafeEqual(Buffer.from(digest(left)), Buffer.from(digest(right)));
}
export function secret(value) {
  if (typeof value !== 'string' || value.length < 32) throw new Error('A secret of at least 32 characters is required');
  return value;
}
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
export function requestHash(request) { return digest(canonical({ method: request.method, params: request.params ?? {} })); }
export function validateRequest(request) {
  if (!request || Array.isArray(request) || request.jsonrpc !== '2.0' || !METHODS.has(request.method) ||
      !['string', 'number'].includes(typeof request.id) || (typeof request.id === 'number' && !Number.isSafeInteger(request.id)) ||
      (request.params !== undefined && (!request.params || typeof request.params !== 'object' || Array.isArray(request.params)))) {
    throw new Error('Invalid or unsupported MCP request');
  }
}
export function threadId(request) {
  const meta = request.params?._meta;
  if (meta?.threadId && meta?.thread_id && meta.threadId !== meta.thread_id) throw new Error('Conflicting host identity');
  const id = meta?.threadId ?? meta?.thread_id;
  if (typeof id !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) throw new Error('Missing host thread identity');
  return id;
}
export function rpcError(id, code, message, data) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data ? { data } : {}) } };
}
export async function readJson(response, limit = MAX_BYTES, inspectText) {
  const chunks = []; let size = 0;
  for await (const chunk of response) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Payload too large'), { status: 413 });
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  // Optional local admission checks run before JSON.parse can expand a short
  // wire payload into a much larger object graph. Parsing still owns validity.
  inspectText?.(text);
  try { return JSON.parse(text); }
  catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}
export function bridgeUrl(value, allowLoopback = false) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      (url.protocol !== 'https:' && !(allowLoopback && url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new Error('Use an HTTPS origin (HTTP loopback is allowed only for tests)');
  }
  return url.origin;
}
