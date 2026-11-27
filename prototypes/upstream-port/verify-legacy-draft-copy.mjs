import assert from 'node:assert/strict';
import { fixture } from './test-fixtures/sidebar-fixture.mjs';

for (const detail of [false, true]) {
  const f = fixture();
  try {
    const original = '$triage\n\n手写旧草稿，保留空格  \n🙂';
    await f.seed(original);
    const view = await f.open({ detail });
    assert.ok(!view.button('更多动作'));
    assert.ok(!view.button('复制旧草稿原文'), 'retired More does not leave a history-export button');
    assert.equal(view.group.querySelector('[data-issue-action-preview]'), null);
    view.button('填入当前聊天').click();
    await f.until(() => f.writes.length === 1);
    await f.until(() => view.group.querySelector('[role="status"]')?.textContent.includes('已请求填入'));
    assert.equal(f.copies.length, 0);
    assert.equal(await f.readLegacyText(), original, 'removing More and using a direct outlet does not clear surviving user text');
  } finally { f.close(); }
}
console.log('PASS More removal preserves surviving historical user text without exporting it');
