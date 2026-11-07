import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveExecutable } from "./executables.mjs";

export const adapterRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)));
export const repoRoot = path.resolve(adapterRoot, "../..");
export const serverScript = path.join(adapterRoot, "sidebar-server.mjs");
const buildScript = path.join(adapterRoot, "build.mjs");
const vendorClient = path.join(repoRoot, "vendor/mattskills-1.8.0-rc.7/lib/client.js");
const distClient = path.join(adapterRoot, "dist/client.js");
const distManifest = path.join(adapterRoot, "dist/manifest.json");
export const defaultServerName = "deck-sidebar-probe";

export function resolveCodexHome(flag) {
  return path.resolve(flag ?? process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"));
}

export function configPathFor(codexHome) {
  return path.join(codexHome, "config.toml");
}

function tomlString(value) {
  const text = String(value);
  if (!text.includes("'") && !text.includes("\n") && !text.includes("\r")) return `'${text}'`;
  return JSON.stringify(text);
}

function stripServerSections(text, serverName) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const result = [];
  let skipping = false;
  for (const line of lines) {
    if (/^\s*\[/.test(line)) {
      const header = line.trim();
      skipping = header === `[mcp_servers.${serverName}]` ||
        header.startsWith(`[mcp_servers.${serverName}.`);
      if (skipping) continue;
    }
    if (!skipping) result.push(line);
  }
  return result
    .join(eol)
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+/, "");
}

function serverBlock(serverName, { command, args, cwd, codexHome, startupTimeoutSec = 30 }) {
  return [
    `[mcp_servers.${serverName}]`,
    "enabled = true",
    `command = ${tomlString(command)}`,
    `args = [${args.map(tomlString).join(", ")}]`,
    `cwd = ${tomlString(cwd)}`,
    `startup_timeout_sec = ${startupTimeoutSec}`,
    "tool_timeout_sec = 320",
    "",
    `[mcp_servers.${serverName}.env]`,
    `CODEX_HOME = ${tomlString(codexHome)}`,
    "",
  ].join("\n");
}

function ensureFeature(text, key, value) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex(line => line.trim() === "[features]");
  if (start === -1) {
    return (text.replace(/\s*$/, "") + eol + eol + "[features]" + eol + `${key} = ${value}` + eol);
  }
  let end = start + 1;
  while (end < lines.length && !/^\s*\[/.test(lines[end])) end++;
  let found = false;
  for (let index = start + 1; index < end; index++) {
    if (new RegExp(`^\\s*${key}\\s*=`).test(lines[index])) {
      lines[index] = `${key} = ${value}`;
      found = true;
    }
  }
  if (!found) lines.splice(start + 1, 0, `${key} = ${value}`);
  return lines.join(eol) + (text.endsWith("\n") ? "" : eol);
}

export function planConfig(text, {
  serverName = defaultServerName,
  command = process.execPath,
  args = [serverScript],
  cwd = adapterRoot,
  codexHome = resolveCodexHome(),
} = {}) {
  let next = stripServerSections(text, serverName);
  next = ensureFeature(next, "enable_mcp_apps", "true");
  next = next.replace(/\s*$/, "") + "\n\n" +
    serverBlock(serverName, { command, args, cwd, codexHome });
  return next;
}

function sectionLines(text, header) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex(line => line.trim() === header);
  if (start === -1) return null;
  let end = start + 1;
  while (end < lines.length && !/^\s*\[/.test(lines[end])) end++;
  return lines.slice(start + 1, end);
}

function parseTomlString(raw) {
  const value = String(raw ?? "").trim();
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  if (value.startsWith('"') && value.endsWith('"')) {
    try { return JSON.parse(value); } catch { return value.slice(1, -1); }
  }
  return value;
}

function parseTomlArgs(raw) {
  const inner = String(raw ?? "").match(/\[([\s\S]*?)\]/)?.[1] ?? "";
  const args = [];
  const pattern = /'([^']*)'|"((?:\\.|[^"])*)"/g;
  for (const match of inner.matchAll(pattern)) {
    args.push(match[1] ?? JSON.parse(`"${match[2]}"`));
  }
  return args;
}

function valueOf(lines, key) {
  if (!lines) return null;
  const line = lines.find(item => new RegExp(`^\\s*${key}\\s*=`).test(item));
  return line ? line.slice(line.indexOf("=") + 1).trim() : null;
}

function valueOfArray(lines, key) {
  if (!lines) return null;
  const start = lines.findIndex(item => new RegExp(`^\\s*${key}\\s*=`).test(item));
  if (start === -1) return null;
  let raw = lines[start].slice(lines[start].indexOf("=") + 1).trim();
  if (!raw.includes("]")) {
    for (let index = start + 1; index < lines.length; index++) {
      raw += " " + lines[index].trim();
      if (lines[index].includes("]")) break;
    }
  }
  return raw;
}

export function inspectConfig(text, {
  serverName = defaultServerName,
  codexHome = resolveCodexHome(),
  command = process.execPath,
  args = [serverScript],
  cwd = adapterRoot,
} = {}) {
  const server = sectionLines(text, `[mcp_servers.${serverName}]`);
  const env = sectionLines(text, `[mcp_servers.${serverName}.env]`);
  const features = sectionLines(text, "[features]");
  const checks = [];
  const add = (name, ok, detail, fix) => checks.push({ name, ok, detail, fix });
  add("server section", Boolean(server), server ? `[mcp_servers.${serverName}]` : "missing",
    `node install.mjs --apply --server-name ${serverName}`);
  if (server) {
    const installedCommand = parseTomlString(valueOf(server, "command"));
    const installedArgs = parseTomlArgs(valueOfArray(server, "args"));
    const installedCwd = parseTomlString(valueOf(server, "cwd"));
    add("command", installedCommand === command, installedCommand || "missing", "node install.mjs --apply");
    add("args[0]", installedArgs[0] === args[0], installedArgs.join(" ") || "missing", "node install.mjs --apply");
    add("args count", installedArgs.length === args.length, String(installedArgs.length), "node install.mjs --apply");
    add("cwd", installedCwd === cwd, installedCwd || "missing", "node install.mjs --apply");
    add("env.CODEX_HOME", Boolean(env) && parseTomlString(valueOf(env, "CODEX_HOME")) === codexHome,
      env ? parseTomlString(valueOf(env, "CODEX_HOME")) : "missing", "node install.mjs --apply");
  }
  const featureValue = valueOf(features, "enable_mcp_apps");
  add("features.enable_mcp_apps", featureValue === "true", featureValue ?? "missing", "node install.mjs --apply");
  return { checks, server, env, features };
}

async function exists(file) {
  try { await access(file, constants.F_OK); return true; } catch { return false; }
}

export async function inspectBuild() {
  const vendor = await readFile(vendorClient, "utf8");
  const expected = createHash("sha256").update(vendor).digest("hex");
  let manifest = null;
  let actual = null;
  try { manifest = JSON.parse(await readFile(distManifest, "utf8")); } catch {}
  if (await exists(distClient)) actual = await readFile(distClient, "utf8");
  const built = Boolean(manifest && actual && manifest.upstreamClientSha256 === expected);
  return {
    built,
    expected,
    manifestHash: manifest?.upstreamClientSha256 ?? null,
    distExists: Boolean(actual),
    buildScript,
    distClient,
  };
}

export async function dependenciesPresent() {
  for (const name of ["esbuild", "react", "react-dom", "jsdom"]) {
    try { await access(path.join(adapterRoot, "node_modules", name)); } catch { return false; }
  }
  return true;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, ...options });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", chunk => { stdout += chunk; });
    child.stderr?.on("data", chunk => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", code => resolve({ code, stdout, stderr }));
  });
}

export async function ensureDependencies({ log = console.log } = {}) {
  if (await dependenciesPresent()) return { installed: false };
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const useCi = await exists(path.join(adapterRoot, "package-lock.json"));
  log(`Installing adapter dependencies with ${npm} ${useCi ? "ci" : "install"}...`);
  const result = await run(npm, [useCi ? "ci" : "install"], { cwd: adapterRoot, stdio: "inherit" });
  if (result.code !== 0) throw new Error(`Dependency install failed with exit ${result.code}`);
  return { installed: true };
}

export async function build({ log = console.log } = {}) {
  log("Building the Codex client bundle...");
  const result = await run(process.execPath, [buildScript], { cwd: adapterRoot, stdio: "inherit" });
  if (result.code !== 0) throw new Error(`Build failed with exit ${result.code}`);
  return inspectBuild();
}

export async function inspectRuntime({ codexHome = resolveCodexHome() } = {}) {
  const checks = [];
  const add = (name, ok, detail, fix, warn = false) => checks.push({ name, ok, detail, fix, warn });
  add("node", Boolean(process.version), process.version, "Install Node.js 20+");
  for (const file of ["sidebar-server.mjs", "sidebar-bridge.js", "build.mjs", "package.json"]) {
    add(`adapter ${file}`, await exists(path.join(adapterRoot, file)), path.join(adapterRoot, file), "Restore the adapter checkout");
  }
  const buildInfo = await inspectBuild();
  add("dist/client.js", buildInfo.distExists, buildInfo.distClient, "node build.mjs");
  add("dist manifest matches vendor", buildInfo.built,
    buildInfo.built ? "upstream client hash matches" : `expected ${buildInfo.expected.slice(0, 12)}…, got ${String(buildInfo.manifestHash).slice(0, 12)}…`,
    "node build.mjs");
  const gh = await resolveExecutable("gh");
  const git = await resolveExecutable("git");
  add("gh executable", Boolean(gh), gh ?? "not found on PATH", "Install GitHub CLI or set DECK_GH");
  add("git executable", Boolean(git), git ?? "not found on PATH", "Install Git or set DECK_GIT");
  if (gh) {
    const auth = await run(gh, ["auth", "status"], { cwd: repoRoot }).catch(error => ({ code: -1, stdout: "", stderr: error.message }));
    let authenticated = auth.code === 0 || /Logged in/i.test(auth.stdout + auth.stderr);
    let warnAuth = false;
    let detail = authenticated ? "authenticated" : "gh auth status failed";
    if (!authenticated) {
      const api = await run(gh, ["api", "user", "--jq", ".login"], { cwd: repoRoot })
        .catch(error => ({ code: -1, stdout: "", stderr: error.message }));
      if (api.code === 0 && api.stdout.trim()) {
        authenticated = true;
        detail = `API token works as ${api.stdout.trim()}; gh auth status keyring entry is stale`;
      } else {
        const networkFailure = /EOF|timed out|timeout|network|TLS|connection|ECONN|ENOTFOUND|Get "https:/i
          .test(`${api.stderr}${api.stdout}${auth.stderr}${auth.stdout}`);
        if (networkFailure) {
          authenticated = true;
          warnAuth = true;
          detail = "unverified: GitHub API unavailable (network)";
        } else {
          detail = "not logged in / API token invalid";
        }
      }
    }
    add("gh auth", authenticated, detail, "gh auth login or gh auth refresh", warnAuth);
  }
  add("CODEX_HOME", await exists(codexHome), codexHome, "Set CODEX_HOME or install Codex");
  add("state_5.sqlite", await exists(path.join(codexHome, "state_5.sqlite")),
    path.join(codexHome, "state_5.sqlite"), "Open Codex once so it creates its state database");
  return { checks, gh, git, build: buildInfo, codexHome };
}

export async function readConfigText(codexHome) {
  try { return await readFile(configPathFor(codexHome), "utf8"); } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}

export async function applyInstall({
  serverName = defaultServerName,
  codexHome = resolveCodexHome(),
  command = process.execPath,
  args = [serverScript],
  cwd = adapterRoot,
  log = console.log,
} = {}) {
  const configPath = configPathFor(codexHome);
  await mkdir(codexHome, { recursive: true });
  const before = await readConfigText(codexHome);
  const after = planConfig(before, { serverName, command, args, cwd, codexHome });
  if (before === after) {
    log(`Codex config already up to date: ${configPath}`);
    return { changed: false, configPath };
  }
  if (before) {
    const backup = `${configPath}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    await copyFile(configPath, backup);
    log(`Backed up ${configPath} -> ${backup}`);
  }
  await writeFile(configPath, after, "utf8");
  log(`Updated ${configPath}`);
  return { changed: true, configPath, after };
}

export function summarize(report) {
  const failed = report.checks.filter(check => !check.ok);
  return { ok: failed.length === 0, failed, checks: report.checks };
}

export function printChecks(checks, { log = console.log } = {}) {
  for (const check of checks) {
    const mark = check.ok ? (check.warn ? "WARN" : "PASS") : "FAIL";
    log(`${mark}  ${check.name}${check.detail ? `: ${check.detail}` : ""}${!check.ok && check.fix ? `\n      fix: ${check.fix}` : ""}`);
  }
  const failed = checks.filter(check => !check.ok).length;
  log(`\n${checks.length - failed}/${checks.length} checks passed`);
  return failed === 0;
}

export function parseArgs(argv) {
  const options = {
    apply: false,
    json: false,
    build: true,
    installDeps: true,
    serverName: defaultServerName,
    codexHome: resolveCodexHome(),
    help: false,
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--apply") options.apply = true;
    else if (arg === "--check") options.apply = false;
    else if (arg === "--json") options.json = true;
    else if (arg === "--no-build") options.build = false;
    else if (arg === "--no-install") options.installDeps = false;
    else if (arg === "--server-name") options.serverName = argv[++index];
    else if (arg === "--codex-home") options.codexHome = resolveCodexHome(argv[++index]);
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function help() {
  console.log(`Usage: node install.mjs [--check|--apply] [options]

  --check                 Inspect only (default); never writes the Codex config.
  --apply                 Build if needed, back up and update ~/.codex/config.toml.
  --server-name <name>    MCP server table name (default: ${defaultServerName}).
  --codex-home <dir>      Codex home to update (default: CODEX_HOME or ~/.codex).
  --no-build              Do not rebuild dist/client.js.
  --no-install            Do not run npm ci/install when dependencies are missing.
  --json                  Print the check report as JSON.
  --help                  Show this help.`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return help();
  if (options.installDeps && !options.apply) {
    // A check must not install packages. Only the apply path mutates node_modules.
  }
  if (options.apply) {
    if (options.installDeps) await ensureDependencies();
    if (options.build) {
      const buildInfo = await inspectBuild();
      if (!buildInfo.built) await build();
    }
    await applyInstall({
      serverName: options.serverName,
      codexHome: options.codexHome,
    });
  }
  const configText = await readConfigText(options.codexHome);
  const configChecks = inspectConfig(configText, {
    serverName: options.serverName,
    codexHome: options.codexHome,
  }).checks;
  const runtime = await inspectRuntime({ codexHome: options.codexHome });
  const report = { checks: [...runtime.checks, ...configChecks], codexHome: options.codexHome, serverName: options.serverName };
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printChecks(report.checks);
    if (!options.apply) {
      console.log(`\nDry run. Re-run with --apply to update ${configPathFor(options.codexHome)}.`);
    } else {
      console.log("\nRestart Codex desktop (or run `codex mcp get " + options.serverName + "`) so the panel picks up the new server.");
    }
  }
  process.exitCode = summarize(report).ok ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  });
}
