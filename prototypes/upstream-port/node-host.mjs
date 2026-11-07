import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import originalHost from "../../vendor/mattskills-1.8.0-rc.7/lib/index.js";
import { createPlatform } from "../../vendor/mattskills-1.8.0-rc.7/lib/platform/index.js";
import { resolveExecutable } from "./executables.mjs";
import { classifyEndpoint } from "./rpc-endpoints.mjs";
import { createSessionStore } from "./session-store.mjs";

function isReadCommand(argv) {
  const program = path.basename(argv[0]).replace(/\.exe$/i, "").toLowerCase();
  const args = argv.slice(1);
  if (program === "gh") {
    if (args[0] === "--version") return true;
    if (args[0] === "auth") return args[1] === "status";
    if (["repo", "issue", "pr"].includes(args[0])) return ["view", "list"].includes(args[1]);
    if (args[0] !== "api") return false;
    const method = args.findIndex(arg => arg === "-X" || arg === "--method");
    if (method !== -1 && args[method + 1] !== "GET") return false;
    if (args[1] === "graphql") {
      const query = args.find(arg => arg.startsWith("query="));
      return Boolean(query) && !/\bmutation\b/i.test(query);
    }
    return !args.some(arg => ["-f", "-F", "--field", "--raw-field", "--input"].includes(arg));
  }
  if (program !== "git") return false;
  if (args[0] === "-C") args.splice(0, 2);
  if (["--version", "rev-parse", "status", "log", "show", "diff", "ls-files", "check-ref-format"].includes(args[0])) return true;
  if (args[0] === "remote") return ["get-url", "-v"].includes(args[1]);
  if (args[0] === "config") return args.some(arg => ["--get", "--get-all", "--get-regexp", "--list"].includes(arg));
  if (args[0] === "worktree") return args[1] === "list";
  return false;
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
      const relative = path.relative(dataRoot, destination);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error("This verification host writes only to its data directory.");
      }
      await fs.mkdir(path.dirname(destination), { recursive: true });
      const parent = await fs.realpath(path.dirname(destination));
      const parentRelative = path.relative(dataRoot, parent);
      if (parentRelative.startsWith("..") || path.isAbsolute(parentRelative)) {
        throw new Error("Write target resolves outside the data directory.");
      }
      await fs.writeFile(destination, content, "utf8");
    },
  };
  const subprocess = {
    async resolveExecutable(name) {
      return resolveExecutable(name, { env: process.env });
    },
    spawn(options) {
      if (!isReadCommand(options.argv)) throw new Error("Command is outside read-only port verification.");
      const [program, ...args] = options.argv;
      const child = spawn(program, args, {
        cwd: options.cwd ?? workspaceRoot, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      });
      processes.add(child);
      const buffers = { stdout: "", stderr: "" };
      for (const stream of ["stdout", "stderr"]) {
        child[stream].setEncoding("utf8");
        child[stream].on("data", chunk => {
          const limit = options.stdio?.[stream]?.maxBytes ?? 4 * 1024 * 1024;
          buffers[stream] = (buffers[stream] + chunk).slice(-limit);
        });
      }
      const done = new Promise((resolve, reject) => {
        child.once("error", error => { processes.delete(child); reject(error); });
        child.once("close", (exitCode, signal) => {
          processes.delete(child);
          resolve({ exitCode, signal });
        });
      });
      return {
        done, terminate: () => child.kill(),
        collected: Object.fromEntries(["stdout", "stderr"].map(stream => [
          stream, { readFrom: offset => ({ text: buffers[stream].slice(offset) }) },
        ])),
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
      if (kind === "write") throw new Error("Host action is a write and is not enabled in this ticket: " + method);
      if (method === "cwd") return { ok: true, value: { ok: true, cwd: workspaceRoot, workspaceRoot } };
      const request = new Request("https://mattskills-adapter.invalid/api/dsws", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "client-request", rpcId: "codex-" + ++sequence,
          payload: { method, payload: { ...payload, cwd: workspaceRoot } },
        }),
      });
      const response = await route(request);
      return (await response.json()).result;
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
