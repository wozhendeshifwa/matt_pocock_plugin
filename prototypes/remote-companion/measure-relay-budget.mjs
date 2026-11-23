// Local-only resource experiment. Synthetic credentials, no files, cloud or
// production traffic. The relay lives in a heap-limited child with an RSS stop
// line; the driver limits both request count and total input size.
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRelay } from './relay.mjs';

const callerToken = 'c'.repeat(40), deviceToken = 'd'.repeat(40), sessionSecret = 's'.repeat(40);
if (process.argv.includes('--child')) {
  const relay = await createRelay({ callerToken, deviceToken, sessionSecret, requestTimeout: 6000, pollTimeout: 8000 });
  let peak = 0;
  const timer = setInterval(() => {
    peak = Math.max(peak, process.memoryUsage().rss);
    if (peak > 360 * 1024 * 1024) {
      process.send?.({ limitExceeded: true, peak });
      void relay.close().finally(() => process.exit(2));
    }
  }, 25);
  process.on('message', async message => {
    if (message === 'sample') process.send?.({ memory: process.memoryUsage(), peak, osPeakRss: process.resourceUsage().maxRSS * 1024 });
    if (message === 'close') { clearInterval(timer); await relay.close(); process.exit(0); }
  });
  process.send?.({ port: relay.port, memory: process.memoryUsage() });
} else {
  const count = Number(process.argv[2] ?? 12), bytes = Number(process.argv[3] ?? 2097152);
  const maximumBody = count === 1 ? 7 * 1024 * 1024 : 4 * 1024 * 1024;
  if (!Number.isSafeInteger(count) || count < 1 || count > 24 || !Number.isSafeInteger(bytes) || bytes < 1 || bytes > maximumBody) throw new Error('Measurement exceeds its bounded local fixture');
  const child = fork(fileURLToPath(import.meta.url), ['--child'], { execArgv: ['--max-old-space-size=256'], windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let errors = ''; child.stderr.on('data', chunk => { errors += chunk.toString(); });
  const messages = []; child.on('message', value => messages.push(value));
  async function until(predicate, ms = 5000) {
    const deadline = Date.now() + ms;
    while (!predicate()) { if (Date.now() > deadline) throw new Error('Measurement failed: ' + errors); await new Promise(resolve => setTimeout(resolve, 20)); }
  }
  try {
    await until(() => messages.some(value => value.port));
    const initial = messages.find(value => value.port), origin = `http://127.0.0.1:${initial.port}`;
    const poll = fetch(origin + '/bridge/poll', { method: 'POST', headers: { authorization: 'Bearer ' + deviceToken, 'content-type': 'application/json' }, body: '{"version":1}' }).then(response => response.json());
    await new Promise(resolve => setTimeout(resolve, 50));
    const requests = [];
    for (let id = 0; id < count; id++) {
      const fixture = process.argv.includes('--objects') ? Array.from({ length: Math.floor(bytes / 3) }, () => ({})) : 'x'.repeat(bytes);
      const body = JSON.stringify({ jsonrpc: '2.0', id, method: 'initialize', params: { protocolVersion: '2025-03-26', fixture } });
      requests.push(fetch(origin + '/mcp', { method: 'POST', headers: { authorization: 'Bearer ' + callerToken, 'content-type': 'application/json' }, body })
        .then(async response => ({ status: response.status, body: await response.json() })).catch(error => ({ error: error.message })));
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    await poll; await new Promise(resolve => setTimeout(resolve, 1200)); child.send('sample');
    await until(() => messages.some(value => value.memory && !value.port));
    const sample = messages.find(value => value.memory && !value.port), responses = await Promise.all(requests);
    console.log(JSON.stringify({ count, payloadBytesEach: bytes, baseline: initial.memory, retained: sample.memory, peakRss: sample.peak, osPeakRss: sample.osPeakRss,
      statuses: responses.map(value => value.status ?? value.error), childLimitExceeded: messages.some(value => value.limitExceeded) }, null, 2));
  } finally {
    if (child.connected) child.send('close');
    await new Promise(resolve => {
      if (child.exitCode !== null) return resolve();
      child.once('exit', resolve); setTimeout(() => { child.kill(); resolve(); }, 3000).unref();
    });
  }
}
