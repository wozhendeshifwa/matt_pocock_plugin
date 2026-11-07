import path from "node:path";

// #18: the settings page's debug group can reveal the log folder. Codex exposes
// no folder-open host service, so the upstream platform recipe shells out to
// Windows `cmd /c start`. This module is the only place that decides whether
// such an argv may run, and it is deliberately narrower than a shell: the
// program must be cmd, the verb must be start, and the target must be an
// absolute path inside one of the roots this port already owns.

const META = /[&|^%!<>"]/;
const NAME = /^[A-Za-z0-9._-]+$/;

function inside(root, target) {
  const relative = path.win32.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.win32.isAbsolute(relative));
}

function allowedTarget(target, roots) {
  if (typeof target !== "string" || !/^[A-Za-z]:[\\/]/.test(target)) return false;
  if (META.test(target)) return false;
  return roots.some(root => inside(root, path.win32.normalize(target)));
}

/**
 * Classify a `cmd /c start` argv produced by the vendored platform layer.
 * Returns { kind: "folder" | "file", target } or null when the shape is not
 * exactly the recipe this port allows.
 */
export function classifyOpenCommand(argv, roots) {
  if (process.platform !== "win32") return null;
  if (!Array.isArray(argv) || argv.length < 4 || argv.length > 12) return null;
  const rootsList = (Array.isArray(roots) ? roots : [roots]).filter(Boolean).map(root => path.win32.normalize(String(root)));
  if (!rootsList.length) return null;
  const program = path.win32.basename(String(argv[0] ?? "")).toLowerCase();
  if (program !== "cmd" && program !== "cmd.exe") return null;
  if (argv[1] !== "/c" || argv[2] !== "start") return null;
  let index = 3;
  if (argv[index] === "") index += 1;
  if (argv[index] === "/max") index += 1;
  if (argv[index] === "/d") {
    const directory = String(argv[index + 1] ?? "");
    const opener = String(argv[index + 2] ?? "").toLowerCase();
    const select = String(argv[index + 3] ?? "");
    if (opener !== "explorer" || !select.startsWith("/select,")) return null;
    const name = select.slice("/select,".length);
    if (!NAME.test(name)) return null;
    if (index + 4 !== argv.length) return null;
    if (!allowedTarget(directory, rootsList)) return null;
    const target = path.win32.join(directory, name);
    return allowedTarget(target, rootsList) ? { kind: "file", target } : null;
  }
  if (index !== argv.length - 1) return null;
  const target = String(argv[index]);
  return allowedTarget(target, rootsList) ? { kind: "folder", target: path.win32.normalize(target) } : null;
}
