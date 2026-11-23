(() => {
  const bar = document.createElement('div');
  bar.style.cssText = 'padding:8px 12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;background:var(--background,Canvas);color:var(--foreground,CanvasText);font:13px system-ui;border-bottom:1px solid var(--border,#8885)';
  const label = document.createElement('label');
  label.textContent = 'GitHub 仓库 ';
  const select = document.createElement('select');
  select.setAttribute('aria-label', '选择 GitHub 仓库');
  label.append(select);
  const status = document.createElement('span');
  status.setAttribute('role', 'status');
  bar.append(label, status);
  document.body.prepend(bar);
  let sequence = 0;
  const pending = new Map();
  function call(name, args = {}) {
    return new Promise((resolve, reject) => {
      const id = 'cloud-repository-' + ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('仓库请求超时')); }, 45000);
      pending.set(id, { resolve, reject, timer });
      parent.postMessage({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }, '*');
    });
  }
  window.addEventListener('message', event => {
    if (event.source !== parent || event.data?.jsonrpc !== '2.0') return;
    const item = pending.get(event.data.id);
    if (!item) return;
    pending.delete(event.data.id);
    clearTimeout(item.timer);
    const reply = event.data.result;
    if (event.data.error || reply?.isError) item.reject(new Error(event.data.error?.message ?? reply.content?.[0]?.text ?? '请求失败'));
    else item.resolve(reply?.structuredContent ?? JSON.parse(reply?.content?.[0]?.text ?? '{}'));
  });
  async function load() {
    const data = await call('deck_repository_list');
    select.replaceChildren(new Option('请选择仓库', ''), ...data.repositories.map(repo => new Option(repo, repo)));
    select.value = data.selected ?? '';
    status.textContent = data.githubWrites ? '云端模式 · 本机 Git 和桌面操作不可用' : '云端只读模式 · 本机 Git 和桌面操作不可用';
  }
  select.addEventListener('change', async () => {
    if (!select.value) return;
    select.disabled = true;
    status.textContent = '正在连接 GitHub…';
    try { await call('deck_repository_select', { repository: select.value }); await load(); }
    catch (error) { status.textContent = error.message; }
    finally { select.disabled = false; }
  });
  // Wait for the original bridge to complete the MCP Apps handshake.
  const timer = setInterval(() => {
    if (!window.MattSkillsCodex?.hostInitialization) return;
    clearInterval(timer);
    void load().catch(error => { status.textContent = error.message; });
  }, 100);
  setTimeout(() => clearInterval(timer), 60000);
})();
