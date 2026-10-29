import { guessEfforts } from './effort';
import { getJson, joinUrl, readLines, request } from './http';
import { uid } from '../storage';
import type { Endpoint, ProviderAdapter, ToolCall, WireMessage } from './types';

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

  async stream({ endpoint, apiKey, model, messages, system, effort, tools, signal, onToken, onReasoning, onToolDraft }) {
    const body = {
      model,
      stream: true,
      ...(effort ? { think: effort === 'on' ? true : effort === 'off' ? false : effort } : {}),
      ...(tools?.length
        ? {
            tools: tools.map((t) => ({
              type: 'function',
              function: { name: t.name, description: t.description, parameters: t.parameters },
            })),
          }
        : {}),
      messages: [...(system ? [{ role: 'system', content: system }] : []), ...messages.flatMap(toOllama)],
    };
    const res = await request(joinUrl(endpoint.baseUrl, 'api/chat'), {
      headers: headers(endpoint, apiKey),
      body,
      signal,
    });
    // Ollama streams newline-delimited JSON rather than SSE.
    const toolCalls: ToolCall[] = [];
    for await (const line of readLines(res)) {
      if (!line.trim()) continue;
      const json = JSON.parse(line);
      if (json.error) throw new Error(json.error);
      if (json.message?.thinking) onReasoning?.(json.message.thinking);
      if (json.message?.content) onToken(json.message.content);
      // Each tool call arrives whole, with its arguments already parsed.
      for (const tc of json.message?.tool_calls ?? []) {
        if (!tc.function?.name) continue;
        const args = tc.function.arguments;
        const call = {
          id: tc.id ?? `call_${uid()}`,
          name: tc.function.name,
          input: typeof args === 'string' ? safeParse(args) : (args ?? {}),
        };
        onToolDraft?.({ index: toolCalls.length, id: call.id, name: call.name, args: JSON.stringify(call.input) });
        toolCalls.push(call);
      }
      if (json.done) break;
    }
    return { toolCalls };
  },
};

function safeParse(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json);
  } catch {
    return { _raw: json };
  }
}

function toOllama(m: WireMessage): object[] {
  if (m.role === 'tool') {
    const results = m.results ?? [];
    return results.map((r, i) => ({
      role: 'tool',
      tool_name: r.name,
      content: r.output || '(no output)',
      // Images ride on the last result; Ollama takes them on any message.
      ...(i === results.length - 1 && results.some((x) => x.images?.length)
        ? { images: results.flatMap((x) => (x.images ?? []).map((img) => img.base64)) }
        : {}),
    }));
  }
  return [
    {
      role: m.role,
      content: m.text,
      ...(m.images.length ? { images: m.images.map((img) => img.base64) } : {}),
      ...(m.toolCalls?.length
        ? { tool_calls: m.toolCalls.map((c) => ({ function: { name: c.name, arguments: c.input } })) }
        : {}),
    },
  ];
}
