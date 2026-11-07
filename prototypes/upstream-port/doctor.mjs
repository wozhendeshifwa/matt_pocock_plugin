import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  adapterRoot,
  configPathFor,
  defaultServerName,
  inspectConfig,
  inspectRuntime,
  printChecks,
  readConfigText,
  repoRoot,
  resolveCodexHome,
  serverScript,
  summarize,
} from "./install.mjs";

function parseArgs(argv) {
  const options = {
    github: false,
    json: false,
    codexHome: resolveCodexHome(),
    serverName: defaultServerName,
    help: false,
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--github") options.github = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--codex-home") options.codexHome = path.resolve(argv[++index]);
    else if (arg === "--server-name") options.serverName = argv[++index];
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function help() {
  console.log(`Usage: node doctor.mjs [options]

  --github               Also read the real GitHub repository through the MCP server.
  --json                 Print the report as JSON.
  --codex-home <dir>     Codex home to inspect (default: CODEX_HOME or ~/.codex).
  --server-name <name>   MCP server table name (default: ${defaultServerName}).
  --help                 Show this help.`);
}

function rpcClient(child) {
  const pending = new Map();
  let sequence = 0;
  const lines = createInterface({ input: child.stdout });
  lines.on("line", line => {
    let response;
    try { response = JSON.parse(line); } catch { return; }
    const entry = pending.get(response.id);
    if (!entry) return;
    pending.delete(response.id);
    clearTimeout(entry.timer);
    if (response.error) entry.reject(new Error(response.error.message));
    else entry.resolve(response.result);
  });
  return {
    request(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`MCP request timed out: ${method}`));
        }, 60000);
        pending.set(id, { resolve, reject, timer });
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      });
    },
    close() {
      for (const { timer } of pending.values()) clearTimeout(timer);
      pending.clear();
    },
  };
}

async function smokeTest({ github = false, serverName = defaultServerName } = {}) {
  const checks = [];
  const add = (name, ok, detail, fix) => checks.push({ name, ok, detail, fix });
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "mattskills-doctor-"));
  const threadId = "22222222-2222-4222-8222-222222222222";
  const sessionDir = path.join(codexHome, "sessions", "2026", "11", "07");
  await mkdir(sessionDir, { recursive: true });
  await writeFile(path.join(sessionDir, "rollout-test-" + threadId + ".jsonl"), JSON.stringify({
    type: "session_meta",
    payload: { id: threadId, cwd: repoRoot },
  }) + "\n");
  const child = spawn(process.execPath, [serverScript], {
    cwd: adapterRoot,
    env: { ...process.env, CODEX_HOME: codexHome },
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk; });
  const rpc = rpcClient(child);
  const metadata = { thread_id: threadId, threadId };
  try {
    const initialized = await rpc.request("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "mattskills-doctor", version: "1" },
    });
    add("MCP initialize", initialized?.serverInfo?.name === "deck-sidebar-probe",
      initialized?.serverInfo ? `${initialized.serverInfo.name} ${initialized.serverInfo.version}` : "no serverInfo",
      `node install.mjs --apply --server-name ${serverName}`);
    add("MCP tools capability", Boolean(initialized?.capabilities?.tools), "tools advertised", "Fix sidebar-server.mjs");
    const listed = await rpc.request("tools/list", {});
    const names = new Set((listed.tools ?? []).map(tool => tool.name));
    for (const name of ["open_deck_sidebar_probe", "deck_current_project", "deck_upstream_read", "deck_host_context_probe", "deck_rpc_manifest"]) {
      add(`MCP tool ${name}`, names.has(name), names.has(name) ? "listed" : "missing", "Fix sidebar-server.mjs");
    }
    const manifestResponse = await rpc.request("tools/call", {
      name: "deck_rpc_manifest",
      arguments: {},
      _meta: {},
    });
    const manifest = manifestResponse?.structuredContent ?? JSON.parse(manifestResponse?.content?.[0]?.text ?? "{}");
    add("RPC endpoint manifest",
      manifest.read?.length === 30 && manifest.write?.length === 26 && manifest.upstream?.length === 56,
      `read=${manifest.read?.length ?? "?"} write=${manifest.write?.length ?? "?"} upstream=${manifest.upstream?.length ?? "?"}`,
      "Run node verify-rpc-manifest.mjs and update rpc-endpoints.mjs");
    const resource = await rpc.request("resources/read", { uri: "ui://deck-sidebar/board.html" });
    const html = resource?.contents?.[0]?.text ?? "";
    add("MCP resource board.html", html.includes("MattSkillsDeck") && html.length > 1000,
      `${html.length} bytes`, "Run node build.mjs and restart the server");
    const project = await rpc.request("tools/call", {
      name: "deck_current_project",
      arguments: {},
      _meta: metadata,
    });
    add("MCP thread identity", project?.structuredContent?.cwd === repoRoot,
      project?.structuredContent?.cwd ?? project?.content?.[0]?.text ?? "no cwd",
      "Check session-project.mjs and the thread session record");
    if (github) {
      const snapshot = await rpc.request("tools/call", {
        name: "deck_upstream_read",
        arguments: { method: "snapshot", payload: { expectedThreadId: threadId } },
        _meta: metadata,
      });
      if (snapshot?.isError) {
        add("real GitHub read", false, snapshot.content?.[0]?.text ?? "isError", "Check gh auth and network");
      } else {
        const result = snapshot?.structuredContent ?? JSON.parse(snapshot?.content?.[0]?.text ?? "{}");
        const snapshotValue = result.value ?? result;
        add("real GitHub read", Boolean(snapshotValue.repository?.name),
          snapshotValue.repository?.name ?? "no repository", "Check gh auth and repository binding");
      }
    }
  } catch (error) {
    add("MCP smoke test", false, error.message, `Check server stderr: ${stderr.slice(-400)}`);
  } finally {
    rpc.close();
    child.stdin.end();
    child.kill();
    await rm(codexHome, { recursive: true, force: true }).catch(() => {});
  }
  return checks;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return help();
  const configText = await readConfigText(options.codexHome);
  const configChecks = inspectConfig(configText, {
    serverName: options.serverName,
    codexHome: options.codexHome,
  }).checks;
  const runtime = await inspectRuntime({ codexHome: options.codexHome });
  const smoke = await smokeTest({ github: options.github, serverName: options.serverName });
  const checks = [...runtime.checks, ...configChecks, ...smoke];
  const report = { ok: summarize({ checks }).ok, checks, codexHome: options.codexHome, serverName: options.serverName };
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`MattSkillsDeck Codex port doctor\nconfig: ${configPathFor(options.codexHome)}\n`);
    printChecks(checks);
    if (!options.github) console.log("\nGitHub read skipped. Re-run with --github for a live repository check.");
  }
  process.exitCode = report.ok ? 0 : 1;
}

main().catch(error => {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
});
