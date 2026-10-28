import { fetch } from 'expo/fetch';
import { useSettings, type SearchConfig, type SearchProvider } from '@/store/settings';
import { joinUrl, ProviderError, request } from '../providers/http';
import { apiKeys } from '../storage';
import { formatSize } from '../workspace';
import { decodeEntities } from './documents';

export const SEARCH_PROVIDERS: Record<SearchProvider, { label: string; needsKey: boolean; hint: string }> = {
  duckduckgo: {
    label: 'DuckDuckGo',
    needsKey: false,
    hint: 'No key needed. DuckDuckGo may turn away searches made in quick succession; set up another provider if that happens often.',
  },
  brave: { label: 'Brave', needsKey: true, hint: 'Get a key at api-dashboard.search.brave.com. The free plan covers light use.' },
  tavily: { label: 'Tavily', needsKey: true, hint: 'Get a key at app.tavily.com. Tavily is built for agents, with longer snippets.' },
  searxng: {
    label: 'SearXNG',
    needsKey: false,
    hint: 'Your own SearXNG instance. Enable the json format under search.formats in its settings.yml.',
  },
};

export const searchKeyId = (provider: SearchProvider) => `search-${provider}`;

export type SearchResult = { title: string; url: string; snippet: string; date?: string };

// Many sites, DuckDuckGo's HTML endpoint included, turn away clients that don't look like a browser.
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

const plain = (html: string) => decodeEntities(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

/** `signal`, also aborted after `ms`. */
export function withTimeout(signal: AbortSignal, ms: number) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, ms);
  signal.addEventListener('abort', abort);
  return {
    signal: controller.signal,
    timedOut: () => controller.signal.aborted && !signal.aborted,
    done: () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    },
  };
}

// ---- search --------------------------------------------------------------------------------

/** DuckDuckGo result links go through a redirect that carries the target in `uddg`; ads go through y.js. */
function duckLink(href: string) {
  if (/\/y\.js\?/.test(href)) return null;
  const target = href.match(/[?&]uddg=([^&]+)/)?.[1];
  if (target) return decodeURIComponent(target);
  return href.startsWith('//') ? `https:${href}` : /^https?:/.test(href) ? href : null;
}

async function duckduckgo(query: string, count: number, signal: AbortSignal): Promise<SearchResult[]> {
  const res = await request(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html' },
    signal,
  });
  const html = await res.text();
  const results: SearchResult[] = [];
  for (const chunk of html.split('class="result__title"').slice(1)) {
    const a = chunk.match(/<a\b[^>]*class="result__a"[^>]*>([\s\S]*?)<\/a>/);
    const url = a && duckLink(decodeEntities(a[0].match(/href="([^"]*)"/)?.[1] ?? ''));
    if (!a || !url) continue;
    const snippet = chunk.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div)>/)?.[1] ?? '';
    results.push({ title: plain(a[1]), url, snippet: plain(snippet) });
    if (results.length >= count) break;
  }
  if (!results.length && /anomaly/i.test(html)) {
    throw new Error(
      'DuckDuckGo turned the search away as automated. Try again in a minute, or set up Brave, Tavily or SearXNG in Settings → Web search.'
    );
  }
  return results;
}

async function brave(query: string, count: number, key: string, signal: AbortSignal): Promise<SearchResult[]> {
  const res = await request(
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`,
    { headers: { Accept: 'application/json', 'X-Subscription-Token': key }, signal }
  );
  const json: any = await res.json();
  return (json.web?.results ?? []).map((r: any) => ({
    title: plain(r.title ?? ''),
    url: r.url,
    snippet: plain(r.description ?? ''),
    date: r.age,
  }));
}

async function tavily(query: string, count: number, key: string, signal: AbortSignal): Promise<SearchResult[]> {
  const res = await request('https://api.tavily.com/search', {
    headers: { Authorization: `Bearer ${key}` },
    body: { query, max_results: count },
    signal,
  });
  const json: any = await res.json();
  return (json.results ?? []).map((r: any) => ({
    title: r.title ?? r.url,
    url: r.url,
    snippet: String(r.content ?? '').replace(/\s+/g, ' ').trim(),
    date: r.published_date,
  }));
}

async function searxng(query: string, count: number, base: string | undefined, signal: AbortSignal): Promise<SearchResult[]> {
  if (!base?.trim()) throw new Error('No SearXNG URL is set. Add one in Settings → Web search.');
  let res;
  try {
    res = await request(joinUrl(base.trim(), `search?q=${encodeURIComponent(query)}&format=json`), {
      headers: { Accept: 'application/json' },
      signal,
    });
  } catch (e) {
    if (e instanceof ProviderError && e.status === 403) {
      throw new Error(`${e.message}\nThe instance doesn't allow JSON results: add json to search.formats in its settings.yml.`);
    }
    throw e;
  }
  const json: any = await res.json();
  return (json.results ?? []).slice(0, count).map((r: any) => ({
    title: r.title ?? r.url,
    url: r.url,
    snippet: String(r.content ?? '').replace(/\s+/g, ' ').trim(),
    date: r.publishedDate ?? undefined,
  }));
}

/** Runs `query` through the configured search provider. */
export async function searchWeb(
  query: string,
  count: number,
  signal: AbortSignal,
  config: SearchConfig = useSettings.getState().search
): Promise<SearchResult[]> {
  const { label, needsKey } = SEARCH_PROVIDERS[config.provider];
  const key = needsKey ? await apiKeys.get(searchKeyId(config.provider)) : null;
  if (needsKey && !key) throw new Error(`No ${label} API key is set. Add one in Settings → Web search.`);
  const t = withTimeout(signal, 30_000);
  try {
    switch (config.provider) {
      case 'brave':
        return await brave(query, count, key!, t.signal);
      case 'tavily':
        return await tavily(query, count, key!, t.signal);
      case 'searxng':
        return await searxng(query, count, config.url, t.signal);
      default:
        return await duckduckgo(query, count, t.signal);
    }
  } catch (e) {
    if (t.timedOut()) throw new Error(`${label} didn't answer within 30 seconds.`);
    throw e;
  } finally {
    t.done();
  }
}

// ---- fetching ------------------------------------------------------------------------------

export type Download = {
  /** Final URL, after redirects. */
  url: string;
  ok: boolean;
  status: number;
  /** Media type without parameters, lowercased; empty when the server sent none. */
  type: string;
  bytes: Uint8Array;
  /** A file name for the response, from Content-Disposition or the URL. */
  filename: string;
};

const EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'application/json': 'json',
  'text/csv': 'csv',
  'text/plain': 'txt',
  'text/html': 'html',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

function filenameOf(url: string, disposition: string | null, type: string) {
  const fromHeader = disposition?.match(/filename\*=(?:UTF-8'')?([^;]+)|filename="?([^";]+)"?/i);
  let name = fromHeader ? decodeURIComponent((fromHeader[1] ?? fromHeader[2]).trim()) : '';
  if (!name) {
    const last = url.replace(/[?#].*$/, '').split('/').pop() ?? '';
    try {
      name = decodeURIComponent(last);
    } catch {
      name = last;
    }
  }
  name = name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'download';
  const ext = EXTENSIONS[type];
  return ext && !/\.[a-z0-9]{1,5}$/i.test(name) ? `${name}.${ext}` : name;
}

/** Fetches `url` whole, refusing bodies over `maxBytes`. */
export async function download(url: string, signal: AbortSignal, maxBytes: number, timeoutMs: number): Promise<Download> {
  const t = withTimeout(signal, timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.8',
      },
      signal: t.signal,
    });
    const length = Number(res.headers.get('content-length'));
    if (length > maxBytes) throw new Error(`The response is ${formatSize(length)}, over the ${formatSize(maxBytes)} limit.`);
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = res.body?.getReader();
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) {
        reader.cancel().catch(() => {});
        throw new Error(`The response is over the ${formatSize(maxBytes)} limit.`);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
      bytes.set(c, at);
      at += c.length;
    }
    const finalUrl = res.url || url;
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    return {
      url: finalUrl,
      ok: res.ok,
      status: res.status,
      type,
      bytes,
      filename: filenameOf(finalUrl, res.headers.get('content-disposition'), type),
    };
  } catch (e) {
    if (t.timedOut()) throw new Error(`No complete response within ${timeoutMs / 1000} seconds.`);
    throw e;
  } finally {
    t.done();
  }
}

// ---- HTML → markdown -----------------------------------------------------------------------

// Elements whose content is never readable text.
const DROP = /<(script|style|noscript|svg|template|iframe|object|canvas|select|button|textarea|head)(?=[\s>])[\s\S]*?<\/\1\s*>/gi;
// Site navigation around the content.
const PAGE_CHROME = /<(nav|header|footer|aside|dialog)(?=[\s>])[\s\S]*?<\/\1\s*>/gi;
const BLOCK =
  /<\/?(p|div|section|article|main|header|footer|blockquote|ul|ol|dl|dd|dt|table|thead|tbody|tr|figure|figcaption|form|fieldset|details|summary|address|center)\b[^>]*>/gi;

const attr = (tag: string, name: string) =>
  decodeEntities(tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))?.slice(1).find((v) => v != null) ?? '');

function resolveUrl(href: string, base: string) {
  if (/^[a-z][a-z\d+.-]*:/i.test(href)) return href;
  const origin = base.match(/^[a-z][a-z\d+.-]*:\/\/[^/?#]*/i)?.[0] ?? '';
  if (href.startsWith('//')) return `${base.match(/^[a-z][a-z\d+.-]*:/i)?.[0] ?? 'https:'}${href}`;
  if (href.startsWith('/')) return origin + href;
  const path = base.slice(origin.length).replace(/#.*$/, '');
  if (href.startsWith('#')) return origin + path + href;
  if (href.startsWith('?')) return origin + path.replace(/\?.*$/, '') + href;
  const dir = path.replace(/\?.*$/, '');
  return origin + (dir.slice(0, dir.lastIndexOf('/') + 1) || '/') + href;
}

const textLength = (html: string) => html.replace(/<[^>]+>/g, '').replace(/\s+/g, '').length;

/** The page's main content: <main> or <article> when they hold most of the text, else the body without navigation. */
function mainContent(html: string) {
  const body = html.match(/<body\b[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html;
  const main = body.match(/<main\b[^>]*>([\s\S]*)<\/main>/i)?.[1] ?? body.match(/<article\b[^>]*>([\s\S]*)<\/article>/i)?.[1];
  // Headers inside an article usually carry its title, so only menus are dropped there.
  if (main && textLength(main) > 500) return main.replace(/<(nav|aside)(?=[\s>])[\s\S]*?<\/\1\s*>/gi, '');
  return body.replace(PAGE_CHROME, '');
}

/** Converts an HTML page to compact markdown, keeping headings, links, lists, tables and code. */
export function htmlToMarkdown(html: string, url: string) {
  const title = plain(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '');
  let s = mainContent(html.replace(/\u0000/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(DROP, ''));

  // Preformatted text keeps its whitespace, so it is set aside before whitespace is collapsed.
  const kept: string[] = [];
  s = s.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_, code: string) => {
    const text = decodeEntities(code.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/^\n+|\s+$/g, '');
    return `\u0000${kept.push(`\n\n\`\`\`\n${text}\n\`\`\`\n\n`) - 1}\u0000`;
  });

  s = s
    .replace(/\s+/g, ' ')
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi, (_, n: string, t: string) => {
      const text = t.replace(/<[^>]+>/g, '').trim();
      return text ? `\n\n${'#'.repeat(Number(n))} ${text}\n\n` : '';
    })
    .replace(/<img\b[^>]*>/gi, (tag) => {
      const alt = attr(tag, 'alt').trim();
      const src = attr(tag, 'src');
      return alt && src && !src.startsWith('data:') ? `![${alt}](${resolveUrl(src, url)})` : '';
    })
    .replace(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi, (_, attrs: string, inner: string) => {
      const text = inner.replace(/<[^>]+>/g, '').trim();
      const href = attr(attrs, 'href');
      if (!text) return '';
      return !href || /^(javascript:|#)/i.test(href) ? text : `[${text}](${resolveUrl(href, url)})`;
    })
    .replace(/<\/code\s*>\s*<code\b[^>]*>/gi, '')
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code\s*>/gi, (_, c: string) => {
      const code = c.replace(/<[^>]+>/g, '').trim();
      return code ? `\`${code}\`` : '';
    })
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/t[dh]\s*>/gi, ' | ')
    .replace(/<hr\b[^>]*>/gi, '\n\n---\n\n')
    .replace(BLOCK, '\n')
    .replace(/<[^>]+>/g, '');

  const text = decodeEntities(s)
    .split('\n')
    .map((line) => line.trim().replace(/\s*\|$/, ''))
    .join('\n')
    // A list item whose content sits in a block element: pull the content up to its bullet, and drop empty items.
    .replace(/^-\n+(?=[^\n-])/gm, '- ')
    .replace(/^-\n/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\u0000(\d+)\u0000/g, (_, i: string) => kept[Number(i)])
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { title, text };
}
