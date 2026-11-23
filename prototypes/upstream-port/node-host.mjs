import { spawn, execFileSync } from "node:child_process";
import { AsyncLocalStorage } from "node:async_hooks";
import { realpathSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "./comment-pagination-hook.mjs";
import originalHost from "./upstream-host.mjs";
import { createPlatform } from "../../vendor/mattskills-1.8.0-rc.7/lib/platform/index.js";
import { resolveExecutable } from "./executables.mjs";
import { classifyEndpoint } from "./rpc-endpoints.mjs";
import { classifyReadCommand, createBoundedCollector } from "./read-command.mjs";
import { createSessionStore } from "./session-store.mjs";
import { createSkillsService } from "./skills-service.mjs";
import { classifyOpenCommand } from "./open-command.mjs";
import { classifyWriteCommand } from "./write-gate.mjs";
import { classifyGraphWriteCommand, observeGraphIssueId } from "./graph-write-gate.mjs";
import { classifyGitWriteCommand } from "./git-write-gate.mjs";
import { namingCapability } from "./naming-capability.mjs";
import { createManualNaming } from "./manual-naming.mjs";
import { DECK_TOOL_POLICY, ENABLED_WRITE_ENDPOINTS, WRITE_POLICY } from "./write-policy.mjs";

// Write endpoints opened by the issue, settings, handoff and Git tickets.
// Everything else in WRITE_ENDPOINTS keeps returning "write and is not enabled":
// Each remaining ticket turns on its own surface.
const WRITE_SURFACE = new Set(ENABLED_WRITE_ENDPOINTS);

// Project files the workspace binding may write (write-policy: project-write).
// Everything else under the project stays read-only for this host.
const PROJECT_WRITE_FILES = new Set(["docs/agents/workspace.json", "docs/agents/label-colors.json"]);

// write-policy §4: append-only, rotated before it grows past 5 MB.
const AUDIT_MAX_BYTES = 5 * 1024 * 1024;

/** Short, non-reversible digest used for audit fields (never raw argv/paths). */
function digest(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 12);
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** The confirmation boundary each method rides on (write-policy §3). */
function confirmationFor(method) {
  return WRITE_POLICY[method]?.confirmation ?? DECK_TOOL_POLICY[method]?.confirmation ?? "";
}

export async function createOriginalHost({ dataRoot, workspaceRoot }) {
  dataRoot = await fs.realpath(dataRoot);
  workspaceRoot = await fs.realpath(workspaceRoot);
  const gitExecutable = await resolveExecutable("git", { env: process.env });
  if (await fs.realpath(process.cwd()) !== dataRoot) {
    throw new Error("Run the upstream host in its dedicated data directory.");
  }
  const disposers = [];
  const routes = new Map();
  let resolveRoute;
  const routeReady = new Promise(resolve => { resolveRoute = resolve; });
  const processes = new Set();
  const operation = new AsyncLocalStorage();
  let writeQueue = Promise.resolve();
  function terminate(child) {
    if (!processes.has(child)) return;
    if (process.platform === "win32" && child.pid) {
      // Git may have credential/ssh grandchildren. Only terminate a process
      // still owned by this host; never act on a completed handle's recycled pid.
      spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }).on("error", () => child.kill());
    } else child.kill();
  }
  const auditPath = path.join(dataRoot, "write-audit.jsonl");
  const projectHash = digest(workspaceRoot);
  let auditQueue = Promise.resolve();
  // One line per write, fields from write-policy §4 only. The body/title/comment
  // text and absolute paths never enter the audit; hashes are enough to correlate
  // an entry with the operation without turning the file into a data leak.
  function recordWrite(entry) {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n";
    auditQueue = auditQueue.then(async () => {
      try {
        const info = await fs.stat(auditPath).catch(() => null);
        if (info && info.size > AUDIT_MAX_BYTES) {
          await fs.rename(auditPath, path.join(dataRoot, "write-audit." + Date.now() + ".jsonl")).catch(() => {});
        }
        await fs.appendFile(auditPath, line, "utf8");
      } catch {
        process.stderr.write("write-audit-skipped\n");
      }
    });
    return auditQueue;
  }
  const targetPath = target => typeof target === "string" ? target : target.displayPath;
  const filesystem = {
    resolve: async (name, options = {}) => {
      const displayPath = path.resolve(options.cwd ?? workspaceRoot, name);
      return { targetKey: displayPath, displayPath };
    },
    readText: target => fs.readFile(targetPath(target), "utf8"),
    lstat: name => fs.lstat(name),
    stat: target => fs.stat(targetPath(target)),
    listDir: async target => {
      const entries = await fs.readdir(targetPath(target), { withFileTypes: true });
      return entries.map(entry => ({
        name: entry.name, type: entry.isDirectory() ? "directory" : "file",
        isDirectory: entry.isDirectory(), isFile: entry.isFile(),
      }));
    },
    unlink: async target => {
      const destination = path.resolve(targetPath(target));
      // logClear is the only caller: it removes day log files under the data
      // root. Nothing in the project tree is deletable from this host.
      if (!isInside(dataRoot, destination)) {
        throw new Error("This host only removes log files inside its data directory.");
      }
      await fs.unlink(destination);
    },
    writeText: async (target, content) => {
      const destination = path.resolve(targetPath(target));
      const insideData = isInside(dataRoot, destination);
      // The workspace binding is the one project-write this ticket owns; it is
      // gated by its exact relative path, not by "anything under the project".
      const projectRelative = isInside(workspaceRoot, destination)
        ? path.relative(workspaceRoot, destination).split(path.sep).join("/")
        : null;
      const projectFile = projectRelative !== null && PROJECT_WRITE_FILES.has(projectRelative) ? projectRelative : null;
      if (!insideData && !projectFile) {
        throw new Error("This host writes only to its data directory or the workspace binding files.");
      }
      await fs.mkdir(path.dirname(destination), { recursive: true });
      const parent = await fs.realpath(path.dirname(destination));
      if (!isInside(insideData ? dataRoot : workspaceRoot, parent)) {
        throw new Error("Write target resolves outside the allowed roots.");
      }
      await fs.writeFile(destination, content, "utf8");
      if (projectFile) {
        await recordWrite({
          method: "bind", category: "project-write", projectHash,
          fsTargetHash: digest(projectFile), confirmation: "upstream-dialog", ok: true,
        });
      }
    },
  };
  const subprocess = {
    async resolveExecutable(name) {
      return resolveExecutable(name, { env: process.env });
    },
    spawn(options) {
      const read = classifyReadCommand(options.argv);
      const active = operation.getStore();
      const gitWrite = read ? null : classifyGitWriteCommand(options.argv, {
        method: active?.method, cwd: options.cwd ?? workspaceRoot, workspaceRoot,
      });
      const graphWrite = read ? null : classifyGraphWriteCommand(options.argv, active);
      const write = read ? null : gitWrite ?? graphWrite ?? classifyWriteCommand(options.argv);
      // #18: the settings page may reveal a log directory. Codex has no folder
      // host service, so the vendored platform recipe's `cmd /c start` shape is
      // the only other program allowed, and only for a root this port owns.
      const opened = read || write ? null : classifyOpenCommand(options.argv, [workspaceRoot, dataRoot]);
      if (!read && !write && !opened) {
        throw new Error("Command is outside the Codex port's allowlisted git/gh/open commands.");
      }
      const environment = { ...process.env, GIT_TERMINAL_PROMPT: "0", GH_PROMPT_DISABLED: "1", GCM_INTERACTIVE: "never", GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o ConnectTimeout=30", ...options.env, ...active?.identity };
      // DSH's undefined env values are tombstones (not the string 'undefined').
      for (const key of ["GIT_ASKPASS", "SSH_ASKPASS", "DISPLAY"]) delete environment[key];
      for (const key of Object.keys(environment)) if (environment[key] === undefined) delete environment[key];
      if (gitWrite) {
        // Also inherited by gh repo create --push's own git child. Publication
        // must not push configured follow-tags or a remote.*.mirror refset.
        const remote = active.method === "gitPush" ? String(options.argv.at(-2)) : "origin";
        const overrides = [["push.followTags", "false"], ["push.default", "nothing"], ["remote." + remote + ".mirror", "false"]];
        const base = /^\d+$/.test(environment.GIT_CONFIG_COUNT ?? "") ? Number(environment.GIT_CONFIG_COUNT) : 0;
        overrides.forEach(([key, value], i) => { environment["GIT_CONFIG_KEY_" + (base + i)] = key; environment["GIT_CONFIG_VALUE_" + (base + i)] = value; });
        environment.GIT_CONFIG_COUNT = String(base + overrides.length);
      }
      if (gitWrite) {
        const git = gitExecutable;
        // The upstream pins git to its detected toplevel. A nested project must
        // never silently write an enclosing repo, even when the UI can read it.
        let top;
        try { top = execFileSync(git, ["-C", workspaceRoot, "rev-parse", "--show-toplevel"], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: environment }).trim(); }
        catch { if (!(active.method === "initPublish" && options.argv.at(-1) === "init")) throw new Error("Git write requires this project's own working tree."); }
        if (top && realpathSync(top) !== workspaceRoot) throw new Error("Git write would change an enclosing repository.");
        for (const relative of gitWrite.paths ?? []) {
          let target = path.resolve(workspaceRoot, relative);
          while (!existsSync(target) && target !== path.dirname(target)) target = path.dirname(target);
          if (!isInside(workspaceRoot, realpathSync(target))) throw new Error("Git path resolves outside this project.");
        }
        if (gitWrite.identity) {
          Object.assign(active.identity, gitWrite.identity);
          return { done: Promise.resolve({ exitCode: 0 }), terminate() {}, collected: { stdout: createBoundedCollector(), stderr: createBoundedCollector() } };
        }
        if (gitWrite.configChange && top) {
          const common = execFileSync(git, ["-C", workspaceRoot, "rev-parse", "--git-common-dir"], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: environment }).trim();
          const config = path.resolve(workspaceRoot, common, "config");
          if (existsSync(config)) {
            const backupDir = path.join(dataRoot, "git-config-backups");
            mkdirSync(backupDir, { recursive: true });
            copyFileSync(config, path.join(backupDir, Date.now() + "-" + sequence++ + ".config"));
          }
        }
      }
      const [program, ...args] = options.argv;
      const child = spawn(program, args, {
        cwd: options.cwd ?? workspaceRoot, windowsHide: true,
        env: environment,
        stdio: ["ignore", opened ? "ignore" : "pipe", opened ? "ignore" : "pipe"],
      });
      processes.add(child);
      const collected = {
        stdout: createBoundedCollector(options.stdio?.stdout?.maxBytes),
        stderr: createBoundedCollector(options.stdio?.stderr?.maxBytes),
      };
      for (const stream of ["stdout", "stderr"]) {
        if (child[stream]) child[stream].on("data", chunk => collected[stream].push(chunk));
      }
      const done = new Promise((resolve, reject) => {
        child.once("error", error => {
          processes.delete(child);
          if (write) {
            void recordWrite({
              method: write.method, category: write.category, projectHash,
              argvHash: digest(options.argv.join("\u0000")), confirmation: confirmationFor(write.method),
              ok: false, errorKind: "spawn",
            });
          }
          reject(error);
        });
        child.once("close", (exitCode, signal) => {
          processes.delete(child);
          if (read && exitCode === 0 && !collected.stdout.lossy) {
            observeGraphIssueId(options.argv, collected.stdout.finalize().text, active);
          }
          if (write) {
            void recordWrite({
              method: write.method, category: write.category, projectHash,
              argvHash: digest(options.argv.join("\u0000")), confirmation: confirmationFor(write.method),
              ok: exitCode === 0, errorKind: exitCode === 0 ? "" : "exit",
            });
          }
          resolve({ exitCode, signal });
        });
      });
      return {
        done, terminate: () => terminate(child), collected,
      };
    },
  };
  const timer = {
    timeout(callback, delay) {
      if (typeof callback === "number") {
        return new Promise(resolve => {
          const handle = setTimeout(resolve, callback);
          handle.unref();
          disposers.push(() => clearTimeout(handle));
        });
      }
      const handle = setTimeout(callback, delay);
      handle.unref();
      disposers.push(() => clearTimeout(handle));
      return handle;
    },
    interval(callback, delay) {
      const handle = setInterval(callback, delay);
      handle.unref();
      const dispose = () => clearInterval(handle);
      disposers.push(dispose);
      return dispose;
    },
  };
  const services = new Map([
    ["fs", filesystem], ["subprocess", subprocess], ["timer", timer],
    ["connection", { fetch: { register(route) {
      routes.set(route.path, route.fetch);
      if (route.path === "/api/dsws") resolveRoute(route.fetch);
      return () => routes.delete(route.path);
    } } }],
  ]);
  const sessionStore = createSessionStore();
  const manualNaming = createManualNaming({ dataRoot, workspaceRoot, sessionStore,
    async writeText(file, text) {
      await filesystem.writeText(file, text);
      await recordWrite({ method: "manualNaming", category: "local-state-write", projectHash,
        fsTargetHash: digest("manual-naming.json"), confirmation: "upstream-dialog", ok: true });
    },
  });
  const deckTools = new Map();
  const toolsService = {
    register(definition) {
      if (!definition || typeof definition.name !== "string") throw new Error("Invalid deck tool definition");
      deckTools.set(definition.name, definition);
      return () => deckTools.delete(definition.name);
    },
    get(name) { return deckTools.get(name); },
    list() { return [...deckTools.values()]; },
  };
  services.set("tools", toolsService);
  services.set("sessions", { get: sessionId => sessionStore.get(sessionId) });
  services.set("sessionQuery", {
    filterSessions: filters => sessionStore.filterSessions(filters),
    readSession: sessionId => sessionStore.readSession(sessionId),
    listEvents: sessionId => sessionStore.listEvents(sessionId),
  });
  const context = {
    get: name => services.get(name),
    set: (name, service) => services.set(name, service),
    inject(dependencies, callback) {
      if (dependencies.every(name => services.has(name))) callback(context);
    },
    effect(factory) {
      const dispose = factory();
      if (typeof dispose === "function") disposers.push(dispose);
      return dispose;
    },
    on() { return () => {}; },
  };
  services.set("platform", await createPlatform(context, { homedir: () => dataRoot }));
  // Codex has no skills service (#8). Supplying the bundled-skills registry here
  // lets the upstream bootstrap register its provider and makes the check chain
  // report the 27 packaged skills instead of waiting forever.
  services.set("skills", createSkillsService({
    bundledDir: fileURLToPath(new URL("../../vendor/mattskills-1.8.0-rc.7/bundled-skills/", import.meta.url)),
  }));
  originalHost.apply(context);
  const toolDeadline = Date.now() + 12000;
  while (deckTools.size < 9 && Date.now() < toolDeadline) {
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  let deadline;
  const route = await Promise.race([
    routeReady,
    new Promise((resolve, reject) => {
      deadline = setTimeout(() => reject(new Error("Original host RPC registration timed out.")), 15000);
    }),
  ]).finally(() => clearTimeout(deadline));
  let sequence = 0;
  return {
    async call(method, payload = {}) {
      if (method === "namingPlan") return { ok: true, value: await manualNaming.plan(payload.sessionId) };
      if (method === "cancelNewSessionWatcher") return { ok: true, value: await manualNaming.cancel(payload.sessionId, payload.suggestionId) };
      const naming = namingCapability(method);
      if (naming) return { ok: true, value: naming };
      const kind = classifyEndpoint(method, payload);
      if (kind === "unknown") throw new Error("Unknown upstream endpoint: " + method);
      if (kind === "write" && !WRITE_SURFACE.has(method)) {
        throw new Error("Write endpoint is still not enabled in this ticket: " + method);
      }
      if (method === "cwd") return { ok: true, value: { ok: true, cwd: workspaceRoot, workspaceRoot } };
      const policy = kind === "write" ? (WRITE_POLICY[method] ?? {}) : null;
      // Every upstream call is scoped to this project's root. The two open
      // endpoints are the exception: their `cwd`/`path` is the thing to open, and
      // the spawn gate (open-command.mjs) already limits them to the owned roots.
      const scoped = (method === "openFolder" || method === "openPath")
        ? { ...payload }
        : { ...payload, cwd: workspaceRoot };
      const request = new Request("https://mattskills-adapter.invalid/api/dsws", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "client-request", rpcId: "codex-" + ++sequence,
          payload: { method, payload: scoped },
        }),
      });
      try {
        const execute = () => operation.run({ method, identity: {} }, () => route(request));
        const responsePromise = kind === "write" ? writeQueue.then(execute, execute) : execute();
        if (kind === "write") writeQueue = responsePromise.catch(() => {});
        const response = await responsePromise;
        const result = (await response.json()).result;
        if (policy) {
          // Endpoint-level entry: it exists even when the backend refuses below
          // (missing repo, no permission), so a write attempt is never invisible.
          const outcome = result?.value ?? result;
          await recordWrite({
            method, category: policy.category ?? "external-github-write", projectHash,
            confirmation: policy.confirmation ?? "upstream-dialog", stage: "endpoint",
            ok: outcome?.ok !== false, errorKind: outcome?.ok === false ? String(outcome?.error?.kind ?? outcome?.errorKind ?? "backend") : "",
          });
        }
        return result;
      } catch (error) {
        if (policy) {
          await recordWrite({
            method, category: policy.category ?? "external-github-write", projectHash,
            confirmation: policy.confirmation ?? "upstream-dialog", stage: "endpoint",
            ok: false, errorKind: "threw",
          });
        }
        throw error;
      }
    },
    listTools() {
      return [...deckTools.values()].map(tool => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      }));
    },
    async callTool(name, args, context = {}) {
      const tool = deckTools.get(name);
      if (!tool || typeof tool.execute !== "function") throw new Error("Deck tool unavailable: " + name);
      const cwd = workspaceRoot;
      const exec = {
        cwd,
        session: context.sessionId ? { id: String(context.sessionId), cwd } : undefined,
        signal: undefined,
      };
      const execute = async () => {
        let repo;
        if (["deck_issue_create", "deck_map_plan_create", "deck_map_link"].includes(name)) {
          // Resolve the repository through the same upstream backend selection
          // as the tool, never from model arguments or an arbitrary git remote.
          const raw = await deckTools.get("deck_context").execute({}, exec);
          const selected = typeof raw === "string" ? JSON.parse(raw) : raw;
          if (selected?.data?.backend?.id === "github") repo = selected.data.repo?.refId;
        }
        return operation.run({ method: name, repo, issueIds: new Set(), identity: {} }, () => tool.execute(args ?? {}, exec));
      };
      const writing = DECK_TOOL_POLICY[name]?.category === "external-github-write";
      const resultPromise = writing ? writeQueue.then(execute, execute) : execute();
      if (writing) writeQueue = resultPromise.catch(() => {});
      const result = await resultPromise;
      if (name === "deck_issue_create" && context.sessionId) {
        try {
          const parsed = typeof result === "string" ? JSON.parse(result) : result;
          const ticket = parsed?.data?.ticket ?? parsed?.value?.data?.ticket;
          if (ticket) await manualNaming.created(context.sessionId, ticket);
        } catch {
          // The issue already exists. A local suggestion failure must never
          // turn success into a retried (possibly duplicate) GitHub write.
          process.stderr.write("manual-naming-record-skipped\n");
        }
      }
      return result;
    },
    dispose() {
      for (const child of processes) terminate(child);
      for (const dispose of disposers.reverse()) dispose();
      sessionStore.close();
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const host = await createOriginalHost({ dataRoot: process.cwd(), workspaceRoot: process.argv[2] });
  try {
    const result = await host.call(process.argv[3] ?? "registry", { number: Number(process.argv[4] ?? 1) });
    await new Promise(resolve => process.stdout.write(JSON.stringify(result) + "\n", resolve));
  } finally {
    host.dispose();
  }
  process.exit(0);
}
