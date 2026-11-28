import assert from 'node:assert/strict';
import { fixture } from './test-fixtures/sidebar-fixture.mjs';
import { contextRequest } from './context-requests.mjs';

for (const [id, values] of [['mapExecute', { url: 'https://github.com/fixture/repo/issues/10' }]]) {
  const text = contextRequest(id, values);
  assert.ok(text.includes('https://github.com/fixture/repo/issues/10'));
  assert.ok(text.includes('每批完成及结束前刷新'));
  assert.ok(text.includes('局部暂停只阻塞实际依赖它的工作'));
}
for (const values of [{ skill: '$wayfinder' }, { skill: 'wayfinder', related: 'https://github.com/fixture/repo/issues/20' }]) {
  const text = contextRequest('skill', values);
  assert.ok(text.startsWith('$wayfinder'));
  assert.ok(text.includes('关联来源仅供背景'));
  assert.ok(!text.includes('允许提交、推送和创建 PR'));
  assert.ok(!text.includes('请自主推进主线地图'));
}

for (const detail of [false, true]) {
  for (const target of ['active', 'new']) {
    const f = fixture();
    try {
      const view = await f.open({ labels: ['wayfinder:map'], detail });
      const button = view.button(target === 'active' ? '填入当前聊天' : '填入新聊天');
      button.focus();
      button.click();
      await f.until(() => f.w.document.querySelector('[data-map-mode-dialog]'));
      let dialog = f.w.document.querySelector('[data-map-mode-dialog]');
      assert.equal(f.writes.length, 0);
      assert.equal(dialog.querySelector('input:checked').value, 'autonomous');
      assert.equal(f.w.document.activeElement, dialog.querySelector('input:checked'));
      dialog.dispatchEvent(new f.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await f.until(() => !f.w.document.querySelector('[data-map-mode-dialog]'));
      assert.equal(f.writes.length, 0);
      assert.equal(f.w.document.activeElement, button);
      // Confirm the non-default choice, then reopen to verify a fresh default.
      for (const mode of ['interactive', 'autonomous']) {
        button.click();
        await f.until(() => f.w.document.querySelector('[data-map-mode-dialog]'));
        dialog = f.w.document.querySelector('[data-map-mode-dialog]');
        assert.equal(dialog.querySelector('input:checked').value, 'autonomous');
        dialog.querySelector('input[value="' + mode + '"]').click();
        await f.until(() => dialog.querySelector('input:checked').value === mode);
        const before = f.writes.length;
        [...dialog.querySelectorAll('button')].find(b => b.textContent === '确认填入').click();
        await f.until(() => f.writes.length === before + 1);
        await f.until(() => !button.disabled);
        const write = f.writes.at(-1);
        assert.equal(write.target, target);
        assert.ok(write.text.includes('https://github.com/fixture/repo/issues/10'));
        assert.ok(write.text.includes(mode === 'interactive' ? '按需交互：' : '完全自主、静默输入：'));
        assert.ok(!write.text.includes(mode === 'interactive' ? '完全自主、静默输入：' : '按需交互：'));
        assert.doesNotMatch(write.text, /\[[ x]\]|按勾选项执行/);
        assert.ok(write.text.includes('自主操控 Codex app'));
        for (const required of ['每批完成及结束前刷新', '可执行／执行中／真实受阻／用户明确暂停', '自己的认领不等于受阻', '局部暂停只阻塞实际依赖它的工作', '单次工具失败', '最小解除动作', '用户明确暂停整个努力']) {
          assert.ok(write.text.includes(required), 'map continuation contract missing: ' + required);
        }
        assert.equal(f.w.document.querySelector('[data-map-mode-dialog]'), null);
      }
    } finally { f.close(); }
  }
}

for (const labels of [['ready-for-agent'], ['wayfinder:task'], ['wayfinder:research'], ['wayfinder:map', 'wayfinder:task']]) {
  const f = fixture();
  try {
    const view = await f.open({ labels });
    view.button('填入当前聊天').click();
    await f.until(() => f.writes.length === 1);
    await f.until(() => f.w.document.querySelector('[data-draft-toast]')?.textContent.includes('已请求'));
    assert.equal(f.w.document.querySelector('[data-map-mode-dialog]'), null);
    await f.until(() => !view.button('填入新聊天').disabled);
    view.button('填入新聊天').click();
    await f.until(() => f.writes.length === 2);
    assert.equal(f.w.document.querySelector('[data-map-mode-dialog]'), null);
  } finally { f.close(); }
}

// Changing project while the choice is open must never write to either chat.
{
  const f = fixture();
  try {
    const view = await f.open({ labels: ['wayfinder:map'] });
    view.button('填入当前聊天').click();
    await f.until(() => f.w.document.querySelector('[data-map-mode-dialog]'));
    await f.open({ project: '/other-project', labels: ['needs-triage'] });
    assert.equal(f.w.document.querySelector('[data-map-mode-dialog]'), null);
    assert.equal(f.writes.length, 0);
  } finally { f.close(); }
}
console.log('PASS map mode dialog: list/detail, active/new, modes, cancel, scope and non-map isolation');
