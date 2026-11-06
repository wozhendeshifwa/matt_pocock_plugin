import { createReadStream } from "node:fs";
import { glob, realpath } from "node:fs/promises";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import path from "node:path";

export async function resolveSessionProject(metadata, sessionsRoot = path.join(process.env.CODEX_HOME || path.join(homedir(), ".codex"), "sessions")) {
  const threadId = metadata?.threadId ?? metadata?.thread_id;
  if (metadata?.threadId && metadata?.thread_id && metadata.threadId !== metadata.thread_id) {
    throw new Error("宿主传入了不一致的聊天身份。");
  }
  if (typeof threadId !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(threadId)) {
    throw new Error("当前侧栏请求没有可验证的聊天身份。");
  }
  const matches = [];
  for await (const filename of glob(`**/*${threadId}*.jsonl`, { cwd: sessionsRoot })) {
    const stream = createReadStream(path.join(sessionsRoot, filename), { encoding: "utf8" });
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        const record = JSON.parse(line);
        if (record.type === "session_meta" && record.payload?.id === threadId && path.isAbsolute(record.payload.cwd ?? "")) {
          matches.push(await realpath(record.payload.cwd));
        }
        break;
      }
    } finally {
      lines.close();
      stream.destroy();
    }
  }
  const directories = [...new Set(matches)];
  if (directories.length !== 1) throw new Error("无法从当前聊天的会话记录确定唯一项目目录，临时聊天可能尚未创建本地记录。");
  return { threadId, cwd: directories[0] };
}
