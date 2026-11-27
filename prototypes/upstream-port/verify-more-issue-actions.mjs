import assert from 'node:assert/strict';
import { fixture } from './test-fixtures/sidebar-fixture.mjs';

for (const detail of [false, true]) {
  const f = fixture();
  try {
    const view = await f.open({ detail });
    assert.ok(!view.button('更多动作'), 'More is removed from the production header and Issue actions');
    assert.equal(view.group.querySelector('[aria-label="选择其他动作"]'), null);
    assert.equal(view.button('复制旧草稿原文'), undefined);
    assert.equal(view.group.querySelector('[data-issue-action-preview]'), null);
    view.button('填入当前聊天').click();
    await f.until(() => f.writes.length === 1);
    await f.until(() => view.group.querySelector('[role="status"]')?.textContent.includes('已请求填入'));
    await f.until(() => !view.button('填入当前聊天').disabled);
    assert.equal(f.writes[0].target, 'active');
    assert.match(f.writes[0].text, /^\$triage\n/);
    view.button('填入新聊天').click();
    await f.until(() => f.writes.length === 2);
    await f.until(() => !view.button('填入当前聊天').disabled);
    assert.equal(f.writes[1].target, 'new');
    assert.equal(f.writes[1].text, f.writes[0].text);
    assert.equal(f.copies.length, 0);
    assert.ok(!view.button('更多动作'));
  } finally { f.close(); }
}
console.log('PASS production sidebar without More retains both direct outlets');



