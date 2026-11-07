// Codex draft dispatch returns no created thread ID and exposes no session
// rename/event service. Do not register upstream watchers against guessed IDs.
export const NAMING_DISABLED_REASON = "Codex 未提供会话创建事件与改名服务；自动命名与 watcher 已关闭。交接仍通过草稿完成，请发送后手动命名聊天。";

export function namingCapability(method) {
  if (["namingPlan", "awaitCreatedIssue"].includes(method)) {
    return { ok: true, enabled: false, reason: NAMING_DISABLED_REASON,
      orders: [], tracked: [], failures: [], watching: false };
  }
  if (["namingRegister", "registerNewSessionWatcher", "namingSignal", "namingResult", "cancelNewSessionWatcher"].includes(method)) {
    return { ok: false, enabled: false,
      error: { kind: "unsupported", message: NAMING_DISABLED_REASON } };
  }
  return null;
}
