import { guessEfforts } from './effort';
import { getJson, joinUrl, readSSE, request } from './http';
import type { EffortParam, Endpoint, ProviderAdapter } from './types';

function headers(endpoint: Endpoint, apiKey?: string) {
  return { ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}), ...endpoint.headers };
}

type OpenAIModel = {
  id: string;
  owned_by?: string;
  /** OpenRouter lists the request parameters each model accepts. */
  supported_parameters?: string[];
  /** llama-swap describes each model's input and output modalities. */
  capabilities?: { in?: unknown };
};

const isOpenRouter = (endpoint: Endpoint) => endpoint.baseUrl.includes('openrouter.ai');

function detectEffortParam(endpoint: Endpoint, models: OpenAIModel[]): EffortParam {
  if (isOpenRouter(endpoint)) return 'reasoning';
  // llama.cpp reports owned_by "llamacpp"; llama-swap in front of it adds a capabilities object.
  const llamaCpp = models.some((m) => /llama/i.test(m.owned_by ?? '') || Array.isArray(m.capabilities?.in));
  return llamaCpp ? 'chat_template_kwargs' : 'reasoning_effort';
}

function effortBody(endpoint: Endpoint, effort: string) {
  switch (endpoint.effortParam ?? detectEffortParam(endpoint, [])) {
    case 'reasoning':
      return { reasoning: { effort } };
    case 'chat_template_kwargs':
      // Hybrid models (Qwen3, GLM, ...) toggle thinking; gpt-oss's template reads a level.
      return {
        chat_template_kwargs:
          effort === 'on' || effort === 'off' ? { enable_thinking: effort === 'on' } : { reasoning_effort: effort },
      };
    case 'reasoning_effort':
      return { reasoning_effort: effort };
  }
}

export const openai: ProviderAdapter = {
  async listModels(endpoint, apiKey) {
    const json = await getJson(joinUrl(endpoint.baseUrl, 'models'), headers(endpoint, apiKey));
    const data: OpenAIModel[] = json.data ?? [];
    const effortParam = detectEffortParam(endpoint, data);
    const models = data
      .map((m) => ({
        id: m.id,
        efforts: m.supported_parameters
          ? m.supported_parameters.some((p) => p === 'reasoning' || p === 'reasoning_effort')
            ? ['low', 'medium', 'high']
            : undefined
          : guessEfforts('openai', m.id, effortParam),
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    return { models, effortParam };
  },

  async stream({ endpoint, apiKey, model, messages, system, effort, signal, onToken }) {
    const body = {
      model,
      stream: true,
      ...(effort ? effortBody(endpoint, effort) : {}),
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
