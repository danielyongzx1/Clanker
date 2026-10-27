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
  /** Extra HTTP headers sent with every request, e.g. OpenRouter's HTTP-Referer. */
  headers?: Record<string, string>;
}

export interface StreamOptions {
  endpoint: Endpoint;
  apiKey?: string;
  model: string;
  messages: WireMessage[];
  system?: string;
  signal: AbortSignal;
  onToken: (text: string) => void;
}

export interface ProviderAdapter {
  listModels(endpoint: Endpoint, apiKey?: string): Promise<string[]>;
  stream(opts: StreamOptions): Promise<void>;
}
