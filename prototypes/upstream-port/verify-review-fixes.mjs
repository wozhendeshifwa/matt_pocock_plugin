import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, stat, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { createSkillsService } from './skills-service.mjs';
import { createRequestPreparation } from './request-preparation.mjs';
import { createSkillUpdateManager } from './skill-updates.mjs';

const root=await mkdtemp(path.join(os.tmpdir(),'deck-review-fixes-'));
try {
  const rules=path.join(root,'tdd','rules.md');
  await mkdir(path.dirname(rules));
  await writeFile(path.join(root,'tdd','SKILL.md'),'---\nname: tdd\ndescription: Fixture\n---\nRead [necessary rules](rules.md).');
  await writeFile(rules,'# Rule\nUse behavior A.\n');
  const skills=createSkillsService({bundledDir:root,workspaceRoot:root,assessRequirements:async()=>({complete:true,tools:[]})});
  const requests=createRequestPreparation({knownNames:['tdd'],prepareSkill:async()=>({status:'source-unbound',bindings:[]}),readSkillDoc:name=>skills.readDoc({name})});
  const draft=await requests.prepare({text:'$tdd\n核验指定工作。'});
  await writeFile(rules,'# Rule\r\nUse behavior A.\r\n');
  assert.equal((await requests.check({draftId:draft.id,text:draft.text})).allowed,true,'format-only reference changes retain the observed behavior');
  await writeFile(rules,'# Rule\nUse behavior B instead.\n');
  const changed=await requests.check({draftId:draft.id,text:draft.text});
  assert.equal(changed.allowed,false,'required reference behavior changes must stop the old request even if SKILL.md is unchanged');
  assert.equal(changed.status,'review-required');
  assert.equal(changed.text,draft.text);
  assert.doesNotMatch(draft.text,/Use behavior A/,'necessary reference bodies are not copied into requests');
  console.log('PASS actual skill service + request preparation detect required reference behavior changes, ignore CRLF-only changes and preserve request text');

  async function bindingFor(name) {
    const source=path.join(root,'sources',name);
    await mkdir(source,{recursive:true});
    const body='---\nname: '+name+'\ndescription: Fixture\n---\n# '+name;
    await writeFile(path.join(source,'SKILL.md'),body);
    await writeFile(path.join(source,'manifest.json'),JSON.stringify({sourceId:name+'-source',revision:'v1',skills:[{name,files:[{path:'SKILL.md',size:Buffer.byteLength(body),sha256:createHash('sha256').update(body).digest('hex'),url:'SKILL.md'}]}]}));
    return {id:name+'-binding',sourceId:name+'-source',projectRoot:root,kind:'host',targetRoot:path.join(root,'target-'+name),manifestUrl:pathToFileURL(path.join(source,'manifest.json')).href};
  }
  const tdd=await bindingFor('tdd'),research=await bindingFor('research');
  const options={dataRoot:path.join(root,'data'),workspaceRoot:root,frozenBundledDir:path.join(root,'frozen'),getBindings:async()=>[tdd,research],assessRequirements:async()=>({complete:true,tools:[]})};
  const manager=createSkillUpdateManager(options);
  assert.equal((await manager.prepare({reason:'startup'})).status,'checked');
  const onlyTdd=await manager.prepare({name:'tdd'});
  assert.equal(onlyTdd.status,'checked','a separate legal research binding must not make tdd preparation fail');
  assert.deepEqual(onlyTdd.bindings.map(binding=>binding.id),['tdd-binding']);
  const untouched=path.join(root,'unrelated-target-must-not-exist');
  const selective=createSkillUpdateManager({...options,getBindings:async()=>[tdd,{...research,targetRoot:untouched}]});
  assert.equal((await selective.prepare({name:'tdd'})).status,'checked');
  await assert.rejects(stat(untouched),/ENOENT/,'an irrelevant source must not create or write its target directory');
  const absentTdd=path.join(root,'absent-tdd-target'),absentResearch=path.join(root,'absent-research-target');
  const noMatch=createSkillUpdateManager({...options,getBindings:async()=>[{...tdd,targetRoot:absentTdd},{...research,targetRoot:absentResearch}]});
  const unmatched=await noMatch.prepare({name:'retro'});
  assert.notEqual(unmatched.status,'checked');
  assert.equal(unmatched.latest,false);
  assert.deepEqual(unmatched.bindings,[]);
  await assert.rejects(stat(absentTdd),/ENOENT/);
  await assert.rejects(stat(absentResearch),/ENOENT/);
  console.log('PASS actual two-source manager startup and per-skill filtering; unrelated targets stay untouched and no matching source never claims latest');
} finally {await rm(root,{recursive:true,force:true});}
