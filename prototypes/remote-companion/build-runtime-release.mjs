import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, realpath, readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { verifyFrozenAdapter } from './freeze-adapter.mjs';
import { verifyClientRelease, CLIENT_LAUNCH_TEMPLATE, CLIENT_RELEASE_MANIFEST, CLIENT_RELEASE_ENTRY } from './client-launch.mjs';

const run = promisify(execFile), sha = bytes => createHash('sha256').update(bytes).digest('hex');
const HASH = /^[a-f0-9]{64}$/, COMMIT = /^[a-f0-9]{40}$/;
const RUNTIME_ENTRY = 'prototypes/remote-companion/launch.mjs', ADAPTER_ENTRY = 'prototypes/upstream-port/sidebar-server.mjs';
const fold = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
const fail = (code, message) => Object.assign(new Error(message), { code });
const need = (condition, code, message) => { if (!condition) throw fail(code, message); };
const inside = (root, file) => { const relative = path.relative(fold(root), fold(file)); return relative === '' || relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative); };
const exists = file => lstat(file).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
function relative(value) {
  need(typeof value === 'string' && value.length <= 2048 && !/[\\:\u0000-\u001f\u007f]/.test(value) && !value.startsWith('/') &&
    !value.split('/').some(part => !part || ['.', '..', '.git', 'node_modules'].includes(part)), 'RUNTIME_PATH', 'Unsafe release path');
  return value;
}
async function ordinary(file, directory = false) {
  need(typeof file === 'string' && path.isAbsolute(file) && !/^\\\\/.test(file) && !/[\u0000-\u001f\u007f]/.test(file), 'RUNTIME_PATH', 'Use an absolute local path');
  const actual = await realpath(file), info = await lstat(file);
  need(!info.isSymbolicLink() && fold(actual) === fold(file) && (directory ? info.isDirectory() : info.isFile()), 'RUNTIME_PATH', 'Release inputs cannot redirect');
  return actual;
}
function sourceFile(name) {
  return /^prototypes\/remote-companion\/[^/]+\.mjs$/.test(name) && !/(?:^|[-.])(?:test|spec|benchmark|bench)(?:[-.]|$)/i.test(path.posix.basename(name)) &&
    !/^(?:measure-|benchmark-|bench-|credentials?\.|secrets?\.|\.env)/i.test(path.posix.basename(name));
}
async function gitSnapshot(repository, commit) {
  need(COMMIT.test(commit ?? ''), 'RUNTIME_COMMIT', 'Pin a full 40-character commit; HEAD, branches and worktree files are not sources');
  const root = await ordinary(repository, true), env = { ...process.env, GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1', GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };
  const git = async args => {
    try { return (await run('git', ['--no-optional-locks', '-C', root, ...args], { env, windowsHide: true, encoding: 'buffer', timeout: 20000, maxBuffer: 33 * 1024 * 1024 })).stdout; }
    catch { throw fail('RUNTIME_GIT', 'Fixed local Git objects are unavailable; no network fetch or working-tree fallback'); }
  };
  need((await git(['cat-file', '-t', commit])).toString().trim() === 'commit', 'RUNTIME_COMMIT', 'The pinned object must be a commit');
  const tree = await git(['ls-tree', '-r', '-z', '--full-tree', commit, '--', 'prototypes/remote-companion']);
  const entries = tree.toString('utf8').split('\0').filter(Boolean).map(row => {
    const match = /^(\d{6}) (blob|tree|commit) ([a-f0-9]{40})\t([\s\S]+)$/.exec(row);
    need(match, 'RUNTIME_GIT', 'Invalid fixed Git tree'); return { mode: match[1], type: match[2], oid: match[3], path: match[4] };
  }).filter(entry => sourceFile(entry.path));
  need(entries.length > 0 && entries.length < 1500, 'RUNTIME_GIT', 'No bounded runtime source set');
  const files = new Map();
  for (const entry of entries) {
    relative(entry.path); need(entry.type === 'blob' && ['100644', '100755'].includes(entry.mode), 'RUNTIME_GIT', 'Source links and submodules are not release files');
    const bytes = await git(['cat-file', 'blob', entry.oid]);
    need(bytes.length <= 32 * 1024 * 1024 && createHash('sha1').update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex') === entry.oid,
      'RUNTIME_GIT', 'Fixed Git object hash changed'); files.set(entry.path, bytes);
  }
  async function unchanged() {
    need((await git(['ls-tree', '-r', '-z', '--full-tree', commit, '--', 'prototypes/remote-companion'])).equals(tree), 'RUNTIME_SOURCE_DRIFT', 'Fixed source tree changed');
    for (const entry of entries) need((await git(['cat-file', 'blob', entry.oid])).equals(files.get(entry.path)), 'RUNTIME_SOURCE_DRIFT', 'Fixed source bytes changed');
  }
  return { files, unchanged };
}

// Compile only: SourceTextModule parses static imports/exports without linking
// or evaluate(). Pinned Git/candidate code is never imported as verification.
const PARSER = String.raw`const {SourceTextModule}=require('node:vm');let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',v=>input+=v);process.stdin.on('end',()=>{try{const rows=JSON.parse(input),out=[];for(const row of rows){const m=new SourceTextModule(Buffer.from(row.source,'base64').toString('utf8'));out.push({path:row.path,imports:m.dependencySpecifiers});}process.stdout.write(JSON.stringify(out));}catch{process.stderr.write('Module syntax check failed');process.exitCode=1;}});`;
async function staticImports(files) {
  const rows = [...files].filter(([name]) => /\.(?:mjs|js)$/.test(name)).map(([name, bytes]) => ({ path: name, source: bytes.toString('base64') }));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--experimental-vm-modules', '-e', PARSER], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const output = []; let length = 0; const timer = setTimeout(() => { child.kill(); reject(fail('RUNTIME_IMPORTS', 'Static module parsing timed out')); }, 30000);
    child.on('error', () => { clearTimeout(timer); reject(fail('RUNTIME_IMPORTS', 'Static module parser unavailable')); });
    child.stdout.on('data', chunk => { length += chunk.length; if (length > 4 * 1024 * 1024) child.kill(); else output.push(chunk); }); child.stderr.resume();
    child.stdin.on('error', () => {}); child.stdin.end(JSON.stringify(rows));
    child.on('close', code => { clearTimeout(timer); if (code || length > 4 * 1024 * 1024) reject(fail('RUNTIME_IMPORTS', 'Static module syntax is invalid')); else try { resolve(JSON.parse(Buffer.concat(output).toString())); } catch { reject(fail('RUNTIME_IMPORTS', 'Invalid static module index')); } });
  });
}
function tokens(text) {
  const out = []; let i = 0;
  while (i < text.length) {
    if (/\s/.test(text[i])) { i++; continue; }
    if (text.startsWith('//', i)) { i = text.indexOf('\n', i + 2); if (i < 0) break; continue; }
    if (text.startsWith('/*', i)) { const end = text.indexOf('*/', i + 2); i = end < 0 ? text.length : end + 2; continue; }
    if (text[i] === '`') { i++; while (i < text.length) { if (text[i] === '\\') i += 2; else if (text[i++] === '`') break; } continue; }
    if (text[i] === '"' || text[i] === "'") {
      const quote = text[i++]; let value = '';
      while (i < text.length && text[i] !== quote) { if (text[i] === '\\') { i++; value += text[i++] ?? ''; } else value += text[i++]; }
      i++; out.push({ value, string: true }); continue;
    }
    const word = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(text.slice(i));
    if (word) { out.push({ value: word[0] }); i += word[0].length; } else out.push({ value: text[i++] });
  }
  return out;
}
export async function verifyImportClosure(files) {
  const rows = await staticImports(files), missing = []; let relativeImports = 0, dynamicImports = 0;
  const check = (from, spec, base = path.posix.dirname(from)) => {
    if (!spec.startsWith('.')) return;
    const resolved = path.posix.normalize(path.posix.join(base, decodeURIComponent(spec.split(/[?#]/)[0])));
    need(!resolved.startsWith('../') && !resolved.startsWith('/'), 'RUNTIME_IMPORTS', 'Relative import escapes release');
    relativeImports++; if (!files.has(resolved)) missing.push(from + ' -> ' + spec + ' (' + resolved + ')');
  };
  for (const row of rows) {
    for (const spec of row.imports) check(row.path, spec);
    const list = tokens(files.get(row.path).toString('utf8'));
    for (let i = 0; i < list.length; i++) if (list[i].value === 'import' && !list[i].string && list[i + 1]?.value === '(') {
      if (list[i + 2]?.string) { check(row.path, list[i + 2].value); dynamicImports++; }
      else if (list[i + 2]?.value === 'new' && list[i + 3]?.value === 'URL' && list[i + 5]?.string) {
        const spec = list[i + 5].value, tail = list.slice(i + 6, i + 24).map(token => token.value).join('');
        if (tail.includes('import.meta.url')) check(row.path, spec);
        else if (tail.includes('pathToFileURL(') && ['prototypes/remote-companion/launch.mjs', 'prototypes/remote-companion/companion.mjs'].includes(row.path)) check(row.path, spec, 'prototypes/upstream-port');
        else throw fail('RUNTIME_IMPORTS', 'Relative dynamic URL has no approved static base: ' + row.path);
        dynamicImports++;
      } else if (list[i + 2]?.value === 'pathToFileURL' && list[i + 4]?.value === 'path' && list[i + 6]?.value === 'join' && list[i + 8]?.value === 'vendor' && list[i + 10]?.string) {
        const resolved = relative('vendor/mattskills-1.8.0-rc.7/' + list[i + 10].value); dynamicImports++; if (!files.has(resolved)) missing.push(row.path + ' -> ' + resolved);
      }
    }
  }
  need(!missing.length, 'RUNTIME_IMPORTS', 'Missing relative import closure: ' + missing.slice(0, 8).join('; '));
  return { modulesParsedWithoutEvaluation: rows.length, relativeImports, dynamicImports };
}

function declaration(files, adapterManifest) {
  const text = name => { need(files.has(name), 'RUNTIME_REQUIRED', 'Missing runtime module ' + name); return files.get(name).toString('utf8'); };
  const protocol = [...text('prototypes/remote-companion/protocol.mjs').matchAll(/^export const VERSION = (\d+);\r?$/gm)];
  const overlay = [...text('prototypes/remote-companion/freeze-adapter.mjs').matchAll(/^export const OVERLAY_VERSION = ['"]([^'"\r\n]+)['"];\r?$/gm)];
  need(protocol.length === 1 && protocol[0][1] === '1', 'RUNTIME_PROTOCOL', 'The fixed source must explicitly declare protocol 1');
  need(overlay.length === 1 && overlay[0][1] === adapterManifest.overlayVersion, 'RUNTIME_OVERLAY', 'Fixed runtime source and adapter overlay must match');
  text(CLIENT_RELEASE_ENTRY); text(RUNTIME_ENTRY);
  const template = /export const CLIENT_LAUNCH_TEMPLATE = String\.raw`([\s\S]*?)`;/.exec(text(CLIENT_RELEASE_ENTRY));
  need(template && !template[1].includes('${') && template[1].replace(/\r\n/g, '\n') === CLIENT_LAUNCH_TEMPLATE.replace(/\r\n/g, '\n'), 'RUNTIME_BOOTSTRAP', 'Fixed source must use the reviewed client catalog bootstrap');
  return { protocolVersion: 1, overlayVersion: overlay[0][1] };
}

const PAIRING_CHECK = String.raw`  $stage='external-pairing'
  function Get-LocalAbsolute([string]$value){
    if($value -notmatch '^[A-Za-z]:[\\/]' -or $value -match '[\x00-\x1f\x7f]'){throw 'absolute local state path required'}
    $full=[IO.Path]::GetFullPath($value);$cursor=$full
    while($cursor){
      if(Test-Path -LiteralPath $cursor){if((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'state link'}}
      $parent=[IO.Path]::GetDirectoryName($cursor.TrimEnd('\'));if($parent -eq $cursor){break};$cursor=$parent
    }
    return $full
  }
  function Assert-External([string]$value){
    $full=Get-LocalAbsolute $value
    if($full -ieq $root -or $full.StartsWith($root.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'state inside release'}
    return $full
  }
  $pairingPath=Assert-External $PairingFile
  $pairingItem=Get-Item -LiteralPath $pairingPath -Force
  if($pairingItem.PSIsContainer -or $pairingItem.Length -gt 32768){throw 'pairing record'}
  $pairing=Get-Content -LiteralPath $pairingPath -Raw | ConvertFrom-Json
  if($manifest.protocolVersion -ne 1 -or $pairing.protocolVersion -ne 1 -or $manifest.runtimeEntrypoint -cne 'prototypes/remote-companion/launch.mjs' -or $manifest.adapterRelativePath -cne 'prototypes/upstream-port/sidebar-server.mjs' -or $manifest.adapterManifestSha256 -notmatch '^[a-f0-9]{64}$'){throw 'runtime declaration'}
  if($pairing.PSObject.Properties.Name -contains 'writeLedgerFile' -or $pairing.PSObject.Properties.Name -contains 'writeLedgerPath'){throw 'ledger override'}
  $adapter=Get-LocalAbsolute $pairing.adapterPath
  $expectedAdapter=Join-Path $root 'prototypes\upstream-port\sidebar-server.mjs'
  if($adapter -ine $expectedAdapter -or (Get-LocalAbsolute $pairing.baseline.directory) -ine $root -or $pairing.baseline.manifestSha256 -cne $manifest.adapterManifestSha256){throw 'pairing baseline does not select this release'}
  if((Get-LocalSha256 (Join-Path $root 'frozen-adapter.json')) -cne $manifest.adapterManifestSha256){throw 'adapter manifest drift'}
  $localData=Assert-External $pairing.localDataRoot
  if(-not(Test-Path -LiteralPath $localData -PathType Container) -or $root.StartsWith($localData.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'explicit disjoint data root required'}
  $journal=Assert-External $pairing.journalPath
  if(-not(Test-Path -LiteralPath ([IO.Path]::GetDirectoryName($journal)) -PathType Container)){throw 'external journal parent required'}
  $ledger=Assert-External (Join-Path (Get-LocalAbsolute $env:LOCALAPPDATA) 'MattSkillsDeck\RemoteCompanion\write-ledger.sqlite')
  $PairingFile=$pairingPath
`;
export function companionLaunchScript() {
  let result = CLIENT_LAUNCH_TEMPLATE.replace(/\r\n/g, '\n').replaceAll('$CallerFile', '$PairingFile');
  const oldEntry = "$entrypoint=Join-Path $root 'prototypes\\remote-companion\\client-launch.mjs'";
  const oldRun = "  & $NodeExe $entrypoint 'start' $PairingFile '--release-dir' $root '--manifest-sha256' $ManifestSha256";
  need(result.split(oldEntry).length === 2 && result.split(oldRun).length === 2, 'RUNTIME_BOOTSTRAP', 'Client bootstrap anchor drift');
  result = result.replace(oldEntry, () => "$entrypoint=Join-Path $root 'prototypes\\remote-companion\\launch.mjs'");
  return result.replace(oldRun, () => PAIRING_CHECK.replace(/\r\n/g, '\n') + "  & $NodeExe $entrypoint '--pairing' $PairingFile");
}

async function verifyPowerShellSyntax(script) {
  need(process.platform === 'win32', 'RUNTIME_PLATFORM', 'This Windows release builder requires Windows PowerShell syntax verification');
  const command = "$fixtureScript=[Console]::In.ReadToEnd();$fixtureTokens=$null;$fixtureErrors=$null;[Management.Automation.Language.Parser]::ParseInput($fixtureScript,[ref]$fixtureTokens,[ref]$fixtureErrors)|Out-Null;if($fixtureErrors.Count){exit 1}";
  try {
    const pending = run(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', command],
      { windowsHide: true, timeout: 15000, maxBuffer: 16384 }); pending.child.stdin.end(script); await pending;
  } catch { throw fail('RUNTIME_BOOTSTRAP', 'Generated companion PowerShell syntax is invalid or its parser is unavailable'); }
}

async function catalog(root, expected, incomplete = false) {
  const actual = []; async function walk(folder, prefix = '') {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const name = prefix + entry.name, file = path.join(folder, entry.name);
      need(!entry.isSymbolicLink(), 'RUNTIME_CATALOG', 'Release contains a link');
      if (entry.isDirectory()) await walk(file, name + '/');
      else { need(entry.isFile(), 'RUNTIME_CATALOG', 'Release contains a non-file'); if (name !== CLIENT_RELEASE_MANIFEST && !(incomplete && name === 'INCOMPLETE')) actual.push(name); }
    }
  } await walk(root);
  need(actual.length === expected.size && actual.every(name => expected.has(name)), 'RUNTIME_CATALOG', 'Release contains extra or missing files');
  for (const [name, bytes] of expected) need((await readFile(await ordinary(path.join(root, name)))).equals(bytes), 'RUNTIME_CATALOG', 'Release file drift: ' + name);
}

export async function verifyRuntimeRelease({ directory, expectedManifestSha256 }) {
  need(!await exists(path.join(directory, 'INCOMPLETE')), 'RUNTIME_INCOMPLETE', 'Release is incomplete');
  const verified = await verifyClientRelease({ directory, expectedManifestSha256 });
  const manifest = JSON.parse(await readFile(path.join(verified.directory, CLIENT_RELEASE_MANIFEST), 'utf8'));
  need(COMMIT.test(manifest.sourceCommit ?? '') && manifest.protocolVersion === 1 && manifest.runtimeEntrypoint === RUNTIME_ENTRY && manifest.adapterRelativePath === ADAPTER_ENTRY && HASH.test(manifest.adapterManifestSha256 ?? ''), 'RUNTIME_METADATA', 'Invalid complete runtime release metadata');
  const adapter = await verifyFrozenAdapter({ directory: verified.directory, expectedManifestSha256: manifest.adapterManifestSha256 });
  need(adapter.fileCount === 450 && adapter.overlayVersion === manifest.overlayVersion, 'RUNTIME_METADATA', 'Adapter count or overlay differs');
  const files = new Map(); for (const item of manifest.files) files.set(item.path, await readFile(path.join(verified.directory, item.path)));
  declaration(files, manifest); const imports = await verifyImportClosure(files);
  await verifyPowerShellSyntax(files.get('start-companion.ps1').toString('utf8'));
  return { ...verified, sourceCommit: manifest.sourceCommit, protocolVersion: 1, adapterManifestSha256: manifest.adapterManifestSha256, runtimeEntrypoint: path.join(verified.directory, RUNTIME_ENTRY), imports };
}

export async function buildRuntimeRelease({ repository, sourceCommit, adapterDirectory, adapterManifestSha256, outputDirectory, releaseId } = {}) {
  const buildToolSha256 = sha(await readFile(new URL(import.meta.url)));
  need(HASH.test(adapterManifestSha256 ?? ''), 'RUNTIME_ADAPTER', 'Pin the frozen adapter manifest SHA256');
  const source = await gitSnapshot(repository, sourceCommit), adapterRoot = await ordinary(adapterDirectory, true);
  const adapter = await verifyFrozenAdapter({ directory: adapterRoot, expectedManifestSha256: adapterManifestSha256 });
  need(adapter.fileCount === 450, 'RUNTIME_ADAPTER', 'Use the reviewed 450-file adapter');
  const adapterBytes = await readFile(path.join(adapterRoot, 'frozen-adapter.json')), frozen = JSON.parse(adapterBytes), files = source.files;
  for (const entry of frozen.files) {
    relative(entry.path); const file = await ordinary(path.join(adapterRoot, entry.path)); need(inside(adapterRoot, file), 'RUNTIME_ADAPTER', 'Adapter path escaped');
    const bytes = await readFile(file); need(bytes.length === entry.bytes && sha(bytes) === entry.sha256, 'RUNTIME_ADAPTER', 'Adapter changed during capture'); files.set(entry.path, bytes);
  }
  need(files.has('vendor/mattskills-1.8.0-rc.7/LICENSE') && files.has('vendor/mattskills-1.8.0-rc.7/bundled-skills/LICENSE'), 'RUNTIME_LICENSE', 'Preserve both upstream licenses');
  const compatibility = declaration(files, frozen);
  const bootstrap = companionLaunchScript(); await verifyPowerShellSyntax(bootstrap);
  files.set('frozen-adapter.json', adapterBytes); files.set('start-companion.ps1', Buffer.from(bootstrap));
  const imports = await verifyImportClosure(files);
  const id = releaseId ?? 'runtime-' + sourceCommit.slice(0, 12) + '-' + adapterManifestSha256.slice(0, 12);
  need(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(id), 'RUNTIME_METADATA', 'Invalid release id');
  const entries = [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([name, bytes]) => ({ path: name, bytes: bytes.length, sha256: sha(bytes) }));
  need(entries.length <= 2000 && entries.every(entry => entry.bytes <= 32 * 1024 * 1024) && entries.reduce((sum, entry) => sum + entry.bytes, 0) <= 64 * 1024 * 1024, 'RUNTIME_BUDGET', 'Release exceeds the client integrity budget');
  const manifest = { schemaVersion: 1, kind: 'deck-client-launcher-release', releaseId: id, entrypoint: CLIENT_RELEASE_ENTRY, sourceCommit,
    runtimeEntrypoint: RUNTIME_ENTRY, adapterRelativePath: ADAPTER_ENTRY, adapterManifestSha256, ...compatibility, files: entries };
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n'), manifestSha256 = sha(manifestBytes);
  need(manifestBytes.length <= 2 * 1024 * 1024, 'RUNTIME_BUDGET', 'Release manifest exceeds the client integrity budget');
  need(typeof outputDirectory === 'string' && path.isAbsolute(outputDirectory), 'RUNTIME_PATH', 'Select a new absolute output directory');
  const parent = await ordinary(path.dirname(outputDirectory), true), output = path.join(parent, path.basename(outputDirectory));
  need(!inside(adapterRoot, output) && !inside(output, adapterRoot), 'RUNTIME_PATH', 'Output must be disjoint from the frozen source');
  need(!await exists(output), 'RUNTIME_EXISTS', 'Never overwrite a release or installation');
  await mkdir(output); await writeFile(path.join(output, 'INCOMPLETE'), 'Runtime release capture and verification pending\n', { flag: 'wx' });
  try {
    for (const [name, bytes] of files) { const file = path.join(output, name); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, bytes, { flag: 'wx' }); }
    await writeFile(path.join(output, CLIENT_RELEASE_MANIFEST), manifestBytes, { flag: 'wx' });
    await source.unchanged();
    await verifyFrozenAdapter({ directory: adapterRoot, expectedManifestSha256: adapterManifestSha256 });
    need((await readFile(path.join(adapterRoot, 'frozen-adapter.json'))).equals(adapterBytes), 'RUNTIME_SOURCE_DRIFT', 'Frozen manifest changed during capture');
    await catalog(output, files, true);
    await unlink(path.join(output, 'INCOMPLETE'));
    const checked = await verifyRuntimeRelease({ directory: output, expectedManifestSha256: manifestSha256 });
    need(sha(await readFile(new URL(import.meta.url))) === buildToolSha256, 'RUNTIME_SOURCE_DRIFT', 'Local packaging tool changed during capture');
    return { ...checked, buildToolSha256, buildToolIsPartOfPinnedSource: files.has('prototypes/remote-companion/build-runtime-release.mjs'),
      preparedOnly: true, installed: false, imports, bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0) };
  } catch (error) {
    if (!await exists(path.join(output, 'INCOMPLETE'))) await writeFile(path.join(output, 'INCOMPLETE'), 'Runtime release verification failed\n', { flag: 'wx' });
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (args[0] === 'verify' && args.length === 3) console.log(JSON.stringify(await verifyRuntimeRelease({ directory: path.resolve(args[1]), expectedManifestSha256: args[2] }), null, 2));
    else {
      need(args[0] === 'build' && args.length === 6, 'RUNTIME_USAGE', 'Usage: build-runtime-release.mjs build <local-git> <40-char-commit> <frozen-dir> <frozen-sha256> <new-dir>; or verify <dir> <release-sha256>');
      console.log(JSON.stringify(await buildRuntimeRelease({ repository: path.resolve(args[1]), sourceCommit: args[2], adapterDirectory: path.resolve(args[3]), adapterManifestSha256: args[4], outputDirectory: path.resolve(args[5]) }), null, 2));
    }
  } catch (error) { console.error(JSON.stringify({ code: error.code ?? 'RUNTIME_BUILD', message: error.message, preparedOnly: true, installed: false })); process.exitCode = 1; }
}
