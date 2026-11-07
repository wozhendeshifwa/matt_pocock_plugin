// Skills registry for the Codex adapter.
//
// The upstream host normally gets skills from DSH's `skills` service. Codex has
// no such service (#8), so the bundled 27 skills were invisible: the check chain
// sat at "waiting for the skills service" forever and the panel showed "未检测到
// 核心技能套件". This module supplies the part of the DSH contract the upstream
// code actually uses (`get`), backed directly by the vendored
// `bundled-skills` directory — the same source `skill.readDoc` reads.
//
// Deliberately no `registerProvider`: the upstream bootstrap only scans for a
// provider after finding that method, and its candidate list includes
// `~/.dsh/profiles/**`. Ticket #10 keeps the plugin's skills vendor-only and
// says not to read those profiles, so the port's registry is the single source
// and nothing else gets registered.
import * as fs from "node:fs/promises";
import path from "node:path";

const SKILL_NAME = /^[\p{L}0-9]+(?:-[\p{L}0-9]+)*$/u;
const PROVIDER_NAME = "codex-port-bundled";
const BUNDLED_RANK = 350;

function field(frontMatter, key) {
  const match = new RegExp("^" + key + "\\s*:\\s*(.+)$", "m").exec(frontMatter);
  if (!match) return "";
  return match[1].trim().replace(/^["']|["']$/g, "");
}

function asBool(value) {
  return String(value).trim().toLowerCase() === "true";
}

/** Minimal SKILL.md reader: front matter + body, the shape the upstream probe reads. */
export function parseSkillMarkdown(raw) {
  const source = String(raw ?? "").replace(/^\uFEFF/, "");
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(source);
  if (!match) return null;
  const frontMatter = match[1];
  const body = match[2].trim();
  const name = field(frontMatter, "name");
  if (!name || !SKILL_NAME.test(name)) return null;
  const userFlag = field(frontMatter, "user-invocable");
  return {
    name,
    description: field(frontMatter, "description"),
    whenToUse: field(frontMatter, "when-to-use") || undefined,
    invocation: {
      modelInvocable: !asBool(field(frontMatter, "disable-model-invocation")),
      userInvocable: userFlag === "" ? true : !asBool(userFlag),
    },
    content: body,
  };
}

function entryFrom(parsed, file) {
  return {
    name: parsed.name,
    description: parsed.description,
    ...(parsed.whenToUse ? { whenToUse: parsed.whenToUse } : {}),
    invocation: parsed.invocation,
    source: "bundled",
    provider: PROVIDER_NAME,
    rank: BUNDLED_RANK,
    path: file,
    locator: { path: file, directory: path.dirname(file) },
    content: parsed.content,
  };
}

export function createSkillsService({ bundledDir }) {
  async function get(name) {
    const skill = String(name ?? "");
    if (!SKILL_NAME.test(skill)) return null;
    const file = path.join(bundledDir, skill, "SKILL.md");
    const raw = await fs.readFile(file, "utf8").catch(() => null);
    if (raw === null) return null;
    const parsed = parseSkillMarkdown(raw);
    if (!parsed || parsed.name !== skill) return null;
    return entryFrom(parsed, file);
  }

  async function list() {
    const entries = await fs.readdir(bundledDir, { withFileTypes: true }).catch(() => []);
    const out = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() || !SKILL_NAME.test(entry.name)) continue;
      const item = await get(entry.name);
      if (item) out.push(item);
    }
    return out;
  }

  return {
    name: PROVIDER_NAME,
    get,
    list,
    // The invalidation channel is optional upstream; a no-op keeps the probe's
    // subscription path quiet instead of falling into its pending bucket.
    onDidInvalidate() {
      return () => {};
    },
    subscribe() {
      return () => {};
    },
    on() {},
    off() {},
    getSnapshot() {
      return { providers: [PROVIDER_NAME] };
    },
  };
}
