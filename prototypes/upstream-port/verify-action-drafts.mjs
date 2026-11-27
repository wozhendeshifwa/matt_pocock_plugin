import assert from 'node:assert/strict';
import { fixture } from './test-fixtures/sidebar-fixture.mjs';
const f = fixture();
try {
 const original = 'Project A handwritten draft';
 await f.seed(original, { legacyContext: { scope: 'Approved changes', branch: 'codex/old', baseline: 'release/2' } });
 for (const options of [{}, { project: '/project-b' }, { number: 11 }, { repo: 'fixture/another' }, { effortId: 'other' }, { backend: 'markdown' }, { detail: true }]) {
  const v = await f.open(options);
  assert.equal(f.w.document.querySelector('[data-issue-action-draft]'), null);
  assert.ok(!v.button('更多动作'));
  for (const name of ['选择其他动作', '改动范围', '比较基线', '分支或 PR']) assert.equal(v.group.querySelector('[aria-label="' + name + '"]'), null);
 }
 const v = await f.open();
 v.button('填入当前聊天').click();
 await f.until(() => f.writes.length === 1);
 await f.until(() => v.group.querySelector('[role="status"]')?.textContent.includes('已请求填入'));
 assert.match(f.writes[0].text, /^\$triage\n/, 'surviving supplemental context does not replace the direct label-driven action');
 assert.doesNotMatch(f.writes[0].text, /Approved changes|codex\/old|release\/2/);
 assert.equal(await f.readLegacyText(), original);
 assert.equal(f.copies.length, 0);
 console.log('PASS retired More fields are absent and do not alter direct requests or surviving text');
} finally { f.close(); }
