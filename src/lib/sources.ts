import type { ContentPart, Source, ToolPart } from './providers';

export type SourceEntry = Source & {
  host: string;
  /** The agent opened the page with web_fetch, rather than only seeing it in search results. */
  read: boolean;
  /** The reply's text links to the page. */
  cited: boolean;
};

export type Site = { host: string; url: string };

export const hostOf = (url: string) =>
  url.match(/^[a-z][a-z\d+.-]*:\/\/(?:[^@/?#]*@)?([^/?#:]+)/i)?.[1]?.toLowerCase() ?? '';

/** A site's short name for lists: "www.nvidia.com" → "nvidia", "bbc.co.uk" → "bbc". */
export function siteName(host: string) {
  const parts = host.replace(/^www\d?\./, '').split('.');
  if (parts.length < 2) return host;
  const secondLevel = parts.length > 2 && parts[parts.length - 1].length === 2 && parts[parts.length - 2].length <= 3;
  return parts.slice(0, secondLevel ? -2 : -1).join('.');
}

export const faviconUrl = (host: string) => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;

const urlKey = (url: string) => url.replace(/^https?:\/\/(www\.)?/i, '').replace(/[#].*$/, '').replace(/\/+$/, '');

/** Sources from replies saved before tools recorded them, read back from the tool output. */
function legacySources(part: ToolPart): Source[] {
  const output = part.output ?? '';
  if (part.name === 'web_fetch') {
    const url = output.match(/^URL: (\S+)/m)?.[1];
    return url && part.status === 'done' ? [{ url, title: output.match(/^# (.+)/)?.[1] }] : [];
  }
  return [...output.matchAll(/^\d+\. (.+)\n {3}(https?:\/\/\S+)/gm)].map((m) => ({ title: m[1], url: m[2] }));
}

function sourcesOfPart(part: ToolPart) {
  if (part.name !== 'web_search' && part.name !== 'web_fetch') return [];
  return part.sources ?? legacySources(part);
}

/**
 * Every web page the tools in `content` found or read, once each: pages the text links to first,
 * then pages the agent read, then the other search results, each group in the order they came up.
 */
export function sourcesOf(content: ContentPart[]): SourceEntry[] {
  const text = content.map((p) => (p.type === 'text' ? p.text : '')).join('');
  const linked = new Set([...text.matchAll(/https?:\/\/[^\s)\]>"']+/g)].map((m) => urlKey(m[0])));
  const byUrl = new Map<string, SourceEntry>();
  for (const part of content) {
    if (part.type !== 'tool') continue;
    for (const source of sourcesOfPart(part)) {
      const key = urlKey(source.url);
      const host = hostOf(source.url);
      if (!host) continue;
      const read = part.name === 'web_fetch';
      const known = byUrl.get(key);
      if (known) {
        // A page both found and read keeps the search result's snippet and date.
        known.read ||= read;
        known.title ||= source.title;
      } else byUrl.set(key, { ...source, host, read, cited: linked.has(key) });
    }
  }
  const all = [...byUrl.values()];
  const rank = (s: SourceEntry) => (s.cited ? 0 : s.read ? 1 : 2);
  return all.map((s, i) => [s, i] as const).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([s]) => s);
}

/** The distinct sites behind `content`'s searches and fetches, in the order they came up. */
export function sitesOf(content: ContentPart[]): { sites: Site[]; searched: boolean } {
  const sites = new Map<string, Site>();
  let searched = false;
  for (const part of content) {
    if (part.type !== 'tool') continue;
    searched ||= part.name === 'web_search';
    for (const source of sourcesOfPart(part)) {
      const host = hostOf(source.url);
      if (host && !sites.has(host)) sites.set(host, { host, url: source.url });
    }
  }
  return { sites: [...sites.values()], searched };
}
