/** A bridge's pairing code: everything the backend form needs, from the host's pairing page. */
export type Pairing = { bridgeId: string; token: string; name: string; urls: string[] };

type Params = Record<string, string | string[] | undefined>;

function bridgeUrl(value: string) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

/** From the clanker://pair link's parameters, as the bridge writes them: bridge, token, name, and url once per address. */
export function pairingFromParams(params: Params): Pairing | null {
  const all = (key: string) => [params[key] ?? []].flat();
  const bridgeId = all('bridge')[0]?.trim();
  const token = all('token')[0]?.trim();
  const urls = all('url').map((u) => u.trim().replace(/\/+$/, '')).filter(bridgeUrl);
  // The bridge refuses tokens shorter than this.
  if (!bridgeId || !token || token.length < 24 || !urls.length) return null;
  return { bridgeId, token, name: (all('name')[0] ?? '').trim().slice(0, 80), urls: [...new Set(urls)] };
}

/** Reads a scanned code. Anything other than a clanker://pair link is null. */
export function parsePairingLink(text: string): Pairing | null {
  const match = /^clanker:\/\/pair\/?\?(.*)$/i.exec(text.trim());
  if (!match) return null;
  const params: Record<string, string[]> = {};
  try {
    for (const part of match[1].split('&')) {
      const eq = part.indexOf('=');
      if (eq < 1) continue;
      const decode = (s: string) => decodeURIComponent(s.replace(/\+/g, ' '));
      (params[decode(part.slice(0, eq))] ??= []).push(decode(part.slice(eq + 1)));
    }
  } catch {
    return null;
  }
  return pairingFromParams(params);
}
