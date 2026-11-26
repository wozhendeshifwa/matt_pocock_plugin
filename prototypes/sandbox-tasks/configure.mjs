import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { atomicJson } from './engine.mjs';
import { defaultConfigPath, callService } from './service.mjs';

// Local operator CLI only; never exposed as an MCP argument or sidebar field.
const args = process.argv.slice(2);
const get = (name, fallback) => { const index = args.indexOf(name); return index < 0 ? fallback : args[index + 1]; };
const configFile = path.resolve(get('--config', defaultConfigPath()));
const moduleRoot = path.dirname(fileURLToPath(import.meta.url));
if (!args.includes('--apply')) {
  console.log('Usage: node configure.mjs --apply --image <verified-image> --auth <dedicated-auth-directory> --model <verified-model> [--models <comma-separated>] [--config <file>] [--startup]');
  process.exit(0);
}
const authDirectory = fs.realpathSync(get('--auth', ''));
if (!fs.existsSync(path.join(authDirectory, 'auth.json'))) throw new Error('请先完成专用ChatGPT登录。');
const dockerPath = process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA, 'Programs/DockerDesktop/resources/bin/docker.exe') : 'docker';
const image = get('--image');
const imageInfo = JSON.parse(execFileSync(dockerPath, ['image', 'inspect', image], { encoding: 'utf8', windowsHide: true }))[0];
if (imageInfo.Config.User !== '1000:1000') throw new Error('仅接受已核验的非root沙箱镜像。');
const directory = path.join(path.dirname(configFile), 'data');
fs.mkdirSync(path.dirname(configFile), { recursive: true });
if (process.platform === 'win32') {
  const sid = execFileSync('powershell.exe', ['-NoProfile', '-Command', '[Security.Principal.WindowsIdentity]::GetCurrent().User.Value'], { encoding: 'utf8', windowsHide: true }).trim();
  execFileSync('icacls.exe', [path.dirname(configFile), '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F'], { stdio: 'pipe', windowsHide: true });
}
let previous;
if (fs.existsSync(configFile)) { previous = JSON.parse(fs.readFileSync(configFile, 'utf8')); fs.copyFileSync(configFile, `${configFile}.backup-${Date.now()}`); }
const defaultModel = get('--model');
const models = get('--models', defaultModel).split(',').filter(Boolean);
if (!models.includes(defaultModel)) throw new Error('默认模型不在已核验列表中。');
const catalogRaw = execFileSync(dockerPath, ['run', '--rm', '--cap-drop', 'ALL', '--mount', `type=bind,source=${authDirectory},target=/home/agent/.codex`, imageInfo.Id, 'codex', 'debug', 'models'], { encoding: 'utf8', windowsHide: true, timeout: 45000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
const catalog = JSON.parse(catalogRaw);
const entries = Array.isArray(catalog) ? catalog : catalog.models ?? catalog.data ?? [];
const modelEfforts = {};
for (const model of models) {
  const entry = entries.find(item => (item.slug ?? item.id) === model);
  if (!entry) throw new Error('配置模型不在当前账户的CLI模型目录中。');
  modelEfforts[model] = (entry.supported_reasoning_levels ?? entry.supportedReasoningEfforts ?? []).map(level => typeof level === 'string' ? level : level.effort).filter(Boolean);
  if (!modelEfforts[model].length) throw new Error('无法核验该模型推理强度，请先核对CLI目录。');
}
atomicJson(configFile, { directory, authDirectory, dockerPath, image: imageInfo.Id, defaultModel, models, modelEfforts, token: previous?.token ?? randomBytes(32).toString('hex') });
if (args.includes('--startup') && process.platform === 'win32') {
  const quote = value => `'${value.replaceAll("'", "''")}'`;
  const startup = path.join(process.env.APPDATA, 'Microsoft/Windows/Start Menu/Programs/Startup/MattSkills Sandbox Tasks.lnk');
  const menu = path.join(process.env.APPDATA, 'Microsoft/Windows/Start Menu/Programs/MattSkills Sandbox Tasks.lnk');
  const launcher = path.join(path.dirname(configFile), 'launch.ps1');
  if (fs.existsSync(launcher)) fs.copyFileSync(launcher, `${launcher}.backup-${Date.now()}`);
  fs.writeFileSync(launcher, `$ErrorActionPreference = 'Stop'\n& ${quote(process.execPath)} ${quote(path.join(moduleRoot, 'service.mjs'))} ${quote(configFile)} 2>> ${quote(path.join(path.dirname(configFile), 'service.log'))}\n`);
  for (const target of [startup, menu]) {
    if (fs.existsSync(target)) fs.copyFileSync(target, `${target}.backup-${Date.now()}`);
    execFileSync('powershell.exe', ['-NoProfile', '-Command', `$w=New-Object -ComObject WScript.Shell;$s=$w.CreateShortcut(${quote(target)});$s.TargetPath=$env:SystemRoot+'\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';$s.Arguments=${quote(`-NoProfile -WindowStyle Hidden -File "${launcher}"`)};$s.WindowStyle=7;$s.Save()`], { windowsHide: true, stdio: 'pipe' });
  }
}
const log = fs.openSync(path.join(path.dirname(configFile), 'service.log'), 'a');
const child = spawn(process.execPath, [path.join(moduleRoot, 'service.mjs'), configFile], { detached: true, windowsHide: true, stdio: ['ignore', log, log] });
child.unref(); fs.closeSync(log);
console.log('Configured local sandbox manager. No provider configuration was changed. Startup entry installed only when requested.');
