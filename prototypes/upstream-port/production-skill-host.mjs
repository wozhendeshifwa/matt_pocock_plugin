// Trusted embedding adapter: the browser and project files cannot select a source.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { MATT_SKILL_PROBE_NAMES } from '../../vendor/mattskills-1.8.0-rc.7/shared/matt-skills.js';
import { acquireSkillMaintenanceLock } from './skill-updates.mjs';
const exec = promisify(execFile);
const APPROVED = Object.freeze({repository:'https://github.com/FeatherHunter/dsh-mattpocock-skills-deck.git',ref:'refs/heads/main',skillPrefix:'package/bundled-skills/',names:MATT_SKILL_PROBE_NAMES});
const sha = value => createHash('sha256').update(value).digest('hex');
async function noLink(file) {
 const info = await fs.lstat(file).catch(e=>{if(e.code==='ENOENT') return null; throw e;});
 if(info?.isSymbolicLink()) throw Error('skill-source-symlink');
}
async function atomic(file,value) {
 const temp=file+'.'+randomUUID()+'.tmp';
 await fs.writeFile(temp,JSON.stringify(value),{flag:'wx'}); await fs.rename(temp,file);
}
export function createProductionSkillHost({dataRoot,workspaceRoot,source=APPROVED}={}) {
 const identity={repository:source.repository,ref:source.ref,skillPrefix:source.skillPrefix,names:[...source.names]};
 const sourceId='git:'+identity.repository+'#'+identity.ref;
 const directory=path.resolve(dataRoot,'skill-source');
 let queue=Promise.resolve();
 async function refresh({projectRoot}) {
  if(await fs.realpath(projectRoot)!==await fs.realpath(workspaceRoot)) throw Error('wrong-project-binding');
  await noLink(directory); await fs.mkdir(directory,{recursive:true});
  const release=await acquireSkillMaintenanceLock(directory);
  try {
   const bindingFile=path.join(directory,'binding.json'); await noLink(bindingFile);
   let binding;
   try {binding=JSON.parse(await fs.readFile(bindingFile,'utf8'));}
   catch(e) {if(e.code!=='ENOENT') throw e; binding={schema:1,...identity}; await atomic(bindingFile,binding); await fs.copyFile(bindingFile,path.join(directory,'binding.initial-backup.json'),fs.constants.COPYFILE_EXCL);}
   if(JSON.stringify(binding)!==JSON.stringify({schema:1,...identity})) throw Error('bound-source-changed');
   let manifestFile=path.join(directory,'unavailable','manifest.json'), sourceError;
   try {
   const repository=path.join(directory,'repository.git'); await noLink(repository);
   const git=async args=>(await exec('git',['-c','core.hooksPath='+path.join(directory,'no-hooks'),...args],{timeout:45000,maxBuffer:10*1024*1024,encoding:'buffer',windowsHide:true})).stdout;
   if(!await fs.stat(repository).catch(()=>null)) await git(['init','--bare',repository]);
   await git(['--git-dir',repository,'fetch','--no-tags','--depth=1',identity.repository,identity.ref]);
   const revision=(await git(['--git-dir',repository,'rev-parse','FETCH_HEAD'])).toString().trim();
   if(!/^[a-f0-9]{40,64}$/.test(revision)) throw Error('invalid-source-revision');
   const snapshot=path.join(directory,revision); await noLink(snapshot);
   manifestFile=path.join(snapshot,'manifest.json');
   // A successful online fetch is still mandatory before reusing an unchanged snapshot.
   if(!await fs.stat(manifestFile).catch(()=>null)) {
    const staging=path.join(directory,'stage-'+randomUUID()); await fs.mkdir(staging);
    const tree=(await git(['--git-dir',repository,'ls-tree','-r','-l','-z',revision,'--',identity.skillPrefix])).toString('utf8').split('\0').filter(Boolean);
    if(tree.length>4096) throw Error('source-tree-size-limit');
    const skills=new Map(); let total=0;
    for(const entry of tree) {
     const match=/^(\d+) blob ([a-f0-9]+)\s+(\d+)\t(.+)$/.exec(entry);
     if(!match) throw Error('invalid-source-tree');
     const [,mode,blob,sizeText,filename]=match;
     const relative=filename.slice(identity.skillPrefix.length), parts=relative.split('/'), name=parts.shift();
     if(!identity.names.includes(name)) continue;
     if(mode!=='100644'&&mode!=='100755') throw Error('source-file-type');
     if(!parts.length||parts.some(p=>!p||p==='.'||p==='..'||/[\\:%\x00-\x1f<>"|?*#]/.test(p)||/[. ]$/.test(p)||/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p))) throw Error('invalid-source-path');
     const size=Number(sizeText); total+=size;
     if(size>200000||total>8*1024*1024) throw Error('source-size-limit');
     if(!skills.has(name)) skills.set(name,[]);
     const files=skills.get(name); if(files.length>=64) throw Error('source-file-count');
     const content=await git(['--git-dir',repository,'cat-file','blob',blob]);
     if(content.length!==size) throw Error('source-size-mismatch');
     const local=path.join(staging,name,...parts); await fs.mkdir(path.dirname(local),{recursive:true}); await fs.writeFile(local,content,{flag:'wx'});
     files.push({path:parts.join('/'),url:name+'/'+parts.join('/'),size,sha256:sha(content)});
    }
    if(skills.size!==identity.names.length) throw Error('missing-managed-skill');
    for(const files of skills.values()) if(!files.some(f=>f.path==='SKILL.md')) throw Error('missing-skill-document');
    await atomic(path.join(staging,'manifest.json'),{sourceId,revision,skills:[...skills].map(([name,files])=>({name,files}))});
    await fs.rename(staging,snapshot);
   }
   } catch {sourceError='source-refresh-failed';}
   return [{id:'approved-plugin-reference',sourceId,kind:'bundled',projectRoot:await fs.realpath(workspaceRoot),manifestUrl:pathToFileURL(manifestFile).href,...(sourceError?{sourceError}:{})}];
  } finally {await release();}
 }
 return {
  getUpdateBindings(input) {
   const next=queue.then(()=>refresh(input)).catch(async error=>{
    if(error.message!=='maintenance-busy') throw error;
    return [{id:'approved-plugin-reference',sourceId,kind:'bundled',projectRoot:await fs.realpath(workspaceRoot),manifestUrl:pathToFileURL(path.join(directory,'unavailable','manifest.json')).href,sourceError:'maintenance-busy'}];
   });
   queue=next.catch(()=>{});return next;
  },
  // Installing reference files requires package integrity and complete local references,
  // not the Agent execution tools. This assessment is never supplied to skill use.
  async assessMaintenanceRequirements() {return {complete:true,tools:[{name:'git-source-read',available:true}]};},
 };
}
