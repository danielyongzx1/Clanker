import type { BridgeInfo, RemoteBackend } from './types';

type Connection = { url: string; info: BridgeInfo };
type Fetch = (url: string, init: RequestInit) => Promise<Response>;
const known = new Map<string, { token: string; at: number; connection: Connection }>();

export function bridgeAddresses(backend: Pick<RemoteBackend, 'baseUrl' | 'altBaseUrls'>) {
  return [...new Set([backend.baseUrl, ...(backend.altBaseUrls ?? [])].map((value) => value.trim().replace(/\/+$/, '')).filter(Boolean))].map((value) => {
    const parsed = new URL(value);
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new Error('Use HTTP(S) bridge addresses without credentials or query parameters.');
    }
    return value;
  });
}

const key = (backend: RemoteBackend) => JSON.stringify([backend.id, backend.bridgeId, ...bridgeAddresses(backend)]);
export const forgetBridgeAddress = (backend: RemoteBackend) => known.delete(key(backend));

/** Only a successfully authenticated capability response from the saved bridge can win. */
export async function resolveBridgeAddress(backend: RemoteBackend, token: string, fetch: Fetch, force = false): Promise<Connection> {
  const cacheKey = key(backend);
  const cached = known.get(cacheKey);
  if (!force && cached?.token === token && Date.now() - cached.at < 30000) return cached.connection;
  const addresses = bridgeAddresses(backend);
  if (!addresses.length) throw new Error('Add a bridge address in Settings → Backends.');
  const controllers = addresses.map(() => new AbortController());
  try {
    const connection = await Promise.any(addresses.map(async (url, index): Promise<Connection> => {
      const controller = controllers[index];
      const timeout = setTimeout(() => controller.abort(), 6000);
      try {
        const response = await fetch(`${url}/v1/capabilities`, { headers: { Authorization: `Bearer ${token}`, 'X-Clanker-Bridge': backend.bridgeId }, signal: controller.signal });
        if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
        const info = await response.json() as BridgeInfo;
        if (info.protocol !== 1 || !info.bridgeId || !['hermes', 'harness'].includes(info.kind) || !Array.isArray(info.models)) throw new Error(`${url}: unsupported bridge protocol`);
        if (backend.bridgeId && info.bridgeId !== backend.bridgeId) throw new Error(`${url}: belongs to a different bridge`);
        return { url, info };
      } finally { clearTimeout(timeout); }
    }));
    known.set(cacheKey, { token, at: Date.now(), connection });
    return connection;
  } catch (error) {
    known.delete(cacheKey);
    const failures = error instanceof AggregateError ? error.errors.map((item: unknown) => item instanceof Error ? item.message : String(item)).join('; ') : String(error);
    throw new Error(`Cannot reach this bridge at its configured addresses. ${failures}`);
  } finally { controllers.forEach((controller) => controller.abort()); }
}
