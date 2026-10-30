import { readFile, writeFile, mkdir, realpath, access } from 'node:fs/promises';
import { openSync, readSync, closeSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { parseEnv, promisify } from 'node:util';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { HarnessAdapter } from '../src/harness.mjs';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const configFile = process.argv[2] ?? 'bridge.harness.json';
if (!/^[\w.-]+\.json$/.test(configFile)) throw new Error('Use a JSON configuration filename within the bridge directory.');
const configPath = path.join(root, configFile);
const envPath = path.join(root, '.env.harness');
const original = await readFile(configPath, 'utf8');
const config = JSON.parse(original);
if (config.kind !== 'harness') throw new Error('Choose the Harness bridge configuration.');
const savedEnv = await readFile(envPath, 'utf8');
const credentials = parseEnv(savedEnv);
if (!credentials.BRIDGE_TOKEN || credentials.BRIDGE_TOKEN.length < 24) throw new Error('Save the existing bridge token in .env.harness before installation.');
const stateDir = path.resolve(root, config.stateDir);
await mkdir(stateDir, { recursive: true });
let state = JSON.parse(await readFile(path.join(stateDir, 'state.json'), 'utf8'));
for (let attempt = 0; Object.values(state.runs).some((r) => !['completed', 'failed', 'cancelled'].includes(r.state)); attempt++) {
  if (attempt === 0) console.log('Waiting for the current Harness turn to settle; Desktop and its agent are left running.');
  if (attempt >= 100) throw new Error('A remote task is still active. Retry installation when it has finished.');
  await new Promise((resolve) => setTimeout(resolve, 3000));
  state = JSON.parse(await readFile(path.join(stateDir, 'state.json'), 'utf8'));
}

function readAsar(archive, filename) {
  const fd = openSync(archive, 'r');
  try {
    const prefix = Buffer.alloc(16); readSync(fd, prefix, 0, 16, 0);
    const size = prefix.readUInt32LE(12);
    if (size > 64 * 1024 * 1024) throw new Error('Unexpected Desktop archive header.');
    const header = Buffer.alloc(size); readSync(fd, header, 0, size, 16);
    let entry = JSON.parse(header.toString());
    for (const segment of filename.split('/')) entry = entry?.files?.[segment];
    if (!entry || entry.unpacked || entry.size > 8 * 1024 * 1024) throw new Error('Required Desktop contract is unavailable in this installation.');
    const content = Buffer.alloc(Number(entry.size));
    readSync(fd, content, 0, content.length, 8 + prefix.readUInt32LE(4) + Number(entry.offset));
    return content.toString();
  } finally { closeSync(fd); }
}

const desktopDir = path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'DeepSeek Harness');
const archive = path.join(desktopDir, 'resources', 'app.asar');
const desktopVersion = JSON.parse(readAsar(archive, 'package.json')).version;
if (desktopVersion !== '0.2.1-rc.5') throw new Error(`Unsupported Desktop ${desktopVersion}; this plugin supports 0.2.1-rc.5. No version exemptions are used.`);
const adapter = new HarnessAdapter({ ...config, launchToken: credentials.HARNESS_LAUNCH_TOKEN });
let changed = false, installed = false;
try {
  await adapter.models();
  const descriptorFile = path.join(stateDir, 'plugin-manager.remote.mjs');
  await writeFile(descriptorFile, readAsar(archive, 'dsh/node_modules/@deepseek-ai/dsh-plugin-manager/lib/typert.remote-client.js'));
  const { default: descriptor } = await import(pathToFileURL(descriptorFile).href);
  await adapter.ctx.remote.$mount(descriptor);

  const profileId = config.desktopDiscovery?.profileId ?? randomUUID();
  const discoveryFile = path.join(stateDir, 'desktop-runtime.json');
  config.desktopDiscovery = { profileId, file: discoveryFile };
  const localConfig = {
    profileId, discoveryFile, bridgeDirectory: await realpath(root), nodeExecutable: process.execPath,
    configFile, envFile: '.env.harness', logFile: path.join(stateDir, 'bridge.log'),
  };
  const backup = path.join(stateDir, 'desktop-setup-backup.json');
  try { await access(backup); } catch { await writeFile(backup, JSON.stringify({ config: JSON.parse(original), env: savedEnv }, null, 2), { mode: 0o600 }); }
  await writeFile(path.join(root, 'desktop-plugin', 'local.config.json'), JSON.stringify(localConfig, null, 2));
  if (!process.env.npm_execpath) throw new Error('Run this installer through npm run desktop:install.');
  const packed = await execute(process.execPath, [process.env.npm_execpath, 'pack', '--json', '--ignore-scripts', '--pack-destination', stateDir], { cwd: path.join(root, 'desktop-plugin'), windowsHide: true, maxBuffer: 1024 * 1024 });
  const manifests = JSON.parse(packed.stdout);
  const packedFile = (Array.isArray(manifests) ? manifests : Object.values(manifests))[0]?.filename;
  if (typeof packedFile !== 'string' || path.basename(packedFile) !== packedFile) throw new Error('npm pack did not report a local plugin archive.');
  const archivePath = path.join(stateDir, packedFile);
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
  await writeFile(envPath, `BRIDGE_TOKEN=${credentials.BRIDGE_TOKEN}\n`, { mode: 0o600 });
  changed = true;

  // Stop only the authenticated, idle bridge at this port. Never stop Desktop.
  const info = await fetch(`http://127.0.0.1:${config.port}/v1/capabilities`, { headers: { Authorization: `Bearer ${credentials.BRIDGE_TOKEN}` }, signal: AbortSignal.timeout(10000) }).then(async (r) => { if (!r.ok) throw new Error('The existing bridge did not authenticate.'); return r.json(); });
  if (info.bridgeId !== state.bridgeId || info.kind !== 'harness') throw new Error('The listener belongs to another bridge.');
  const port = Number(config.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid bridge port.');
  const script = `$ErrorActionPreference='Stop'; $ids=@(Get-NetTCPConnection -State Listen -LocalPort ${port} | Select-Object -ExpandProperty OwningProcess -Unique); if($ids.Count -ne 1){throw 'Unexpected listener count'}; $proc=Get-CimInstance Win32_Process -Filter ('ProcessId = '+$ids[0]); if($proc.Name -ne 'node.exe' -or $proc.CommandLine -notlike '*main.mjs*${configFile}*'){throw 'Refusing to stop another process'}; $s=Get-Content -Raw (Join-Path '${stateDir.replace(/'/g, "''")}' 'state.json')|ConvertFrom-Json; if(@($s.runs.PSObject.Properties.Value|Where-Object {$_.state -notin @('completed','failed','cancelled')}).Count -gt 0){throw 'A new remote task started; retry after it settles'}; $result=Invoke-CimMethod -InputObject $proc -MethodName Terminate; if($result.ReturnValue -ne 0){throw 'Bridge stop failed'}`;
  await execute('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true });

  const result = await adapter.ctx.remote.pluginManager.installBundle(archivePath, { enabled: true, saveExact: true });
  if (!result.ok) throw new Error(`Desktop refused plugin installation: ${result.error.code}.`);
  const value = result.value;
  console.log(JSON.stringify({ pluginInstallApplication: value.application, plugin: value.bundle ?? 'clanker-harness-desktop-bridge' }));
  installed = ['applied', 'restart-required'].includes(value.application);
  if (!installed) throw new Error('Desktop could not activate the plugin. Inspect its plugin manager diagnostics.');
  if (value.application === 'restart-required') console.log('Installed. Fully quit Desktop through its tray menu, then open it normally once to activate automatic startup.');
  for (let attempt = 0; value.application === 'applied' && attempt < 45; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/v1/capabilities`, { headers: { Authorization: `Bearer ${credentials.BRIDGE_TOKEN}` }, signal: AbortSignal.timeout(1500) });
      if (response.ok) {
        const info = await response.json();
        if (info.bridgeId !== state.bridgeId) throw new Error('Bridge identity changed.');
        console.log(JSON.stringify({ automaticDesktopBridge: true, bridgeId: info.bridgeId, models: info.models.length, port }));
        break;
      }
    } catch { /* Plugin activation and child startup are asynchronous. */ }
    if (attempt === 44) throw new Error('Plugin installed, but the bridge is not ready. Inspect the bridge log.');
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
} catch (error) {
  if (changed && !installed) {
    await writeFile(configPath, original);
    await writeFile(envPath, savedEnv, { mode: 0o600 });
    console.error('Restored the previous bridge configuration. Restart the manual bridge if installation did not activate.');
  }
  throw error;
} finally { await adapter.close(); }
