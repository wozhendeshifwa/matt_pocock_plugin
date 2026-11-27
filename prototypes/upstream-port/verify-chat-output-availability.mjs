import assert from 'node:assert/strict';
import { fixture } from './test-fixtures/sidebar-fixture.mjs';
for (const native of [false,true]) for (const detail of [false,true]) {
 const f=fixture();f.controls.native=native;
 try {
  const view=await f.open({detail});
  for(const text of ['填入当前聊天','填入新聊天']) {
   assert.equal(view.button(text).disabled,!native);
   if(!native) assert.match(view.button(text).title,/宿主能力暂不可用/);
  }
  assert.equal(f.writes.length,0);assert.equal(f.copies.length,0);
  view.button('复制').click();await f.until(()=>f.copies.length===1);
  assert.match(f.copies[0],/rules\/stable/);assert.equal(f.writes.length,0);
  if(native) for(const [text,target] of [['填入当前聊天','active'],['填入新聊天','new']]) {
   view.button(text).click();await f.until(()=>f.writes.at(-1)?.target===target);
   await f.until(()=>view.group.textContent.includes('已请求'));
   await f.until(()=>!view.button(text).disabled);
   assert.equal(f.writes.at(-1).text,f.copies[0]);
   assert.doesNotMatch(view.group.textContent,/已填入当前聊天|已填入新聊天/);
  }
  assert.equal(!!f.w.document.querySelector('[data-issue-action-preview]'),false);
 } finally {f.close();}
}
console.log('PASS direct capability availability, deliberate copy and truthful requested status');
