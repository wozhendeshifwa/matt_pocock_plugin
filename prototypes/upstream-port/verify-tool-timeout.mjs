import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { planToolTimeout, updateToolTimeout } from './update-tool-timeout.mjs';

for (const eol of ['\n', '\r\n']) {
  const before = '\ufeff' + ['model_provider = "deepseek"', '[model_providers.deepseek]', 'base_url = "https://example.test"', '[mcp_servers.deck-sidebar-probe]', 'startup_timeout_sec = 30.0', '[mcp_servers.deck-sidebar-probe.env]', 'CODEX_HOME = "kept"', '[model_providers.openai]', 'name = "OpenAI"', ''].join(eol);
  const after = planToolTimeout(before);
  assert.equal(after.replace('tool_timeout_sec = 320' + eol, ''), before);
  assert.equal(planToolTimeout(after), after);
  const old = after.replace('tool_timeout_sec = 320', 'tool_timeout_sec = 60.0 # keep');
  assert.equal(planToolTimeout(old), after.replace('tool_timeout_sec = 320', 'tool_timeout_sec = 320 # keep'));
  const root = await mkdtemp(path.join(tmpdir(), 'deck-timeout-'));
  const config = path.join(root, 'config.toml');
  await writeFile(config, before);
  assert.equal((await updateToolTimeout(config)).applied, false);
  assert.equal(await readFile(config, 'utf8'), before);
  const result = await updateToolTimeout(config, true);
  assert.equal(await readFile(result.backup, 'utf8'), before);
  assert.equal(await readFile(config, 'utf8'), after);
  assert.equal((await updateToolTimeout(config, true)).backup, null);
}
assert.throws(() => planToolTimeout('[unrelated]\nx=1'));
assert.throws(() => planToolTimeout('[mcp_servers.deck-sidebar-probe]\ntool_timeout_sec=1\ntool_timeout_sec=2'));
console.log('PASS targeted timeout repair: dry run, backup/readback, idempotency, BOM/CRLF, providers/env preserved, ambiguous config refused');
