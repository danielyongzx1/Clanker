import { expandAssistantStream, isTokenDelta, lastAssistantStreamChunk } from '@deepseek-ai/dsh-llm';

const count = (n) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;

// Harness input buckets are disjoint. Its inputTokens excludes cache reads/writes.
function promptTokens(usage) {
  if (!usage || !count(usage.inputTokens) || !count(usage.outputTokens)) return;
  const known = usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
  if (!count(known)) return;
  if (count(usage.totalTokens)) {
    const prompt = usage.totalTokens - usage.outputTokens;
    if (count(prompt) && prompt >= known) return prompt;
  } else if (usage.totalTokens === undefined && count(usage.cacheReadTokens) && count(usage.cacheWriteTokens)) return known;
}

/** Only exact, ordered Host projections; never a lifetime tokenUsage total. */
export function acceptHarnessProjection(run, baseline) {
  if (!baseline || baseline.kind === 'migration-required' || !count(baseline.asOfSeq) && baseline.asOfSeq !== -1) return;
  if (baseline.asOfSeq < (run.harnessProjectionSeq ?? -1)) return;
  run.harnessProjectionSeq = baseline.asOfSeq;
  run.harnessPressure = baseline.values?.contextPressure;
}

function attemptSample(event) {
  const stream = event.data.stream ?? [];
  const usage = event.data.usage ?? lastAssistantStreamChunk(stream, 'usage')?.usage;
  if (!usage) return;
  const prompt = promptTokens(usage);
  let ms;
  try {
    const chunks = expandAssistantStream(stream);
    const first = chunks.find((entry) => isTokenDelta(entry.chunk))?.time;
    const end = chunks.at(-1)?.time;
    if (first !== undefined && end !== undefined && end - first >= 100) ms = end - first;
  } catch { /* An unrecognized timed stream cannot provide a decode measurement. */ }
  return { prompt, tokens: count(usage.outputTokens) ? usage.outputTokens : undefined, cached: count(usage.cacheReadTokens) ? usage.cacheReadTokens : undefined, ms };
}

/** Rebuild, rather than increment, so reconnect and live/final samples cannot double count. */
export function renderHarnessMetrics(run, events) {
  const samples = [];
  let budget = run.harnessPressure?.contextWindow;
  let lastPrompt;
  let lastSampleSeq = -1;
  let lastContextSeq = -1;
  for (const event of events) {
    if (event.type === 'request/context') { budget = event.data.contextWindow; lastContextSeq = event.seq; }
    if (event.type === 'assistant/message' || event.type === 'assistant/attempt') {
      const sample = attemptSample(event);
      if (sample) {
        samples.push(sample);
        if (sample.prompt !== undefined) { lastPrompt = sample.prompt; lastSampleSeq = event.seq; }
      }
    }
  }
  // The projection can account for compaction and surface edits after the last model call.
  // projectedTokens includes heuristic adjustments; pressureTokens is the reported prompt.
  const pressure = (run.harnessProjectionSeq ?? -1) >= Math.max(lastSampleSeq, lastContextSeq) ? run.harnessPressure : undefined;
  if (count(pressure?.contextWindow) && pressure.contextWindow > 0) budget = pressure.contextWindow;
  const projected = count(pressure?.projectedTokens) ? pressure.projectedTokens : undefined;
  const used = projected ?? (count(pressure?.pressureTokens) ? pressure.pressureTokens : lastPrompt);
  const metrics = {};
  if (count(used) && count(budget) && budget > 0) metrics.context = { used, budget, estimated: projected !== undefined };
  const timed = samples.filter((s) => s.tokens !== undefined && s.ms !== undefined);
  const ms = timed.reduce((n, s) => n + s.ms, 0);
  if (ms) metrics.tokensPerSec = timed.reduce((n, s) => n + s.tokens, 0) / ms * 1000;
  const known = samples.filter((s) => s.prompt > 0 && s.cached !== undefined && s.cached <= s.prompt);
  const input = known.reduce((n, s) => n + s.prompt, 0);
  if (input) metrics.cacheHit = known.reduce((n, s) => n + s.cached, 0) / input;
  run.metrics = Object.keys(metrics).length ? metrics : undefined;
}
