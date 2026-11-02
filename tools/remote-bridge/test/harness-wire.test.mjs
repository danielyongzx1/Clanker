import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { HarnessAdapter } from '../src/harness.mjs';

const until = async (fn) => { for (let i = 0; i < 200; i++) { const result = await fn(); if (result) return result; await new Promise((resolve) => setTimeout(resolve, 10)); } throw new Error('Harness fixture timed out'); };

test('published Harness clients pair, mount generated contracts, stream journals, answer controls and cancel', { timeout: 15000 }, async (t) => {
  let promptCount = 0; let eventSocket; let eventStream; let followSocket; let followStream; let sessionId;
  const answers = [];
  const rpcCalls = [];
  const selections = [];
  let durableRecords = [];
  let projection = { asOfSeq: 0, values: { contextPressure: { pressureTokens: 900, projectedTokens: 950, contextWindow: 32768 }, tokenUsage: { uncachedInputTokens: 3000000, cacheReadTokens: 9000000, cacheWriteTokens: 0, outputTokens: 100000 } } };
  const server = http.createServer(async (req, res) => {
    if (req.url.startsWith('/connect?')) {
      assert.ok(req.url.includes('interactions=answer'));
      res.writeHead(302, { 'Set-Cookie': 'api-session=fixture; HttpOnly; Path=/', Location: '/api/remote.mux' }); res.end(); return;
    }
    assert.equal(req.headers.cookie, 'api-session=fixture');
    let text = ''; for await (const chunk of req) text += chunk;
    const message = JSON.parse(text); const endpoint = message.method; rpcCalls.push(endpoint);
    const request = message.payload.args.request;
    let value;
    if (endpoint === 'session/modelCatalog') value = { default: { provider: 'deepseek', model: 'fixture-model' }, routableProviders: ['deepseek'], groups: [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'fixture-model', name: 'Fixture', reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'low' } }, { id: 'plain', name: 'Plain' }] }], failures: [] };
    else if (endpoint === 'session/create') { sessionId = request.sessionId; value = { sessionId }; }
    else if (endpoint === 'session/selectModel') { selections.push(request); value = { selected: { provider: request.provider, model: request.model, reasoningEffort: request.reasoningEffort } }; }
    else if (endpoint === 'session/projections') value = { kind: 'sequenced', ...projection };
    else if (endpoint === 'session/prompt') { promptCount++; value = { accepted: true }; }
    else if (endpoint === 'session/cancel') value = { accepted: true };
    else if (endpoint === '$events/result') { answers.push(message.payload.args); value = undefined; }
    else throw new Error(`Unexpected RPC ${endpoint}`);
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ type: 'server-response', rpcId: message.rpcId, result: { ok: true, value } }));
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => { assert.equal(req.headers.cookie, 'api-session=fixture'); wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws)); });
  const item = (socket, streamId, value) => socket.send(JSON.stringify({ type: 'item', streamId, value }));
  wss.on('connection', (socket) => socket.on('message', (raw) => {
    const message = JSON.parse(raw);
    if (message.type !== 'open') return;
    if (message.endpoint === '$events') {
      eventSocket = socket; eventStream = message.streamId;
      item(socket, message.streamId, { type: 'ready', clientId: 'client1', host: { home: '/fixture' } });
    } else if (message.endpoint === 'session/follow') {
      followSocket = socket; followStream = message.streamId;
      item(socket, message.streamId, { type: 'snapshot', header: { version: 1, id: sessionId, createdAt: 0 }, cursor: projection.asOfSeq, records: durableRecords, hasMore: false, projections: projection });
    }
  }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const adapter = new HarnessAdapter({ upstreamUrl: `http://127.0.0.1:${server.address().port}`, launchToken: 'launch' });
  t.after(async () => { await adapter.close(); for (const socket of wss.clients) socket.terminate(); wss.close(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  assert.deepEqual(await adapter.models(), ['deepseek/fixture-model', 'deepseek/plain']);
  assert.deepEqual(adapter.modelOptions['deepseek/fixture-model'], { efforts: ['low', 'high'], defaultEffort: 'low' });
  assert.deepEqual(adapter.modelOptions['deepseek/plain'], { efforts: [] });
  const session = { id: 'chat', model: 'deepseek/fixture-model', workspace: '/fixture/chat', instructions: 'project rules' };
  session.upstreamId = await adapter.ensureSession(session);
  const run = { id: 'run1', effort: 'high', state: 'running', content: [], controls: [], files: [] };
  const update = async (fn) => fn(run);
  run.upstreamId = await adapter.start(run, session, update);
  assert.equal(promptCount, 1);
  assert.equal(selections.at(-1).reasoningEffort, 'high');
  assert.equal(selections.at(-1).model, 'fixture-model');
  const abort = new AbortController();
  const observing = adapter.observe(run, update, abort.signal);
  await until(() => eventSocket && followStream);
  item(eventSocket, eventStream, { type: 'waterfall', event: 'approval/request', eventId: 'approval1', agentId: 'chat', request: { toolName: 'terminal', reason: 'Allow edit?' } });
  await until(() => run.controls.length);
  await adapter.respond(run, run.controls[0], 'once');
  await until(() => answers.length);
  assert.equal(answers[0].outcome.value, 'allowed-once');
  item(eventSocket, eventStream, { type: 'waterfall', event: 'user-questions/request', eventId: 'questions1', agentId: 'chat', request: { questions: [{ id: 'question1', question: 'Which sheet?', options: [{ label: 'Budget' }] }] } });
  await until(() => run.controls.length);
  await adapter.respond(run, run.controls[0], 'Budget');
  await until(() => answers.length === 2);
  assert.deepEqual(answers[1].outcome.value, { answers: [{ id: 'question1', selected: ['Budget'] }] });
  item(followSocket, followStream, { type: 'assistant-stream', frame: { type: 'chunk', attemptId: 'attempt1', revision: 1, index: 0, time: 0, chunk: { type: 'text-delta', index: 0, text: 'Streaming' } } });
  await until(() => run.content.some((p) => p.text === 'Streaming'));
  const usage = { inputTokens: 100, outputTokens: 100, cacheReadTokens: 300, cacheWriteTokens: 0, totalTokens: 500 };
  const settled = { seq: 1, time: 2500, type: 'assistant/message', data: {
    message: { content: [{ type: 'text', text: 'Finished' }] }, usage,
    stream: [
      { type: 'reasoning-chunks', index: 0, time0: 500, dt: [100], texts: ['First ', 'thought'] },
      { type: 'text-chunks', index: 1, time0: 700, dt: [], texts: ['Finished'] },
      { type: 'chunk', time: 2500, chunk: { type: 'usage', usage } },
      { type: 'chunk', time: 2500, chunk: { type: 'finish', reason: { kind: 'stop' } } },
    ],
  } };
  projection = { asOfSeq: 1, values: { ...projection.values, contextPressure: { pressureTokens: 400, projectedTokens: 500, contextWindow: 32768 } } };
  item(followSocket, followStream, { type: 'event', event: settled });
  await until(() => run.metrics?.tokensPerSec === 50);
  assert.deepEqual(run.metrics, { context: { used: 500, budget: 32768, estimated: true }, tokensPerSec: 50, cacheHit: 0.75 });
  // Replayed durable usage replaces its previous seq rather than accumulating again.
  item(followSocket, followStream, { type: 'event', event: settled });
  await adapter.stop(run); assert.ok(rpcCalls.includes('session/cancel'));
  projection = { ...projection, asOfSeq: 2 };
  // The host persisted completion but dropped the live terminal notification.
  // A fresh follow snapshot must settle it without another prompt submission.
  durableRecords = [{ type: 'event', event: settled }, { type: 'event', event: { seq: 2, time: 3000, type: 'turn/end', data: { reason: { kind: 'aborted' } } } }];
  await observing;
  assert.equal(run.state, 'cancelled'); assert.equal(run.content[0].text, 'Finished');
  assert.equal(run.metrics.tokensPerSec, 50); assert.equal(run.metrics.cacheHit, 0.75); assert.equal(promptCount, 1);
});
