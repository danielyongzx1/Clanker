import { readFile, mkdir, open } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const settings = JSON.parse(await readFile(path.join(root, 'hermes-startup.json'), 'utf8'));
const config = JSON.parse(await readFile(path.resolve(root, settings.configFile), 'utf8'));
if (config.kind !== 'hermes') throw new Error('Hermes startup requires a Hermes bridge configuration.');
await mkdir(path.resolve(root, config.stateDir), { recursive: true });
const output = await open(path.resolve(root, config.stateDir, 'bridge.log'), 'a');
let stopped = false, child, retry;
const busy = () => new Promise((resolve) => {
  const socket = createConnection({ host: '127.0.0.1', port: config.port });
  const done = (value) => { socket.destroy(); resolve(value); };
  socket.once('connect', () => done(true)); socket.once('error', () => done(false)); socket.setTimeout(1500, () => done(true));
});
async function start() {
  if (stopped) return;
  if (await busy()) { retry = setTimeout(() => { void start(); }, 10000); return; }
  if (stopped) return;
  try {
    const saved = parseEnv(await readFile(path.resolve(root, settings.envFile), 'utf8'));
    const hermes = parseEnv(await readFile(settings.hermesEnvFile, 'utf8'));
    if (!saved.BRIDGE_TOKEN || !hermes.API_SERVER_KEY) throw new Error('Missing saved bridge or Hermes credential.');
    const env = { ...process.env, BRIDGE_TOKEN: saved.BRIDGE_TOKEN, HERMES_API_KEY: hermes.API_SERVER_KEY };
    delete env.ELECTRON_RUN_AS_NODE;
    child = spawn(process.execPath, ['src/main.mjs', settings.configFile], { cwd: root, env, windowsHide: true, stdio: ['ignore', output.fd, output.fd] });
    let finished = false;
    const ended = () => { if (finished) return; finished = true; child = undefined; if (!stopped) retry = setTimeout(() => { void start(); }, 5000); };
    child.once('error', ended); child.once('exit', ended);
  } catch { await output.write('[Clanker] Hermes bridge startup failed; check the configured paths and saved credentials.\n'); if (!stopped) retry = setTimeout(() => { void start(); }, 10000); }
}
function stop() { stopped = true; clearTimeout(retry); child?.kill(); }
process.once('SIGTERM', stop); process.once('SIGINT', stop);
await start();
