import assert from 'node:assert/strict';
import { fixture } from './test-fixtures/sidebar-fixture.mjs';
async function scenario(labels, expected, detail = false) {
  const f = fixture();
  try {
    const view = await f.open({ labels, detail });
    assert.equal(f.writes.length,0);assert.equal(f.copies.length,0);
    assert.doesNotMatch(f.w.document.body.textContent,/旧草稿预览|选择动作／预览|重新核验技能来源/);
    assert.equal(!!f.w.document.querySelector('textarea[data-issue-action-draft]'),false);
    view.button('填入当前聊天').click();await f.until(()=>f.writes.length===1);
    await f.until(()=>f.w.document.querySelector('[data-draft-toast]')?.textContent.includes('已请求'));
    await f.until(()=>!view.button('填入当前聊天').disabled);
    view.button('填入新聊天').click();await f.until(()=>f.writes.length===2);
    for (const pattern of expected) assert.match(f.writes[0].text,pattern);
    assert.match(f.writes[0].text,/deck_issue_report/);
    assert.equal(f.writes[0].text,f.writes[1].text);
    assert.equal(f.copies.length,0);
    assert.equal(f.writes[0].target,'active');assert.equal(f.writes[1].target,'new');
  } finally { f.close(); }
}
await scenario(['needs-info', 'bug'], [/查证/, /\$grilling/, /补齐前不实施/]);
await scenario(['wontfix', 'bug'], [/保持不做边界/, /只有用户明确要求重新评估/]);
await scenario(['bug', 'wayfinder:research'], [/^\$research/, /不触发自动修复/]);
await scenario(['bug', 'wayfinder:grilling'], [/^\$grill-with-docs/, /人来定夺/]);
await scenario(['wayfinder:prototype'], [/^\$prototype/, /用户反馈/]);
await scenario(['needs-info', 'ready-for-agent', 'bug'], [/Agent 依据最新现状与证据自主选择/, /不使用固定优先级/]);
await scenario(['wayfinder:research', 'wayfinder:prototype'], [/Agent 依据最新现状与证据自主选择/]);
await scenario(['wayfinder:map', 'wayfinder:task'], [/先查证，再请用户确认/, /确认前不实施/]);
await scenario(['wayfinder:task', 'wayfinder:research'], [/类型冲突/, /确认前不实施/]);
await scenario(['ready-for-agent', 'wayfinder:task'], [/\$implement-spec/, /缺规格先 \$to-spec/, /缺实施票先 \$to-tickets/, /非代码任务/]);
await scenario(['bug'], [/^\$diagnosing-bugs/, /缺明确就绪状态/, /不直接代码实施/]);
await scenario(['ready-for-human', 'bug'], [/必要人工步骤的原因及验证点/, /仅适合交互脚本引导时才用 \$wizard/]);
await scenario(['needs-triage', 'unrelated'], [/^\$triage/, /先用 \$triage 诊断/]);
await scenario([], [/^\$triage/, /无标签/, /不默认实施/]);
await scenario(['unrecognized'], [/^\$triage/, /不默认实施/]);
await scenario(['ready-for-agent', 'bug'], [/^\$diagnosing-bugs/, /\$implement-spec/], true);
await scenario(['ready-for-agent', 'bug', 'wayfinder:task'], [/缺规格先 \$to-spec/, /缺实施票先 \$to-tickets/, /只补缺项并复用有效产物/]);
for (const detail of [false,true]) await scenario(['wayfinder:map','wayfinder:task'],[/先查证，再请用户确认/,/确认前不实施/],detail);
console.log('PASS label policy through production list/detail direct outlets');
