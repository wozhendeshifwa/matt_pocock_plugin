// Local authority only. A hostname is read from the launcher's own environment,
// never selected by an MCP payload, repository slug or returned issue URL.
const invalid = () => Object.assign(new Error('Use a local GitHub hostname, optionally followed by a valid port'), { code: 'INVALID_GITHUB_HOST' });

export function normalizeKnownGithubHost(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 260 || /[^\x21-\x7e]/.test(value) ||
      /[\/\\@?#=]/.test(value)) throw invalid();
  const parts = value.split(':');
  if (parts.length > 2) throw invalid();
  const hostname = parts[0].toLowerCase(), port = parts[1];
  // Keep the CLI's literal authority: never rewrite an explicit port, strip a
  // final DNS dot, or turn api.github.com into github.com. Those may select a
  // different gh credential/config entry or API route.
  const domain = hostname.endsWith('.') ? hostname.slice(0, -1) : hostname;
  if (!domain || domain.length > 253 || domain.split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) throw invalid();
  if (port !== undefined && (!/^[0-9]{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535)) throw invalid();
  return hostname + (port === undefined ? '' : ':' + port);
}

export function localGithubHost(env = process.env) {
  if (!env || typeof env !== 'object' || Array.isArray(env)) throw invalid();
  // Windows treats environment names case-insensitively. Plain JS fixture
  // objects can contain both spellings; do not let spawn choose one silently.
  const hosts = Object.entries(env).filter(([name, value]) => name.toUpperCase() === 'GH_HOST' && value !== undefined)
    .map(([, value]) => value === '' ? 'github.com' : normalizeKnownGithubHost(value));
  if (!hosts.length) return 'github.com';
  if (hosts.some(host => host !== hosts[0])) throw Object.assign(new Error('Local GH_HOST environment spellings disagree'), { code: 'AMBIGUOUS_GITHUB_HOST' });
  return hosts[0];
}

// Fixed readers use this explicit --hostname value. It describes routing, not
// a successful login, accessible enterprise API or authorization to write.
export function githubReadRecipe(env = process.env) {
  return Object.freeze({ hostname: localGithubHost(env) });
}

// Pin only the selected child's environment; preserve the original environment
// and all other settings. Removing case aliases avoids Windows spawn ambiguity.
export function githubChildEnvironment(env, knownHost) {
  const hostname = normalizeKnownGithubHost(knownHost);
  if (!env || typeof env !== 'object' || Array.isArray(env)) throw invalid();
  const result = Object.fromEntries(Object.entries(env).filter(([name]) => name.toUpperCase() !== 'GH_HOST'));
  result.GH_HOST = hostname;
  return result;
}
