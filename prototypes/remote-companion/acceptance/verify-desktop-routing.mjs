import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';

// Supply four existing, idle chat IDs from the installed client. The remote
// plugin must be enabled and the caller environment available to that client.
const [casesFile, codex = 'codex'] = process.argv.slice(2);
const cases = JSON.parse(await readFile(casesFile, 'utf8'));
const scenarios = ['first', 'second', 'other', 'unscoped'];
for (const key of scenarios) {
  assert.match(cases[key]?.id ?? '', /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i);
  if (key !== 'unscoped') assert.ok(path.isAbsolute(cases[key].cwd));
}
assert.equal(new Set(scenarios.map(key => cases[key].id)).size, 4);
const normalize = value => path.resolve(value).toLowerCase();
assert.equal(normalize(cases.first.cwd), normalize(cases.second.cwd));
assert.notEqual(normalize(cases.first.cwd), normalize(cases.other.cwd));

const child = spawn(codex, ['app-server', '--listen', 'stdio://'], {
  windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'],
});
const lines = createInterface({ input: child.stdout });
const pending = new Map();
let sequence = 0;
function failPending(error) {
  for (const finish of pending.values()) finish({ error: { message: error.message } });
}
child.on('error', failPending);
child.stdin.on('error', failPending);
child.on('exit', () => failPending(new Error('Codex app-server exited')));
lines.on('line', line => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  pending.get(message.id)?.(message);
});
function request(method, params) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(method + ' timed out'));
    }, 60000);
    pending.set(id, message => {
      pending.delete(id);
      clearTimeout(timeout);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    });
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
}
const remote = (threadId, tool, args = {}) => request('mcpServer/tool/call', {
  threadId, server: 'deck-remote-companion', tool, arguments: args,
});
async function readProject(id) {
  try { return await remote(id, 'deck_current_project'); }
  catch (error) {
    if (!/thread.*(?:not found|not loaded|not running)|unknown thread/i.test(error.message)) throw error;
    await request('thread/resume', { threadId: id, excludeTurns: true });
    return remote(id, 'deck_current_project');
  }
}
async function expectDenial(read, reason) {
  let response;
  try { response = await read(); }
  catch (error) { assert.match(error.message, reason); return; }
  assert.equal(response.isError, true);
  assert.match(JSON.stringify(response.content), reason);
}

try {
  await request('initialize', {
    clientInfo: { name: 'deck-readonly-routing', version: '1' }, capabilities: { experimentalApi: true },
  });
  child.stdin.write('{"method":"initialized"}\n');
  for (const key of ['first', 'second', 'other', 'first']) {
    const { id, cwd } = cases[key];
    const response = await readProject(id);
    assert.notEqual(response.isError, true);
    assert.equal(response.structuredContent.threadId, id);
    assert.equal(normalize(response.structuredContent.projectRoot), normalize(cwd));
    console.log(key + ': correct thread and project');
  }
  await expectDenial(() => readProject(cases.unscoped.id), /No verified local project for this host identity/);
  console.log('unscoped: rejected');
  await expectDenial(() => remote(cases.first.id, 'deck_upstream_read', {
    method: 'gitStatus', payload: { expectedThreadId: cases.other.id },
  }), /thread changed|聊天已切换/i);
  console.log('stale read: rejected');
} finally {
  lines.close();
  child.stdin.end();
  child.kill();
}
