// Codex 面板数据适配：把宿主原生依赖边的票号压成面板地图详情比较所需的数字。
//
// 为什么需要这一层（#16 诊断结论）：vendor 1.8.0-rc.7 的 GitHub 快照把阻塞边压成
// 「键字符串」（src/host/sessionSnapshot.js：#691 之后 effort 维度按「工作单元 + 键」查），
// 但地图详情的旧视图代码仍拿数字票号做严格比较：
//   x.number === b            （MapDetail.isFog / TicketRow.openBlocker / blockerNames）
// 字符串键永远对不上数字票号，于是被阻塞的子票在地图页里既不显示「被阻塞」，也不进迷雾、
// 也不抑制动作按钮 —— 原生依赖读了却没用上。effort 感知的新代码走 refKeyOf，两种形状都认，
// 所以把「纯数字键」还原成数字是两种口径的交集，且不动上游文件。
//
// 边界：只处理面板读取（snapshot / refresh / mapTickets）的返回值；非数字键（Markdown 后端的
// '00' 这类）原样保留。票号以外的字段一概不碰。
const PANEL_METHODS = new Set(["snapshot", "refresh", "mapTickets"]);
const NUMERIC_KEY = /^\d+$/;

function normalizeBlockerRef(ref) {
  return (typeof ref === "string" && NUMERIC_KEY.test(ref)) ? Number(ref) : ref;
}

function normalizeTicket(ticket) {
  if (!ticket || typeof ticket !== "object" || !Array.isArray(ticket.blockedBy)) return;
  ticket.blockedBy = ticket.blockedBy.map(normalizeBlockerRef);
}

export function normalizePanelPayload(method, envelope) {
  if (!PANEL_METHODS.has(method) || !envelope || envelope.ok !== true || !envelope.value || typeof envelope.value !== "object") return envelope;
  const value = envelope.value;
  if (Array.isArray(value.issues)) value.issues.forEach(normalizeTicket);
  if (Array.isArray(value.maps)) value.maps.forEach(map => { if (Array.isArray(map?.tickets)) map.tickets.forEach(normalizeTicket); });
  if (Array.isArray(value.items)) value.items.forEach(normalizeTicket);
  return envelope;
}
