import { guessEfforts } from './effort';
import { getJson, joinUrl, readSSE, request } from './http';
import { uid } from '../storage';
import type { Endpoint, ProviderAdapter, ToolCall, WireMessage } from './types';

function headers(endpoint: Endpoint, apiKey?: string) {
  return { ...(apiKey ? { 'x-goog-api-key': apiKey } : {}), ...endpoint.headers };
}

type GeminiModel = { name: string; supportedGenerationMethods?: string[]; thinking?: boolean; inputTokenLimit?: number };

// Gemini 2.x takes a thinking token budget; later models take a named thinking level.
const THINKING_BUDGETS: Record<string, number> = { none: 0, minimal: 512, low: 1024, medium: 8192, high: 24576 };

function thinkingConfig(model: string, effort: string) {
  const levels = !/gemini-2\./.test(model) ? { thinkingLevel: effort } : { thinkingBudget: THINKING_BUDGETS[effort] ?? -1 };
  // Thought summaries are withheld unless asked for; without this the panel would stay empty.
  // REST takes camelCase here, unlike the snake_case inline_data elsewhere in this body.
  return { ...levels, includeThoughts: true };
}

export const gemini: ProviderAdapter = {
  async listModels(endpoint, apiKey) {
    const json = await getJson(joinUrl(endpoint.baseUrl, 'v1beta/models?pageSize=1000'), headers(endpoint, apiKey));
    const models = ((json.models ?? []) as GeminiModel[])
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent') ?? true)
      .map((m) => {
        const id = m.name.replace(/^models\//, '');
        return {
          id,
          efforts: m.thinking ? (guessEfforts('gemini', id) ?? ['low', 'medium', 'high']) : undefined,
          contextLength: m.inputTokenLimit,
        };
      });
    return { models };
  },

  async stream({ endpoint, apiKey, model, messages, system, effort, tools, signal, onToken, onReasoning }) {
    const body = {
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      ...(effort ? { generationConfig: { thinkingConfig: thinkingConfig(model, effort) } } : {}),
      ...(tools?.length
        ? {
            tools: [
              {
                functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })),
              },
            ],
          }
        : {}),
      contents: messages.map(toGemini),
    };
    const url = joinUrl(endpoint.baseUrl, `v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`);
    const res = await request(url, {
      headers: { Accept: 'text/event-stream', ...headers(endpoint, apiKey) },
      body,
      signal,
    });
    const toolCalls: ToolCall[] = [];
    for await (const data of readSSE(res)) {
      const json = JSON.parse(data);
      if (json.error) throw new Error(json.error.message ?? 'Stream error');
      for (const part of json.candidates?.[0]?.content?.parts ?? []) {
        if (part.functionCall) {
          toolCalls.push({
            id: part.functionCall.id ?? `call_${uid()}`,
            name: part.functionCall.name,
            input: part.functionCall.args ?? {},
            signature: part.thoughtSignature,
          });
        }
        if (!part.text) continue;
        // Thought summaries from thinking models stream with `thought: true`.
        if (part.thought) onReasoning?.(part.text);
        else onToken(part.text);
      }
    }
    return { toolCalls };
  },
};

function toGemini(m: WireMessage) {
  if (m.role === 'tool') {
    const results = m.results ?? [];
    return {
      role: 'user',
      parts: [
        ...results.map((r) => ({
          functionResponse: { name: r.name, response: r.isError ? { error: r.output } : { output: r.output } },
        })),
        ...results.flatMap((r) => (r.images ?? []).map((img) => ({ inline_data: { mime_type: img.mimeType, data: img.base64 } }))),
      ],
    };
  }
  return {
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [
      ...m.images.map((img) => ({ inline_data: { mime_type: img.mimeType, data: img.base64 } })),
      ...(m.files ?? []).map((file) => ({ inline_data: { mime_type: file.mimeType, data: file.base64 } })),
      ...(m.text ? [{ text: m.text }] : []),
      // Gemini 3 rejects a replayed function call without the thought signature it came with.
      ...(m.toolCalls ?? []).map((c) => ({
        functionCall: { name: c.name, args: c.input },
        ...(c.signature ? { thoughtSignature: c.signature } : {}),
      })),
    ],
  };
}
