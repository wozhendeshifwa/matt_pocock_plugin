import { build } from "esbuild";
import { readFile, mkdir, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";

import { adaptSkillPrefixes } from "./skill-prefix-client.mjs";
import { adaptContextRequests } from "./context-request-client.mjs";
import { adaptSkillSourceDisplay } from "./skill-source-client.mjs";
import { adaptIssueActions } from "./issue-actions-client.mjs";
import { adaptBottomActionBar } from "./bottom-action-bar-client.mjs";
import { adaptSkillPreparation } from "./skill-preparation-client.mjs";

const runtime = await build({
  entryPoints: [new URL("browser-runtime.mjs", import.meta.url).pathname.replace(/^\/(\w:)/, "$1")],
  bundle: true, write: false, format: "iife", platform: "browser",
  define: { "process.env.NODE_ENV": '"production"' },
  minify: true, legalComments: "inline",
});
const original = await readFile(new URL("../../vendor/mattskills-1.8.0-rc.7/lib/client.js", import.meta.url), "utf8");
let adapted = original.replace(/\r\n/g, '\n');
const skillNames = (await readdir(new URL('../../vendor/mattskills-1.8.0-rc.7/bundled-skills/', import.meta.url), { withFileTypes: true }))
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
const output = new URL("dist/", import.meta.url);
await mkdir(output, { recursive: true });
// Adapt host actions, reviewed request drafts and skill sources without modifying vendor files.
await writeFile(new URL("client.js", output), runtime.outputFiles[0].text + "\n;\n" + adapted);
await writeFile(new URL("manifest.json", output), JSON.stringify({
  upstreamVersion: "1.8.0-rc.7",
  upstreamClientSha256: createHash("sha256").update(original).digest("hex"),
  output: "client.js",
  adaptedBoundaries: ["inject", "openTextInNewSession", "skills.dollarPrefix", "issueActions.scenarioDraft", "context.requests.v2", "skills.sourceDisplay", "skills.beforeUse", "issueActions.bottomBar"],
}, null, 2) + "\n");
console.log("Built original MattSkills client with Codex mounting adapter");
