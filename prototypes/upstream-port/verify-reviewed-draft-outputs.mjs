import assert from 'node:assert/strict';
import {fixture} from './test-fixtures/sidebar-fixture.mjs';
for(const detail of [false,true]) {
 const f=fixture();f.controls.reliable=true;f.controls.receipt='filled';
 try {
  const v=await f.open({detail});
  for(const target of ['填入当前聊天','填入新聊天']) {
    v.button(target).click(); await f.until(()=>v.group.textContent.includes('已填入')); await f.until(()=>!v.button(target).disabled);
  }
  assert.equal(f.writes.length,2); const original=f.writes[0].text; assert.equal(f.writes[1].text,original);
  f.controls.body='changed irrelevant source body';f.setSource('B');
  v.button('填入当前聊天').click();await f.until(()=>f.writes.length===3);await f.until(()=>!v.button('填入当前聊天').disabled);
  assert.equal(f.writes[2].text,original,'plugin source observations are absent from the plain draft path');
  f.controls.receipt='unknown';v.button('填入当前聊天').click();await f.until(()=>v.group.textContent.includes('无法确认是否填入'));
  assert.equal(f.writes.length,4);assert.equal(f.copies.length,0);assert.equal(v.button('复制'),undefined);
  assert.equal(!!f.w.document.querySelector('[data-issue-action-preview]'),false);
 } finally {f.close()}
}
console.log('PASS honest reliable/requested/unknown feedback without plugin source preflight');
