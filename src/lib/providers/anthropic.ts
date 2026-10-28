import { getJson, joinUrl, readSSE, request } from './http';
import type { Endpoint, ProviderAdapter } from './types';

const EFFORT_ORDER = ['low', 'medium', 'high', 'xhigh', 'max'];

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

  async stream({ endpoint, apiKey, model, messages, system, effort, signal, onToken }) {
    const body = {
      model,
      // Thinking counts toward max_tokens, and every model that takes effort allows at least 64K.
      max_tokens: effort ? 32000 : 8192,
      stream: true,
      ...(system ? { system } : {}),
      ...(effort ? { output_config: { effort } } : {}),
      messages: messages.map((m) => ({
        role: m.role,
        content: [
          ...m.images.map((img) => ({
            type: 'image',
            source: { type: 'base64', media_type: img.mimeType, data: img.base64 },
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
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        onToken(event.delta.text);
      }
      if (event.type === 'message_stop') break;
    }
  },
};
