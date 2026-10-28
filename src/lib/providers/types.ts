export type ProviderType = 'openai' | 'anthropic' | 'ollama' | 'gemini';

export type ImagePart = {
  type: 'image';
  /** File name inside the attachments directory (see lib/attachments). */
  file: string;
  mimeType: string;
  width?: number;
  height?: number;
};

/** A non-image attachment. Text-like files carry `text`; binaries are stored and sent base64 where the provider takes them. */
export type FilePart = {
  type: 'file';
  /** File name inside the attachments directory; omitted for text files, whose content is inlined. */
  file?: string;
  /** Original name as the user sees it. */
  name: string;
  mimeType: string;
  /** Extracted text for text-like files; omitted for binary. */
  text?: string;
  size?: number;
};

export type ContentPart = { type: 'text'; text: string } | ImagePart | FilePart;

export type AttachmentPart = ImagePart | FilePart;

export type Role = 'user' | 'assistant';

/** Message shape handed to provider adapters, with attachments already resolved to base64/text. */
export type WireMessage = {
  role: Role;
  text: string;
  images: { base64: string; mimeType: string }[];
  /** Binary non-image attachments; text-like files are merged into `text` before this point. */
  files?: { name: string; mimeType: string; base64: string }[];
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
  /** Streams the model's reasoning/thinking output, when the provider exposes it. */
  onReasoning?: (text: string) => void;
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
