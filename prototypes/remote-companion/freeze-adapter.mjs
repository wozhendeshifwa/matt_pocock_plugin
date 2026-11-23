import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, lstat, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const BASELINE_MANIFEST_SHA256 = '5390342ff96c94f3d3884853e2631d92f3a56cd0c1cc9aa37a96b83aee4dacef';
export const OVERLAY_VERSION = 'choices-project-tracker-and-local-data-v4';
export const READ_ONLY_OVERLAY_VERSIONS = Object.freeze(['choices-data-root-v1', 'choices-and-bound-project-v2', 'choices-bound-project-and-log-load-v3', OVERLAY_VERSION]);
export const OUTPUT_BASE = fileURLToPath(new URL('../../.scratch/', import.meta.url));
const defaultManifest = fileURLToPath(new URL('../../docs/research/remote-companion-baseline-2026-11-24.json', import.meta.url));
const roots = ['prototypes/upstream-port', 'vendor/mattskills-1.8.0-rc.7'];
const excluded = new Set(['node_modules', '.scratch', '.git']);
const allowedExtension = /\.(mjs|js|css|html|json|md|ps1|svg|png|webp|jpg|jpeg|ico|txt|yml|yaml|sh)$/i;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const normalize = value => process.platform === 'win32' ? value.toLowerCase() : value;
function within(root, file) {
  const relative = path.relative(normalize(root), normalize(file));
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}
function eligible(relative) {
  return (allowedExtension.test(relative) || ['LICENSE', 'VERSION'].includes(relative.split('/').at(-1))) &&
    !relative.split('/').some(part => excluded.has(part) || part === '.env' || part.startsWith('.env.') || part.endsWith('.secret'));
}
function validPath(relative) {
  if (typeof relative !== 'string' || relative.includes('\\') || relative.startsWith('/') || relative.includes('\0') ||
      relative.split('/').some(part => !part || part === '.' || part === '..' || part.includes(':')) ||
      !roots.some(root => relative.startsWith(root + '/')) || !eligible(relative)) {
    throw new Error('Manifest contains an extra or unsafe path');
  }
}
async function catalog(root) {
  const files = [];
  async function walk(relative) {
    const absolute = path.join(root, relative);
    const info = await lstat(absolute);
    if (info.isSymbolicLink()) throw new Error('Source links are not accepted: ' + relative);
    if (!info.isDirectory()) throw new Error('Expected source directory: ' + relative);
    for (const entry of await readdir(absolute, { withFileTypes: true })) {
      if (excluded.has(entry.name) || entry.name === '.env' || entry.name.startsWith('.env.') || entry.name.endsWith('.secret')) continue;
      const next = relative + '/' + entry.name;
      if (entry.isSymbolicLink()) throw new Error('Source links are not accepted: ' + next);
      if (entry.isDirectory()) await walk(next);
      else if (entry.isFile() && eligible(next)) files.push(next);
      else throw new Error('Unexpected source entry: ' + next);
    }
  }
  for (const relative of roots) await walk(relative);
  return files.sort();
}
function exact(source, from, to) {
  if (source.split(from).length !== 2) throw new Error('Overlay anchor drift; refusing to freeze');
  return source.replace(from, to);
}
export function applyChoicesOverlay(relative, bytes) {
  let text = bytes.toString('utf8');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  if (relative === 'prototypes/upstream-port/sidebar-server.mjs') {
    text = exact(text, 'import { createInterface } from "node:readline";', [
      'import { createInterface } from "node:readline";',
      'import path from "node:path";',
    ].join(eol));
    text = exact(text, 'import { readFile, writeFile, rename, mkdir, realpath, unlink } from "node:fs/promises";',
      'import { readFile, writeFile, rename, mkdir, realpath, unlink, lstat } from "node:fs/promises";');
    text = exact(text, 'const dataRoot = fileURLToPath(new URL("../../.scratch/upstream-sidebar/" + key + "/", import.meta.url));', [
      'const legacyDataRoot = fileURLToPath(new URL("../../.scratch/upstream-sidebar/" + key + "/", import.meta.url));',
      'const localDataOverride = process.env.DECK_LOCAL_DATA_ROOT;',
      'let dataRoot = legacyDataRoot;',
      'if (localDataOverride !== undefined) {',
      '  if (!localDataOverride || !path.isAbsolute(localDataOverride) || /[\\u0000-\\u001f\\u007f]/.test(localDataOverride))',
      '    throw new Error("Use an existing absolute local business-data root");',
      '  const actual = await realpath(localDataOverride);',
      '  const pathKey = value => process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);',
      '  if (!(await lstat(localDataOverride)).isDirectory() || pathKey(actual) !== pathKey(localDataOverride))',
      '    throw new Error("Local business-data root must not redirect");',
      '  dataRoot = actual;',
      '}',
    ].join(eol));
    text = exact(text, 'const hostContextPath = dataRoot + "host-context-captures.json";',
      'const hostContextPath = path.join(dataRoot, "host-context-captures.json");');
    text = exact(text, 'const projectHosts = createProjectHosts(dataRoot + "projects");',
      'const projectHosts = createProjectHosts(path.join(dataRoot, "projects"));');
    text = exact(text, 'async function handle(request) {', [
      '// Only the local stdio bridge supplies this envelope, after resolving the',
      '// host identity and replacing any same-named remote input. Resolve again',
      '// here and reject a project change before a worker receives the request.',
      'async function assertLocalDispatchProject(request, project, required) {',
      '  const bound = request._deckLocalDispatch;',
      '  if (bound == null && !required) return;',
      '  if (!bound || bound.threadId !== project.threadId || typeof bound.projectRoot !== "string")',
      '    throw new Error("Missing verified local dispatch project");',
      '  const [expected, actual] = await Promise.all([realpath(bound.projectRoot), realpath(projectKey(project))]);',
      '  const key = value => process.platform === "win32" ? value.toLowerCase() : value;',
      '  if (key(expected) !== key(actual)) throw new Error("Project changed before local dispatch; refresh project");',
      '}',
      'async function handle(request) {',
    ].join(eol));
    text = exact(text, '          const result = await projectHosts.call(cwd, "__deck_tool_call__", {', [
      '          await assertLocalDispatchProject(request, project, !["deck_context", "deck_issue_get", "deck_map_snapshot", "deck_issue_list"].includes(deckTool.name));',
      '          const result = await projectHosts.call(cwd, "__deck_tool_call__", {',
    ].join(eol));
    text = exact(text, '          return { content: [{ type: "text", text: JSON.stringify(project) }], structuredContent: project };', [
      '          await assertLocalDispatchProject(request, project, false);',
      '          return { content: [{ type: "text", text: JSON.stringify(project) }], structuredContent: project };',
    ].join(eol));
    text = exact(text, '            context: { cwd, sessionId: project.threadId },',
      '            context: { cwd, sessionId: project.threadId, localTracker: request._deckLocalDispatch?.tracker },');
    text = exact(text, '        const result = await projectHosts.call(cwd, method, scopedPayload);', [
      '        await assertLocalDispatchProject(request, project, upstreamTool === "deck_upstream_write");',
      '        const result = await projectHosts.call(cwd, method, { ...scopedPayload, __deckLocalTracker: request._deckLocalDispatch?.tracker });',
    ].join(eol));
  } else if (relative === 'prototypes/upstream-port/node-host.mjs') {
    text = exact(text, 'export async function createOriginalHost({ dataRoot, workspaceRoot }) {', [
      'const TRACKER_WRITE_METHODS = new Set(["deck_issue_create", "deck_issue_patch", "deck_map_plan_create", "deck_map_link", "commentIssue", "setLabelColors"]);',
      'function requireLocalTracker(tracker) {',
      '  if (!tracker || !["github", "gitlab", "markdown"].includes(tracker.backendId) || typeof tracker.repository !== "string" || !tracker.repository || tracker.repository.length > 4096 || /[\\u0000-\\u001f\\u007f]/.test(tracker.repository))',
      '    throw new Error("Missing verified local tracker context");',
      '  if (tracker.backendId === "github" && !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(tracker.repository))',
      '    throw new Error("Invalid verified GitHub repository");',
      '  return tracker;',
      '}',
      'function assertLocalGithubCommand(active, argv) {',
      '  const tracker = requireLocalTracker(active.localTracker);',
      '  const program = path.basename(String(argv[0])).replace(/\\.exe$/i, "").toLowerCase();',
      '  const args = argv.slice(1);',
      '  let repository;',
      '  if (program === "gh" && args[0] === "api") repository = /^repos\\/([^/]+\\/[^/]+)(?:\\/|$)/.exec(args[1] ?? "")?.[1];',
      '  else if (program === "gh" && ["issue", "label"].includes(args[0])) {',
      '    const index = args.indexOf("--repo");',
      '    if (index >= 0) repository = args[index + 1];',
      '  }',
      '  if (tracker.backendId !== "github" || typeof repository !== "string" || repository.toLowerCase() !== tracker.repository.toLowerCase())',
      '    throw new Error("GitHub write repository changed before local dispatch");',
      '}',
      'export async function createOriginalHost({ dataRoot, workspaceRoot }) {',
    ].join(eol));
    text = exact(text, '      const projectFile = projectRelative !== null && PROJECT_WRITE_FILES.has(projectRelative) ? projectRelative : null;', [
      '      const projectFile = projectRelative !== null && PROJECT_WRITE_FILES.has(projectRelative) ? projectRelative : null;',
      '      const trackerOperation = operation.getStore();',
      '      if (TRACKER_WRITE_METHODS.has(trackerOperation?.method)) {',
      '        const tracker = requireLocalTracker(trackerOperation.localTracker);',
      '        if (projectFile && tracker.backendId === "github") throw new Error("Tracker backend changed before local project write");',
      '      }',
    ].join(eol));
    text = exact(text, '      const write = read ? null : gitWrite ?? graphWrite ?? classifyWriteCommand(options.argv);', [
      '      const write = read ? null : gitWrite ?? graphWrite ?? classifyWriteCommand(options.argv);',
      '      if (write?.category === "external-github-write" && TRACKER_WRITE_METHODS.has(active?.method)) assertLocalGithubCommand(active, options.argv);',
    ].join(eol));
    text = exact(text, '    async call(method, payload = {}) {', [
      '    async call(method, payload = {}) {',
      '      const { __deckLocalTracker: localTracker, ...businessPayload } = payload;',
      '      payload = businessPayload;',
    ].join(eol));
    text = exact(text, '        const execute = () => operation.run({ method, identity: {} }, () => route(request));',
      '        const execute = () => operation.run({ method, localTracker, identity: {} }, () => route(request));');
    text = exact(text, '        if (["deck_issue_create", "deck_map_plan_create", "deck_map_link"].includes(name)) {',
      '        if (TRACKER_WRITE_METHODS.has(name) || context.localTracker) {');
    text = exact(text, '          if (selected?.data?.backend?.id === "github") repo = selected.data.repo?.refId;', [
      '          const tracker = requireLocalTracker(context.localTracker);',
      '          const backend = selected?.data?.backend?.id;',
      '          const selectedRepo = selected?.data?.repo?.refId;',
      '          const repoKey = value => backend === "github" && typeof value === "string" ? value.toLowerCase() : value;',
      '          if (backend !== tracker.backendId || repoKey(selectedRepo) !== repoKey(tracker.repository)) throw new Error("Tracker selection changed before local tool execution");',
      '          if (backend === "github") repo = selectedRepo;',
    ].join(eol));
    text = exact(text, '        return operation.run({ method: name, repo, issueIds: new Set(), identity: {} }, () => tool.execute(args ?? {}, exec));',
      '        return operation.run({ method: name, repo, localTracker: context.localTracker, issueIds: new Set(), identity: {} }, () => tool.execute(args ?? {}, exec));');
  } else if (relative === 'prototypes/upstream-port/read-command.mjs') {
    text = exact(text, '  if (args[0] === "auth") return args[1] === "status";', [
      '  if (args[0] === "auth") return args[1] === "status";',
      '  if (args[0] === "label") return args.length === 8 && args[1] === "list" && args[2] === "--repo" &&',
      '    /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(args[3]) &&',
      '    args[4] === "--json" && args[5] === "name,color,description" && args[6] === "--limit" && args[7] === "1000";',
    ].join(eol));
  } else if (relative === 'prototypes/upstream-port/project-worker.mjs') {
    text = exact(text, 'identity: createSnapshotCacheIdentity(process.argv[2]),',
      'identity: createSnapshotCacheIdentity(process.argv[2], { dataRoot: process.cwd() }),');
  } else if (relative === 'prototypes/upstream-port/snapshot-cache-identity.mjs') {
    text = exact(text, 'export function createSnapshotCacheIdentity(workspaceRoot) {',
      'export function createSnapshotCacheIdentity(workspaceRoot, options = {}) {');
    text = exact(text, '      const root = await realpath(workspaceRoot);', [
      '      // Frozen-candidate overlay: choices belong to the worker dataRoot.',
      '      // A missing local root disables cache reuse before reading auth/config.',
      "      if (typeof options.dataRoot !== 'string' || !path.isAbsolute(options.dataRoot)) return null;",
      '      const dataRoot = await realpath(options.dataRoot);',
      '      const root = await realpath(workspaceRoot);',
    ].join(eol));
    text = exact(text, "path.join(home, '.dsh/mattskillsdeck/choices.json')",
      "path.join(dataRoot, '.dsh/mattskillsdeck/choices.json')");
  } else if (relative === 'vendor/mattskills-1.8.0-rc.7/lib/logPkg/store.js' || relative === 'vendor/mattskills-1.8.0-rc.7/lib/logStore.js') {
    const semi = relative.includes('/logPkg/') ? ';' : '';
    text = exact(text, '  let switchLoaded = false' + semi, '  let switchLoadPromise = null' + semi);
    text = exact(text, ['    if (switchLoaded) return getSwitchState()' + semi, '    switchLoaded = true' + semi].join(eol), [
      '    // One pending disk load is shared by startup and the first RPC.',
      '    if (switchLoadPromise) { await switchLoadPromise; return getSwitchState() }' + semi,
      '    switchLoadPromise = (async () => {',
    ].join(eol));
    text = exact(text, ['    return getSwitchState()' + semi, '  }', '  async function persistSwitch() {'].join(eol), [
      '    return getSwitchState()' + semi,
      '    })()' + semi,
      '    await switchLoadPromise' + semi,
      '    return getSwitchState()' + semi,
      '  }',
      '  async function persistSwitch() {',
    ].join(eol));
    text = exact(text, '  async function setSwitch(enabled, sampleRate) {', [
      '  async function setSwitch(enabled, sampleRate) {',
      '    // A late startup read must not overwrite a newly requested switch.',
      '    await loadSwitch()' + semi,
    ].join(eol));
  } else return bytes;
  return Buffer.from(text);
}

/** Freeze source bytes already matched to a reviewed hash manifest. No Git,
 * credentials, node_modules, runtime state or arbitrary source tree is copied.
 * Output is constrained to this worktree's ignored .scratch directory.
 */
export async function freezeAdapter({ sourceRoot, outputRoot, manifestFile = defaultManifest,
  expectedManifestSha256 = BASELINE_MANIFEST_SHA256 } = {}) {
  if (!sourceRoot || !outputRoot) throw new Error('Select a source root and a new output directory');
  if (!/^[a-f0-9]{64}$/.test(expectedManifestSha256)) throw new Error('Pin the input manifest SHA-256');
  const manifestBytes = await readFile(manifestFile);
  if (hash(manifestBytes) !== expectedManifestSha256) throw new Error('Input manifest SHA-256 mismatch');
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (manifest.schemaVersion !== 1 || manifest.sourceCandidateOnly !== true || !Array.isArray(manifest.files) ||
      manifest.fileCount !== manifest.files.length) throw new Error('Invalid source candidate manifest');
  const expected = new Set();
  for (const entry of manifest.files) {
    validPath(entry.path);
    if (expected.has(entry.path) || !/^[a-f0-9]{64}$/.test(entry.sha256) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0) throw new Error('Invalid or duplicate manifest entry');
    expected.add(entry.path);
  }
  for (const required of ['prototypes/upstream-port/sidebar-server.mjs', 'prototypes/upstream-port/project-worker.mjs', 'prototypes/upstream-port/snapshot-cache-identity.mjs']) {
    if (!expected.has(required)) throw new Error('Missing required candidate module');
  }
  const source = await realpath(sourceRoot);
  const actual = await catalog(source);
  if (actual.length !== expected.size || actual.some(file => !expected.has(file))) throw new Error('Source catalog has extra or missing files');

  // Keep verified bytes in memory, so later source edits cannot produce a mixed
  // candidate between verification and copying. This snapshot is about 8 MB.
  const prepared = [];
  for (const entry of manifest.files) {
    const absolute = await realpath(path.join(source, entry.path));
    if (!within(source, absolute)) throw new Error('Source path escaped the selected root');
    const original = await readFile(absolute);
    if (original.length !== entry.bytes || hash(original) !== entry.sha256) throw new Error('Source drift: ' + entry.path);
    const bytes = applyChoicesOverlay(entry.path, original);
    prepared.push({ path: entry.path, inputSha256: entry.sha256, sha256: hash(bytes), bytes, overlay: bytes.equals(original) ? null : OVERLAY_VERSION });
  }
  // Confirm the catalog once more after reading: unexpected additions must not
  // silently become part of an apparently frozen candidate.
  const after = await catalog(source);
  if (JSON.stringify(actual) !== JSON.stringify(after)) throw new Error('Source catalog changed during capture');
  for (const entry of prepared) {
    if (hash(await readFile(path.join(source, entry.path))) !== entry.inputSha256) throw new Error('Source drift during capture: ' + entry.path);
  }
  await mkdir(OUTPUT_BASE, { recursive: true });
  const base = await realpath(OUTPUT_BASE);
  const requested = path.resolve(outputRoot);
  const parent = await realpath(path.dirname(requested));
  const output = path.join(parent, path.basename(requested));
  if (!within(base, output) || normalize(base) === normalize(output) || roots.some(root => within(path.join(source, root), output))) throw new Error('Output must be a new directory inside this worktree .scratch');
  await mkdir(output); // EEXIST: never merge into or overwrite a previous freeze.
  await writeFile(path.join(output, 'INCOMPLETE'), 'A failed freeze is not a runnable candidate. Choose a new output directory.\n', { flag: 'wx' });
  for (const entry of prepared) {
    const target = path.join(output, entry.path);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, entry.bytes, { flag: 'wx' });
    if (hash(await readFile(target)) !== entry.sha256) throw new Error('Frozen file readback mismatch: ' + entry.path);
  }
  const candidate = {
    schemaVersion: 1, ready: true, userAccepted: false, sourceCandidateOnly: true,
    createdAt: new Date().toISOString(), sourceCommit: manifest.commit,
    sourceManifestSha256: expectedManifestSha256, overlayVersion: OVERLAY_VERSION,
    adapterRelativePath: 'prototypes/upstream-port/sidebar-server.mjs',
    dependencyPolicy: 'No node_modules copied. Development scripts are recorded, never automatically executed.',
    files: prepared.map(({ bytes, ...entry }) => ({ ...entry, bytes: bytes.length })),
  };
  const candidateText = JSON.stringify(candidate, null, 2) + '\n';
  await writeFile(path.join(output, 'frozen-adapter.json'), candidateText, { flag: 'wx' });
  await unlink(path.join(output, 'INCOMPLETE'));
  return { directory: output, adapterPath: path.join(output, candidate.adapterRelativePath),
    manifestPath: path.join(output, 'frozen-adapter.json'), manifestSha256: hash(candidateText),
    fileCount: prepared.length, overlayVersion: OVERLAY_VERSION, userAccepted: false };
}

/** Read-only launch check. The expected digest must come from a locally pinned
 * pairing/install record, never from an MCP request or the candidate itself.
 */
export async function verifyFrozenAdapter({ directory, expectedManifestSha256 } = {}) {
  if (!directory || !/^[a-f0-9]{64}$/.test(expectedManifestSha256 ?? '')) throw new Error('Select a candidate directory and its locally pinned manifest digest');
  const root = await realpath(directory);
  if (await lstat(path.join(root, 'INCOMPLETE')).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; })) {
    throw new Error('Incomplete or withdrawn frozen candidate');
  }
  const manifestBytes = await readFile(path.join(root, 'frozen-adapter.json'));
  if (hash(manifestBytes) !== expectedManifestSha256) throw new Error('Frozen manifest SHA-256 mismatch');
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (manifest.schemaVersion !== 1 || manifest.ready !== true || !READ_ONLY_OVERLAY_VERSIONS.includes(manifest.overlayVersion) ||
      manifest.adapterRelativePath !== 'prototypes/upstream-port/sidebar-server.mjs' || !Array.isArray(manifest.files)) throw new Error('Invalid frozen candidate manifest');
  const expected = new Set();
  for (const entry of manifest.files) {
    validPath(entry.path);
    if (expected.has(entry.path) || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('Invalid frozen file entry');
    expected.add(entry.path);
    const absolute = await realpath(path.join(root, entry.path));
    if (!within(root, absolute)) throw new Error('Frozen path escaped the selected directory');
    const bytes = await readFile(absolute);
    if (bytes.length !== entry.bytes || hash(bytes) !== entry.sha256) throw new Error('Frozen candidate drift: ' + entry.path);
  }
  const actual = await catalog(root);
  if (actual.length !== expected.size || actual.some(file => !expected.has(file))) throw new Error('Frozen catalog has extra or missing files');
  return { adapterPath: path.join(root, manifest.adapterRelativePath), fileCount: actual.length,
    overlayVersion: manifest.overlayVersion, userAccepted: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 4) throw new Error('Usage: node freeze-adapter.mjs <source-root> <new-worktree-scratch-output>');
  console.log(JSON.stringify(await freezeAdapter({ sourceRoot: process.argv[2], outputRoot: process.argv[3] }), null, 2));
}
