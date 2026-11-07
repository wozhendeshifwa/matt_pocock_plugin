import * as React from "react";

export function ManualNaming({ connection, language }) {
  const en = String(language).startsWith("en");
  const [suggestions, setSuggestions] = React.useState(null);
  const [message, setMessage] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  async function run(method, payload = {}) {
    const result = await connection.rpc.call("/api", "dsws", { method, payload });
    if (!result?.value?.ok) throw new Error(result?.value?.error?.message ?? (en ? "Request failed" : "操作失败"));
    return result.value;
  }
  async function perform(action) {
    setBusy(true); setMessage("");
    try { await action(); } catch (error) { setMessage(String(error.message)); }
    finally { setBusy(false); }
  }
  return React.createElement("section", { className: "mattskills-note", "data-manual-naming": true },
    React.createElement("button", { type: "button", disabled: busy, onClick: () => perform(async () => {
      setSuggestions((await run("namingPlan")).suggestions ?? []);
    }) }, en ? "View naming suggestions" : "查看命名建议"),
    suggestions?.length === 0 ? React.createElement("p", null, en ? "No naming suggestions for this chat." : "当前聊天没有命名建议。") : null,
    suggestions?.map(item => React.createElement("div", { key: item.id },
      React.createElement("input", { readOnly: true, value: item.title, "aria-label": en ? "Suggested chat name" : "建议聊天名称", style: { width: "100%", boxSizing: "border-box" } }),
      item.issueKey ? React.createElement("p", null, (en ? "Created issue: #" : "对应已创建 Issue：#") + item.issueKey) : null,
      React.createElement("button", { type: "button", disabled: busy, onClick: () => perform(async () => {
        const current = (await run("namingPlan")).suggestions ?? [];
        if (!current.some(suggestion => suggestion.id === item.id)) {
          setSuggestions(current);
          setMessage(en ? "The chat or suggestion changed. Review the current suggestion." : "聊天或建议已变化，请查看当前建议。");
          return;
        }
        await navigator.clipboard.writeText(item.title);
        setMessage(en ? "Copied. Rename the chat manually." : "已复制，请手动修改聊天名称。");
      }) }, en ? "Copy name" : "复制名称"),
      React.createElement("button", { type: "button", disabled: busy, onClick: () => perform(async () => {
        await run("cancelNewSessionWatcher", { suggestionId: item.id });
        setSuggestions((await run("namingPlan")).suggestions ?? []);
      }) }, en ? "Cancel suggestion" : "取消建议"))),
    message ? React.createElement("p", { role: "status" }, message) : null);
}
