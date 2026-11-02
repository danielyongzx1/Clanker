import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptHarnessProjection } from '../src/harness-metrics.mjs';
import { renderHarnessRun } from '../src/harness.mjs';

function assistant(seq, usage, time0, duration, type = 'assistant/message') {
  return { seq, type, data: {
    ...(type === 'assistant/message' ? { usage, message: { content: [{ type: 'text', text: 'Done' }] } } : {}),
    stream: [
      { type: 'reasoning-chunks', index: 0, time0, dt: [100], texts: ['Think ', 'briefly'] },
      { type: 'text-chunks', index: 1, time0: time0 + 200, dt: [], texts: ['Done'] },
      { type: 'chunk', time: time0 + duration, chunk: { type: 'usage', usage } },
      { type: 'chunk', time: time0 + duration, chunk: { type: 'finish', reason: { kind: 'stop' } } },
    ],
  } };
}

test('Harness cache input is disjoint, speed excludes tools, and context follows host compaction', () => {
  const run = { state: 'running', harnessEvents: {
    1: { seq: 1, type: 'request/context', data: { contextWindow: 64000 } },
    2: assistant(2, { inputTokens: 4000, cacheReadTokens: 6000, cacheWriteTokens: 0, outputTokens: 40, totalTokens: 10040 }, 1000, 2000),
    3: assistant(3, { inputTokens: 3000, cacheReadTokens: 9000, cacheWriteTokens: 1000, outputTokens: 60, totalTokens: 13060 }, 1000000, 3000),
  } };
  acceptHarnessProjection(run, { asOfSeq: 4, values: { tokenUsage: { uncachedInputTokens: 3000000 }, contextPressure: { pressureTokens: 13000, projectedTokens: 2000, contextWindow: 64000 } } });
  renderHarnessRun(run);
  assert.deepEqual(run.metrics.context, { used: 2000, budget: 64000, estimated: true });
  assert.equal(run.metrics.tokensPerSec, 20);
  assert.equal(run.metrics.cacheHit, 15000 / 23000);
  const saved = structuredClone(run.metrics);
  renderHarnessRun(run);
  assert.deepEqual(run.metrics, saved);
  // Without the plugin's projection, use only the latest call's prompt, never a sum.
  delete run.harnessPressure;
  renderHarnessRun(run);
  assert.deepEqual(run.metrics.context, { used: 13000, budget: 64000, estimated: false });
});

test('Harness failed attempts retain usage without counting the final sample twice', () => {
  const usage = { inputTokens: 100, cacheReadTokens: 300, cacheWriteTokens: 0, outputTokens: 20, totalTokens: 420 };
  const run = { state: 'running', harnessEvents: {
    1: assistant(1, usage, 1000, 1000, 'assistant/attempt'),
    2: assistant(2, usage, 5000, 1000),
  } };
  renderHarnessRun(run);
  assert.equal(run.metrics.tokensPerSec, 20);
  assert.equal(run.metrics.cacheHit, 0.75);
  assert.equal(run.metrics.context, undefined);
});

test('missing Harness cache or timing stays unknown and zero reported cache is preserved', () => {
  const run = { state: 'running', harnessEvents: {
    1: { seq: 1, type: 'assistant/message', data: { message: { content: [] }, usage: { inputTokens: 400, outputTokens: 20, totalTokens: 420 }, stream: [] } },
  } };
  acceptHarnessProjection(run, { asOfSeq: 1, values: { tokenUsage: { cacheReadTokens: 0, uncachedInputTokens: 400 }, contextPressure: { pressureTokens: 400, contextWindow: 64000 } } });
  renderHarnessRun(run);
  assert.deepEqual(run.metrics, { context: { used: 400, budget: 64000, estimated: false } });
  run.harnessEvents[1].data.usage.cacheReadTokens = 0;
  renderHarnessRun(run);
  assert.equal(run.metrics.cacheHit, 0);
  assert.equal(run.metrics.tokensPerSec, undefined);
});

test('older or migration-only Harness baselines cannot overwrite current context', () => {
  const run = { state: 'running', harnessEvents: {} };
  acceptHarnessProjection(run, { asOfSeq: 10, values: { contextPressure: { projectedTokens: 500, contextWindow: 64000 } } });
  acceptHarnessProjection(run, { asOfSeq: 9, values: { contextPressure: { projectedTokens: 9999, contextWindow: 64000 } } });
  acceptHarnessProjection(run, { kind: 'migration-required', values: { contextPressure: { projectedTokens: 8888, contextWindow: 64000 } } });
  renderHarnessRun(run);
  assert.equal(run.metrics.context.used, 500);
  run.harnessEvents[11] = assistant(11, { inputTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 40, totalTokens: 1040 }, 1000, 1000);
  renderHarnessRun(run);
  assert.equal(run.metrics.context.used, 1000);
});
