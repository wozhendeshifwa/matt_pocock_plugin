const skillFinder = String.raw`  async function findCardPath(name) {
    // The Codex registry and document reader share this immutable packaged
    // directory. Never search the worker cwd, parent projects or DSH profiles.
    const pathMod = await import('node:path')
    const fsSync = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    try {
      const root = fsSync.realpathSync(fileURLToPath(new URL('../bundled-skills/', import.meta.url)))
      const file = pathMod.join(root, name, 'SKILL.md')
      const actual = fsSync.realpathSync(file)
      const key = value => process.platform === 'win32' ? value.toLowerCase() : value
      if (key(actual) !== key(file) || fsSync.lstatSync(file).isSymbolicLink()) return null
      const relative = pathMod.relative(key(root), key(actual))
      if (relative === '..' || relative.startsWith('..' + pathMod.sep) || pathMod.isAbsolute(relative)) return null
      return fsSync.statSync(actual).isFile() ? actual : null
    } catch { return null }
  }
`;

export function unavailableUpdate(method, result, { modulePath, moduleUrl }) {
  if (!['updateStatus', 'updateCheck', 'updateChangelog'].includes(method) || result?.ok !== false || result.error?.code !== 'internal') return null;
  const prefix = "Cannot find package 'dsh-plugin-update' imported from ";
  if (![prefix + modulePath, prefix + moduleUrl].includes(result.error.message)) return null;
  // The researched Codex baseline never had the DSH installer dependency.
  // Keep it unavailable, without inventing a current/latest update snapshot.
  return { ok: false, unsupported: true, errorKind: 'unsupported', error: '当前 Codex 版使用本机手动更新入口。' };
}

export function applyReadOverlay(relative, text, eol) {
  if (relative === 'prototypes/upstream-port/node-host.mjs') {
    const anchor = '        const result = (await response.json()).result;';
    if (text.split(anchor).length !== 2) throw new Error('Update-unavailable overlay anchor drift');
    return text.replace(anchor, () => [anchor,
      '        const unavailableUpdateResult = (' + unavailableUpdate.toString() + ')(method, result, {',
      '          modulePath: fileURLToPath(new URL("../../vendor/mattskills-1.8.0-rc.7/lib/updateFromPackage.js", import.meta.url)),',
      '          moduleUrl: new URL("../../vendor/mattskills-1.8.0-rc.7/lib/updateFromPackage.js", import.meta.url).href,',
      '        });',
      '        if (unavailableUpdateResult) return { ok: true, value: unavailableUpdateResult };',
    ].join(eol));
  }
  if (relative !== 'vendor/mattskills-1.8.0-rc.7/lib/skillDoc.js') return text;
  const start = text.indexOf('  async function findCardPath(name) {');
  const end = text.indexOf('  async function readDoc(args) {', start);
  if (start < 0 || end < 0 || text.indexOf('  async function findCardPath(name) {', start + 1) !== -1 ||
      !text.slice(start, end).includes("'.dsh/profiles/desktop/node_modules/dsh-mattpocock-skills-deck/bundled-skills'")) {
    throw new Error('Bundled skill document overlay anchor drift');
  }
  return text.slice(0, start) + skillFinder.replace(/\r?\n/g, eol) + text.slice(end);
}
