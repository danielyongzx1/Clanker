import { fetch } from 'expo/fetch';

export function joinUrl(base: string, path: string) {
  return base.replace(/\/+$/, '') + '/' + path.replace(/^\/+/, '');
}

export class ProviderError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

async function errorFrom(res: Response): Promise<ProviderError> {
  const body = await res.text().catch(() => '');
  let message = body;
  try {
    const json = JSON.parse(body);
    const err = Array.isArray(json) ? json[0]?.error : json.error;
    message = (typeof err === 'string' ? err : err?.message) ?? json.message ?? body;
  } catch {}
  return new ProviderError(`${res.status} ${res.statusText || 'Error'}${message ? `: ${message}` : ''}`, res.status);
}

export async function request(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: unknown; signal?: AbortSignal }
) {
  const res = await fetch(url, {
    method: init.method ?? (init.body ? 'POST' : 'GET'),
    headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: init.signal,
  });
  if (!res.ok) throw await errorFrom(res as unknown as Response);
  return res;
}

export async function getJson<T = any>(url: string, headers?: Record<string, string>): Promise<T> {
  const res = await request(url, { headers });
  return (await res.json()) as T;
}

/** Yields each complete line of a streamed response body. */
export async function* readLines(res: { body: ReadableStream<Uint8Array> | null }) {
  if (!res.body) throw new ProviderError('Response has no body');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      yield buffer.slice(0, nl).replace(/\r$/, '');
      buffer = buffer.slice(nl + 1);
    }
  }
  buffer += decoder.decode();
  if (buffer) yield buffer;
}

/** Yields the `data:` payloads of a server-sent-events stream. */
export async function* readSSE(res: { body: ReadableStream<Uint8Array> | null }) {
  for await (const line of readLines(res)) {
    if (line.startsWith('data:')) yield line.slice(5).trimStart();
  }
}
