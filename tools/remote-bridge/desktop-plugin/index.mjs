import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, rename, unlink, open } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import path from 'node:path';

export const name = 'clanker-desktop-bridge';
export const inject = ['webServer', 'connection'];

export async function publishConnection(config, origin, authenticatedUrl) {
  const url = new URL(authenticatedUrl);
  if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('Desktop did not provide its own loopback connection.');
  const token = url.searchParams.get('token');
  if (!token || token.length < 16) throw new Error('Desktop did not provide a process launch token.');
  const generation = randomUUID();
  const file = path.resolve(config.discoveryFile);
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${generation}.tmp`;
  try {
    await writeFile(temp, JSON.stringify({ version: 1, profileId: config.profileId, generation, pid: process.pid, upstreamUrl: origin, launchToken: token }), { mode: 0o600, flag: 'wx' });
    await rename(temp, file);
  } finally { await unlink(temp).catch(() => {}); }
  return async () => {
    try { if (JSON.parse(await readFile(file, 'utf8')).generation === generation) await unlink(file); } catch { /* Another plugin generation may already own the file. */ }
  };
}

async function portBusy(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const done = (busy) => { socket.destroy(); resolve(busy); };
    socket.once('connect', () => done(true)); socket.once('error', () => done(false)); socket.setTimeout(1500, () => done(true));
  });
}

export async function superviseBridge(config, overrides = {}) {
  let stopped = false, child, retry, spawning;
  const spawnChild = overrides.spawn ?? spawn;
  const busy = overrides.portBusy ?? portBusy;
  const log = overrides.log ?? ((message) => console.error(`[Clanker] ${message}`));
  const bridgeConfig = JSON.parse(await readFile(path.resolve(config.bridgeDirectory, config.configFile), 'utf8'));
  const output = await open(path.resolve(config.bridgeDirectory, config.logFile), 'a');
  const schedule = () => { if (!stopped) retry = setTimeout(() => { void start(); }, config.retryMs ?? 5000); };
  async function start() {
    spawning = (async () => {
      if (stopped) return;
      if (await busy(bridgeConfig.port ?? 8788)) { log('Bridge port is occupied. Waiting; the existing process will not be stopped.'); schedule(); return; }
      if (stopped) return;
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      delete env.BRIDGE_TOKEN; delete env.HARNESS_LAUNCH_TOKEN; delete env.HERMES_API_KEY;
      child = spawnChild(config.nodeExecutable, [`--env-file=${config.envFile}`, 'src/main.mjs', config.configFile], {
        cwd: config.bridgeDirectory, env, stdio: ['ignore', output.fd, output.fd], windowsHide: true,
      });
      let finished = false;
      const ended = () => { if (finished) return; finished = true; child = undefined; if (!stopped) { log('Bridge exited; restarting.'); schedule(); } };
      child.once('error', ended); child.once('exit', ended);
    })().catch(() => { log('Bridge could not start. Check its local paths and credentials file.'); schedule(); });
    return spawning;
  }
  await start();
  return async () => {
    stopped = true; clearTimeout(retry); await spawning;
    if (child) {
      const running = child;
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 3000);
        running.once('exit', () => { clearTimeout(timer); resolve(); });
        running.kill();
      });
    }
    await output.close();
  };
}

export async function apply(ctx) {
  const config = JSON.parse(await readFile(new URL('./local.config.json', import.meta.url), 'utf8'));
  for (const field of ['bridgeDirectory', 'nodeExecutable', 'discoveryFile']) if (!path.isAbsolute(config[field] ?? '')) throw new Error(`Clanker bridge ${field} must be absolute.`);
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(config.profileId ?? '')) throw new Error('Clanker bridge profile identity is missing.');
  let stopped = false, cleanupConnection, cleanupBridge;
  let startup;
  let cancelReady;
  const cancelled = new Promise((resolve) => { cancelReady = resolve; });
  ctx.on('dispose', async () => {
    stopped = true; cancelReady(); await startup;
    await cleanupBridge?.(); await cleanupConnection?.();
  });
  // Await readiness asynchronously: waiting inside activation would wait on our own row.
  const ready = ctx.get('loader')?.await() ?? Promise.resolve();
  startup = Promise.race([ready, cancelled]).then(async () => {
    if (stopped) return;
    const origin = ctx.webServer.getOrigin();
    cleanupConnection = await publishConnection(config, origin, ctx.connection.authenticatedUrl(origin));
    if (stopped) return;
    cleanupBridge = await superviseBridge(config);
  }).catch(() => { console.error('[Clanker] Automatic bridge startup failed. Check the plugin configuration.'); });
}
