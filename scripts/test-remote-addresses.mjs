import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(path.join(root, 'package.json'));
const ts = require('typescript');
function client() {
  const modules = new Map();
  function load(name) {
    if (modules.has(name)) return modules.get(name);
    const code = ts.transpileModule(readFileSync(path.join(root, `src/lib/remote/${name}.ts`), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const module = { exports: {} };
    const deps = {
      'expo/fetch': { fetch },
      'expo-file-system': { File: class {} },
      '@/lib/attachments': {}, '@/lib/storage': { apiKeys: { get: async () => 'fixture' } }, './cache': {},
    };
    vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: `remote/${name}.ts` })((specifier) => specifier.startsWith('./') && !deps[specifier] ? load(specifier.slice(2)) : deps[specifier], module, module.exports);
    modules.set(name, module.exports); return module.exports;
  }
  return load('client').RemoteAdapter;
}
async function host(t, { bridgeId = 'same-bridge', delay = 0, shared, dropSubmission = false } = {}) {
  const server = http.createServer(async (req, res) => {
    if (req.url === '/v1/capabilities') {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      if (!res.destroyed) res.end(JSON.stringify({ protocol: 1, bridgeId, kind: 'hermes', models: ['model'], maxFileBytes: 20971520 }));
      return;
    }
    if (req.method === 'POST') {
      let body = ''; for await (const part of req) body += part;
      const request = JSON.parse(body); shared.calls.push(request);
      shared.receipts.set(request.submissionId, shared.receipts.get(request.submissionId) ?? { id: 'same-run' });
      if (dropSubmission) { req.socket.destroy(); server.closeAllConnections(); server.close(); return; }
      res.end(JSON.stringify(shared.receipts.get(request.submissionId))); return;
    }
    res.end(JSON.stringify({ id: 'same-run', sessionId: 'same-session', cursor: 1, content: [], controls: [], files: [], state: 'running' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}
const backend = (baseUrl, altBaseUrls) => ({ id: 'remote', bridgeId: 'same-bridge', kind: 'hermes', name: 'Host', model: 'model', models: ['model'], baseUrl, altBaseUrls });

test('saved connection moves from LAN to its alternative while observing the same run', async (t) => {
  const RemoteAdapter = client();
  const lan = await host(t); const remote = await host(t, { delay: 50 });
  const adapter = new RemoteAdapter(backend(lan.url, [remote.url]), 'fixture');
  assert.equal((await adapter.info()).bridgeId, 'same-bridge');
  await new Promise((resolve) => { lan.server.closeAllConnections(); lan.server.close(resolve); });
  assert.equal((await adapter.snapshot('same-run')).sessionId, 'same-session');
});

test('a faster unrelated server cannot receive session or run mutations', async (t) => {
  const RemoteAdapter = client();
  const wrong = await host(t, { bridgeId: 'another-bridge' }); const right = await host(t, { delay: 40 });
  const adapter = new RemoteAdapter(backend(wrong.url, [right.url]), 'fixture');
  assert.equal((await adapter.info()).bridgeId, 'same-bridge');
  assert.equal((await adapter.snapshot('same-run')).id, 'same-run');
  await assert.rejects(new RemoteAdapter(backend(wrong.url, []), 'fixture').info(), /different bridge/);
});

test('a lost submission response reuses its receipt across addresses', async (t) => {
  const RemoteAdapter = client(); const shared = { calls: [], receipts: new Map() };
  const lan = await host(t, { shared, dropSubmission: true }); const remote = await host(t, { shared, delay: 40 });
  const adapter = new RemoteAdapter(backend(lan.url, [remote.url]), 'fixture');
  await adapter.info();
  const reply = await adapter.start('same-session', 'submission', 'hello', []);
  assert.equal(reply.id, 'same-run'); assert.equal(shared.receipts.size, 1);
  assert.deepEqual(shared.calls.map((call) => call.submissionId), ['submission', 'submission']);
});
