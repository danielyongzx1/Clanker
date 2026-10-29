import { guessEfforts } from './effort';
import { getJson, joinUrl, readSSE, request } from './http';
import { uid } from '../storage';
import type { EffortParam, Endpoint, ProviderAdapter, StreamUsage, ToolCall, WireMessage } from './types';

function headers(endpoint: Endpoint, apiKey?: string) {
  return { ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}), ...endpoint.headers };
}

/** The `metadata` block of a llama-swap model's config. */
type LlamaSwapMeta = {
  reasoning?: boolean;
  /** Effort levels mapped to the value the template takes; empty where the model has no such level. */
  thinkingLevelMap?: Record<string, string | null>;
  compat?: { chatTemplateKwargs?: Record<string, unknown> };
};

type OpenAIModel = {
  id: string;
  owned_by?: string;
  /** OpenRouter lists the request parameters each model accepts; llama-swap lists only the tool ones. */
  supported_parameters?: string[];
  /** llama-swap's modalities; older versions sent them, and the context window, under `capabilities`. */
  architecture?: { input_modalities?: unknown; output_modalities?: unknown };
  capabilities?: { in?: unknown; out?: unknown; context?: unknown };
  /** Context window: OpenRouter's `context_length`, Groq's `context_window`, LM Studio's `max_context_length`. */
  context_length?: number;
  context_window?: number;
  max_context_length?: number;
  /** llama-swap repeats the context window as `n_ctx` and passes on its config metadata as `llamaswap`. */
  meta?: { n_ctx?: number; llamaswap?: LlamaSwapMeta };
};

const isOpenRouter = (endpoint: Endpoint) => endpoint.baseUrl.includes('openrouter.ai');

const LEVEL_ORDER = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

function contextOf(m: OpenAIModel) {
  const legacy = m.capabilities?.context;
  return (
    m.context_length ??
    m.context_window ??
    m.max_context_length ??
    m.meta?.n_ctx ??
    (typeof legacy === 'number' ? legacy : undefined)
  );
}

/** False for speech and other models that don't both take and return text. */
function isChatModel(m: OpenAIModel) {
  const has = (list: unknown) => !Array.isArray(list) || list.includes('text');
  return (
    has(m.architecture?.input_modalities ?? m.capabilities?.in) &&
    has(m.architecture?.output_modalities ?? m.capabilities?.out)
  );
}

function effortsOf(endpoint: Endpoint, m: OpenAIModel, effortParam: EffortParam): string[] | undefined {
  if (!isChatModel(m)) return undefined;
  const meta = m.meta?.llamaswap;
  if (meta?.reasoning === false) return undefined;
  const map = meta?.thinkingLevelMap;
  if (map) {
    const levels = LEVEL_ORDER.filter((l) => map[l] != null);
    // A template that reads enable_thinking can also switch thinking off.
    const toggles = 'enable_thinking' in (meta.compat?.chatTemplateKwargs ?? {});
    const all = toggles ? ['off', ...levels] : levels;
    return all.length ? all : undefined;
  }
  if (m.supported_parameters && m.owned_by !== 'llama-swap') {
    return m.supported_parameters.some((p) => p === 'reasoning' || p === 'reasoning_effort')
      ? ['low', 'medium', 'high']
      : undefined;
  }
  return guessEfforts('openai', m.id, effortParam);
}

function detectEffortParam(endpoint: Endpoint, models: OpenAIModel[]): EffortParam {
  if (isOpenRouter(endpoint)) return 'reasoning';
  // llama.cpp reports owned_by "llamacpp"; llama-swap in front of it adds a capabilities object.
  const llamaCpp = models.some((m) => /llama/i.test(m.owned_by ?? '') || Array.isArray(m.capabilities?.in));
  return llamaCpp ? 'chat_template_kwargs' : 'reasoning_effort';
}

function effortBody(endpoint: Endpoint, effort: string) {
  switch (endpoint.effortParam ?? detectEffortParam(endpoint, [])) {
    case 'reasoning':
      // `enabled` matters for models that only reason on request; effort picks the depth.
      return { reasoning: { effort, enabled: true, exclude: false } };
    case 'chat_template_kwargs':
      // Hybrid models (Qwen3, GLM, ...) toggle thinking; gpt-oss's and Qwen3.8's templates read a level.
      // A level also switches thinking on, for templates that read both.
      return {
        chat_template_kwargs:
          effort === 'on' || effort === 'off'
            ? { enable_thinking: effort === 'on' }
            : { enable_thinking: true, reasoning_effort: effort },
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
      .map((m) => ({ id: m.id, contextLength: contextOf(m), efforts: effortsOf(endpoint, m, effortParam) }))
      .sort((a, b) => a.id.localeCompare(b.id));
    return { models, effortParam };
  },

  async stream({ endpoint, apiKey, model, messages, system, effort, tools, signal, onToken, onReasoning, onToolDraft }) {
    const body = {
      model,
      stream: true,
      // Token counts come in a last chunk, only when asked for.
      stream_options: { include_usage: true },
      ...(effort ? effortBody(endpoint, effort) : {}),
      ...(tools?.length
        ? {
            tools: tools.map((t) => ({
              type: 'function',
              function: { name: t.name, description: t.description, parameters: t.parameters },
            })),
          }
        : {}),
      messages: [...(system ? [{ role: 'system', content: system }] : []), ...messages.flatMap(toOpenAI)],
    };
    const res = await request(joinUrl(endpoint.baseUrl, 'chat/completions'), {
      headers: { Accept: 'text/event-stream', ...headers(endpoint, apiKey) },
      body,
      signal,
    });
    // Tool calls stream in fragments keyed by index: the id and name first, then the arguments.
    const calls: { id?: string; name: string; args: string }[] = [];
    let usage: StreamUsage | undefined;
    for await (const data of readSSE(res)) {
      if (data === '[DONE]') break;
      const json = JSON.parse(data);
      if (json.error) throw new Error(json.error.message ?? String(json.error));
      if (json.usage || json.timings) usage = usageOf(json);
      const delta = json.choices?.[0]?.delta;
      // Reasoning arrives as `reasoning_content` on DeepSeek/llama.cpp-style servers and as
      // `reasoning` on OpenRouter.
      const thought = delta?.reasoning_content ?? delta?.reasoning;
      if (typeof thought === 'string' && thought) onReasoning?.(thought);
      const text = delta?.content;
      if (text) onToken(text);
      for (const [i, tc] of ((delta?.tool_calls ?? []) as any[]).entries()) {
        // Some servers send each call whole and leave out the index.
        const index = typeof tc.index === 'number' ? tc.index : calls.length + i;
        const call = (calls[index] ??= { name: '', args: '' });
        if (tc.id) call.id = tc.id;
        if (tc.function?.name) call.name += tc.function.name;
        if (tc.function?.arguments != null) {
          call.args += typeof tc.function.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function.arguments);
        }
        // The id is made up here when the server sends none, so the draft and the finished call share it.
        if (call.name) onToolDraft?.({ index, id: (call.id ??= `call_${uid()}`), name: call.name, args: call.args });
      }
    }
    const toolCalls: ToolCall[] = calls
      .filter((c) => c?.name)
      .map((c) => {
        let input: Record<string, unknown> = {};
        try {
          input = c.args ? JSON.parse(c.args) : {};
        } catch {
          input = { _raw: c.args };
        }
        return { id: c.id ?? `call_${uid()}`, name: c.name, input };
      });
    return { toolCalls, usage };
  },
};

/**
 * llama.cpp's `timings` count what it decoded and how long that took, and `cache_n` the prompt
 * tokens it reused; elsewhere `usage` has the counts, with cached tokens under OpenAI's
 * `prompt_tokens_details` or DeepSeek's `prompt_cache_hit_tokens`.
 */
function usageOf(json: any): StreamUsage {
  const t = json.timings;
  if (t && typeof t.predicted_n === 'number') {
    return {
      output: t.predicted_n,
      decodeMs: t.predicted_ms,
      ...(typeof t.cache_n === 'number' ? { input: (t.prompt_n ?? 0) + t.cache_n, cached: t.cache_n } : {}),
    };
  }
  const u = json.usage ?? {};
  return {
    output: u.completion_tokens,
    input: u.prompt_tokens,
    cached: u.prompt_tokens_details?.cached_tokens ?? u.prompt_cache_hit_tokens,
  };
}

const imageParts = (images: WireMessage['images']) =>
  images.map((img) => ({ type: 'image_url', image_url: { url: `data:${img.mimeType};base64,${img.base64}` } }));

function toOpenAI(m: WireMessage): object[] {
  if (m.role === 'tool') {
    const results = m.results ?? [];
    const images = results.flatMap((r) => r.images ?? []);
    return [
      ...results.map((r) => ({ role: 'tool', tool_call_id: r.callId, content: r.output || '(no output)' })),
      // Tool messages only take text here, so images the tools returned follow as a user turn.
      ...(images.length
        ? [{ role: 'user', content: [{ type: 'text', text: 'Images returned by the tool calls above:' }, ...imageParts(images)] }]
        : []),
    ];
  }
  if (m.toolCalls?.length) {
    return [
      {
        role: 'assistant',
        content: m.text || null,
        tool_calls: m.toolCalls.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: JSON.stringify(c.input) },
        })),
      },
    ];
  }
  return [
    m.images.length === 0
      ? { role: m.role, content: m.text }
      : { role: m.role, content: [...imageParts(m.images), ...(m.text ? [{ type: 'text', text: m.text }] : [])] },
  ];
}
