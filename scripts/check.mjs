import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const sandbox = path.join(root, 'prototypes/sandbox-tasks');
const sidebar = path.join(root, 'prototypes/upstream-port');
function run(label, cwd, args, quiet = false) {
  if (!quiet) console.log(`\n[check] ${label}`);
  const result = spawnSync(process.execPath, args, { cwd, stdio: 'inherit', windowsHide: true, timeout: 120000 });
  if (result.error || result.status !== 0) {
    console.error(`[check] FAILED: ${label}${result.error ? ` (${result.error.message})` : ''}`);
    process.exit(result.status || 1);
  }
}
if (Number(process.versions.node.split('.')[0]) < 26) throw new Error('检查需要Node.js 26或更新版本。');
let syntaxFiles = 0;
console.log('[check] Checking JavaScript syntax');
for (const directory of [path.join(root, 'scripts'), sandbox, sidebar]) {
  for (const name of fs.readdirSync(directory).sort()) {
    if (/\.(mjs|js)$/.test(name)) { run(`syntax ${path.relative(root, path.join(directory, name))}`, directory, ['--check', name], true); syntaxFiles++; }
  }
}
console.log(`[check] PASS syntax (${syntaxFiles} files)`);
run('same-chat MCP refresh recovery', root, ['--test', 'scripts/mcp-refresh-recovery.test.mjs']);
run('same-chat connector recovery handoff', root, ['--test', 'scripts/mcp-refresh-connector-recovery.test.mjs']);
const tests = fs.readdirSync(sandbox).filter(name => name.endsWith('.test.mjs')).sort();
if (!tests.length) throw new Error('沙箱测试清单为空。');
run('sandbox regressions', sandbox, ['--test', ...tests]);
run('sidebar build', sidebar, ['build.mjs']);
run('native visual foundation', sidebar, ['verify-native-visual-foundation.mjs']);
run('native visual surfaces', sidebar, ['verify-native-visual-surfaces.mjs']);
run('map execution mode dialog', sidebar, ['verify-map-mode-dialog.mjs']);
for (const file of ['verify-spec-list.mjs', 'verify-spec-resilience.mjs']) run(file, sidebar, [file]);
for (const file of ['verify-project-switch.mjs', 'verify-rpc-manifest.mjs', 'verify-write-policy.mjs']) run(file, sidebar, [file]);
for (const file of ['verify-native-draft-injection.mjs', 'verify-new-chat-project.mjs', 'verify-native-legacy-actions.mjs', 'verify-chat-output-availability.mjs', 'verify-direct-issue-actions.mjs', 'verify-direct-new-chat.mjs', 'verify-direct-recovery.mjs', 'verify-more-issue-actions.mjs', 'verify-legacy-draft-copy.mjs', 'verify-bottom-action-bar.mjs', 'verify-action-drafts.mjs', 'verify-issue-actions.mjs', 'verify-reviewed-draft-outputs.mjs', 'verify-linked-worktree-project.mjs', 'verify-sidebar-resource-revision.mjs']) run(file, sidebar, [file]);
console.log('\n[check] PASS: syntax, sandbox tests, sidebar build, project identity/draft routing, RPC manifest and write policy');
