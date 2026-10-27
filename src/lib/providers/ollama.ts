import { getJson, joinUrl, readLines, request } from './http';
import type { Endpoint, ProviderAdapter } from './types';

function headers(endpoint: Endpoint, apiKey?: string) {
  return { ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}), ...endpoint.headers };
}

export const ollama: ProviderAdapter = {
  async listModels(endpoint, apiKey) {
    const json = await getJson(joinUrl(endpoint.baseUrl, 'api/tags'), headers(endpoint, apiKey));
    return (json.models ?? []).map((m: { name: string }) => m.name).sort();
  },

  async stream({ endpoint, apiKey, model, messages, system, signal, onToken }) {
    const body = {
      model,
      stream: true,
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        ...messages.map((m) => ({
          role: m.role,
          content: m.text,
          ...(m.images.length ? { images: m.images.map((img) => img.base64) } : {}),
        })),
      ],
    };
    const res = await request(joinUrl(endpoint.baseUrl, 'api/chat'), {
      headers: headers(endpoint, apiKey),
      body,
      signal,
    });
    // Ollama streams newline-delimited JSON rather than SSE.
    for await (const line of readLines(res)) {
      if (!line.trim()) continue;
      const json = JSON.parse(line);
      if (json.error) throw new Error(json.error);
      if (json.message?.content) onToken(json.message.content);
      if (json.done) break;
    }
  },
};
