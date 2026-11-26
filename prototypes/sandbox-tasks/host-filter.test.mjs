import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { git } from './engine.mjs';

test('host status, SDK execFile and spawn cannot run task clean or process filters', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-host-filter-'));
  try {
    for (const mode of ['git', 'execFile', 'spawn']) {
      const repo = path.join(directory, mode); fs.mkdirSync(repo);
      git(repo, ['init']); git(repo, ['config', 'user.name', 'Test']); git(repo, ['config', 'user.email', 'test@localhost']);
      fs.writeFileSync(path.join(repo, 'file.txt'), 'base\n'); git(repo, ['add', '.']); git(repo, ['commit', '-m', 'base']);
      const marker = path.join(directory, `executed-${mode}`);
      const script = path.join(directory, `filter-${mode}.sh`);
      fs.writeFileSync(script, `#!/bin/sh\nprintf UNSAFE > '${marker.replaceAll('\\', '/')}'\ncat\n`);
      git(repo, ['config', 'filter.evil.with.dot.clean', `sh "${script.replaceAll('\\', '/')}"`]);
      git(repo, ['config', 'filter.evil.with.dot.process', `sh "${script.replaceAll('\\', '/')}"`]);
      git(repo, ['config', 'filter.evil.with.dot.required', 'true']);
      fs.writeFileSync(path.join(repo, '.gitattributes'), 'file.txt filter=evil.with.dot\n');
      fs.writeFileSync(path.join(repo, 'file.txt'), 'edit\n');
      assert.equal(fs.existsSync(marker), false);
      if (mode === 'git') git(repo, ['status', '--porcelain']);
      else {
        const source = `
          import { isolateHostGit } from ${JSON.stringify(new URL('./windows-exec.mjs', import.meta.url).href)};
          import { execFile, spawn } from 'node:child_process';
          isolateHostGit();
          const cwd = ${JSON.stringify(repo)};
          if (${JSON.stringify(mode)} === 'execFile') await new Promise((resolve,reject)=>execFile('git',['status','--porcelain'],{cwd},error=>error?reject(error):resolve()));
          else await new Promise((resolve,reject)=>{const p=spawn('git',['status','--porcelain'],{cwd});p.on('error',reject);p.on('close',code=>code===0?resolve():reject(new Error('exit '+code)));});
        `;
        execFileSync(process.execPath, ['--input-type=module', '-e', source], { timeout: 15000, windowsHide: true, stdio: 'pipe' });
      }
      assert.equal(fs.existsSync(marker), false, `${mode} executed a task filter`);
    }
  } finally { fs.rmSync(directory, { recursive: true }); }
});


