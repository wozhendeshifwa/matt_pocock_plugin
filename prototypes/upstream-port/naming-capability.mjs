// Codex draft dispatch returns no created thread ID and exposes no session
// rename/event service. Do not register upstream watchers against guessed IDs.
export const NAMING_DISABLED_REASON = "session-events-and-rename-unavailable";

export function namingDisabledText(language) {
  return String(language).startsWith("en")
    ? "Codex does not provide session creation events or renaming. Automatic naming and watchers are disabled. View, copy or cancel a manual naming suggestion below."
    : "Codex 未提供会话创建事件与改名服务；自动命名与 watcher 已关闭。可在下方查看、复制或取消手动命名建议。";
}

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
