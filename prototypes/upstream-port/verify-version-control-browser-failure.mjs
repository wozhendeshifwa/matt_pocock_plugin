import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

// Exercise the browser process boundary through the public verification command.
// Node exits on Chromium's flags; an existing directory cannot be spawned.
const run = promisify(execFile);
const root = await mkdtemp(path.join(tmpdir(), 'deck-browser-failure-'));
try {
  for (const kind of ['early-exit', 'spawn-error']) {
    const temporary = path.join(root, kind);
    await mkdir(temporary);
    const started = Date.now();
    let failure;
    try {
      await run(process.execPath, [fileURLToPath(new URL('verify-version-control-style.mjs', import.meta.url))], {
        env: { ...process.env, DECK_TEST_HOVER: '1', DECK_TEST_BROWSER: kind === 'early-exit' ? process.execPath : temporary, TMP: temporary, TEMP: temporary, TMPDIR: temporary },
        windowsHide: true,
        timeout: 8000,
      });
    } catch (error) { failure = error; }
    assert.ok(failure, kind + ' reports a failed browser verification');
    assert.equal(failure.killed, false, kind + ' settles without the harness timeout');
    assert.equal(failure.code, 1, kind + ' reports an ordinary verification failure');
    assert.ok(Date.now() - started < 4000, kind + ' fails promptly');
    assert.match(failure.stderr, /Chromium (?:exited before|could not start)/, kind + ' gives a process-boundary failure reason');
    assert.deepEqual(await readdir(temporary), [], kind + ' removes the verification temporary directory');
    console.log('PASS browser verification ' + kind + ' fails promptly and cleans its temporary files');
  }
} finally {
  await rm(root, { recursive: true, force: true });
}
