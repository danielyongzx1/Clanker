export type ProviderType = 'openai' | 'anthropic' | 'ollama' | 'gemini';

export type ImagePart = {
  type: 'image';
  /** File name inside the attachments directory (see lib/attachments). */
  file: string;
  mimeType: string;
  width?: number;
  height?: number;
};

export type ContentPart = { type: 'text'; text: string } | ImagePart;

export type Role = 'user' | 'assistant';

/** Message shape handed to provider adapters, with images already resolved to base64. */
export type WireMessage = {
  role: Role;
  text: string;
  images: { base64: string; mimeType: string }[];
};

export interface Endpoint {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl: string;
  models: string[];
  /** Reasoning effort levels each model accepts, lowest first. Models missing here have no effort control. */
  efforts?: Record<string, string[]>;
  /** How OpenAI-compatible servers take the effort level; detected when fetching models. */
  effortParam?: EffortParam;
  /** Extra HTTP headers sent with every request, e.g. OpenRouter's HTTP-Referer. */
  headers?: Record<string, string>;
}

export interface StreamOptions {
  endpoint: Endpoint;
  apiKey?: string;
  model: string;
  messages: WireMessage[];
  system?: string;
  /** One of the model's levels from `Endpoint.efforts`; omitted to use the provider default. */
  effort?: string;
  signal: AbortSignal;
  onToken: (text: string) => void;
}

/**
 * `reasoning_effort` is OpenAI's field, `reasoning` is OpenRouter's `reasoning.effort`, and
 * `chat_template_kwargs` passes it to the chat template, which is all llama.cpp (and llama-swap) reads.
 */
export type EffortParam = 'reasoning_effort' | 'reasoning' | 'chat_template_kwargs';

export type ModelInfo = { id: string; efforts?: string[] };

export type ModelList = { models: ModelInfo[]; effortParam?: EffortParam };

export interface ProviderAdapter {
  listModels(endpoint: Endpoint, apiKey?: string): Promise<ModelList>;
  stream(opts: StreamOptions): Promise<void>;
}
