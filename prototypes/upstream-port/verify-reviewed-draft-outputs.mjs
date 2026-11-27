import assert from 'node:assert/strict';
import { fixture } from './test-fixtures/sidebar-fixture.mjs';
for(const detail of [false,true]) {
 const f=fixture();f.controls.reliable=true;f.controls.receipt='filled';
 try {
  const v=await f.open({detail});
  v.button('填入当前聊天').click();await f.until(()=>f.writes.length===1);
  await f.until(()=>v.group.textContent.includes('已填入当前聊天'));
  await f.until(()=>!v.button('填入当前聊天').disabled);
  v.button('填入新聊天').click();await f.until(()=>f.writes.length===2);
  await f.until(()=>v.group.textContent.includes('已填入新聊天'));
  await f.until(()=>!v.button('填入新聊天').disabled);
  const original=f.writes[0].text;assert.equal(f.writes[1].text,original);
  f.controls.body='changed body at same path';
  v.button('复制').click();await f.until(()=>v.group.textContent.includes('复制已停止'));
  assert.equal(f.copies.length,0,'source body drift stops copy even when its path is unchanged');
  for(const text of ['填入当前聊天','填入新聊天']) {
   v.button(text).click();await f.until(()=>v.group.textContent.includes('来源或必要条件已变化'));
   await f.until(()=>!v.button(text).disabled);
  }
  assert.equal(f.writes.length,2,'changed sources stop both host outlets');
  const regenerate=v.button('按最新来源重新生成并填入');assert.ok(regenerate);regenerate.click();
  await f.until(()=>f.writes.length===3);await f.until(()=>!v.button('填入新聊天').disabled);
  assert.equal(f.writes[2].target,'new');
  f.setSource('B');v.button('填入当前聊天').click();
  await f.until(()=>v.group.textContent.includes('来源或必要条件已变化'));
  await f.until(()=>!v.button('填入当前聊天').disabled);
  v.button('按最新来源重新生成并填入').click();await f.until(()=>f.writes.length===4);
  await f.until(()=>!v.button('填入当前聊天').disabled);
  assert.match(f.writes[3].text,/rules\/B/);assert.doesNotMatch(f.writes[3].text,/rules\/stable/);
  f.controls.receipt='unknown';v.button('填入当前聊天').click();await f.until(()=>f.writes.length===5);
  await f.until(()=>v.group.textContent.includes('无法确认是否填入'));
  assert.doesNotMatch(v.group.textContent,/已填入当前聊天/);
  v.button('复制').click();await f.until(()=>f.copies.length===1);
  assert.equal(f.copies[0],f.writes.at(-1).text,'unknown output offers the exact retained generated text');
  assert.equal(f.writes.length,5,'copy does not repeat the host request');
  assert.equal(!!f.w.document.querySelector('[data-issue-action-preview]'),false);
 } finally {f.close();}
}
console.log('PASS reliable receipts, changed source bodies/paths and unknown-result exact copy through direct outlets');
