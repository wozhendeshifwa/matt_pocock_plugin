import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { callService } from './service.mjs';
const project = process.argv[2], config = process.argv[3], output = process.argv[4];
const call = (method, input) => callService(project, method, input, config);
const preview = await call('prepare', { prompt: 'Reply only DONE without using any tools or reading or changing files.', minutes: 1, model: 'gpt-6.1-sol', effort: 'low', check: 'node -e "setTimeout(()=>{},90000)"' });
const task = await call('start', { token: preview.token });
const started = Date.now();
let final;
for (;;) {
  const value = await call('detail', { id: task.id });
  if (['completed', 'failed', 'cancelled', 'interrupted'].includes(value.status)) { final = value; break; }
  if (Date.now() - started > 100000) throw new Error('Timeout acceptance deadline exceeded');
  await new Promise(r => setTimeout(r, 1000));
}
fs.writeFileSync(output, JSON.stringify({ duration: Date.now() - started, task: final }, null, 2));
assert.equal(final.status, 'failed'); assert.ok(final.message.includes('超时'));
console.log('PASS real task runtime deadline stops container and preserves evidence');
