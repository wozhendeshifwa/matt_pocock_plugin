import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { JSDOM, VirtualConsole } from "jsdom";

// Called by the integration fixture with a real host and local bare remote.
export async function verifyGitWriteUi({ host, project, git, remote }) {
  await writeFile(path.join(project, "ui.txt"), "from the original UI\n");
  const dom = new JSDOM('<main id="root"></main>', { url: "https://adapter.invalid", runScripts: "outside-only", pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
  const { window } = dom;
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.eval(await readFile(new URL("dist/client.js", import.meta.url), "utf8"));
  const session = { id: "fixture", cwd: project };
  const calls = [];
  const dispose = window.MattSkillsCodex.mount(window.document.getElementById("root"), {
    connection: { rpc: { async call(channel, endpoint, request) {
      calls.push(request.method);
      if (request.method === "selection") return { ok: true, value: { ok: true, selection: { backendId: "github", source: "explicit" } } };
      if (["snapshot", "refresh"].includes(request.method)) return { ok: true, value: {
        ok: true, workspaceRoot: project, repoRoot: project, issues: [], maps: [], labels: [],
        repository: { backend: "github", refId: "fixture/repo", name: "fixture/repo", url: "https://github.com/fixture/repo" },
        repo: { owner: "fixture", name: "repo" },
        selection: { backendId: "github", source: "explicit" }, generatedMs: Date.now(),
      } };
      return host.call(request.method, request.payload ?? {});
    } } },
  }, { sessionId: session.id, session, useSessions: f => f({ current: session.id, byId: { [session.id]: session }, items: [session] }) });
  const select = s => window.document.querySelector(s);
  async function until(f) {
    const end = Date.now() + 20000;
    while (Date.now() < end) { if (f()) return; await new Promise(r => setTimeout(r, 30)); }
    assert.fail(JSON.stringify(calls.slice(-20)) + "\n" + window.document.getElementById("root").textContent.slice(0, 1500));
  }
  try {
    const tab = () => [...window.document.querySelectorAll("button")].find(b => b.textContent.trim() === "版本管理");
    await until(tab); tab().click();
    await until(() => select("[data-vc-stage-all]"));
    select("[data-vc-stage-all]").click();
    await until(() => calls.includes("gitStage") && select("[data-vc-commit-msg]"));
    const input = select("[data-vc-commit-msg]");
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, "UI adapter commit");
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    await until(() => !select("[data-vc-commit-btn]").disabled);
    select("[data-vc-commit-btn]").click();
    await until(() => calls.includes("gitCommit") && select('[data-vc-op-result="done"]'));
    assert.equal(git(project, "log", "-1", "--format=%s"), "UI adapter commit");
    await until(() => select('[data-vc-action="push"]') && !select('[data-vc-action="push"]').disabled);
    const pushes = () => calls.filter(m => m === "gitPush").length;
    select('[data-vc-action="push"]').click();
    await until(() => select('[data-vc-confirm="push"]'));
    assert.equal(pushes(), 0, "preflight must not push before confirmation");
    select("[data-vc-confirm-cancel]").click();
    await until(() => !select("[data-vc-confirm]"));
    assert.equal(pushes(), 0);
    select('[data-vc-action="push"]').click();
    await until(() => select('[data-vc-confirm="push"]'));
    select("[data-vc-confirm-ok]").click();
    await until(() => pushes() === 1 && select('[data-vc-op-result="done"]') && !select("[data-vc-running]"));
    assert.equal(git(project, "rev-parse", "HEAD"), git(project, "--git-dir", remote, "rev-parse", "refs/heads/test-write"));
    assert.ok(calls.filter(m => m === "gitStatus").length >= 3, "write completion refreshes real status");
    console.log("PASS original UI stage/commit, push cancel/confirm and post-write refresh -> real git");
  } finally { dispose(); window.close(); }
}
