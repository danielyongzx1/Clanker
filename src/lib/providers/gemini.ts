import { getJson, joinUrl, readSSE, request } from './http';
import type { Endpoint, ProviderAdapter } from './types';

function headers(endpoint: Endpoint, apiKey?: string) {
  return { ...(apiKey ? { 'x-goog-api-key': apiKey } : {}), ...endpoint.headers };
}

type GeminiModel = { name: string; supportedGenerationMethods?: string[] };

export const gemini: ProviderAdapter = {
  async listModels(endpoint, apiKey) {
    const json = await getJson(joinUrl(endpoint.baseUrl, 'v1beta/models?pageSize=1000'), headers(endpoint, apiKey));
    return ((json.models ?? []) as GeminiModel[])
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent') ?? true)
      .map((m) => m.name.replace(/^models\//, ''));
  },

  async stream({ endpoint, apiKey, model, messages, system, signal, onToken }) {
    const body = {
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      contents: messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [
          ...m.images.map((img) => ({ inline_data: { mime_type: img.mimeType, data: img.base64 } })),
          ...(m.text ? [{ text: m.text }] : []),
        ],
      })),
    };
    const url = joinUrl(endpoint.baseUrl, `v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`);
    const res = await request(url, {
      headers: { Accept: 'text/event-stream', ...headers(endpoint, apiKey) },
      body,
      signal,
    });
    for await (const data of readSSE(res)) {
      const json = JSON.parse(data);
      if (json.error) throw new Error(json.error.message ?? 'Stream error');
      for (const part of json.candidates?.[0]?.content?.parts ?? []) {
        // Skip thought summaries from thinking models.
        if (part.text && !part.thought) onToken(part.text);
      }
    }
  },
};
