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

// Exercise the actual app stores/orchestration in Node. Only device services and
// network I/O are replaced; Zustand persistence and the chat policy run unchanged.
function app({ snapshot } = {}) {
  const loaded = new Map(); let serial = 0;
  const persisted = new Map();
  const storage = { uid: () => `id${++serial}`, flushJsonStorage() {}, apiKeys: { get: async () => null, remove: async () => {}, set: async () => {} }, jsonFileStorage: { getItem: (key) => persisted.get(key) ?? null, setItem: (key, value) => persisted.set(key, value), removeItem: (key) => persisted.delete(key) } };
  const ui = { currentId: null, newChatMemoryOff: false, newChatProjectId: null };
  const mocks = {
    '@/lib/storage': storage,
    '@/lib/attachments': { deleteAttachment() {} },
    '@/lib/remote/cache': { removeRemoteCache() {} },
    '@/lib/workspace': { chatWorkspace: () => ({ remove() {} }) },
    '@/store/projects': { useProjects: { getState: () => ({ projects: {} }) } },
    '@/store/ui': { useUI: { getState: () => ui } },
    '@/lib/notifications': { notifyReplyFinished: async () => {} },
    '@/lib/remote/client': { RemoteAdapter: class {
      constructor(backend) { this.backend = backend; }
      info() { return snapshot ? Promise.resolve({}) : new Promise(() => {}); }
      ensureSession() { return Promise.resolve({ sessionId: 'session' }); }
      start() { return Promise.resolve({ id: 'run' }); }
      snapshot() { return Promise.resolve(snapshot); }
    } },
    '@/lib/tools/phone': { onPhoneStop() {} },
  };
  function load(filename) {
    if (mocks[filename]) return mocks[filename];
    const normalized = filename.replace(/^@\//, 'src/');
    if (loaded.has(normalized)) return loaded.get(normalized);
    const actual = path.join(root, normalized + '.ts');
    const source = readFileSync(actual, 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const module = { exports: {} }; loaded.set(normalized, module.exports);
    const localRequire = (specifier) => {
      if (!specifier.startsWith('.') && !specifier.startsWith('@/')) return require(specifier);
      const resolved = specifier.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(normalized), specifier)).replace(/^src\//, '@/') : specifier;
      if (mocks[resolved]) return mocks[resolved];
      if (['@/store/chats', '@/store/backends', '@/lib/remote/chat', '@/lib/remote/effort', '@/lib/remote/types'].includes(resolved)) return load(resolved);
      // Built-in agent dependencies are intentionally unavailable: remote routing
      // must return before any of their tools, models or helper requests are used.
      return new Proxy({}, { get: (_target, key) => key === '__esModule' ? false : () => { throw new Error(`Unexpected local agent call: ${resolved}.${String(key)}`); } });
    };
    vm.runInThisContext(`(function(require,module,exports){${compiled}\n})`, { filename: actual })(localRequire, module, module.exports);
    loaded.set(normalized, module.exports); return module.exports;
  }
  return { chats: load('@/store/chats').useChats, backends: load('@/store/backends').useBackends, remote: load('@/lib/remote/chat'), chat: load('src/lib/chat'), ui };
}

test('backend is locked at first message; another chat selection cannot retarget or steer queued messages', () => {
  const f = app();
  const first = { id: 'remote_A', bridgeId: 'A', name: 'Hermes A', kind: 'hermes', model: 'agent-A', models: ['agent-A'], baseUrl: 'http://a' };
  const second = { ...first, id: 'remote_B', bridgeId: 'B', name: 'Harness B', kind: 'harness', model: 'agent-B', baseUrl: 'http://b' };
  f.backends.getState().save(first); f.backends.getState().save(second); f.backends.getState().select(first.id);
  const id = f.remote.sendRemoteMessage(null, 'Hello A', []);
  assert.equal(f.chats.getState().conversations[id].backendId, first.id);
  f.backends.getState().select(second.id);
  f.chats.getState().setModel(id, 'other-endpoint', 'other-model');
  assert.equal(f.chats.getState().conversations[id].model, 'agent-A');
  f.chat.submitMessage(id, 'Continue A', []);
  const saved = f.chats.getState().conversations[id];
  assert.equal(saved.queue.length, 1); assert.equal(saved.queue[0].steer, undefined);
  assert.equal(saved.backendId, first.id);
  assert.equal(f.remote.adapterForChat(id).backend.id, first.id);
  const before = saved.messages.length;
  f.chat.regenerate(id, saved.messages.at(-1).id);
  assert.equal(f.chats.getState().conversations[id].messages.length, before);
  f.backends.getState().remove(first.id);
  assert.throws(() => f.remote.adapterForChat(id), /removed/);
});

test('legacy migration preserves text and built-in behavior; remote active turns survive rehydration', () => {
  const f = app(); const options = f.chats.persist.getOptions();
  const legacy = { conversations: { old: { id: 'old', endpointId: 'endpoint', model: 'model', messages: [{ id: 'm1', role: 'user', status: 'done', content: [{ type: 'text', text: 'Original history' }] }] } } };
  const migrated = options.migrate(legacy, 1);
  assert.equal(migrated.conversations.old.backendId, 'local');
  assert.equal(migrated.conversations.old.messages[0].content[0].text, 'Original history');
  const pending = { conversations: { remote: { id: 'remote', backendId: 'remote_A', remote: { submissionId: 'one', runId: 'run1' }, messages: [{ id: 'reply', role: 'assistant', status: 'streaming', content: [] }] } } };
  const restored = options.merge(pending, f.chats.getState());
  assert.equal(restored.conversations.remote.messages[0].status, 'streaming');
  assert.equal(restored.conversations.remote.remote.runId, 'run1');
});

test('effort is frozen per submission and queued follow-up, independently of backend defaults', () => {
  const f = app();
  const backend = { id: 'hermes', bridgeId: 'bridge', name: 'Hermes', kind: 'hermes', model: 'model', models: ['model'], baseUrl: 'http://a', modelOptions: { model: { efforts: ['low', 'medium', 'high'] } }, efforts: { model: 'high' } };
  f.backends.getState().save(backend); f.backends.getState().select(backend.id);
  const id = f.remote.sendRemoteMessage(null, 'First turn', []);
  const read = () => f.chats.getState().conversations[id];
  assert.equal(read().remote.effort, 'high');
  assert.equal(read().remote.submissionEffort, 'high');
  f.chats.getState().setRemote(id, { effort: 'low' });
  f.chat.submitMessage(id, 'Queued turn', []);
  assert.equal(read().queue[0].remoteEffort, 'low');
  f.chats.getState().setRemote(id, { effort: 'medium' });
  f.backends.getState().save({ ...backend, efforts: { model: 'medium' } });
  assert.equal(read().remote.submissionEffort, 'high');
  assert.equal(read().queue[0].remoteEffort, 'low');
  f.chats.getState().setRemote(id, { submissionId: undefined });
  f.remote.sendRemoteQueue(id);
  assert.equal(read().remote.submissionEffort, 'low');
  assert.equal(read().remote.effort, 'medium');
  assert.equal(read().queue, undefined);
});

test('reported remote context and reply statistics persist through chat reopening', { timeout: 3000 }, async (t) => {
  const metrics = { context: { used: 12345, budget: 64000, estimated: false }, tokensPerSec: 42.5, cacheHit: 0 };
  const f = app({ snapshot: { id: 'run', sessionId: 'session', cursor: 5, state: 'completed', content: [{ type: 'text', text: 'Done' }], files: [], controls: [], metrics } });
  const backend = { id: 'hermes', bridgeId: 'bridge', name: 'Hermes', kind: 'hermes', model: 'model', models: ['model'], baseUrl: 'http://a' };
  f.backends.getState().save(backend); f.backends.getState().select(backend.id);
  const id = f.remote.sendRemoteMessage(null, 'Hello', []);
  t.after(() => f.chats.getState().setRemote(id, { submissionId: undefined }));
  await new Promise((resolve) => setImmediate(resolve));
  const saved = f.chats.getState().conversations[id];
  assert.equal(saved.remote.submissionId, undefined);
  assert.deepEqual(saved.remote.context, metrics.context);
  assert.deepEqual(saved.messages.at(-1).stats, { tokensPerSec: 42.5, cacheHit: 0 });
  const restored = f.chats.persist.getOptions().merge({ conversations: { [id]: structuredClone(saved) } }, f.chats.getState());
  assert.deepEqual(restored.conversations[id].remote.context, metrics.context);
  assert.deepEqual(restored.conversations[id].messages.at(-1).stats, saved.messages.at(-1).stats);
});

test('Harness uses its advertised effort default and captures a later selection per turn', () => {
  const f = app();
  const backend = { id: 'harness', bridgeId: 'bridge', name: 'Harness', kind: 'harness', model: 'deepseek/model', models: ['deepseek/model'], baseUrl: 'http://a', modelOptions: { 'deepseek/model': { efforts: ['low', 'high'], defaultEffort: 'low' } } };
  f.backends.getState().save(backend); f.backends.getState().select(backend.id);
  const id = f.remote.sendRemoteMessage(null, 'First turn', []);
  assert.equal(f.chats.getState().conversations[id].remote.submissionEffort, 'low');
  f.chats.getState().setRemote(id, { effort: 'high' });
  f.chat.submitMessage(id, 'Queued turn', []);
  assert.equal(f.chats.getState().conversations[id].queue[0].remoteEffort, 'high');
  assert.equal(f.chats.getState().conversations[id].remote.submissionEffort, 'low');
});
