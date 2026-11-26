// Native MCP draft requests append to the composer. An ACK is not a readback.
// Keep this transport separate from the optional atomic replacement adapter.
export function createNativeDraftOutputs({ capabilities, getIdentity, readIdentity, request } = {}) {
  const supported = !!capabilities?.experimental?.['openai/message']?.draft;
  return {
    capabilities: Object.freeze({ nativeDraftRequest: supported, reliableDraft: false, active: supported, new: supported,
      reason: supported ? '' : '宿主未提供聊天草稿接口。',
      notice: supported ? '当前聊天追加并保留已有输入，不会自动发送。新聊天项目由宿主当前选择决定，请核对／切换项目后发送；需要确保项目时，先在目标项目开空聊天再使用当前聊天出口。' : '' }),
    async prefill(target, text) {
      if (!supported) throw new Error('宿主未提供聊天草稿接口。');
      if (!['active', 'new'].includes(target)) throw new Error('未知草稿出口，不会自动改投。');
      if (typeof text !== 'string') throw new Error('缺少可见草稿文本。');
      const expected = { ...getIdentity() };
      if (!expected.threadId || !expected.projectRoot) throw new Error('无法确认目标项目或聊天。');
      const same = value => value?.threadId === expected.threadId && value?.projectRoot === expected.projectRoot;
      const active = await readIdentity();
      if (!same(active) || !same(getIdentity())) throw new Error('聊天或项目已切换，旧注入已停止；请重新确认目标。');
      // No await between the final identity check and posting the draft request.
      await request('ui/message', { role: 'user', content: [{ type: 'text', text }], _meta: { 'openai/message': { target, send: false } } });
      if (!same(getIdentity())) throw new Error('聊天或项目已切换，请检查原目标输入框；不会自动重试。');
      return { status: 'requested', target };
    },
  };
}
