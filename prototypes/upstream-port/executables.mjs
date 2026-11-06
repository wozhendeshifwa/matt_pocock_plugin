import { access } from "node:fs/promises";
import path from "node:path";

const FALLBACKS = {
  gh: [
    "C:/Program Files/GitHub CLI/gh.exe",
    "C:/Program Files (x86)/GitHub CLI/gh.exe",
  ],
  git: [
    "C:/Program Files/Git/cmd/git.exe",
    "C:/Program Files/Git/bin/git.exe",
    "C:/Program Files (x86)/Git/cmd/git.exe",
  ],
};

async function readable(candidate) {
  if (!candidate) return false;
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

function pathEntries(env) {
  return String(env.PATH ?? env.Path ?? "")
    .split(path.delimiter)
    .map(entry => entry.trim())
    .filter(Boolean);
}

// Resolve a CLI from PATH without hard-coding one machine's install layout.
// DECK_GH / DECK_GIT remain explicit escape hatches for unusual installs.
export async function resolveExecutable(name, {
  env = process.env,
  platform = process.platform,
} = {}) {
  const override = name === "gh" ? env.DECK_GH : name === "git" ? env.DECK_GIT : null;
  if (override && await readable(override)) return override;

  const extensions = platform === "win32"
    ? String(env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean)
    : [""];
  for (const directory of pathEntries(env)) {
    for (const extension of extensions) {
      const candidate = path.join(directory, name + extension);
      if (await readable(candidate)) return candidate;
    }
  }

  if (platform === "win32") {
    for (const candidate of FALLBACKS[name] ?? []) {
      if (await readable(candidate)) return candidate;
    }
  }
  return null;
}
