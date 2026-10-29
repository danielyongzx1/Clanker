import { getJson, joinUrl, readSSE, request } from './http';
import type { Endpoint, ProviderAdapter, StreamUsage, ToolCall, WireMessage } from './types';

const EFFORT_ORDER = ['low', 'medium', 'high', 'xhigh', 'max'];

const CACHE = { type: 'ephemeral' };

// Thinking budgets for models that only take `type: "enabled"` (4.5-era and older).
const EXTENDED_BUDGETS: Record<string, number> = { low: 2048, medium: 8192, high: 16384, xhigh: 24576, max: 30000 };

/** Reads "claude-opus-4-6", "claude-3-5-sonnet" etc. as [4, 6] / [3, 5]; date suffixes → minor 0. */
function modelVersion(model: string): [number, number] | null {
  const m = model.toLowerCase().match(/claude-(?:(?:opus|sonnet|haiku)-)?(\d+)(?:[.-](\d+))?/);
  if (!m) return null;
  const minor = m[2] ? parseInt(m[2]) : 0;
  return [parseInt(m[1]), minor > 20 ? 0 : minor];
}

/** Models before Opus 4.6 don't take adaptive thinking; they need `type: "enabled"` + a budget. */
function isLegacyExtended(model: string) {
  const v = modelVersion(model);
  return !!v && (v[0] < 4 || (v[0] === 4 && v[1] <= 5));
}

/**
 * Effort alone doesn't switch thinking on: on 4.5-era and older models it needs
 * `thinking: {type: "enabled", budget_tokens}`, on 4.6–4.8 `thinking: {type: "adaptive"}`,
 * and on thinking-by-default models the summary display defaults to "omitted". Ask for
 * readable thinking whenever an effort level is set.
 */
function thinkingBody(endpoint: Endpoint, model: string, effort?: string) {
  if (!effort) return {};
  if (isLegacyExtended(model)) {
    const budget = EXTENDED_BUDGETS[effort] ?? 8192;
    return { thinking: { type: 'enabled', budget_tokens: budget }, max_tokens: budget + 8192 };
  }
  // `display` is an Anthropic-first field; some proxies 400 on unknown fields, so only
  // send it to api.anthropic.com. Adaptive still enables thinking on the rest.
  const direct = /(^|\/\/|\.)(?:api\.)?anthropic\.com/i.test(endpoint.baseUrl);
  return {
    thinking: direct ? { type: 'adaptive', display: 'summarized' } : { type: 'adaptive' },
    max_tokens: 32000,
  };
}

type AnthropicModel = {
  id: string;
  max_input_tokens?: number;
  capabilities?: { effort?: { supported?: boolean } & Record<string, { supported?: boolean } | boolean | undefined> };
};

/** Reads the levels marked supported in the model's capability tree, e.g. `effort.max.supported`. */
function effortsOf(model: AnthropicModel) {
  const effort = model.capabilities?.effort;
  if (!effort?.supported) return undefined;
  const levels = Object.keys(effort).filter((k) => {
    const v = effort[k];
    return typeof v === 'object' && v?.supported;
  });
  levels.sort((a, b) => (EFFORT_ORDER.indexOf(a) + 1 || 99) - (EFFORT_ORDER.indexOf(b) + 1 || 99));
  return levels.length ? levels : undefined;
}

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
    return {
      models: ((json.data ?? []) as AnthropicModel[]).map((m) => ({
        id: m.id,
        efforts: effortsOf(m),
        contextLength: m.max_input_tokens,
      })),
    };
  },

  async stream({ endpoint, apiKey, model, messages, system, effort, tools, signal, onToken, onReasoning, onToolDraft }) {
    // Anthropic only caches up to explicit breakpoints. History is append-only, so mark the end of
    // this request and the end of the previous one (the user turn before), so each request reads
    // what the last one wrote; the system prompt gets one too, shared by every chat.
    const wire = messages.map(toAnthropic);
    for (const m of wire.filter((m) => m.role === 'user').slice(-2)) {
      const last = m.content.length - 1;
      if (last >= 0) m.content[last] = { ...m.content[last], cache_control: CACHE };
    }
    const body = {
      model,
      stream: true,
      // Without thinking, 8192 is the cap; thinking counts toward max_tokens, and every
      // model that takes effort allows at least 32K.
      max_tokens: 8192,
      ...(system ? { system: [{ type: 'text', text: system, cache_control: CACHE }] } : {}),
      ...(effort ? { output_config: { effort }, ...thinkingBody(endpoint, model, effort) } : {}),
      ...(tools?.length
        ? { tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) }
        : {}),
      messages: wire,
    };
    const res = await request(joinUrl(endpoint.baseUrl, 'v1/messages'), {
      headers: { Accept: 'text/event-stream', ...headers(endpoint, apiKey) },
      body,
      signal,
    });

    // Tool-use and thinking blocks by stream index, assembled from their deltas.
    const blocks: Record<number, Record<string, any>> = {};
    const toolCalls: ToolCall[] = [];
    const thinking: unknown[] = [];
    const usage: StreamUsage = {};
    for await (const data of readSSE(res)) {
      const event = JSON.parse(data);
      if (event.type === 'error') throw new Error(event.error?.message ?? 'Stream error');
      // Prompt counts come at the start; the output count grows in message_delta to its total.
      if (event.type === 'message_start' && event.message?.usage) {
        const u = event.message.usage;
        usage.cached = u.cache_read_input_tokens ?? 0;
        usage.input = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + usage.cached;
      }
      if (event.type === 'message_delta' && typeof event.usage?.output_tokens === 'number') usage.output = event.usage.output_tokens;
      if (event.type === 'content_block_start') {
        const block = event.content_block;
        if (block?.type === 'tool_use') {
          blocks[event.index] = { type: 'tool_use', id: block.id, name: block.name, json: '' };
          onToolDraft?.({ index: event.index, id: block.id, name: block.name, args: '' });
        }
        if (block?.type === 'thinking') blocks[event.index] = { type: 'thinking', thinking: block.thinking ?? '', signature: '' };
        // Redacted thinking is opaque, but has to be replayed like the rest.
        if (block?.type === 'redacted_thinking') thinking.push(block);
      }
      if (event.type === 'content_block_delta') {
        const block = blocks[event.index];
        const delta = event.delta;
        if (delta?.type === 'text_delta') onToken(delta.text);
        if (delta?.type === 'input_json_delta' && block) {
          block.json += delta.partial_json ?? '';
          onToolDraft?.({ index: event.index, id: block.id, name: block.name, args: block.json });
        }
        if (delta?.type === 'signature_delta' && block) block.signature += delta.signature ?? '';
        // Summarized thinking streams as summary_delta instead of thinking_delta.
        const thought = delta?.type === 'thinking_delta' ? delta.thinking : delta?.type === 'summary_delta' ? (delta.summary ?? delta.text) : '';
        if (thought) {
          onReasoning?.(thought);
          if (block?.type === 'thinking') block.thinking += thought;
        }
      }
      if (event.type === 'content_block_stop') {
        const block = blocks[event.index];
        if (block?.type === 'tool_use') {
          let input: Record<string, unknown> = {};
          try {
            input = block.json ? JSON.parse(block.json) : {};
          } catch {
            input = { _raw: block.json };
          }
          toolCalls.push({ id: block.id, name: block.name, input });
        }
        if (block?.type === 'thinking') thinking.push({ type: 'thinking', thinking: block.thinking, signature: block.signature });
      }
      if (event.type === 'message_stop') break;
    }
    return { toolCalls, thinking: thinking.length ? thinking : undefined, usage };
  },
};

function toAnthropic(m: WireMessage): { role: string; content: Record<string, unknown>[] } {
  if (m.role === 'tool') {
    return {
      role: 'user',
      content: (m.results ?? []).map((r) => ({
        type: 'tool_result',
        tool_use_id: r.callId,
        content: [
          { type: 'text', text: r.output || '(no output)' },
          ...(r.images ?? []).map((img) => ({
            type: 'image',
            source: { type: 'base64', media_type: img.mimeType, data: img.base64 },
          })),
        ],
        ...(r.isError ? { is_error: true } : {}),
      })),
    };
  }
  return {
    role: m.role,
    content: [
      ...((m.toolCalls?.length ? (m.thinking ?? []) : []) as Record<string, unknown>[]),
      ...m.images.map((img) => ({
        type: 'image',
        source: { type: 'base64', media_type: img.mimeType, data: img.base64 },
      })),
      ...(m.files ?? []).map((file) => ({
        type: 'document',
        source: { type: 'base64', media_type: file.mimeType, data: file.base64 },
      })),
      // Anthropic rejects empty text blocks.
      ...(m.text ? [{ type: 'text', text: m.text }] : []),
      ...(m.toolCalls ?? []).map((c) => ({ type: 'tool_use', id: c.id, name: c.name, input: c.input })),
    ],
  };
}
