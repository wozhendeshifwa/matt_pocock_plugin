// Native MCP draft requests append to the composer. An ACK is not a readback.
// New drafts use the host's project-aware deep link, not its global draft target.
export function createNativeDraftOutputs({ capabilities, getIdentity, readIdentity, request } = {}) {
  const supported = !!capabilities?.experimental?.['openai/message']?.draft;
  const projectLinks = !!capabilities?.openLinks;
  return {
    capabilities: Object.freeze({ nativeDraftRequest: supported, reliableDraft: false, active: supported, new: supported && projectLinks,
      reason: supported ? '' : '宿主未提供聊天草稿接口。',
      notice: supported ? '当前聊天追加并保留已有输入；新聊天按来源项目和目录打开并预填原文，均不会自动发送。' : '' }),
    async prefill(target, text) {
      if (!supported) throw new Error('宿主未提供聊天草稿接口。');
      if (!['active', 'new'].includes(target)) throw new Error('未知草稿出口，不会自动改投。');
      if (typeof text !== 'string') throw new Error('缺少可见草稿文本。');
      const expected = { ...getIdentity() };
      if (!expected.threadId || !expected.projectRoot) throw new Error('无法确认目标项目或聊天。');
      if (target === 'new' && (!projectLinks || !expected.projectId)) throw new Error('无法确认新聊天的来源项目或宿主项目链接能力。');
      const same = value => value?.threadId === expected.threadId && value?.projectRoot === expected.projectRoot && value?.projectId === expected.projectId;
      const active = await readIdentity();
      if (!same(active) || !same(getIdentity())) throw new Error('聊天或项目已切换，旧注入已停止；请重新确认目标。');
      let response;
      if (target === 'new') {
        const url = new URL('codex://new');
        url.search = new URLSearchParams({ mode: 'code', projectId: expected.projectId, path: expected.projectRoot, prompt: text }).toString();
        response = await request('ui/open-link', { url: url.href });
      } else {
        // No await between the final identity check and posting the draft request.
        response = await request('ui/message', { role: 'user', content: [{ type: 'text', text }], _meta: { 'openai/message': { target, send: false } } });
      }
      if (response?.isError) throw new Error('宿主拒绝了草稿请求；不会自动重试或改投。');
      // Opening a scoped new draft intentionally navigates away from the source.
      if (target === 'active' && !same(getIdentity())) throw new Error('聊天或项目已切换，请检查原目标输入框；不会自动重试。');
      return { status: 'requested', target };
    },
  };
}
