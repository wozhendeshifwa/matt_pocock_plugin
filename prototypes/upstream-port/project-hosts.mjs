import { fork } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

export function createProjectHosts(baseDirectory) {
  const hosts = new Map();
  let sequence = 0;
  async function start(cwd) {
    const directory = path.join(baseDirectory, createHash("sha256").update(cwd).digest("hex"));
    await mkdir(directory, { recursive: true });
    const child = fork(new URL("project-worker.mjs", import.meta.url), [cwd], {
      cwd: directory, execArgv: [], windowsHide: true, stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    child.stderr.resume();
    const pending = new Map();
    const fail = error => {
      hosts.delete(cwd);
      for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
      pending.clear();
    };
    child.on("error", fail);
    child.on("exit", () => fail(new Error("项目数据进程已退出。")));
    child.on("message", reply => {
      const entry = pending.get(reply.id);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(reply.id);
      if (reply.error) entry.reject(new Error(reply.error));
      else entry.resolve(reply.result);
    });
    return {
      call(method, payload) {
        return new Promise((resolve, reject) => {
          const id = ++sequence;
          const timer = setTimeout(() => { pending.delete(id); reject(new Error("项目数据请求超时。")); }, 55000);
          pending.set(id, { resolve, reject, timer });
          child.send({ id, method, payload }, error => { if (error) fail(error); });
        });
      },
      dispose() { child.kill(); },
    };
  }
  return {
    async call(cwd, method, payload) {
      if (!hosts.has(cwd)) hosts.set(cwd, start(cwd).catch(error => { hosts.delete(cwd); throw error; }));
      return (await hosts.get(cwd)).call(method, payload);
    },
    async dispose() { for (const host of hosts.values()) { try { (await host).dispose(); } catch {} } },
  };
}
