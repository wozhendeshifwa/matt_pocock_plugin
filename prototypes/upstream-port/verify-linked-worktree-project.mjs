import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {linkedWorktreeProject} from './linked-worktree-project.mjs';
const directory=await mkdtemp(path.join(tmpdir(),'deck-worktree-association-'));
const root=path.join(directory,'registered'),worktree=path.join(directory,'linked');
const git=(cwd,...args)=>execFileSync('git',['-c','core.fsmonitor=false','-C',cwd,...args],{stdio:'pipe'});
try {
  await mkdir(root); git(root,'init');git(root,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-m','fixture');
  git(root,'worktree','add','--detach',worktree);
  const registered={path:root,projectId:'fixture'};
  assert.deepEqual(await linkedWorktreeProject(worktree,[registered]),registered);
  await mkdir(path.join(worktree,'sub'));
  assert.deepEqual(await linkedWorktreeProject(path.join(worktree,'sub'),[registered]),registered);
  assert.equal(await linkedWorktreeProject(worktree,[{path:directory,projectId:'wrong'}]),null);
  const marker=await import('node:fs/promises').then(fs=>fs.readFile(path.join(worktree,'.git'),'utf8'));
  const gitdir=marker.trim().slice('gitdir: '.length);
  await writeFile(path.join(gitdir,'gitdir'),path.join(root,'.git'));
  assert.equal(await linkedWorktreeProject(worktree,[registered]),null,'mismatched registration backpointer must fail closed');
  console.log('PASS real registered linked worktree/subdir map to their project; unrelated roots and mismatched backpointer rejected');
} finally {await rm(directory,{recursive:true,force:true});}
