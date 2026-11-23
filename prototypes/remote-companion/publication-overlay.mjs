// Inserted into the verified frozen node host, after the original command has
// passed its unchanged recipe classifier. This binds that recipe to local
// preparation; it neither approves a write nor implements publication itself.
export function createPublicationCommandGuard({ path, realpathSync, existsSync, execFileSync, gitExecutable, workspaceRoot }) {
  const need = (condition, message) => { if (!condition) throw new Error(message); };
  const key = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
  const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const repositoryOf = value => {
    if (typeof value !== 'string') return null;
    const found = /^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}?)?(?:\.git)?$/.exec(value);
    return found?.[1]?.toLowerCase() ?? null;
  };
  function git(args, env, optional = false) {
    try { return execFileSync(gitExecutable, ['--no-optional-locks', '-C', workspaceRoot, ...args], {
      env, encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    }).trim(); }
    catch (error) { if (optional && Number.isInteger(error.status) && error.status !== 0 &&
      (optional !== 'no-repository' || /not a git repository/i.test(String(error.stderr ?? '')))) return null;
    throw new Error('Publication local Git facts are unavailable'); }
  }
  const urls = (name, env) => (git(['config', '--get-all', name], env, true) ?? '').split(/\r?\n/).filter(Boolean);
  function effectiveTarget(args, target, env) {
    const actual = git(args, env).split(/\r?\n/).filter(Boolean);
    need(actual.length === 1 && repositoryOf(actual[0]) === target, 'Publication effective push target was rewritten to another repository');
  }
  function simulateTarget(url, target, env) {
    // remote get-url deliberately ignores command-line-only remote definitions
    // in this installed Git. Read pushInsteadOf's longest matching prefix,
    // then let Git itself apply ordinary insteadOf via --get-url (no network).
    const rules = git(['config', '--null', '--get-regexp', '^url\\..*\\.pushinsteadof$'], env, true) ?? '';
    let chosen = null;
    for (const row of rules.split('\0').filter(Boolean)) {
      const split = row.indexOf('\n'), name = row.slice(0, split), prefix = row.slice(split + 1);
      const match = /^url\.(.*)\.pushinsteadof$/i.exec(name);
      need(split > 0 && match && prefix && !/[\r\n]/.test(prefix), 'Publication URL rewriting rules are not readable');
      if (url.startsWith(prefix) && (!chosen || prefix.length > chosen.prefix.length)) chosen = { base: match[1], prefix };
    }
    const rewritten = chosen ? chosen.base + url.slice(chosen.prefix.length) : url;
    effectiveTarget(['ls-remote', '--get-url', rewritten], target, env);
  }
  function snapshot(env) {
    const top = git(['rev-parse', '--show-toplevel'], env, 'no-repository');
    if (!top) {
      need(!existsSync(path.join(workspaceRoot, '.git')), 'Existing publication repository cannot be read');
      return { repositoryExists: false, headOid: null, branch: null, originUrls: [], originPushUrls: [] };
    }
    need(key(realpathSync(top)) === key(workspaceRoot), 'Publication would change an enclosing repository');
    return { repositoryExists: true, headOid: git(['rev-parse', '--verify', 'HEAD'], env, true),
      branch: git(['symbolic-ref', '--quiet', '--short', 'HEAD'], env, true),
      originUrls: urls('remote.origin.url', env), originPushUrls: urls('remote.origin.pushurl', env) };
  }
  function publication(active) {
    const value = active?.localPublication;
    need(['initPublish', 'retryPush'].includes(active?.method) && value && typeof value === 'object' &&
      Object.keys(value).every(name => ['repository', 'visibility', 'before', 'retry'].includes(name)) &&
      /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(value.repository ?? '') &&
      ['private', 'public'].includes(value.visibility) && value.before &&
      Object.keys(value.before).length === 5 && Object.keys(value.before).every(name => ['repositoryExists', 'headOid', 'branch', 'originUrls', 'originPushUrls'].includes(name)) &&
      typeof value.before.repositoryExists === 'boolean' && (value.before.headOid === null || /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value.before.headOid ?? '')) &&
      (value.before.branch === null || typeof value.before.branch === 'string' && value.before.branch.length <= 256) &&
      Array.isArray(value.before.originUrls) && value.before.originUrls.length <= 1 && value.before.originUrls.every(url => repositoryOf(url)) &&
      Array.isArray(value.before.originPushUrls) && value.before.originPushUrls.length === 0,
    'Missing precise trusted local publication context');
    if (active.method === 'retryPush') need(value.retry && Object.keys(value.retry).length === 3 &&
      Number.isSafeInteger(value.retry.repositoryId) && value.retry.repositoryId > 0 &&
      /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value.retry.commitOid ?? '') && typeof value.retry.branch === 'string' &&
      value.retry.branch === value.before.branch && value.retry.commitOid === value.before.headOid,
    'Retry requires a matching local durable publication record');
    else need(value.retry === undefined, 'A new publication cannot carry retry authority');
    return value;
  }
  return function guard(active, options, env) {
    need(env.GH_HOST === 'github.com', 'Publication host is not bound to github.com');
    const value = publication(active), target = value.repository.toLowerCase();
    need(key(realpathSync(options.cwd ?? workspaceRoot)) === key(workspaceRoot), 'Publication project changed before command dispatch');
    if (!active.publicationChecked) {
      need(same(snapshot(env), value.before), 'Publication local facts changed before first write');
      active.publicationChecked = true;
    }
    const argv = options.argv, program = path.basename(argv[0]).replace(/\.exe$/i, '').toLowerCase();
    let args = argv.slice(1); if (args[0] === '-C') args = args.slice(2);
    if (program === 'gh') {
      const [owner, name] = value.repository.split('/');
      need(active.method === 'initPublish' && args[0] === 'repo' && args[1] === 'create' && args[2] === name &&
        args[3] === '--' + value.visibility && !active.publicationCreateStarted, 'Publication create recipe differs from local target');
      let login;
      try { login = execFileSync(argv[0], ['api', 'user', '-q', '.login'], { env, encoding: 'utf8', windowsHide: true,
        timeout: 15000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
      catch { throw new Error('Publication account cannot be independently rechecked'); }
      need(login.toLowerCase() === owner.toLowerCase(), 'Publication GitHub account changed before creation');
      const current = snapshot(env);
      need(current.repositoryExists && current.headOid && same(current.originUrls, value.before.originUrls) && current.originPushUrls.length === 0,
        'Publication remote changed before repository creation');
      // gh chooses HTTPS or SSH from its local configuration. Simulate both
      // through Git's effective URL resolution without writing a remote. Raw
      // config equality alone misses insteadOf/pushInsteadOf redirection.
      for (const url of ['https://github.com/' + value.repository + '.git', 'git@github.com:' + value.repository + '.git']) {
        simulateTarget(url, target, env);
      }
      active.publicationCreateStarted = true;
      return [argv[0], 'repo', 'create', value.repository, ...args.slice(3)];
    }
    need(program === 'git', 'Publication cannot run another program');
    if (args[0] === 'remote') {
      need(args[2] === 'origin' && repositoryOf(args[3]) === target &&
        (active.method === 'initPublish' && args[1] === 'set-url' && active.publicationCreateStarted || active.method === 'retryPush' && args[1] === 'add'),
      'Publication cannot replace another remote target');
    }
    if (args[0] === 'push') {
      const current = snapshot(env);
      need(current.originUrls.length === 1 && repositoryOf(current.originUrls[0]) === target && current.originPushUrls.length === 0,
        'Publication push is not bound to the prepared repository');
      effectiveTarget(['remote', 'get-url', '--push', '--all', 'origin'], target, env);
      if (active.method === 'retryPush') need(current.headOid === value.retry.commitOid && current.branch === value.retry.branch,
        'Publication retry commit changed before push');
      else need(active.publicationCreateStarted, 'Publication push cannot precede the original create step');
    }
    return argv;
  };
}

export function applyPublicationOverlay(relative, text, eol) {
  if (relative !== 'prototypes/upstream-port/node-host.mjs') return text;
  const exact = (from, to) => { if (text.split(from).length !== 2) throw new Error('Publication overlay anchor drift at ' + JSON.stringify(from.slice(0, 100)) + ': ' + (text.split(from).length - 1) + ' match'); text = text.replace(from, () => to); };
  exact('  const disposers = [];', [
    '  const guardPublicationCommand = (' + createPublicationCommandGuard.toString() + ')({ path, realpathSync, existsSync, execFileSync, gitExecutable, workspaceRoot });',
    '  const disposers = [];',
  ].join(eol));
  exact('      if (gitWrite) {' + eol + '        // Also inherited', [
    '      const actualArgv = gitWrite && ["initPublish", "retryPush"].includes(active?.method)',
    '        ? guardPublicationCommand(active, options, environment) : options.argv;',
    '      if (gitWrite) {',
    '        // Also inherited',
  ].join(eol));
  exact('      const [program, ...args] = options.argv;', '      const [program, ...args] = actualArgv;');
  return text;
}
