import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSkillsService } from './skills-service.mjs';

const root = await mkdtemp(path.join(os.tmpdir(), 'deck-skill-sources-'));
const bundledDir = path.join(root, 'bundled');
const workspaceRoot = path.join(root, 'project');
const body = '# Example\nRead [support](support.md).\n';
const skill = text => '---\nname: example\ndescription: Example\n---\n' + text;
await mkdir(path.join(bundledDir, 'example'), { recursive: true });
await mkdir(workspaceRoot);
await writeFile(path.join(bundledDir, 'example', 'SKILL.md'), skill(body));
await writeFile(path.join(bundledDir, 'example', 'support.md'), '# Supporting rule');
try {
  const service = createSkillsService({ bundledDir, workspaceRoot, managedNames: ['example'] });
  const doc = await service.readDoc({ name: 'example' });
  assert.equal(doc.ok, true);
  assert.equal(doc.source.kind, 'bundled-reference');
  assert.equal(doc.source.hostResolution, 'unknown');
  assert.equal(doc.source.actualLoad, 'unknown');
  assert.equal(doc.execution.allowed, false);
  assert.match(doc.md, /随包参考/);
  assert.match(doc.md, /工具.*未核验/);
  assert.equal((await service.get('example')).source, 'bundled-reference');
  console.log('PASS readable bundled rules are reference, never proof of host loading or complete tools');

  const hostFile = path.join(root, 'host', 'SKILL.md');
  await mkdir(path.dirname(hostFile));
  await writeFile(hostFile, skill(body.replaceAll('\n', '\r\n')));
  await writeFile(path.join(path.dirname(hostFile), 'support.md'), '# Supporting rule');
  let selectedProject = workspaceRoot;
  const host = createSkillsService({ bundledDir, workspaceRoot, managedNames: ['example'],
    resolveHostSkill: async ({ name, projectRoot }) => {
      assert.equal(name, 'example');
      assert.equal(projectRoot, workspaceRoot);
      return { path: hostFile, projectRoot: selectedProject, sourceId: 'host-current', binding: { id: 'existing-source' } };
    },
  });
  const hostDoc = await host.readDoc({ name: 'example' });
  assert.equal(hostDoc.path, hostFile);
  assert.equal(hostDoc.source.kind, 'host-resolved');
  assert.equal(hostDoc.source.actualLoad, 'unknown');
  assert.equal(hostDoc.source.difference.kind, 'equivalent');
  assert.equal(hostDoc.source.binding.id, 'existing-source');
  assert.match(hostDoc.md, /宿主.*解析/);
  selectedProject = root;
  const stale = await host.readDoc({ name: 'example' });
  assert.equal(stale.source.kind, 'bundled-reference');
  assert.notEqual(stale.source.hostResolution, 'resolved');
  await writeFile(hostFile, skill('# Changed behavior: ask a human before proceeding.'));
  selectedProject = workspaceRoot;
  const changed = await host.readDoc({ name: 'example' });
  assert.equal(changed.source.difference.kind, 'review-behavior');
  assert.match(changed.md, /兼容.*自主|自主.*兼容/);
  console.log('PASS current project host resolution wins; format differences ignored, behavior differences need Agent judgment');

  const ready = createSkillsService({ bundledDir, workspaceRoot, managedNames: ['example'],
    assessRequirements: async ({ documents }) => {
      assert.ok(documents.some(doc => doc.path.endsWith('support.md')));
      return { complete: true, tools: [{ name: 'read-files', available: true }] };
    },
  });
  const fallback = await ready.inspectForUse('example');
  assert.equal(fallback.execution.allowed, true);
  assert.equal(fallback.execution.mode, 'bundled-readonly');
  assert.equal(fallback.sourceInfo.actualLoad, 'unknown');
  await rm(path.join(bundledDir, 'example', 'support.md'));
  const broken = await ready.readDoc({ name: 'example' });
  assert.equal(broken.execution.allowed, false);
  assert.ok(broken.execution.reasons.some(reason => reason.includes('support.md')));
  await writeFile(path.join(bundledDir, 'example', 'support.md'), '# Supporting rule');
  const absentTool = createSkillsService({ bundledDir, workspaceRoot, managedNames: ['example'],
    assessRequirements: async () => ({ complete: true, tools: [{ name: 'subagent', available: false }] }),
  });
  assert.equal((await absentTool.inspectForUse('example')).execution.allowed, false);
  assert.match((await absentTool.readDoc({ name: 'example' })).md, /subagent/);
  console.log('PASS full read-only fallback requires readable references and confirmed tools; missing prerequisites pause');

  await rm(hostFile);
  assert.equal((await host.resolveBinding('example')).binding.id, 'existing-source', 'missing local skill retains a verified source binding for repair');
  assert.equal(await host.get('unrelated-plugin-skill'), null);
  const realBundled = createSkillsService({ workspaceRoot, bundledDir: path.resolve('vendor/mattskills-1.8.0-rc.7/bundled-skills'),
    assessRequirements: async () => ({ complete: true, tools: [] }),
  });
  const wayfinder = await realBundled.inspectForUse('wayfinder');
  assert.equal(wayfinder.execution.allowed, true, 'example map links inside code fences are not required files');
  const domain = await realBundled.inspectForUse('domain-modeling');
  assert.equal(domain.execution.allowed, true);
  assert.ok(domain.execution.files.some(file => file.endsWith('ADR-FORMAT.md')));
  assert.equal((await realBundled.list()).length, 27);
  console.log('PASS fixed catalog, missing-skill binding and actual bundled references');
} finally {
  await rm(root, { recursive: true, force: true });
}

