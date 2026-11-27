import assert from 'node:assert/strict';
import { fixture } from './test-fixtures/sidebar-fixture.mjs';

for (const detail of [false, true]) {
  const f = fixture();
  try {
    let view = await f.menu({ detail });
    assert.equal(view.button('复制旧草稿原文'), undefined, 'without surviving text there is no history-export action');
    const original = '$triage\n\n手写旧草稿，保留空格  \n旧规则路径：/old/reference\n🙂';
    await f.seed(original);
    f.setSource('changed-after-history');
    view = await f.menu({ detail });
    const copy = view.button('复制旧草稿原文');
    assert.ok(copy, 'more actions offers verbatim export for surviving legacy text');
    const observed = f.observations.length;
    copy.click();
    await f.until(() => f.copies.length === 1);
    assert.equal(f.copies[0], original, 'historical wording is copied byte-for-byte without source regeneration');
    assert.equal(f.observations.length, observed, 'historical export does not prepare or recheck a current request');
    assert.equal(f.writes.length, 0, 'history export never injects a host draft');
    assert.equal(f.w.document.querySelector('[data-issue-action-preview]'), null, 'recovering history does not mount the legacy editor');
    await f.until(() => view.group.textContent.includes('已复制旧草稿原文'));
    assert.doesNotMatch(view.group.textContent, /已核验|已填入/, 'history is not described as a current verified request');
  } finally { f.close(); }
}

{
  const f = fixture();
  let release;
  try {
    const original = '历史手写文本\n不要重新生成\n  ';
    await f.seed(original);
    let view = await f.menu();
    view.button('填入当前聊天').click();
    await f.until(() => f.writes.length === 1);
    await f.until(() => !view.button('填入当前聊天').disabled);
    view.button('复制').click();
    await f.until(() => f.copies.length === 1);
    assert.equal(f.copies[0], f.writes[0].text, 'normal copy uses the current generated request');
    assert.notEqual(f.copies[0], original);
    await f.until(() => !view.button('填入当前聊天').disabled);
    view.button('复制旧草稿原文').click();
    await f.until(() => f.copies.length === 2);
    assert.equal(f.copies[1], original, 'generating and copying a current request never overwrites history');
    await f.until(() => !view.button('复制旧草稿原文').disabled);
    f.failCopy(true);
    view.button('复制旧草稿原文').click();
    await f.until(() => view.group.textContent.includes('clipboard unavailable'));
    assert.equal(f.copies.length, 2, 'a failed copy is not retried or redirected');
    assert.equal(f.writes.length, 1);
    f.failCopy(false);
    view.button('复制旧草稿原文').click();
    await f.until(() => f.copies.length === 3);
    assert.equal(f.copies[2], original, 'failure preserves the exact historical text for a deliberate retry');

    const delay = new Promise(resolve => { release = resolve; });
    f.delayHost(delay);
    view.button('填入当前聊天').click();
    await f.until(() => f.writes.length === 2);
    assert.equal(view.button('填入当前聊天').disabled, true);
    assert.equal(view.button('复制旧草稿原文').disabled, false, 'deliberate historical copying stays available while injection waits');
    view.button('复制旧草稿原文').click();
    await f.until(() => f.copies.length === 4);
    assert.equal(f.copies[3], original);
    release();
    await f.until(() => !view.button('填入当前聊天').disabled);

    for (const options of [{ number: 11 }, { project: '/legacy-b' }, { repo: 'fixture/another' }, { backend: 'markdown' }, { effortId: 'other-effort' }]) {
      view = await f.menu(options);
      assert.equal(view.button('复制旧草稿原文'), undefined, 'another Issue/project/repository/backend/effort has no access to this history');
    }
    view = await f.menu({ detail: true });
    view.button('复制旧草稿原文').click();
    await f.until(() => f.copies.length === 5);
    assert.equal(f.copies[4], original, 'returning in a new chat for the same project and Issue preserves history');
    await f.seed('');
    view = await f.menu();
    assert.equal(view.button('复制旧草稿原文'), undefined, 'an explicitly empty legacy draft does not invent historical content');
  } finally { release?.(); f.close(); }
}
console.log('PASS verbatim legacy draft export through production more actions');
