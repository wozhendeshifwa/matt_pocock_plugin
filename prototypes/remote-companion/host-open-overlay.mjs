import { createHostOpenRuntime } from './host-open-effects.mjs';

function exact(text, from, to) {
  if (text.split(from).length !== 2) throw new Error('Host-open overlay anchor drift; refusing to freeze');
  return text.replace(from, () => to);
}
export function apply(text, eol = '\n') {
  text = exact(text, 'import { fileURLToPath } from "node:url";', [
    'import { fileURLToPath } from "node:url";',
    'import * as localOpenFs from "node:fs";',
    createHostOpenRuntime.toString().replace(/\r?\n/g, eol),
  ].join(eol));
  text = exact(text, '  const operation = new AsyncLocalStorage();', [
    '  const operation = new AsyncLocalStorage();',
    '  const localOpenRuntime = createHostOpenRuntime({ fs: localOpenFs, path, createHash, workspaceRoot, dataRoot });',
  ].join(eol));
  text = exact(text, '      const request = new Request("https://mattskills-adapter.invalid/api/dsws", {', [
    '      if (["openFolder", "openPath"].includes(method)) localOpenRuntime.remember(localOpen, { method, parameters: scoped });',
    '      const request = new Request("https://mattskills-adapter.invalid/api/dsws", {',
  ].join(eol));
  const spawn = [
    '      const [program, ...args] = options.argv;',
    '      const child = spawn(program, args, {',
    '        cwd: options.cwd ?? workspaceRoot, windowsHide: true,',
    '        env: environment,',
    '        stdio: ["ignore", opened ? "ignore" : "pipe", opened ? "ignore" : "pipe"],',
    '      });',
  ].join(eol);
  text = exact(text, spawn, [
    '      const openReceipt = opened ? localOpenRuntime.claim(active, opened) : null;',
    '      const [program, ...args] = options.argv;',
    '      let child;',
    '      try { child = spawn(program, args, {',
    '        cwd: options.cwd ?? workspaceRoot, windowsHide: true,',
    '        env: environment,',
    '        stdio: ["ignore", opened ? "ignore" : "pipe", opened ? "ignore" : "pipe"],',
    '      }); } catch (error) { openReceipt?.fail(); throw error; }',
    '      openReceipt?.observe(child);',
  ].join(eol));
  return text;
}
