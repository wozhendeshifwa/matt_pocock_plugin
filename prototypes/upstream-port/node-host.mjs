import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import originalHost from "../../vendor/mattskills-1.8.0-rc.7/lib/index.js";
import { createPlatform } from "../../vendor/mattskills-1.8.0-rc.7/lib/platform/index.js";
import { resolveExecutable } from "./executables.mjs";
import { classifyEndpoint } from "./rpc-endpoints.mjs";
import { classifyReadCommand, createBoundedCollector } from "./read-command.mjs";
import { createSessionStore } from "./session-store.mjs";
import { createSkillsService } from "./skills-service.mjs";
import { classifyWriteCommand } from "./write-gate.mjs";
import { DECK_TOOL_POLICY, WRITE_POLICY } from "./write-policy.mjs";

// The write endpoints ticket #12 opens. Everything else in WRITE_ENDPOINTS keeps
// returning "write and is not enabled": each remaining ticket (#9 git writes,
// #18 settings, #7 handoff UI, #4 pull requests) turns on its own surface.
const WRITE_SURFACE = new Set(["commentIssue", "setLabelColors", "bind", "handoffResolve"]);

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
  if (await fs.realpath(process.cwd()) !== dataRoot) {
    throw new Error("Run the upstream host in its dedicated data directory.");
  }
  const disposers = [];
  const routes = new Map();
  let resolveRoute;
  const routeReady = new Promise(resolve => { resolveRoute = resolve; });
  const processes = new Set();
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
      const write = read ? null : classifyWriteCommand(options.argv);
      if (!read && !write) {
        throw new Error("Command is outside the Codex port's allowlisted git/gh commands.");
      }
      const [program, ...args] = options.argv;
      const child = spawn(program, args, {
        cwd: options.cwd ?? workspaceRoot, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      });
      processes.add(child);
      const collected = {
        stdout: createBoundedCollector(options.stdio?.stdout?.maxBytes),
        stderr: createBoundedCollector(options.stdio?.stderr?.maxBytes),
      };
      for (const stream of ["stdout", "stderr"]) {
        child[stream].on("data", chunk => collected[stream].push(chunk));
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
        done, terminate: () => child.kill(), collected,
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
      const kind = classifyEndpoint(method, payload);
      if (kind === "unknown") throw new Error("Unknown upstream endpoint: " + method);
      if (kind === "write" && !WRITE_SURFACE.has(method)) {
        throw new Error("Write endpoint is still not enabled in this ticket: " + method);
      }
      if (method === "cwd") return { ok: true, value: { ok: true, cwd: workspaceRoot, workspaceRoot } };
      const policy = kind === "write" ? (WRITE_POLICY[method] ?? {}) : null;
      const request = new Request("https://mattskills-adapter.invalid/api/dsws", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "client-request", rpcId: "codex-" + ++sequence,
          payload: { method, payload: { ...payload, cwd: workspaceRoot } },
        }),
      });
      try {
        const response = await route(request);
        const result = (await response.json()).result;
        if (policy) {
          // Endpoint-level entry: it exists even when the backend refuses below
          // (missing repo, no permission), so a write attempt is never invisible.
          await recordWrite({
            method, category: policy.category ?? "external-github-write", projectHash,
            confirmation: policy.confirmation ?? "upstream-dialog", stage: "endpoint",
            ok: result?.ok !== false, errorKind: result?.ok === false ? String(result?.error?.kind ?? "backend") : "",
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
      const cwd = context.cwd || workspaceRoot;
      const exec = {
        cwd,
        session: context.sessionId ? { id: String(context.sessionId), cwd } : undefined,
        signal: undefined,
      };
      return tool.execute(args ?? {}, exec);
    },
    dispose() {
      for (const child of processes) child.kill();
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
