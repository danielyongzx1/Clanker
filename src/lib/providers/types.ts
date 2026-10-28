export type ProviderType = 'openai' | 'anthropic' | 'ollama' | 'gemini';

export type ImagePart = {
  type: 'image';
  /** File name inside the attachments directory (see lib/attachments). */
  file: string;
  mimeType: string;
  width?: number;
  height?: number;
  /** Where the image was copied in the agent workspace, when tools were on. */
  path?: string;
};

/** A non-image attachment. Text-like files carry `text`; binaries are stored and sent base64 where the provider takes them. */
export type FilePart = {
  type: 'file';
  /**
   * File name inside the attachments directory. Omitted for text files, whose content is inlined,
   * unless the inline copy was truncated.
   */
  file?: string;
  /** Original name as the user sees it. */
  name: string;
  /** Where the file was copied in the agent workspace, when tools were on. */
  path?: string;
  mimeType: string;
  /** Extracted text for text-like files; omitted for binary. */
  text?: string;
  size?: number;
};

/** A web page a tool found or read, shown with the reply as a source. */
export type Source = {
  url: string;
  title?: string;
  /** A short excerpt, for the sources list. */
  snippet?: string;
  date?: string;
};

/** A tool call the model made inside an assistant reply, with its result once it ran. */
export type ToolPart = {
  type: 'tool';
  id: string;
  name: string;
  input: Record<string, unknown>;
  status: 'running' | 'done' | 'error';
  /** What the model sees as the result. */
  output?: string;
  /** Images returned to the model (e.g. read_file on a photo), stored in the attachments dir. */
  images?: ImagePart[];
  /** Workspace files the call created or changed, shown as chips the user can open. */
  files?: string[];
  /** Web pages the call searched up or read. */
  sources?: Source[];
  durationMs?: number;
  /**
   * Set when the call started a background job. Shown in the UI only: the model saw the
   * "started" output and collects the result with job_output.
   */
  background?: {
    job: string;
    status: 'running' | 'done' | 'error' | 'killed' | 'lost';
    output?: string;
  };
  /** Identifies the model response that made this call; calls from one response replay together. */
  step?: string;
  /** Gemini's thought signature for this call; must be sent back with it. */
  signature?: string;
  /**
   * Anthropic thinking blocks from the step that made this call, set on the step's first call.
   * With thinking on, the API rejects a tool_use turn replayed without them.
   */
  thinking?: unknown[];
};

/** Streamed thinking/reasoning from one stretch of a model response. Shown only, never sent back. */
export type ThoughtPart = {
  type: 'thought';
  text: string;
  /** How long this stretch of thinking took, in ms; set once the model moves on. */
  ms?: number;
};

export type TextPart = {
  type: 'text';
  text: string;
  /** When a reply's text part started streaming, in ms since the epoch. */
  at?: number;
};

export type ContentPart = TextPart | ImagePart | FilePart | ToolPart | ThoughtPart;

export type AttachmentPart = ImagePart | FilePart;

export type Role = 'user' | 'assistant';

export type WireImage = { base64: string; mimeType: string };

export type ToolCall = {
  id: string;
  name: string;
  input: Record<string, unknown>;
  signature?: string;
};

export type WireToolResult = {
  callId: string;
  name: string;
  output: string;
  isError?: boolean;
  images?: WireImage[];
};

/**
 * Message shape handed to provider adapters, with attachments already resolved to base64/text.
 * An assistant turn may end in `toolCalls`; the `tool` turn after it carries their `results`.
 */
export type WireMessage = {
  role: Role | 'tool';
  text: string;
  images: WireImage[];
  /** Binary non-image attachments; text-like files are merged into `text` before this point. */
  files?: { name: string; mimeType: string; base64: string }[];
  toolCalls?: ToolCall[];
  /** Anthropic thinking blocks that preceded `toolCalls`. */
  thinking?: unknown[];
  results?: WireToolResult[];
};

/** A tool offered to the model; `parameters` is a JSON Schema object. */
export type ToolSpec = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type StreamResult = {
  toolCalls: ToolCall[];
  /** Anthropic thinking blocks (with signatures) from this response, to replay with its tool calls. */
  thinking?: unknown[];
};

export interface Endpoint {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl: string;
  models: string[];
  /** Reasoning effort levels each model accepts, lowest first. Models missing here have no effort control. */
  efforts?: Record<string, string[]>;
  /** Context window in tokens per model, where the API reports it. */
  contexts?: Record<string, number>;
  /** History budget in tokens per model, set by the user; overrides the one derived from `contexts`. */
  budgets?: Record<string, number>;
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
  /** Tools the model may call; when it does, the calls come back in the StreamResult. */
  tools?: ToolSpec[];
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

export type ModelInfo = { id: string; efforts?: string[]; contextLength?: number };

export type ModelList = { models: ModelInfo[]; effortParam?: EffortParam };

export interface ProviderAdapter {
  listModels(endpoint: Endpoint, apiKey?: string): Promise<ModelList>;
  stream(opts: StreamOptions): Promise<StreamResult>;
}
