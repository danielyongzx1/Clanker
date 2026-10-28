import { guessEfforts } from './effort';
import { getJson, joinUrl, readLines, request } from './http';
import type { Endpoint, ProviderAdapter } from './types';

function headers(endpoint: Endpoint, apiKey?: string) {
  return { ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}), ...endpoint.headers };
}

export const ollama: ProviderAdapter = {
  async listModels(endpoint, apiKey) {
    const json = await getJson(joinUrl(endpoint.baseUrl, 'api/tags'), headers(endpoint, apiKey));
    const names: string[] = (json.models ?? []).map((m: { name: string }) => m.name).sort();
    // Only /api/show reports whether a model can think; gpt-oss takes levels, the rest an on/off switch.
    const models = await Promise.all(
      names.map(async (id) => {
        try {
          const res = await request(joinUrl(endpoint.baseUrl, 'api/show'), {
            headers: headers(endpoint, apiKey),
            body: { model: id },
          });
          const info: { capabilities?: string[] } = await res.json();
          if (!info.capabilities?.includes('thinking')) return { id };
          return { id, efforts: guessEfforts('ollama', id) ?? ['off', 'on'] };
        } catch {
          return { id, efforts: guessEfforts('ollama', id) };
        }
      })
    );
    return { models };
  },

  async stream({ endpoint, apiKey, model, messages, system, effort, signal, onToken, onReasoning }) {
    const body = {
      model,
      stream: true,
      ...(effort ? { think: effort === 'on' ? true : effort === 'off' ? false : effort } : {}),
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
      if (json.message?.thinking) onReasoning?.(json.message.thinking);
      if (json.message?.content) onToken(json.message.content);
      if (json.done) break;
    }
  },
};
