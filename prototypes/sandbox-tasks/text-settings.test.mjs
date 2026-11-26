import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { git, prepareTaskRepository, writeDiff } from './engine.mjs';

test('Linux Git sees the same clean baseline after a Windows CRLF checkout', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-crlf-'));
  const before = process.env.GIT_CONFIG_GLOBAL;
  const beforeSystem = process.env.GIT_CONFIG_NOSYSTEM;
  try {
    const globalConfig = path.join(root, 'host.gitconfig');
    fs.writeFileSync(globalConfig, '[core]\n autocrlf = true\n');
    process.env.GIT_CONFIG_GLOBAL = globalConfig;
    const source = path.join(root, 'source'), task = path.join(root, 'task');
    fs.mkdirSync(source); fs.mkdirSync(task);
    git(source, ['init']); git(source, ['config', 'user.name', 'Test']); git(source, ['config', 'user.email', 'test@localhost']);
    fs.writeFileSync(path.join(source, 'file.txt'), 'baseline\n');
    git(source, ['add', '.']); git(source, ['commit', '-m', 'baseline']);
    const repo = prepareTaskRepository(source, task, git(source, ['rev-parse', 'HEAD']));
    assert.ok(fs.readFileSync(path.join(repo, 'file.txt'), 'utf8').includes('\r\n'));
    // Docker has no Windows host global config. It must rely on the pinned
    // private repository settings when adding the agent's result.
    process.env.GIT_CONFIG_GLOBAL = process.platform === 'win32' ? 'NUL' : '/dev/null';
    process.env.GIT_CONFIG_NOSYSTEM = '1';
    assert.equal(git(repo, ['status', '--porcelain']), '');
  } finally {
    if (before === undefined) delete process.env.GIT_CONFIG_GLOBAL; else process.env.GIT_CONFIG_GLOBAL = before;
    if (beforeSystem === undefined) delete process.env.GIT_CONFIG_NOSYSTEM; else process.env.GIT_CONFIG_NOSYSTEM = beforeSystem;
    fs.rmSync(root, { recursive: true });
  }
});

test('result diff larger than the RPC/Git buffer is persisted without ENOBUFS', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-large-diff-'));
  try {
    git(root, ['init']);
    fs.writeFileSync(path.join(root, 'large.txt'), 'small\n');
    git(root, ['add', 'large.txt']);
    fs.writeFileSync(path.join(root, 'large.txt'), 'x'.repeat(9 * 1024 * 1024) + '\n');
    const output = path.join(root, 'result.diff');
    assert.equal(writeDiff(root, ['--', 'large.txt'], output), true);
    assert.ok(fs.statSync(output).size > 8 * 1024 * 1024);
  } finally { fs.rmSync(root, { recursive: true }); }
});
