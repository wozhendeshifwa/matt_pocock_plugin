// A request being accepted is not proof that an editable host draft was filled.
// The production MCP Apps transport currently supplies no reliable draft adapter.
// An adapter must atomically reject stale source identity/revision and honor the
// cancellation signal before mutation. readDraft returns {known,text,revision};
// writeDraft returns a verified editable, unsent receipt, never merely an ACK.
// Controlled adapters exercise that contract; they do not create native support.
export function createProtectedDraftOutputs({ getIdentity, readIdentity, subscribeIdentity, adapter, confirmReplace } = {}) {
  const reason = '宿主未提供可靠的草稿读取、目标锁定与结果确认；草稿已保留，请明确选择复制。';
  const reliable = adapter?.contract?.atomicTargetAndRevision === true && adapter?.contract?.confirmedDraft === true
    && typeof adapter.readDraft === 'function' && typeof adapter.writeDraft === 'function'
    && typeof getIdentity === 'function' && typeof readIdentity === 'function' && typeof subscribeIdentity === 'function';
  return {
    capabilities: Object.freeze({ reliableDraft: reliable, active: reliable, new: reliable, reason: reliable ? '' : reason }),
    async prefill(target, text) {
      if (!reliable) throw new Error(reason);
      if (!['active', 'new'].includes(target)) throw new Error('未知草稿出口，不会自动改投。');
      if (typeof text !== 'string') throw new Error('缺少可见草稿文本。');
      const expectedIdentity = Object.freeze({ ...getIdentity() });
      if (!expectedIdentity.projectRoot || !expectedIdentity.threadId) throw new Error('无法确认目标项目或聊天；操作已停止。');
      const controller = new AbortController();
      const { signal } = controller;
      const sameIdentity = identity => identity?.threadId === expectedIdentity.threadId && identity?.projectRoot === expectedIdentity.projectRoot;
      const invalidate = () => controller.abort(new Error('项目或目标聊天已切换，旧操作已停止；草稿已保留，请重新确认目标。'));
      const unsubscribe = subscribeIdentity(identity => { if (!sameIdentity(identity)) invalidate(); });
      const assertCurrent = async () => {
        signal.throwIfAborted();
        if (!sameIdentity(getIdentity()) || !sameIdentity(await readIdentity())) invalidate();
        if (!sameIdentity(getIdentity())) invalidate();
        signal.throwIfAborted();
      };
      try {
        await assertCurrent();
        const snapshot = await adapter.readDraft({ target, expectedIdentity, signal });
        await assertCurrent();
        if (snapshot?.known !== true || typeof snapshot.text !== 'string' || snapshot.revision == null) {
          throw new Error('无法可靠读取宿主输入或确认输入版本；草稿已保留，请明确选择复制。');
        }
        if (snapshot.text.length > 0 && (!confirmReplace || await confirmReplace({ target, existingText: snapshot.text, replacementText: text }) !== true)) {
          throw new Error('已取消替换；宿主原有输入及面板草稿已保留。');
        }
        await assertCurrent();
        const receipt = await adapter.writeDraft({ target, text, send: false, expectedIdentity, expectedRevision: snapshot.revision, signal });
        await assertCurrent();
        if (receipt?.confirmed !== true || receipt.target !== target || receipt.text !== text || receipt.editable !== true || receipt.send !== false
          || receipt.source?.threadId !== expectedIdentity.threadId || receipt.source?.projectRoot !== expectedIdentity.projectRoot
          || receipt.destination?.projectRoot !== expectedIdentity.projectRoot || !receipt.destination?.threadId
          || target === 'active' && receipt.destination.threadId !== expectedIdentity.threadId) {
          throw new Error('宿主草稿结果无法可靠确认；草稿已保留，不会自动重试或改投。');
        }
        return { status: 'filled', target, destination: receipt.destination };
      } finally { unsubscribe?.(); }
    },
  };
}
