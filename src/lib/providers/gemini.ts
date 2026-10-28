import { guessEfforts } from './effort';
import { getJson, joinUrl, readSSE, request } from './http';
import type { Endpoint, ProviderAdapter } from './types';

function headers(endpoint: Endpoint, apiKey?: string) {
  return { ...(apiKey ? { 'x-goog-api-key': apiKey } : {}), ...endpoint.headers };
}

type GeminiModel = { name: string; supportedGenerationMethods?: string[]; thinking?: boolean };

// Gemini 2.x takes a thinking token budget; later models take a named thinking level.
const THINKING_BUDGETS: Record<string, number> = { none: 0, minimal: 512, low: 1024, medium: 8192, high: 24576 };

function thinkingConfig(model: string, effort: string) {
  if (!/gemini-2\./.test(model)) return { thinkingLevel: effort };
  return { thinkingBudget: THINKING_BUDGETS[effort] ?? -1 };
}

export const gemini: ProviderAdapter = {
  async listModels(endpoint, apiKey) {
    const json = await getJson(joinUrl(endpoint.baseUrl, 'v1beta/models?pageSize=1000'), headers(endpoint, apiKey));
    const models = ((json.models ?? []) as GeminiModel[])
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent') ?? true)
      .map((m) => {
        const id = m.name.replace(/^models\//, '');
        return { id, efforts: m.thinking ? (guessEfforts('gemini', id) ?? ['low', 'medium', 'high']) : undefined };
      });
    return { models };
  },

  async stream({ endpoint, apiKey, model, messages, system, effort, signal, onToken }) {
    const body = {
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      ...(effort ? { generationConfig: { thinkingConfig: thinkingConfig(model, effort) } } : {}),
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
