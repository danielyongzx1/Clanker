import { anthropic } from './anthropic';
import { gemini } from './gemini';
import { ollama } from './ollama';
import { ProviderError } from './http';
import { openai } from './openai';
import { baseUrls, forgetBaseUrl, resolveBaseUrl } from './reach';
import type { Endpoint, ProviderAdapter, ProviderType } from './types';

/**
 * Sends each request to whichever of the endpoint's URLs answers. If the request can't reach the
 * server before anything streams back (the network changed since the last probe), it probes again
 * and retries once on the newly picked URL.
 */
async function failover<T>(
  endpoint: Endpoint,
  signal: AbortSignal | undefined,
  run: (endpoint: Endpoint) => Promise<T>,
  started = () => false
): Promise<T> {
  if (baseUrls(endpoint).length < 2) return run(endpoint);
  const url = await resolveBaseUrl(endpoint, signal);
  try {
    return await run({ ...endpoint, baseUrl: url });
  } catch (e) {
    // An HTTP error means the server was reached; only unreachable ones are worth another URL.
    if (e instanceof ProviderError || signal?.aborted || started()) throw e;
    forgetBaseUrl(endpoint);
    const next = await resolveBaseUrl(endpoint, signal);
    if (next === url) throw e;
    return run({ ...endpoint, baseUrl: next });
  }
}

function withFailover(adapter: ProviderAdapter): ProviderAdapter {
  return {
    listModels: (endpoint, apiKey) => failover(endpoint, undefined, (e) => adapter.listModels(e, apiKey)),
    stream: (opts) => {
      let started = false;
      const mark =
        <A extends unknown[]>(fn: (...args: A) => void) =>
        (...args: A) => {
          started = true;
          fn(...args);
        };
      return failover(
        opts.endpoint,
        opts.signal,
        (endpoint) =>
          adapter.stream({
            ...opts,
            endpoint,
            onToken: mark(opts.onToken),
            onReasoning: opts.onReasoning && mark(opts.onReasoning),
            onToolDraft: opts.onToolDraft && mark(opts.onToolDraft),
          }),
        () => started
      );
    },
  };
}

const adapters: Record<ProviderType, ProviderAdapter> = {
  openai: withFailover(openai),
  anthropic: withFailover(anthropic),
  ollama: withFailover(ollama),
  gemini: withFailover(gemini),
};

export function getAdapter(type: ProviderType) {
  return adapters[type];
}

export const PROVIDER_LABELS: Record<ProviderType, string> = {
  openai: 'OpenAI-compatible',
  anthropic: 'Anthropic',
  ollama: 'Ollama',
  gemini: 'Google Gemini',
};

export type Preset = {
  name: string;
  type: ProviderType;
  baseUrl: string;
  needsKey: boolean;
  models?: string[];
};

export const PRESETS: Preset[] = [
  { name: 'OpenAI', type: 'openai', baseUrl: 'https://api.openai.com/v1', needsKey: true },
  { name: 'Anthropic', type: 'anthropic', baseUrl: 'https://api.anthropic.com', needsKey: true },
  { name: 'Gemini', type: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com', needsKey: true },
  { name: 'OpenRouter', type: 'openai', baseUrl: 'https://openrouter.ai/api/v1', needsKey: true },
  { name: 'Groq', type: 'openai', baseUrl: 'https://api.groq.com/openai/v1', needsKey: true },
  { name: 'Ollama', type: 'ollama', baseUrl: 'http://192.168.1.10:11434', needsKey: false },
  { name: 'LM Studio', type: 'openai', baseUrl: 'http://192.168.1.10:1234/v1', needsKey: false },
  { name: 'Custom', type: 'openai', baseUrl: '', needsKey: false },
];

export * from './effort';
export { ProviderError } from './http';
export { resolveBaseUrl } from './reach';
export * from './types';
