import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(path.join(root, 'package.json'));
const ts = require('typescript');
const source = ts.transpileModule(readFileSync(path.join(root, 'src/lib/remote/pairing.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
vm.runInNewContext(source, { module, exports: module.exports, URL });
const { parsePairingLink, pairingFromParams } = module.exports;
const { pairingLink } = await import(new URL('../tools/remote-bridge/src/pairing.mjs', import.meta.url));

const token = 'a1'.repeat(32);

test('the app reads exactly what the bridge puts in its QR code', () => {
  const urls = ['http://192.168.1.10:8788', 'http://100.64.0.2:8788'];
  const pairing = parsePairingLink(pairingLink({ bridgeId: 'deed595f', token, name: 'Harness · PC & co', urls }));
  assert.deepEqual({ ...pairing, urls: [...pairing.urls] }, { bridgeId: 'deed595f', token, name: 'Harness · PC & co', urls });
});

test('other codes, short tokens and unusable addresses are refused', () => {
  assert.equal(parsePairingLink('https://example.com/?token=x'), null);
  assert.equal(parsePairingLink(pairingLink({ bridgeId: 'b', token: 'short', name: '', urls: ['http://192.168.1.10:8788'] })), null);
  assert.equal(parsePairingLink(pairingLink({ bridgeId: 'b', token, name: '', urls: ['ftp://192.168.1.10', 'http://u:p@192.168.1.10'] })), null);
  assert.equal(parsePairingLink('clanker://pair?bridge=b&token=%E0%A4%A'), null);
});

test('a link opened by the camera arrives as route parameters, with one or several addresses', () => {
  assert.deepEqual([...pairingFromParams({ bridge: 'b', token, url: 'http://192.168.1.10:8788/' }).urls], ['http://192.168.1.10:8788']);
  assert.equal(pairingFromParams({ bridge: 'b', token, url: ['http://a:1', 'http://b:2'] }).urls.length, 2);
});
