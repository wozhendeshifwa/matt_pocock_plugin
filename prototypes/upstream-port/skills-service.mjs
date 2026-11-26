// The plugin's fixed catalog, source inspection and detail reader share this
// boundary. A trusted current-project host resolver can select a rule file;
// absent that capability we show the bundled reference, never claim host load.
// No directory priority, profile scanning or provider/source switching occurs.
import * as fs from "node:fs/promises";
import path from "node:path";
import { createHash } from 'node:crypto';
import { MATT_SKILL_PROBE_NAMES } from '../../vendor/mattskills-1.8.0-rc.7/shared/matt-skills.js';

const SKILL_NAME = /^[\p{L}0-9]+(?:-[\p{L}0-9]+)*$/u;
const PROVIDER_NAME = "codex-port-skills";
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

export function createSkillsService({ bundledDir, managedBundledDir, workspaceRoot, resolveHostSkill, assessRequirements, managedNames = MATT_SKILL_PROBE_NAMES } = {}) {
  const names = [...new Set(managedNames)].filter(name => SKILL_NAME.test(name));
  const normalize = value => String(value).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n').map(line => line.trimEnd()).join('\n').trim();
  const sameProject = async value => {
    if (!value || !workspaceRoot) return false;
    const current = await fs.realpath(workspaceRoot).catch(() => null);
    return current !== null && (await fs.realpath(value).catch(() => null)) === current;
  };
  async function load(name, file) {
    if (!file || !path.isAbsolute(file)) return null;
    const raw = await fs.readFile(file, 'utf8').catch(() => null);
    const parsed = raw === null ? null : parseSkillMarkdown(raw);
    return parsed?.name === name ? { ...entryFrom(parsed, file), raw } : null;
  }
  async function resolveBinding(name) {
    if (!names.includes(name) || !resolveHostSkill) return null;
    try {
      const resolved = await resolveHostSkill({ name, projectRoot: workspaceRoot });
      if (!await sameProject(resolved?.projectRoot)) return null;
      return resolved;
    } catch { return null; }
  }
  async function prerequisites(entry) {
    const documents = [];
    const reasons = [];
    const directory = await fs.realpath(path.dirname(entry.path)).catch(() => null);
    const seen = new Set();
    async function read(file) {
      if (seen.has(file)) return;
      seen.add(file);
      if (seen.size > 64) { reasons.push('必要引用过多，未核验全部文件。'); return; }
      const resolved = await fs.realpath(file).catch(() => null);
      const relative = resolved && directory ? path.relative(directory, resolved) : '..';
      if (!resolved || relative.startsWith('..') || path.isAbsolute(relative)) {
        reasons.push('必要引用不可读或越出技能目录：' + path.basename(file)); return;
      }
      const content = await fs.readFile(resolved, 'utf8').catch(() => null);
      if (content === null || content.length > 200000) { reasons.push('必要引用不可读或过大：' + path.basename(file)); return; }
      documents.push({ path: resolved, content });
      if (!/\.md$/i.test(resolved)) return;
      // Code fences contain examples, not dependencies of the skill itself.
      const prose = content.replace(/```[^\n]*\n[\s\S]*?```|~~~[^\n]*\n[\s\S]*?~~~/g, '');
      for (const match of prose.matchAll(/\[[^\]]*\]\(([^\s)]+)(?:\s+[^)]*)?\)/g)) {
        const target = match[1].replace(/^<|>$/g, '');
        if (/^(?:#|[a-z][a-z0-9+.-]*:|\/\/)/i.test(target) || target.includes('<')) continue;
        let local;
        try { local = decodeURIComponent(target.split('#')[0]); } catch { reasons.push('必要引用格式无效。'); continue; }
        if (local && (local.startsWith('./') || local.startsWith('../') || /\.[a-z0-9]+$/i.test(local))) await read(path.resolve(path.dirname(resolved), local));
      }
    }
    await read(entry.path);
    let assessment;
    try { assessment = await assessRequirements?.({ name: entry.name, projectRoot: workspaceRoot, documents }); }
    catch { reasons.push('工具要求核验失败。'); }
    if (assessment?.complete !== true || !Array.isArray(assessment.tools)) reasons.push('工具及其他必要资料要求未核验；先查证，暂停依赖步骤。');
    for (const tool of Array.isArray(assessment?.tools) ? assessment.tools : []) if (tool?.available !== true) reasons.push('必要工具不可用或未核验：' + String(tool?.name));
    for (const missing of Array.isArray(assessment?.missing) ? assessment.missing : []) reasons.push('必要资料缺失：' + String(missing));
    return { allowed: reasons.length === 0, reasons, files: documents.map(doc => doc.path),
      documentDigests: documents.map(doc => ({ path:doc.path, sha256:createHash('sha256').update(normalize(doc.content)).digest('hex') }))
        .sort((a,b)=>a.path.localeCompare(b.path)),
    };
  }
  async function inspect(name) {
    if (!names.includes(name)) return null;
    const bundled = (managedBundledDir && await load(name, path.join(managedBundledDir, name, 'SKILL.md'))) || await load(name, path.join(bundledDir, name, 'SKILL.md'));
    const resolution = await resolveBinding(name);
    const hostResolution = resolveHostSkill ? 'unavailable' : 'unknown';
    const host = resolution && await load(name, resolution.path);
    const selected = host || bundled;
    if (!selected) return null;
    const { raw, ...entry } = selected;
    const difference = host && bundled ? {
      kind: normalize(host.content) === normalize(bundled.content) ? 'equivalent' : 'review-behavior',
      hostBody: host.content, referenceBody: bundled.content,
    } : { kind: 'unavailable' };
    return {
      ...entry, source: host ? 'host-resolved' : 'bundled-reference', provider: host ? 'codex-host-resolved' : PROVIDER_NAME,
      sourceInfo: { kind: host ? 'host-resolved' : 'bundled-reference', path: entry.path,
        hostResolution: host ? 'resolved' : hostResolution, actualLoad: 'unknown', difference,
        sourceId: resolution?.sourceId ?? null,
        binding: resolution?.binding ?? null, hostPath: resolution?.path ?? null },
      execution: { ...await prerequisites(entry), mode: host ? 'host-rules' : 'bundled-readonly' },
    };
  }

  async function get(name) {
    return inspect(String(name ?? ''));
  }

  async function readDoc({ name } = {}) {
    const entry = await get(name);
    if (!entry) return { ok: false, missing: true };
    return {
      ok: true, path: entry.path,
      md: (entry.source === 'host-resolved' ? '来源：当前项目宿主已解析的规则；尚无实际加载证明。' : '来源：随包参考；当前项目的宿主来源与实际加载均未核验。') +
        '\n\n同名正文存在行为差异时，由 Agent 核对目标及用户明确规则；兼容差异自主继续，只有实质决策冲突才澄清。\n\n' + entry.execution.reasons.join('\n') + '\n\n---\n\n' + entry.content,
      mdZh: null, pathZh: null, source: entry.sourceInfo, execution: entry.execution,
    };
  }

  async function annotateChecks(result) {
    const chain = result?.value ?? result;
    if (!chain?.resolved) return result;
    const states = new Map();
    for (const [id, check] of Object.entries(chain.resolved)) {
      if (!id.startsWith('skill:') || !check || typeof check !== 'object') continue;
      const entry = await get(id.slice(6));
      if (!entry) continue;
      states.set(id, entry);
      check.status = entry.execution.allowed ? 'pass' : 'pending';
      check.detail = (entry.source === 'host-resolved' ? '宿主当前项目解析的规则' : '可读随包参考（非宿主安装或加载证明）') + '：' + entry.path;
      check.source = entry.sourceInfo;
      check.execution = entry.execution;
      check.hint = '';
    }
    const seen = new WeakSet();
    function annotate(value) {
      if (!value || typeof value !== 'object' || seen.has(value)) return;
      seen.add(value);
      if (Array.isArray(value.steps)) {
        for (const step of value.steps) {
          const entry = states.get(step.id);
          if (!entry) continue;
          step.status = entry.execution.allowed ? 'done' : 'pending';
          step.actions = [];
          step.show = { ...(step.show ?? {}), detail: chain.resolved[step.id].detail };
          step.isBlocking = !entry.execution.allowed;
        }
        const first = value.steps.findIndex(step => step.status !== 'done');
        value.currentIndex = first < 0 ? null : first;
        value.doneCount = value.steps.filter(step => step.status === 'done').length;
        value.chainState = first < 0 ? 'allDone' : value.steps[first].status === 'pending' ? 'pending' : 'hasCurrent';
        value.isComplete = first < 0;
      }
      for (const child of Object.values(value)) annotate(child);
    }
    annotate(chain);
    return result;
  }

  async function list() {
    const out = [];
    for (const name of names.slice().sort()) {
      const item = await get(name);
      if (item) out.push(item);
    }
    return out;
  }

  return {
    name: PROVIDER_NAME,
    get,
    list,
    readDoc,
    inspectForUse: get,
    resolveBinding,
    annotateChecks,
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
