import { getJson, joinUrl, readSSE, request } from './http';
import type { Endpoint, ProviderAdapter } from './types';

function headers(endpoint: Endpoint, apiKey?: string) {
  return { ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}), ...endpoint.headers };
}

export const openai: ProviderAdapter = {
  async listModels(endpoint, apiKey) {
    const json = await getJson(joinUrl(endpoint.baseUrl, 'models'), headers(endpoint, apiKey));
    return (json.data ?? []).map((m: { id: string }) => m.id).sort();
  },

  async stream({ endpoint, apiKey, model, messages, system, signal, onToken }) {
    const body = {
      model,
      stream: true,
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        ...messages.map((m) =>
          m.images.length === 0
            ? { role: m.role, content: m.text }
            : {
                role: m.role,
                content: [
                  ...m.images.map((img) => ({
                    type: 'image_url',
                    image_url: { url: `data:${img.mimeType};base64,${img.base64}` },
                  })),
                  ...(m.text ? [{ type: 'text', text: m.text }] : []),
                ],
              }
        ),
      ],
    };
    const res = await request(joinUrl(endpoint.baseUrl, 'chat/completions'), {
      headers: { Accept: 'text/event-stream', ...headers(endpoint, apiKey) },
      body,
      signal,
    });
    for await (const data of readSSE(res)) {
      if (data === '[DONE]') break;
      const json = JSON.parse(data);
      if (json.error) throw new Error(json.error.message ?? String(json.error));
      const text = json.choices?.[0]?.delta?.content;
      if (text) onToken(text);
    }
  },
};
