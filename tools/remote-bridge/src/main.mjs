import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createBridge } from './server.mjs';
import { writePairingPage } from './pairing.mjs';

const configPath = process.argv[2] ?? 'bridge.config.json';
const config = JSON.parse(await readFile(configPath, 'utf8'));
config.token = process.env.BRIDGE_TOKEN;
config.upstreamKey = process.env.HERMES_API_KEY;
config.launchToken = process.env.HARNESS_LAUNCH_TOKEN;
if (config.kind === 'hermes' && !config.upstreamKey) throw new Error('Set HERMES_API_KEY to the Hermes API_SERVER_KEY.');
if (config.kind === 'harness' && !config.launchToken && !config.desktopDiscovery) throw new Error('Set HARNESS_LAUNCH_TOKEN or configure automatic Desktop discovery.');
const bridge = await createBridge(config);
await new Promise((resolve, reject) => { bridge.server.once('error', reject); bridge.server.listen(config.port ?? 8787, config.host ?? '127.0.0.1', resolve); });
console.log(`Clanker ${config.kind} bridge listening on ${config.host ?? '127.0.0.1'}:${config.port ?? 8787}. Identity: ${bridge.state.bridgeId}`);
try {
  const page = await writePairingPage(path.resolve(config.stateDir ?? '.clanker-bridge', 'pairing.html'), {
    kind: config.kind, bridgeId: bridge.state.bridgeId, token: config.token, host: config.host ?? '127.0.0.1', port: config.port ?? 8787,
  });
  console.log(`Pairing page with QR code: ${page}`);
} catch (error) { console.error(`Could not write the pairing page: ${error.message}`); }
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void bridge.close().then(() => process.exit(0)); });
