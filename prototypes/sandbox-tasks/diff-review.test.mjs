import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { TaskEngine, git, writeRetainedDiff } from './engine.mjs';

test('all diff bytes can be reviewed in bounded pages, including UTF-8 page boundaries', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-diff-review-'));
  const engine = new TaskEngine({ directory });
  const task = { id: '11111111-1111-1111-1111-111111111111' };
  const root = engine.root(task); fs.mkdirSync(root);
  const expected = 'FIRST_FILE_CRITICAL_CHANGE\n' + '中文🙂\n'.repeat(60000) + 'LAST_FILE\n';
  fs.writeFileSync(path.join(root, 'result.diff'), expected);
  try {
    let offset = 0, actual = '', pages = 0;
    do {
      const detail = await engine.detail(task, { diffOffset: offset });
      assert.equal(detail.diffPage.offset, offset);
      assert.ok(Buffer.byteLength(detail.diff) <= 128 * 1024);
      actual += detail.diff; pages++;
      offset = detail.diffPage.nextOffset;
    } while (offset !== null);
    assert.ok(pages > 1);
    assert.equal(actual, expected);
    await assert.rejects(() => engine.detail(task, { diffOffset: -1 }));
  } finally { fs.rmSync(directory, { recursive: true }); }
});

test('retained diff includes committed, staged and new files without changing the index or running extensions', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-retained-diff-'));
  try {
    git(root, ['init']); git(root, ['config', 'user.name', 'Test']); git(root, ['config', 'user.email', 'test@localhost']);
    fs.writeFileSync(path.join(root, 'base.txt'), 'baseline\n');
    git(root, ['add', '.']); git(root, ['commit', '-m', 'base']);
    const base = git(root, ['rev-parse', 'HEAD']);
    fs.writeFileSync(path.join(root, 'base.txt'), 'committed result\n');
    git(root, ['commit', '-am', 'agent result']);
    fs.writeFileSync(path.join(root, 'staged.txt'), 'staged result\n'); git(root, ['add', 'staged.txt']);
    fs.writeFileSync(path.join(root, 'untracked.txt'), 'partial new result\n');
    fs.writeFileSync(path.join(root, 'binary.bin'), Buffer.from([0, 1, 2, 3]));
    const marker = path.join(root, 'HOST_EXTENSION_EXECUTED');
    fs.writeFileSync(path.join(root, 'evil.sh'), `#!/bin/sh\nprintf unsafe > '${marker.replaceAll('\\', '/')}'\ncat\n`);
    git(root, ['config', 'filter.evil.clean', `sh "${path.join(root, 'evil.sh').replaceAll('\\', '/')}"`]);
    git(root, ['config', 'diff.evil.textconv', `sh "${path.join(root, 'evil.sh').replaceAll('\\', '/')}"`]);
    git(root, ['config', 'diff.external', `sh "${path.join(root, 'evil.sh').replaceAll('\\', '/')}"`]);
    fs.writeFileSync(path.join(root, '.gitattributes'), '*.txt filter=evil diff=evil\n');
    const before = git(root, ['-c', 'filter.evil.clean=', '-c', 'filter.evil.process=', 'status', '--porcelain']);
    const index = fs.readFileSync(path.join(root, '.git', 'index'));
    const head = git(root, ['rev-parse', 'HEAD']);
    const output = path.join(os.tmpdir(), `retained-${process.pid}-${Date.now()}.diff`);
    try {
      assert.equal(fs.existsSync(marker), false);
      assert.equal(writeRetainedDiff(root, base, output), true);
      const diff = fs.readFileSync(output, 'utf8');
      assert.match(diff, /\+committed result/);
      assert.match(diff, /\+staged result/);
      assert.match(diff, /\+partial new result/);
      assert.match(diff, /GIT binary patch/);
      assert.equal(fs.existsSync(marker), false);
      assert.equal(git(root, ['-c', 'filter.evil.clean=', '-c', 'filter.evil.process=', 'status', '--porcelain']), before);
      assert.deepEqual(fs.readFileSync(path.join(root, '.git', 'index')), index);
      assert.equal(git(root, ['rev-parse', 'HEAD']), head);
      assert.equal(fs.existsSync(marker), false);
    } finally { fs.unlinkSync(output); }
  } finally { fs.rmSync(root, { recursive: true }); }
});

test('retained untracked symlink shows its link value without reading its host target', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-diff-symlink-'));
  const repo = path.join(directory, 'repo'); fs.mkdirSync(repo);
  const target = path.join(directory, 'host-secret.txt');
  fs.writeFileSync(target, 'HOST_SECRET_MUST_NEVER_APPEAR');
  try {
    git(repo, ['init']); git(repo, ['config', 'user.name', 'Test']); git(repo, ['config', 'user.email', 'test@localhost']);
    git(repo, ['commit', '--allow-empty', '-m', 'base']);
    const base = git(repo, ['rev-parse', 'HEAD']);
    try { fs.symlinkSync(target, path.join(repo, 'link.txt'), 'file'); }
    catch (error) {
      if (process.platform === 'win32' && error.code === 'EPERM') { t.skip('Windows token lacks symlink privilege; run this case in verified Linux Docker image.'); return; }
      throw error;
    }
    const output = path.join(directory, 'result.diff');
    writeRetainedDiff(repo, base, output);
    const diff = fs.readFileSync(output, 'utf8');
    assert.match(diff, /new file mode 120000/);
    assert.ok(!diff.includes('HOST_SECRET_MUST_NEVER_APPEAR'));
    assert.equal(fs.readFileSync(target, 'utf8'), 'HOST_SECRET_MUST_NEVER_APPEAR');
  } finally { fs.rmSync(directory, { recursive: true }); }
});
