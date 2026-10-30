import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { WebSocketServer } from 'ws';
import { publishConnection, superviseBridge } from '../desktop-plugin/index.mjs';
import { harnessEndpoint } from '../src/desktop-discovery.mjs';
import { createBridge } from '../src/server.mjs';

const listen = async (server) => { await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); return `http://127.0.0.1:${server.address().port}`; };
const profileId = 'fixture-desktop-profile-12345';
const token = 'fixture-desktop-launch-token-123456';
async function host(model) {
  let prompts = 0;
  const server = http.createServer(async (req, res) => {
    if (req.url.startsWith('/connect?')) {
      assert.equal(new URL(req.url, 'http://localhost').searchParams.get('token'), token);
      res.writeHead(302, { 'Set-Cookie': 'peer=fixture; Path=/', Location: '/api/remote.mux' }); res.end(); return;
    }
    assert.equal(req.headers.cookie, 'peer=fixture');
    let text = ''; for await (const chunk of req) text += chunk;
    const message = JSON.parse(text);
    if (message.method === 'session/prompt') prompts++;
    assert.equal(message.method, 'session/modelCatalog');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ type: 'server-response', rpcId: message.rpcId, result: { ok: true, value: { groups: [{ id: 'provider', models: [{ id: model }] }] } } }));
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws)));
  wss.on('connection', (ws) => ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.type === 'open' && m.endpoint === '$events') ws.send(JSON.stringify({ type: 'item', streamId: m.streamId, value: { type: 'ready', clientId: 'fixture', host: { home: '/fixture' } } }));
  }));
  const url = await listen(server);
  return { url, get prompts() { return prompts; }, close: async () => { for (const ws of wss.clients) ws.terminate(); wss.close(); server.closeAllConnections(); await new Promise((r) => server.close(r)); } };
}

test('Desktop generations refresh the authenticated client and catalogue while preserving bridge identity', { timeout: 10000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'clanker-desktop-'));
  const a = await host('before-restart'), b = await host('after-restart');
  const file = path.join(root, 'desktop-runtime.json');
  const plugin = { discoveryFile: file, profileId };
  const config = { kind: 'harness', token: 'fixture-bridge-token-1234567890', upstreamUrl: a.url, workspaceRoot: path.join(root, 'work'), stateDir: path.join(root, 'state'), desktopDiscovery: { file, profileId } };
  let bridge, removeA, removeB;
  try {
    removeA = await publishConnection(plugin, a.url, `${a.url}/?token=${token}`);
    bridge = await createBridge(config);
    let url = await listen(bridge.server);
    const info = async () => { const r = await fetch(`${url}/v1/capabilities`, { headers: { Authorization: `Bearer ${config.token}` } }); assert.equal(r.status, 200); return r.json(); };
    const first = await info(); assert.deepEqual(first.models, ['provider/before-restart']);
    const keyA = (await harnessEndpoint(config)).key;
    removeB = await publishConnection(plugin, b.url, `${b.url}/?token=${token}`);
    await removeA(); // An old unload cannot remove a later process's connection.
    assert.notEqual((await harnessEndpoint(config)).key, keyA);
    const second = await info(); assert.deepEqual(second.models, ['provider/after-restart']); assert.equal(second.bridgeId, first.bridgeId);
    await bridge.close(); bridge = undefined;
    bridge = await createBridge({ ...config, upstreamUrl: b.url });
    url = await listen(bridge.server);
    assert.equal((await info()).bridgeId, first.bridgeId);
    await bridge.close(); bridge = undefined;
    await assert.rejects(createBridge({ ...config, desktopDiscovery: { file, profileId: 'another-desktop-profile-123' } }), /profile changed/);
    assert.equal(a.prompts + b.prompts, 0);
    await removeB(); await assert.rejects(harnessEndpoint(config), /Open Harness Desktop/);
  } finally { await bridge?.close(); await removeA?.(); await removeB?.(); await a.close(); await b.close(); await rm(root, { recursive: true, force: true }); }
});

test('Desktop discovery rejects a different profile or non-loopback endpoint', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'clanker-discovery-'));
  try {
    const file = path.join(root, 'connection.json');
    const config = { kind: 'harness', desktopDiscovery: { file, profileId } };
    await writeFile(file, JSON.stringify({ version: 1, profileId: 'wrong', launchToken: token, generation: 'one', upstreamUrl: 'http://127.0.0.1:3000' }));
    await assert.rejects(harnessEndpoint(config), /identity/);
    await writeFile(file, JSON.stringify({ version: 1, profileId, launchToken: token, generation: 'one', upstreamUrl: 'http://example.com' }));
    await assert.rejects(harnessEndpoint(config), /loopback/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('enrolling an existing bridge keeps its session mappings and refuses another initial upstream', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'clanker-enrol-'));
  const config = { kind: 'harness', token: 'fixture-bridge-token-1234567890', upstreamUrl: 'http://127.0.0.1:3000', workspaceRoot: path.join(root, 'work'), stateDir: path.join(root, 'state') };
  const adapter = { models: async () => ['model'] };
  let bridge;
  try {
    bridge = await createBridge(config, adapter);
    const identity = bridge.state.bridgeId;
    bridge.state.sessions.existing = { id: 'existing', upstreamId: 'native-session', model: 'model' };
    await bridge.close(); bridge = undefined;
    const discovery = { profileId, file: path.join(root, 'runtime.json') };
    await assert.rejects(createBridge({ ...config, upstreamUrl: 'http://127.0.0.1:9000', desktopDiscovery: discovery }, adapter), /upstream address changed/);
    bridge = await createBridge({ ...config, desktopDiscovery: discovery }, adapter);
    assert.equal(bridge.state.bridgeId, identity);
    assert.equal(bridge.state.sessions.existing.upstreamId, 'native-session');
    await bridge.close(); bridge = undefined;
    bridge = await createBridge({ ...config, upstreamUrl: 'http://127.0.0.1:9000', desktopDiscovery: discovery }, adapter);
    assert.equal(bridge.state.bridgeId, identity);
    assert.equal(bridge.state.sessions.existing.upstreamId, 'native-session');
  } finally { await bridge?.close(); await rm(root, { recursive: true, force: true }); }
});

test('Desktop owns only its child, hides its console, and does not inherit stale credentials', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'clanker-supervisor-'));
  const calls = []; let child, stop;
  try {
    await mkdir(path.join(root, 'state'));
    await writeFile(path.join(root, 'bridge.json'), JSON.stringify({ port: 8788 }));
    const config = { bridgeDirectory: root, configFile: 'bridge.json', envFile: '.env.harness', nodeExecutable: process.execPath, logFile: 'state/log.txt', retryMs: 100 };
    stop = await superviseBridge(config, { portBusy: async () => false, log() {}, spawn: (...args) => {
      calls.push(args); child = new EventEmitter(); child.kill = () => { queueMicrotask(() => child.emit('exit', 0)); return true; }; return child;
    } });
    assert.equal(calls.length, 1);
    assert.equal(calls[0][2].windowsHide, true);
    assert.equal(calls[0][2].env.BRIDGE_TOKEN, undefined);
    assert.equal(calls[0][2].env.ELECTRON_RUN_AS_NODE, undefined);
    await stop(); stop = undefined;
    const busyStop = await superviseBridge(config, { portBusy: async () => true, log() {}, spawn() { throw new Error('Should not take over an occupied port.'); } });
    await busyStop();
    assert.equal(calls.length, 1);
  } finally { await stop?.(); await rm(root, { recursive: true, force: true }); }
});
