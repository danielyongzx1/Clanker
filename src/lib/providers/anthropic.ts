import { getJson, joinUrl, readSSE, request } from './http';
import type { Endpoint, ProviderAdapter } from './types';

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
    return (json.data ?? []).map((m: { id: string }) => m.id);
  },

  async stream({ endpoint, apiKey, model, messages, system, signal, onToken }) {
    const body = {
      model,
      max_tokens: 8192,
      stream: true,
      ...(system ? { system } : {}),
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
