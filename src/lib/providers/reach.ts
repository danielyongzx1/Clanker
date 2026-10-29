import { fetch } from 'expo/fetch';
import type { Endpoint } from './types';

/** How long to wait for any of an endpoint's URLs to answer before giving up on probing. */
const PROBE_MS = 4000;
/** How long a probed URL is trusted before probing again, so moving between networks is picked up. */
const FRESH_MS = 30_000;

const chosen = new Map<string, { url: string; at: number }>();

/** The endpoint's base URL followed by its alternatives, trimmed and without duplicates. */
export function baseUrls(endpoint: Pick<Endpoint, 'baseUrl' | 'altBaseUrls'>) {
  return [...new Set([endpoint.baseUrl, ...(endpoint.altBaseUrls ?? [])].map((u) => u.trim()).filter(Boolean))];
}

// Keyed by the URLs too, so unsaved edits in the endpoint editor aren't served a stale pick.
const keyOf = (endpoint: Endpoint) => [endpoint.id, ...baseUrls(endpoint)].join('\n');

export function forgetBaseUrl(endpoint: Endpoint) {
  chosen.delete(keyOf(endpoint));
}

/**
 * Which of the endpoint's URLs to use: whichever answers first, such as a LAN IP at home and a
 * public address elsewhere. Any HTTP response counts, since some servers 404 on the bare base URL.
 * Falls back to the main base URL when none answer, so the real request reports the error.
 */
export async function resolveBaseUrl(endpoint: Endpoint, signal?: AbortSignal): Promise<string> {
  const urls = baseUrls(endpoint);
  if (urls.length < 2) return endpoint.baseUrl;
  const key = keyOf(endpoint);
  const hit = chosen.get(key);
  if (hit && Date.now() - hit.at < FRESH_MS) return hit.url;

  const controllers = urls.map(() => new AbortController());
  const abortAll = () => controllers.forEach((c) => c.abort());
  signal?.addEventListener('abort', abortAll);
  const timer = setTimeout(abortAll, PROBE_MS);
  try {
    const url = await new Promise<string | null>((resolve) => {
      let pending = urls.length;
      urls.forEach((url, i) =>
        fetch(url, { headers: endpoint.headers, signal: controllers[i].signal })
          .then(() => resolve(url))
          .catch(() => --pending || resolve(null))
      );
    });
    if (url) chosen.set(key, { url, at: Date.now() });
    return url ?? urls[0];
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abortAll);
    // Drops the slower probes and the winner's unread body.
    abortAll();
  }
}
