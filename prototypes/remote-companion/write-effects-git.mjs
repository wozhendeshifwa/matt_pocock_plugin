import path from 'node:path';
import { realpath, lstat, readlink, readFile, stat as fileStat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveExecutable } from '../upstream-port/executables.mjs';
import { canonical, digest } from './protocol.mjs';

const run = promisify(execFile);
const samePath = value => process.platform === 'win32' ? value.toLowerCase() : value;
const oid = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
function checkedPaths(paths) {
  if (!Array.isArray(paths) || !paths.length || paths.length > 128 || paths.some(value => typeof value !== 'string' || !value ||
      path.posix.isAbsolute(value) || path.win32.isAbsolute(value) || /[:\u0000-\u001f\u007f]/.test(value) ||
      value.split(/[\\/]/).some(part => part === '..' || part.toLowerCase() === '.git'))) throw new Error('Use bounded literal project-relative Git paths');
  return [...paths];
}
function parseIndex(text) {
  return text.split('\0').filter(Boolean).map(line => {
    const match = /^(\d{6}) ([a-f0-9]{40}|[a-f0-9]{64}) ([0-3])\t([\s\S]+)$/.exec(line);
    if (!match) throw new Error('Invalid local Git index readback');
    return { mode: match[1], oid: match[2], stage: match[3], path: match[4] };
  }).sort((a, b) => a.path.localeCompare(b.path) || a.stage.localeCompare(b.stage));
}
const fingerprint = value => digest(canonical(value));
const business = response => response?.error || response?.result?.isError || response?.result?.structuredContent?.ok === false
  ? null : response?.result?.structuredContent?.value ?? response?.result?.structuredContent ?? null;

export function gitReadEnvironment(env, { hasConfiguredSshCommand = false } = {}) {
  const result = { ...env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
  for (const key of ['GIT_ASKPASS', 'SSH_ASKPASS', 'DISPLAY']) delete result[key];
  // Preserve the user's program, command, private key/port arguments and
  // core.sshCommand. Default OpenSSH flags apply only without any SSH override.
  if (!env.GIT_SSH_COMMAND && !env.GIT_SSH && !hasConfiguredSshCommand && (!env.GIT_SSH_VARIANT || env.GIT_SSH_VARIANT === 'ssh')) {
    result.GIT_SSH_COMMAND = 'ssh -o BatchMode=yes -o ConnectTimeout=10';
  }
  return result;
}

// This verifier runs fixed read commands only. It never obtains a write ticket,
// retries a write, accepts a remote program/env, or clears a ledger by itself.
export async function createGitWriteEffects({ env = process.env, localBareRoots = [], readRemoteState, onMismatch } = {}) {
  const git = await resolveExecutable('git', { env });
  if (!git) throw new Error('Local Git is unavailable for independent readback');
  const readEnv = gitReadEnvironment(env, { hasConfiguredSshCommand: true });
  async function read(root, args, accepted = [0], input) {
    try {
      let commandEnv = readEnv;
      if (args[0] === 'ls-remote' && !env.GIT_SSH_COMMAND && !env.GIT_SSH) {
        let configured = false;
        try {
          const result = await run(git, ['--no-optional-locks', '-C', root, 'config', '--get', 'core.sshCommand'],
            { env: readEnv, windowsHide: true, timeout: 15000, maxBuffer: 16384, encoding: 'utf8' });
          configured = Boolean(result.stdout.trim());
        } catch (error) { if (error.code !== 1) throw new Error('Cannot verify the existing local SSH configuration'); }
        commandEnv = gitReadEnvironment(env, { hasConfiguredSshCommand: configured });
      }
      const pending = run(git, ['--no-optional-locks', '--literal-pathspecs', '-c', 'credential.interactive=false', '-c', 'core.fsmonitor=false', '-C', root, ...args],
        { env: commandEnv, windowsHide: true, timeout: 15000, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' });
      let inputError;
      pending.child.stdin?.on('error', error => { inputError = error; });
      pending.child.stdin?.end(input);
      const result = await pending;
      if (inputError) throw new Error('Independent local Git input failed');
      return { code: 0, text: result.stdout };
    } catch (error) {
      if (accepted.includes(error.code) && typeof error.stdout === 'string') return { code: error.code, text: error.stdout };
      throw new Error('Independent local Git readback failed');
    }
  }
  async function rootOf(root) {
    const trusted = await realpath(root);
    const actual = await realpath((await read(trusted, ['rev-parse', '--show-toplevel'])).text.trim());
    if (samePath(trusted) !== samePath(actual)) throw new Error('Git root differs from the verified local project');
    return trusted;
  }
  const indexOf = async root => parseIndex((await read(root, ['ls-files', '--stage', '-z'])).text);
  async function selectedWorktree(root, paths, index, previousFiles = []) {
    const files = [...new Set([...previousFiles, ...(await read(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', ...paths])).text.split('\0').filter(Boolean)])].sort();
    const entries = [];
    for (const name of files) {
      const file = path.resolve(root, name);
      const relative = path.relative(root, file);
      if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('Git readback path escaped the verified project');
      let stat;
      try { stat = await lstat(file); } catch (error) { if (error.code === 'ENOENT') { entries.push({ path: name, absent: true }); continue; } throw error; }
      if (stat.isSymbolicLink()) { entries.push({ path: name, link: await readlink(file) }); continue; }
      const resolved = await realpath(file);
      const rel = path.relative(samePath(root), samePath(resolved));
      if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) throw new Error('Git readback resolved outside the verified project');
      if (stat.isDirectory() && index.some(entry => entry.path === name && entry.mode === '160000')) {
        const head = (await read(resolved, ['rev-parse', 'HEAD'])).text.trim();
        if (!oid.test(head)) throw new Error('Submodule HEAD is unavailable');
        entries.push({ path: name, gitlink: head }); continue;
      }
      if (!stat.isFile()) throw new Error('Git readback requires a regular file, link or tracked submodule');
      const hash = createHash('sha256');
      for await (const bytes of createReadStream(file, { signal: AbortSignal.timeout(15000) })) hash.update(bytes);
      entries.push({ path: name, sha256: hash.digest('hex'), executable: Boolean(stat.mode & 0o111) });
    }
    return { files, entries };
  }
  const equal = (a, b) => canonical(a) === canonical(b);
  const branchPattern = /^(?![-+])(?!.*\.\.)(?!.*@\{)[^\s\u0000-\u001f\u007f~^:?*\[\\]+$/;
  const remotePattern = /^(?!-)[A-Za-z0-9._/-]+$/;
  async function refsOf(root) {
    return (await read(root, ['for-each-ref', '--format=%(refname)%00%(objectname)%00%(symref)'])).text.trimEnd().split('\n').filter(Boolean).map(line => {
      const [name, object, symbolic] = line.split('\0');
      if (!name?.startsWith('refs/') || !oid.test(object ?? '') || symbolic === undefined) throw new Error('Invalid local Git refs readback');
      return { name, oid: object, symbolic };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }
  async function configOf(root) {
    return (await read(root, ['config', '--local', '--null', '--list'])).text.split('\0').filter(Boolean).sort();
  }
  async function currentBranch(root) { return (await read(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'])).text.trim(); }
  async function configValue(root, key) {
    const result = await read(root, ['config', '--get', key], [0, 1]);
    return result.code === 0 ? result.text.trim() : null;
  }
  async function intendedCommitMessage(root, message) {
    const configured = await read(root, ['config', '--get', 'commit.cleanup'], [0, 1]);
    const mode = configured.code === 1 ? 'default' : configured.text.replace(/\r?\n$/, '');
    if (!['default', 'whitespace', 'strip', 'verbatim', 'scissors'].includes(mode)) throw new Error('Unsupported local commit.cleanup mode');
    // The original writer uses one -m and no editor. Git completes that line;
    // verbatim keeps every other byte. In this non-editor path scissors has
    // whitespace semantics and does not cut a pasted scissors/comment line.
    if (mode === 'verbatim') return message && !message.endsWith('\n') ? message + '\n' : message;
    let comments = mode === 'strip';
    if (comments) {
      const configuredComments = await read(root, ['config', '--null', '--get-regexp', '^core\\.comment(char|string)$'], [0, 1]);
      const overrides = configuredComments.text.split('\0').filter(Boolean);
      const last = overrides.at(-1);
      // commentChar/commentString share Git's ordered configuration. With
      // auto, commit chooses a prefix absent from the supplied message, so
      // stripping comments removes no message line; stripspace alone does not
      // perform that auto-selection and must use its whitespace path instead.
      if (last && last.slice(last.indexOf('\n') + 1) === 'auto') comments = false;
    }
    return (await read(root, ['stripspace', ...(comments ? ['--strip-comments'] : [])], [0], message)).text;
  }
  function expectedRefs(before, changes) {
    const map = new Map(before.map(ref => [ref.name, { ...ref }]));
    for (const [name, object] of changes) map.set(name, { name, oid: object, symbolic: '' });
    // A symbolic origin/HEAD follows its target's new object without being an
    // additional write to a user branch.
    for (let pass = 0; pass < 3; pass++) for (const ref of map.values()) if (ref.symbolic && map.has(ref.symbolic)) ref.oid = map.get(ref.symbolic).oid;
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  async function fetchHeadOf(root) {
    const name = (await read(root, ['rev-parse', '--git-path', 'FETCH_HEAD'])).text.trim();
    const file = path.resolve(root, name);
    try {
      const stat = await fileStat(file, { bigint: true });
      const text = await readFile(file, 'utf8');
      if (Buffer.byteLength(text) > 1024 * 1024) throw new Error('FETCH_HEAD readback exceeds its limit');
      const rows = text.split('\n').filter(Boolean).map(line => {
        const match = /^([a-f0-9]{40}|[a-f0-9]{64})\t([^\t]*)\t([\s\S]+)$/.exec(line);
        if (!match) throw new Error('Invalid FETCH_HEAD readback');
        return { oid: match[1], merge: match[2], description: match[3] };
      });
      return { exists: true, sha256: digest(text), mtimeNs: String(stat.mtimeNs), rows };
    } catch (error) { if (error.code === 'ENOENT') return { exists: false }; throw error; }
  }
  async function remoteOf(root, remote) {
    if (!remotePattern.test(remote) || !Array.isArray(localBareRoots)) throw new Error('Invalid locally resolved remote');
    const fetchUrls = (await read(root, ['remote', 'get-url', '--all', remote])).text.trim().split('\n');
    const pushUrls = (await read(root, ['remote', 'get-url', '--push', '--all', remote])).text.trim().split('\n');
    if (fetchUrls.length !== 1 || pushUrls.length !== 1 || fetchUrls[0] !== pushUrls[0] || !fetchUrls[0] || /[\u0000-\u001f\u007f]/.test(fetchUrls[0])) throw new Error('Readback currently requires one matching configured fetch/push destination');
    const specs = (await read(root, ['config', '--get-all', 'remote.' + remote + '.fetch'])).text.trim().split('\n');
    if (specs.length !== 1 || !['+refs/heads/*:refs/remotes/' + remote + '/*', 'refs/heads/*:refs/remotes/' + remote + '/*'].includes(specs[0])) throw new Error('Readback currently requires the ordinary remote-tracking refspec');
    const urlsSha256 = fingerprint({ fetchUrls, pushUrls, specs });
    if (localBareRoots.length) {
      // Test isolation is explicit. This branch refuses all network transports
      // before any remote read. It is not the production capability policy.
      if (!path.isAbsolute(fetchUrls[0]) || /^\\\\/.test(fetchUrls[0]) || /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(fetchUrls[0])) throw new Error('Only an absolute local bare fixture URL is accepted in isolated tests; network origins are refused');
      const allowed = await Promise.all(localBareRoots.map(async value => {
        if (typeof value !== 'string' || !path.isAbsolute(value) || /^\\\\/.test(value)) throw new Error('Use absolute local bare fixture paths');
        return samePath(await realpath(value));
      }));
      const bare = await realpath(fetchUrls[0]);
      if (!allowed.includes(samePath(bare)) || (await read(bare, ['rev-parse', '--is-bare-repository'])).text.trim() !== 'true') throw new Error('Remote target is not the trusted local bare fixture');
      return { urlsSha256, snapshot: async () => ({ refs: await refsOf(bare), configSha256: fingerprint(await configOf(bare)), head: (await read(bare, ['symbolic-ref', 'HEAD'])).text.trim() }) };
    }
    return { urlsSha256, async snapshot() {
      let snapshot;
      if (readRemoteState) snapshot = await readRemoteState({ projectRoot: root, remote, urlsSha256 });
      else {
        // Fixed argv, remote name from the locally captured plan/config. The
        // model cannot supply a URL, program, flags, env or GraphQL payload.
        const rows = (await read(root, ['ls-remote', '--refs', remote])).text.trim().split('\n').filter(Boolean);
        const refs = rows.map(line => {
          const match = /^([a-f0-9]{40}|[a-f0-9]{64})\t(refs\/[\s\S]+)$/.exec(line);
          if (!match) throw new Error('Invalid configured remote refs readback');
          return { name: match[2], oid: match[1], symbolic: '' };
        }).sort((a, b) => a.name.localeCompare(b.name));
        const headRows = (await read(root, ['ls-remote', '--symref', remote, 'HEAD'])).text.trim().split('\n').filter(Boolean);
        const symbolic = headRows.find(line => /^ref: refs\/[^\t]+\tHEAD$/.test(line));
        const object = headRows.find(line => /^(?:[a-f0-9]{40}|[a-f0-9]{64})\tHEAD$/.test(line));
        snapshot = { refs, configSha256: null, head: symbolic ? symbolic.slice(5, -5) : object ? 'oid:' + object.split('\t')[0] : 'unborn' };
      }
      if (!snapshot || !Array.isArray(snapshot.refs) || typeof snapshot.head !== 'string' ||
          new Set(snapshot.refs.map(ref => ref.name)).size !== snapshot.refs.length ||
          snapshot.refs.some(ref => typeof ref.name !== 'string' || !ref.name.startsWith('refs/') || !oid.test(ref.oid ?? '') || ref.symbolic !== '') ||
          snapshot.configSha256 !== null && !/^[a-f0-9]{64}$/.test(snapshot.configSha256 ?? '')) throw new Error('Trusted remote reader did not return a complete refs snapshot');
      return { ...snapshot, refs: [...snapshot.refs].sort((a, b) => a.name.localeCompare(b.name)) };
    } };
  }
  async function prepareNetwork({ method, projectRoot, parameters, trustedTicket, threadId }) {
    const mismatch = reason => { try { onMismatch?.(reason); } catch {} return null; };
    const root = await rootOf(projectRoot), capture = trustedTicket, check = capture?.check, ticket = check?.ticket, plan = check?.plan;
    const op = method.slice(3).toLowerCase(), now = Date.now();
    if (typeof threadId !== 'string' || !threadId || capture?.threadId !== threadId ||
        typeof capture?.projectRoot !== 'string' || samePath(await realpath(capture.projectRoot)) !== samePath(root) ||
        check?.ok !== true || !['allow', 'warn'].includes(check.decision?.verdict) || ticket?.op !== op ||
        ticket?.id !== parameters?.ticketId || !/^[A-Za-z0-9_-]{1,64}$/.test(ticket?.id ?? '') ||
        !Number.isFinite(ticket?.checkedAtMs) || !Number.isFinite(ticket?.expiresAtMs) || ticket.checkedAtMs > now + 5000 ||
        ticket.expiresAtMs <= now || ticket.expiresAtMs <= ticket.checkedAtMs || ticket.expiresAtMs - ticket.checkedAtMs > 120000 ||
        parameters?.expectedThreadId !== undefined && parameters.expectedThreadId !== threadId || !plan || typeof plan !== 'object') {
      throw new Error('Use the live gitWriteCheck reply captured locally for this exact project, thread, ticket and method');
    }
    const branch = await currentBranch(root);
    if (!branchPattern.test(branch) || plan.localBranch !== branch) throw new Error('Local branch differs from the captured preflight plan');
    let remote = plan.remote, targetBranch = plan.branch;
    if (method === 'gitPull') {
      remote = await configValue(root, 'branch.' + branch + '.remote');
      const merge = await configValue(root, 'branch.' + branch + '.merge');
      targetBranch = merge?.startsWith('refs/heads/') ? merge.slice(11) : null;
      if (!remote || plan.mode !== 'existing' || plan.upstream !== remote + '/' + targetBranch) throw new Error('Pull upstream differs from the captured preflight plan');
    }
    if (!remotePattern.test(remote ?? '') || method !== 'gitFetch' && !branchPattern.test(targetBranch ?? '') ||
        method === 'gitFetch' && plan.mode !== 'fetch' || method === 'gitPush' && !['existing', 'set-upstream', 'recreate'].includes(plan.mode)) throw new Error('Captured preflight plan has no valid target');
    const destination = await remoteOf(root, remote);
    const beforeHead = (await read(root, ['rev-parse', 'HEAD'])).text.trim();
    if (!oid.test(beforeHead)) throw new Error('Network write readback requires a local HEAD');
    const beforeIndex = await indexOf(root), beforeWorktree = await selectedWorktree(root, ['.'], beforeIndex);
    const beforeRefs = await refsOf(root), beforeConfig = await configOf(root), beforeRemote = await destination.snapshot();
    const beforeBareRefs = beforeRemote.refs, beforeBareConfig = beforeRemote.configSha256, beforeBareHead = beforeRemote.head;
    const beforeFetchHead = await fetchHeadOf(root);
    const remoteHeads = beforeBareRefs.filter(ref => ref.name.startsWith('refs/heads/') && !ref.symbolic);
    const trackingChanges = remoteHeads.map(ref => ['refs/remotes/' + remote + '/' + ref.name.slice(11), ref.oid]);
    let expectedHead = beforeHead;
    if (method === 'gitPull') {
      expectedHead = remoteHeads.find(ref => ref.name === 'refs/heads/' + targetBranch)?.oid;
      if (!oid.test(expectedHead ?? '')) throw new Error('Pull cannot establish its intended remote branch');
      if ((await read(root, ['diff', '--no-ext-diff', '--no-textconv', '--quiet'], [0, 1])).code !== 0 ||
          (await read(root, ['diff', '--cached', '--no-ext-diff', '--no-textconv', '--quiet', 'HEAD'], [0, 1])).code !== 0) throw new Error('Fast-forward acceptance currently requires a clean local index and worktree');
    }
    const beforeStateSha256 = fingerprint({ beforeHead, beforeIndex, beforeWorktree: beforeWorktree.entries, beforeRefs, beforeConfig,
      beforeBareRefs, beforeBareConfig, beforeBareHead, beforeFetchHead, urlsSha256: destination.urlsSha256, plan });
    const target = { beforeOid: beforeHead, remote, beforeStateSha256,
      ...(method === 'gitFetch' ? {} : { branch: targetBranch }),
      ...(method === 'gitPush' ? { commitOid: beforeHead } : method === 'gitPull' ? { expectedAfterOid: expectedHead } : {}) };
    return { target,
      async verify(response) {
        const value = business(response);
        // An original write error stays uncertain even when some refs moved.
        // This path never retries or turns a partial failure into success.
        if (value?.ok !== true) return mismatch('original-write-not-successful');
        if (method === 'gitFetch' && (value.mode !== 'fetched' || value.remote !== remote) ||
            method === 'gitPull' && (value.headBefore !== beforeHead || value.headAfter !== expectedHead || value.upstream !== plan.upstream || value.mode !== (expectedHead === beforeHead ? 'up-to-date' : 'fast-forward')) ||
            method === 'gitPush' && (value.remote !== remote || value.branch !== targetBranch || value.mode !== (plan.mode === 'set-upstream' ? 'set-upstream' : 'existing-upstream'))) return mismatch('response-target-mismatch');
        const afterDestination = await remoteOf(root, remote);
        if (afterDestination.urlsSha256 !== destination.urlsSha256 || await currentBranch(root) !== branch) return mismatch('configured-target-changed');
        const head = (await read(root, ['rev-parse', 'HEAD'])).text.trim(), index = await indexOf(root);
        const worktree = await selectedWorktree(root, ['.'], index, method === 'gitPull' ? [] : beforeWorktree.files);
        const refs = await refsOf(root), config = await configOf(root), remoteState = await afterDestination.snapshot(), bareRefs = remoteState.refs, bareConfig = remoteState.configSha256;
        // ls-remote cannot advertise an unborn remote HEAD. On the first
        // successful push to an empty destination, HEAD may become visible as
        // the exact new branch/commit. The complete refs comparison below
        // still rejects any unrelated branch or tag change.
        const firstBornHead = method === 'gitPush' && beforeBareHead === 'unborn' && beforeBareRefs.length === 0 &&
          ['refs/heads/' + targetBranch, 'oid:' + beforeHead].includes(remoteState.head);
        if (!equal(bareConfig, beforeBareConfig) || remoteState.head !== beforeBareHead && !firstBornHead) return mismatch('remote-identity-changed');
        if (method === 'gitPush') {
          const expectedBare = expectedRefs(beforeBareRefs, [['refs/heads/' + targetBranch, beforeHead]]);
          if (!equal(bareRefs, expectedBare) || head !== beforeHead || !equal(index, beforeIndex) || !equal(worktree.entries, beforeWorktree.entries)) return null;
          const expectedLocal = expectedRefs(beforeRefs, [['refs/remotes/' + remote + '/' + targetBranch, beforeHead]]);
          if (!equal(refs, expectedLocal)) return null;
          let expectedConfig = beforeConfig;
          if (plan.mode !== 'existing') {
            const keys = ['branch.' + branch + '.remote', 'branch.' + branch + '.merge'];
            expectedConfig = [...beforeConfig.filter(entry => !keys.includes(entry.split('\n')[0])), keys[0] + '\n' + remote, keys[1] + '\nrefs/heads/' + targetBranch].sort();
          }
          if (!equal(config, expectedConfig) || await configValue(root, 'branch.' + branch + '.remote') !== remote ||
              await configValue(root, 'branch.' + branch + '.merge') !== 'refs/heads/' + targetBranch) return null;
        } else {
          if (!equal(bareRefs, beforeBareRefs) || !equal(config, beforeConfig)) return mismatch('fetch-remote-or-config-changed');
          const changes = [...trackingChanges, ...(method === 'gitPull' ? [['refs/heads/' + branch, expectedHead]] : [])];
          const expectedLocalRefs = expectedRefs(beforeRefs, changes);
          // Current Git can create remote/HEAD on the first fetch. Accept only
          // that exact symbolic reference to the independently read remote
          // HEAD, never an extra local branch or an arbitrary symbolic target.
          const remoteHeadName = 'refs/remotes/' + remote + '/HEAD';
          const actualRemoteHead = refs.find(ref => ref.name === remoteHeadName);
          if (!beforeRefs.some(ref => ref.name === remoteHeadName) && actualRemoteHead && beforeBareHead.startsWith('refs/heads/')) {
            const remoteHeadBranch = 'refs/remotes/' + remote + '/' + beforeBareHead.slice(11);
            const object = remoteHeads.find(ref => ref.name === beforeBareHead)?.oid;
            if (actualRemoteHead.symbolic !== remoteHeadBranch || actualRemoteHead.oid !== object) return mismatch('remote-head-symbol-mismatch');
            expectedLocalRefs.push({ ...actualRemoteHead });
          }
          // Ordinary fetch may auto-follow reachable tags. Newly observed
          // tags must exactly match this remote snapshot; existing tags cannot
          // be overwritten under this known-success rule.
          for (const ref of refs) if (ref.name.startsWith('refs/tags/') && !beforeRefs.some(old => old.name === ref.name)) {
            if (!bareRefs.some(remoteRef => equal(remoteRef, ref))) return mismatch('fetch-added-unrelated-tag');
            expectedLocalRefs.push({ ...ref });
          }
          expectedLocalRefs.sort((a, b) => a.name.localeCompare(b.name));
          if (!equal(refs, expectedLocalRefs)) return mismatch('tracking-or-local-refs-mismatch');
          const fetched = await fetchHeadOf(root);
          const fetchRows = [
            ...remoteHeads.map(ref => ({ oid: ref.oid, prefix: "branch '" + ref.name.slice(11) + "' of " })),
            ...bareRefs.filter(ref => ref.name.startsWith('refs/tags/')).map(ref => ({ oid: ref.oid, prefix: "tag '" + ref.name.slice(10) + "' of " })),
          ];
          if (!fetched.exists || beforeFetchHead.exists && fetched.mtimeNs === beforeFetchHead.mtimeNs ||
              fetched.rows.length < remoteHeads.length || fetched.rows.some(row => !fetchRows.some(ref => ref.oid === row.oid && row.description.startsWith(ref.prefix))) ||
              remoteHeads.some(ref => !fetched.rows.some(row => row.oid === ref.oid && row.description.startsWith("branch '" + ref.name.slice(11) + "' of ")))) return mismatch('fetch-head-not-observed');
          if (method === 'gitFetch') {
            if (head !== beforeHead || !equal(index, beforeIndex) || !equal(worktree.entries, beforeWorktree.entries)) return mismatch('fetch-altered-local-content');
          } else {
            if (head !== expectedHead || (await read(root, ['merge-base', '--is-ancestor', beforeHead, expectedHead], [0, 1])).code !== 0 ||
                (await read(root, ['diff', '--no-ext-diff', '--no-textconv', '--quiet'], [0, 1])).code !== 0) return null;
            const tree = (await read(root, ['ls-tree', '-r', '-z', expectedHead])).text.split('\0').filter(Boolean).map(line => {
              const match = /^(\d{6}) (?:blob|commit) ([a-f0-9]{40}|[a-f0-9]{64})\t([\s\S]+)$/.exec(line);
              if (!match) throw new Error('Invalid fast-forward tree readback');
              return { mode: match[1], oid: match[2], stage: '0', path: match[3] };
            }).sort((a, b) => a.path.localeCompare(b.path));
            if (!equal(index, tree)) return null;
            const oldTracked = new Set(beforeIndex.map(entry => entry.path)), newTracked = new Set(index.map(entry => entry.path));
            if (!equal(beforeWorktree.entries.filter(entry => !oldTracked.has(entry.path)), worktree.entries.filter(entry => !newTracked.has(entry.path)))) return null;
          }
        }
        return { target: { ...target, expectedStateSha256: fingerprint({ head, index, refs, config, bareRefs }) },
          resultSha256: fingerprint({ head, index, worktree: worktree.entries, refs, config, bareRefs, bareConfig }) };
      } };
  }
  async function prepare({ method, projectRoot, parameters, trustedTicket, threadId }) {
    if (['gitFetch', 'gitPull', 'gitPush'].includes(method)) return prepareNetwork({ method, projectRoot, parameters, trustedTicket, threadId });
    if (!['gitStage', 'gitUnstage', 'gitCommit'].includes(method)) throw new Error('Git effect verifier is not implemented for this method');
    const root = await rootOf(projectRoot), beforeIndex = await indexOf(root);
    const headRead = await read(root, ['rev-parse', '--verify', 'HEAD'], [0, 128]);
    const beforeHead = headRead.code === 0 ? headRead.text.trim() : null;
    if (beforeHead !== null && !oid.test(beforeHead)) throw new Error('Git HEAD is unavailable');
    if (method === 'gitCommit') {
      if (!beforeHead || beforeIndex.some(entry => entry.stage !== '0') || typeof parameters?.message !== 'string') throw new Error('Commit readback requires HEAD, a resolved index and message');
      const intendedMessage = await intendedCommitMessage(root, parameters.message);
      const beforeStateSha256 = fingerprint({ beforeHead, beforeIndex });
      const target = { beforeOid: beforeHead, beforeStateSha256, contentSha256: digest(parameters.message),
        expectedStateSha256: fingerprint({ parent: beforeHead, index: beforeIndex, messageSha256: digest(intendedMessage) }) };
      return { target,
        async verify(response) {
          const value = business(response);
          if (value?.ok !== true || value.committed !== true || value.headBefore !== beforeHead || !oid.test(value.headAfter ?? '')) return null;
          const head = (await read(root, ['rev-parse', 'HEAD'])).text.trim();
          if (head !== value.headAfter || head === beforeHead) return null;
          const commit = (await read(root, ['cat-file', 'commit', head])).text;
          const split = commit.indexOf('\n\n'); if (split < 0) return null;
          const parents = [...commit.slice(0, split).matchAll(/^parent (.+)$/gm)].map(item => item[1]);
          if (canonical(parents) !== canonical([beforeHead]) || commit.slice(split + 2) !== intendedMessage) return null;
          const tree = (await read(root, ['ls-tree', '-r', '-z', head])).text.split('\0').filter(Boolean).map(line => {
            const match = /^(\d{6}) (?:blob|commit) ([a-f0-9]{40}|[a-f0-9]{64})\t([\s\S]+)$/.exec(line);
            if (!match) throw new Error('Invalid committed tree readback');
            return { mode: match[1], oid: match[2], stage: '0', path: match[3] };
          }).sort((a, b) => a.path.localeCompare(b.path));
          if (canonical(tree) !== canonical(beforeIndex)) return null;
          return { target: { ...target, commitOid: head }, resultSha256: fingerprint({ head, tree, parents }) };
        } };
    }
    if (method === 'gitUnstage' && !beforeHead) throw new Error('Unstage readback requires an existing HEAD');
    const paths = checkedPaths(parameters?.paths);
    const headPaths = method === 'gitUnstage' ? (await read(root, ['ls-tree', '-r', '--name-only', '-z', 'HEAD', '--', ...paths])).text.split('\0').filter(Boolean) : [];
    const beforeWorktree = await selectedWorktree(root, paths, beforeIndex, headPaths);
    const selected = new Set(beforeWorktree.files);
    const beforeOutside = beforeIndex.filter(entry => !selected.has(entry.path));
    const target = { paths, beforeStateSha256: fingerprint({ beforeHead, beforeIndex, worktree: beforeWorktree.entries }) };
    return { target,
      async verify(response) {
        const value = business(response), field = method === 'gitStage' ? 'staged' : 'unstaged';
        if (value?.ok !== true || canonical(value[field]) !== canonical(paths)) return null;
        const afterIndex = await indexOf(root), afterWorktree = await selectedWorktree(root, paths, afterIndex, beforeWorktree.files);
        if (canonical(beforeWorktree.entries) !== canonical(afterWorktree.entries) ||
            canonical(beforeOutside) !== canonical(afterIndex.filter(entry => !selected.has(entry.path)))) return null;
        if (method === 'gitStage') for (const entry of beforeWorktree.entries) {
          const indexed = afterIndex.filter(item => item.path === entry.path);
          if (entry.absent ? indexed.length !== 0 : indexed.length !== 1 || indexed[0].stage !== '0') return null;
          if (entry.gitlink && indexed[0].oid !== entry.gitlink) return null;
        }
        const args = method === 'gitStage' ? ['diff', '--no-ext-diff', '--no-textconv', '--ignore-submodules=dirty', '--quiet', '--', ...paths]
          : ['diff', '--cached', '--no-ext-diff', '--no-textconv', '--quiet', 'HEAD', '--', ...paths];
        if ((await read(root, args, [0, 1])).code !== 0) return null;
        const head = (await read(root, ['rev-parse', '--verify', 'HEAD'], [0, 128]));
        if ((head.code === 0 ? head.text.trim() : null) !== beforeHead) return null;
        return { target: { ...target, expectedStateSha256: fingerprint(afterIndex) }, resultSha256: fingerprint({ index: afterIndex, worktree: afterWorktree.entries }) };
      } };
  }
  return { prepare };
}
