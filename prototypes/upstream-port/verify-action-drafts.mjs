import assert from 'node:assert/strict';
import { fixture } from './test-fixtures/sidebar-fixture.mjs';
const f=fixture();
try {
 await f.seed('Project A handwritten draft',{legacyContext:{scope:'Approved changes',branch:'codex/old',baseline:'release/2'}});
 let v=await f.menu();
 assert.equal(!!f.w.document.querySelector('[data-issue-action-draft]'),false);
 const choice=v.group.querySelector('select[aria-label="选择其他动作"]');
 choice.value='code-review';choice.dispatchEvent(new f.w.Event('change',{bubbles:true}));
 await f.until(()=>v.group.querySelector('[aria-label="比较基线"]'));
 assert.equal(v.group.querySelector('[aria-label="比较基线"]').value,'release/2','removing the editor retains previous context');
 assert.equal(v.group.querySelector('[aria-label="改动范围"]').value,'Approved changes');
 for(const options of [{project:'/project-b'},{number:11},{repo:'fixture/another'},{effortId:'other'},{backend:'markdown'}]) {
  const other=await f.menu(options);assert.equal(other.button('复制旧草稿原文'),undefined);
  assert.equal(other.group.querySelector('select[aria-label="选择其他动作"]').value,'');
 }
 v=await f.menu({detail:true});
 assert.equal(v.group.querySelector('select[aria-label="选择其他动作"]').value,'code-review');
 assert.equal(v.group.querySelector('[aria-label="比较基线"]').value,'release/2');
 v.button('填入当前聊天').click();await f.until(()=>f.writes.length===1);
 assert.match(f.writes[0].text,/^\$triage\n/,'saved supplemental choice never replaces the label primary');
 v.button('复制旧草稿原文').click();await f.until(()=>f.copies.length===1);
 assert.equal(f.copies[0],'Project A handwritten draft','current generation retains historical manual text');
 const baseline=v.group.querySelector('[aria-label="比较基线"]');
 baseline.value='';baseline.dispatchEvent(new f.w.Event('input',{bubbles:true}));
 await new Promise(r=>setTimeout(r,0));
 v=await f.menu();
 assert.equal(v.group.querySelector('[aria-label="比较基线"]').value,'','explicitly clearing current context takes precedence over legacy fields');
 console.log('PASS surviving legacy text/context and remembered choices stay isolated after editor removal');
} finally {f.close();}
