import { build } from "esbuild";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { adaptCommentPagination } from "./comment-pagination-client.mjs";
import { adaptSkillPrefixes } from "./skill-prefix-client.mjs";
import { adaptIssueActions } from "./issue-actions-client.mjs";
import { adaptContextRequests } from "./context-request-client.mjs";
import { adaptSkillSourceDisplay } from "./skill-source-client.mjs";
import { adaptBottomActionBar } from "./bottom-action-bar-client.mjs";
import { adaptSkillPreparation } from "./skill-preparation-client.mjs";

const runtime = await build({
  entryPoints: [new URL("browser-runtime.mjs", import.meta.url).pathname.replace(/^\/(\w:)/, "$1")],
  bundle: true, write: false, format: "iife", platform: "browser",
  define: { "process.env.NODE_ENV": '"production"' },
  minify: true, legalComments: "inline",
});
const original = await readFile(new URL("../../vendor/mattskills-1.8.0-rc.7/lib/client.js", import.meta.url), "utf8");
let adapted = adaptCommentPagination(original.replace(/\r\n/g, '\n'));
const sandboxAnchor = '      const hasIssueDetail = topIssue !== null && topIssue !== undefined';
if (adapted.split(sandboxAnchor).length !== 2) throw new Error('Issue selection boundary changed');
adapted = adapted.replace(sandboxAnchor, sandboxAnchor + `
      React.useEffect(function () {
        const sandbox = ctx.get('sandboxTasks');
        if (sandbox) sandbox.setCurrentIssue(hasIssueDetail ? { number: topIssue, effortId: topEffort } : null);
      }, [topIssue, topEffort, hasIssueDetail]);
`);
const skillNames = (await readdir(new URL("../../vendor/mattskills-1.8.0-rc.7/bundled-skills/", import.meta.url), { withFileTypes: true }))
  .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
adapted = adaptSkillPrefixes(adapted, skillNames);
adapted = adaptContextRequests(adapted);
adapted = adaptSkillSourceDisplay(adapted);
adapted = adaptIssueActions(adapted);
adapted = adaptBottomActionBar(adapted);
for (const [anchor, target] of [
  ["const inject = (st, text) => {", "active"],
  ["const openTextInNewSession = function (st, text, title, opts) {", "new"],
]) {
  if (adapted.split(anchor).length !== 2) throw new Error("Upstream action boundary changed: " + anchor);
  adapted = adapted.replace(anchor, anchor + `
      const codexActions = ctx.get('codexActions');
      if (codexActions) {
        Promise.resolve().then(() => codexActions.prefill(${JSON.stringify(target)}, text))
          .then(() => flash(st, tr('toast.injected'), 'ok'))
          .catch(error => flash(st, String(error && error.message || error), 'warn'));
        return;
      }
  `);
}
adapted = adaptSkillPreparation(adapted);
const cacheAnchor = 'const diskGetSnapshot = function (k) {';
// Expose the existing two-step handoff on the board, without duplicating its
// document resolution or host draft routing in a second implementation.
const boardAnchor = "          // 这一行右侧两个各自独立的控件";
if (adapted.split(boardAnchor).length !== 2) throw new Error('Upstream board action boundary changed');
adapted = adapted.replace(boardAnchor, "          h(CodexBoardActions, { key: 'actions', sessionId: sid }),\n" + boardAnchor);
const boardComponentAnchor = 'const DeckSidebarTab = function (props) {';
if (adapted.split(boardComponentAnchor).length !== 2) throw new Error('Upstream board component boundary changed');
adapted = adapted.replace(boardComponentAnchor, `const CodexBoardActions = function (props) {
      const st = useStore(props.sessionId)
      const en = tr('nav.handoff') === 'Handoff'
      return h('div', { className: 'mattskills-board-actions', role: 'group', 'aria-label': en ? 'Chat actions' : '聊天操作' }, [
        h('button', { key: 'fixate', type: 'button', className: 'dsws-btn', 'data-board-action': 'fixate', 'aria-label': tr('nav.word'), title: tr('nav.fixateTitle'), onClick: function () { injectFixate(st) } }, Ic({ n: 'note', size: 14 })),
        h('button', { key: 'handoff', type: 'button', className: 'dsws-btn', 'data-board-action': 'handoff', 'aria-label': tr('nav.handoff'), title: tr('nav.handoffTitle'), onClick: function () { doHandoff(st) } }, Ic({ n: 'handoff', size: 14 })),
        h('button', { key: 'new', type: 'button', className: 'dsws-btn', 'data-board-action': 'new', 'aria-label': en ? 'New chat' : '开新对话', disabled: !!st.handoffSearching, title: st.handoffReady ? tr('nav.handoffReadyTitle') : tr('nav.handoffGreyTitle'), onClick: function () { doHandoffOpen(st) } }, Ic({ n: 'external-link', size: 14 }))
      ])
    }
    ` + boardComponentAnchor);
if (adapted.split(cacheAnchor).length !== 2) throw new Error('Upstream snapshot hydration boundary changed');
adapted = adapted.replace(cacheAnchor, cacheAnchor + `
      const snapshotCache = ctx.get('snapshotCache');
      if (snapshotCache) return snapshotCache.get(k);
`);
// A cached first paint can commit before the passive store subscription. Catch
// an update delivered in that gap instead of leaving the old rows on screen.
const subscriptionAnchor = 'React.useEffect(() => sub(st, (n) => set(n)), [st])';
if (adapted.split(subscriptionAnchor).length !== 2) throw new Error('Upstream store subscription boundary changed');
adapted = adapted.replace(subscriptionAnchor, 'React.useEffect(() => { const off = sub(st, (n) => set(n)); set(st.tick); return off }, [st])');
const outIndex = process.argv.indexOf('--outdir');
if (outIndex >= 0 && !process.argv[outIndex + 1]) throw new Error('--outdir needs a directory');
const output = outIndex >= 0 ? pathToFileURL(path.resolve(process.argv[outIndex + 1]) + path.sep) : new URL("dist/", import.meta.url);
await mkdir(output, { recursive: true });
// Adapt host actions, cache hydration and comment pagination. Keep the remaining
// renderer and its eventual fresh snapshot response intact.
await writeFile(new URL("client.js", output), runtime.outputFiles[0].text + "\n;\n" + adapted);
await writeFile(new URL("manifest.json", output), JSON.stringify({
  upstreamVersion: "1.8.0-rc.7",
  upstreamClientSha256: createHash("sha256").update(original).digest("hex"),
  output: "client.js",
  adaptedBoundaries: ["inject", "openTextInNewSession", "diskGetSnapshot", "useStore.subscription", "DetailsDock.headerActions", "comments.pagination", "skills.dollarPrefix", "issueActions.scenarioDraft", "context.requests.v2", "skills.sourceDisplay", "skills.beforeUse", "issueActions.bottomBar"],
}, null, 2) + "\n");
console.log("Built original MattSkills client with Codex mounting adapter");
