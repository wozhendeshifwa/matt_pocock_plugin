import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import vm from 'node:vm';
import { adaptSkillPrefixes } from './skill-prefix-client.mjs';

const vendor = new URL('../../vendor/mattskills-1.8.0-rc.7/', import.meta.url);
const names = (await readdir(new URL('bundled-skills/', vendor), { withFileTypes: true })).filter(x => x.isDirectory()).map(x => x.name);
const source = await readFile(new URL('lib/client.js', vendor), 'utf8');
const adapted = adaptSkillPrefixes(source, names);
const context = vm.createContext({});
const helper = adapted.slice(0, adapted.indexOf(source.slice(0, 50)));
vm.runInContext(helper, context);
const convert = value => vm.runInContext('codexSkillText(' + JSON.stringify(value) + ')', context);
for (const name of names) {
  const input = '/' + name + '\n遵循 `/' + name + '` 技能（/' + name + '）。';
  assert.equal(convert(input), '$' + name + '\n遵循 `$' + name + '` 技能（$' + name + '）。');
  assert.equal(convert(convert(input)), convert(input));
}
for (const value of ['https://example.com/research', 'https://example.com/wayfinder?q=1', 'docs/research/a.md', '/research/file.md', 'C:\\research\\a.md', '.scratch/handoff/a.md', '/unknown', '/research-extra', '$wayfinder', 'owner/research']) assert.equal(convert(value), value);

// Exercise every real bilingual template with its actual placeholder expansion.
const prompts = adapted.slice(adapted.indexOf('const PROMPTS ='), adapted.indexOf('    const promptLang ='));
const renderStart = adapted.indexOf('const promptText = function');
const render = adapted.slice(renderStart, adapted.indexOf('    // #230', renderStart));
vm.runInContext(prompts + '\nlet language = "zh"; const promptLang = () => language; const VOCABULARY_DEFAULT = {};\n' + render, context);
let count = 0;
for (const lang of ['zh', 'en']) {
  context.lang = lang;
  const outputs = vm.runInContext('language = lang; Object.keys(PROMPTS).map(id => promptText(id, {url:"https://example.com/research", path:"docs/research/a.md"}))', context);
  for (const output of outputs) { assert.equal(convert(output), output); count++; }
}
const prefixStart = adapted.indexOf('const withWayfinderPrefix =');
vm.runInContext('const cfg = {withWayfinder:true};\n' + adapted.slice(prefixStart, adapted.indexOf('    const startText =', prefixStart)), context);
for (const prefix of ['/', '$']) assert.equal(vm.runInContext('withWayfinderPrefix(' + JSON.stringify(prefix + 'wayfinder\nBody') + ')', context), prefix + 'wayfinder\nBody');
assert.equal(convert(vm.runInContext('withWayfinderPrefix("Body")', context)), '$wayfinder\nBody');

const mapStart = adapted.indexOf('const completePrompt = function');
vm.runInContext('const issueUrlFor = () => "https://example.com/research"; const promptTextFor = () => "/research"; const COMPLETE_PROMPT = () => "/research {url}";\n' + adapted.slice(mapStart, adapted.indexOf('    const FIXATE_PROMPT', mapStart)), context);
for (const expression of ['inspectPrompt({},3,"Map")', 'completePrompt({},3,"Map",2,2)']) {
  const output = convert(vm.runInContext(expression, context));
  assert.ok(output.startsWith('$wayfinder https://example.com/research\n\n$research'));
}

// The production clipboard boundary converts full prompts but preserves paths.
const clipboardStart = adapted.indexOf('const copyText = (st, text, okMsg)');
const copied = [];
context.navigator = { clipboard: { async writeText(text) { copied.push(text); } } };
context.flash = () => {};
context.tr = x => x;
vm.runInContext(adapted.slice(clipboardStart, adapted.indexOf('    const dswsDetailHitN', clipboardStart)), context);
await vm.runInContext('copyText({}, "/wayfinder\\nhttps://example.com/research\\ndocs/research/a.md")', context);
assert.equal(copied[0], '$wayfinder\nhttps://example.com/research\ndocs/research/a.md');
assert.throws(() => adaptSkillPrefixes(source.replace('const inject =', 'const changedInject ='), names), /boundary changed/);
console.log(`PASS ${names.length} skill names, ${count} bilingual templates, map prompts, prefix deduplication, clipboard, URL/path preservation and fail-closed build anchors`);
