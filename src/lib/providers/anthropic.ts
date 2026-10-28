import { getJson, joinUrl, readSSE, request } from './http';
import type { Endpoint, ProviderAdapter } from './types';

const EFFORT_ORDER = ['low', 'medium', 'high', 'xhigh', 'max'];

// Thinking budgets for models that only take `type: "enabled"` (4.5-era and older).
const EXTENDED_BUDGETS: Record<string, number> = { low: 2048, medium: 8192, high: 16384, xhigh: 24576, max: 30000 };

/** Reads "claude-opus-4-6", "claude-3-5-sonnet" etc. as [4, 6] / [3, 5]; date suffixes → minor 0. */
function modelVersion(model: string): [number, number] | null {
  const m = model.toLowerCase().match(/claude-(?:(?:opus|sonnet|haiku)-)?(\d+)(?:[.-](\d+))?/);
  if (!m) return null;
  const minor = m[2] ? parseInt(m[2]) : 0;
  return [parseInt(m[1]), minor > 20 ? 0 : minor];
}

/** Models before Opus 4.6 don't take adaptive thinking; they need `type: "enabled"` + a budget. */
function isLegacyExtended(model: string) {
  const v = modelVersion(model);
  return !!v && (v[0] < 4 || (v[0] === 4 && v[1] <= 5));
}

/**
 * Effort alone doesn't switch thinking on: on 4.5-era and older models it needs
 * `thinking: {type: "enabled", budget_tokens}`, on 4.6–4.8 `thinking: {type: "adaptive"}`,
 * and on thinking-by-default models the summary display defaults to "omitted". Ask for
 * readable thinking whenever an effort level is set.
 */
function thinkingBody(endpoint: Endpoint, model: string, effort?: string) {
  if (!effort) return {};
  if (isLegacyExtended(model)) {
    const budget = EXTENDED_BUDGETS[effort] ?? 8192;
    return { thinking: { type: 'enabled', budget_tokens: budget }, max_tokens: budget + 8192 };
  }
  // `display` is an Anthropic-first field; some proxies 400 on unknown fields, so only
  // send it to api.anthropic.com. Adaptive still enables thinking on the rest.
  const direct = /(^|\/\/|\.)(?:api\.)?anthropic\.com/i.test(endpoint.baseUrl);
  return {
    thinking: direct ? { type: 'adaptive', display: 'summarized' } : { type: 'adaptive' },
    max_tokens: 32000,
  };
}

type AnthropicModel = {
  id: string;
  capabilities?: { effort?: { supported?: boolean } & Record<string, { supported?: boolean } | boolean | undefined> };
};

/** Reads the levels marked supported in the model's capability tree, e.g. `effort.max.supported`. */
function effortsOf(model: AnthropicModel) {
  const effort = model.capabilities?.effort;
  if (!effort?.supported) return undefined;
  const levels = Object.keys(effort).filter((k) => {
    const v = effort[k];
    return typeof v === 'object' && v?.supported;
  });
  levels.sort((a, b) => (EFFORT_ORDER.indexOf(a) + 1 || 99) - (EFFORT_ORDER.indexOf(b) + 1 || 99));
  return levels.length ? levels : undefined;
}

function headers(endpoint: Endpoint, apiKey?: string) {
  return {
    'anthropic-version': '2023-06-01',
    ...(apiKey ? { 'x-api-key': apiKey } : {}),
    ...endpoint.headers,
  };
}

export const anthropic: ProviderAdapter = {
  async listModels(endpoint, apiKey) {
    const json = await getJson(joinUrl(endpoint.baseUrl, 'v1/models?limit=1000'), headers(endpoint, apiKey));
    return { models: ((json.data ?? []) as AnthropicModel[]).map((m) => ({ id: m.id, efforts: effortsOf(m) })) };
  },

  async stream({ endpoint, apiKey, model, messages, system, effort, signal, onToken, onReasoning }) {
    const body = {
      model,
      stream: true,
      // Without thinking, 8192 is the cap; thinking counts toward max_tokens, and every
      // model that takes effort allows at least 32K.
      max_tokens: 8192,
      ...(system ? { system } : {}),
      ...(effort ? { output_config: { effort }, ...thinkingBody(endpoint, model, effort) } : {}),
      messages: messages.map((m) => ({
        role: m.role,
        content: [
          ...m.images.map((img) => ({
            type: 'image',
            source: { type: 'base64', media_type: img.mimeType, data: img.base64 },
          })),
          ...(m.files ?? []).map((file) => ({
            type: 'document',
            source: { type: 'base64', media_type: file.mimeType, data: file.base64 },
          })),
          // Anthropic rejects empty text blocks.
          ...(m.text ? [{ type: 'text', text: m.text }] : []),
        ],
      })),
    };
    const res = await request(joinUrl(endpoint.baseUrl, 'v1/messages'), {
      headers: { Accept: 'text/event-stream', ...headers(endpoint, apiKey) },
      body,
      signal,
    });
    for await (const data of readSSE(res)) {
      const event = JSON.parse(data);
      if (event.type === 'error') throw new Error(event.error?.message ?? 'Stream error');
      if (event.type === 'content_block_delta') {
        if (event.delta?.type === 'text_delta') onToken(event.delta.text);
        // signature_delta and redacted_thinking carry nothing readable; skip them.
        // Summarized thinking streams as summary_delta instead of thinking_delta.
        if (event.delta?.type === 'thinking_delta' && event.delta.thinking) {
          onReasoning?.(event.delta.thinking);
        }
        if (event.delta?.type === 'summary_delta') {
          const summary = event.delta.summary ?? event.delta.text;
          if (summary) onReasoning?.(summary);
        }
      }
      if (event.type === 'message_stop') break;
    }
  },
};
