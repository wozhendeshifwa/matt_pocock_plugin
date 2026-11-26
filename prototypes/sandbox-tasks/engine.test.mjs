import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { TaskEngine, git } from './engine.mjs';

test('an executor torn down by the OS is interrupted and keeps raw check evidence', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-os-stop-'));
  const engine = new TaskEngine({ directory });
  const task = { id: '22222222-2222-2222-2222-222222222222', nonce: 'nonce' };
  const root = engine.root(task); fs.mkdirSync(root);
  const result = { id: task.id, nonce: task.nonce, outcome: { status: 'failed', message: 'host Git interrupted during shutdown', checks: { state: 'failed', command: 'long check', exitCode: 4294967295, stdout: '', stderr: '' } } };
  fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify(result));
  try {
    const observed = await engine.inspect(task);
    assert.equal(observed.state, 'terminal');
    assert.equal(observed.result.status, 'interrupted');
    assert.equal(observed.result.checks.state, 'unknown');
    assert.equal(observed.result.checks.exitCode, 4294967295);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'result.json'), 'utf8')), result);
  } finally { fs.rmSync(directory, { recursive: true }); }
});

test('unacknowledged dispatch stays unknown instead of allowing cleanup or rerun', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-dispatch-'));
  const engine = new TaskEngine({ directory });
  const task = { id: '11111111-1111-1111-1111-111111111111', nonce: 'nonce' };
  const root = engine.root(task);
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'request.json'), '{}');
  try { assert.equal((await engine.inspect(task)).state, 'unknown'); }
  finally { fs.rmSync(directory, { recursive: true }); }
});

test('host inspection never runs a task-controlled Git fsmonitor command', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-host-git-'));
  try {
    git(root, ['init']);
    const marker = path.join(root, 'host-executed.txt');
    const hook = path.join(root, 'monitor.sh');
    fs.writeFileSync(hook, `#!/bin/sh\nprintf unsafe > '${marker.replaceAll('\\', '/')}'\n`, { mode: 0o755 });
    git(root, ['config', 'core.fsmonitor', hook.replaceAll('\\', '/')]);
    git(root, ['status', '--porcelain']);
    fs.writeFileSync(path.join(root, 'file.txt'), 'base\n');
    git(root, ['add', 'file.txt']);
    git(root, ['config', 'diff.external', hook.replaceAll('\\', '/')]);
    fs.writeFileSync(path.join(root, 'file.txt'), 'changed\n');
    assert.ok(git(root, ['diff']).includes('+changed'));
    assert.equal(fs.existsSync(marker), false, 'task configuration executed a host command');
  } finally { fs.rmSync(root, { recursive: true }); }
});

test('real Git merge refuses dirt and changed target; conflict retains the result', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-merge-'));
  const project = path.join(root, 'source'), repo = path.join(root, 'task');
  fs.mkdirSync(project);
  try {
    git(project, ['init', '-b', 'main']); git(project, ['config', 'user.name', 'Acceptance']); git(project, ['config', 'user.email', 'acceptance@localhost']);
    fs.writeFileSync(path.join(project, 'file.txt'), 'base\n'); git(project, ['add', '.']); git(project, ['commit', '-m', 'baseline']);
    const base = git(project, ['rev-parse', 'HEAD']);
    git(root, ['clone', '--no-hardlinks', project, repo]);
    git(repo, ['config', 'user.name', 'Acceptance']); git(repo, ['config', 'user.email', 'acceptance@localhost']);
    git(repo, ['checkout', '-b', 'result']); fs.writeFileSync(path.join(repo, 'file.txt'), 'result\n'); git(repo, ['commit', '-am', 'result']);
    const task = { project, result: { repo, branch: 'result', sha: git(repo, ['rev-parse', 'HEAD']) } };
    const engine = new TaskEngine({ directory: path.join(root, 'data') });
    const preview = await engine.mergePreview(task);
    fs.writeFileSync(path.join(project, 'untracked.txt'), 'do not overwrite');
    await assert.rejects(() => engine.merge(task, preview));
    fs.renameSync(path.join(project, 'untracked.txt'), path.join(root, 'kept.txt'));
    fs.writeFileSync(path.join(project, 'file.txt'), 'target\n'); git(project, ['commit', '-am', 'advance target']);
    await assert.rejects(() => engine.merge(task, preview));
    const updated = await engine.mergePreview(task);
    const merged = await engine.merge(task, updated);
    assert.equal(merged.conflict, true); assert.equal(merged.merged, false);
    assert.equal(git(repo, ['rev-parse', 'result']), task.result.sha);
    assert.equal(git(project, ['rev-parse', 'HEAD']), updated.targetHead);
    assert.ok(git(project, ['status', '--porcelain']).includes('UU'));
    assert.equal(fs.readFileSync(path.join(root, 'kept.txt'), 'utf8'), 'do not overwrite');
    assert.notEqual(base, updated.targetHead);
  } finally {
    const relative = path.relative(os.tmpdir(), fs.realpathSync(root));
    assert.ok(relative.startsWith('sandbox-merge-') && !relative.includes('..'));
    fs.rmSync(root, { recursive: true });
  }
});
