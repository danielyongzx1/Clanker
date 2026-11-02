import type { Workspace } from './workspace';

// A run of characters that can be in a file name in prose, ending in an extension. Spaces end it,
// so names with spaces are only found in code spans and links, where the whole text is the name.
const NAME = String.raw`[^\s/\\()[\]{}<>"'\x60*,;:!?|]`;
const MENTION = new RegExp(String.raw`(?:${NAME}+/)*${NAME}*\.[A-Za-z0-9]{1,10}`, 'g');
const LOOKS_LIKE_FILE = /\.[A-Za-z0-9]{1,10}$/;

/**
 * Finds the workspace files a reply names, by path or by bare file name, so they can be tapped
 * open. Lookups are cached for the life of the object, which spans one rendering of a reply.
 */
export class FileMentions {
  private found = new Map<string, string | null>();
  private byName: Map<string, string> | null = null;

  constructor(readonly ws: Workspace) {}

  /** The workspace path `text` names, or null. */
  resolve(text: string): string | null {
    let name = text.trim();
    try {
      name = decodeURI(name);
    } catch {
      // Not percent-encoded after all.
    }
    // Web links and other schemes aren't workspace files; file:// paths may be.
    if (!LOOKS_LIKE_FILE.test(name) || name.length > 300 || (/^[a-z][\w+.-]*:/i.test(name) && !name.startsWith('file:'))) return null;
    const hit = this.found.get(name);
    if (hit !== undefined) return hit;
    let path: string | null = null;
    try {
      const rel = this.ws.normalizePath(name);
      if (rel && this.ws.fileAt(rel).exists) path = rel;
      else if (!rel.includes('/')) path = this.names().get(rel.toLowerCase()) ?? null;
    } catch {
      // Paths outside the workspace and unreadable folders just aren't links.
    }
    this.found.set(name, path);
    return path;
  }

  /** Splits prose into text and the file mentions in it. */
  split(text: string): (string | { text: string; path: string })[] {
    const out: (string | { text: string; path: string })[] = [];
    let last = 0;
    for (const m of text.matchAll(MENTION)) {
      const start = m.index ?? 0;
      // Part of a URL or a longer path that didn't resolve.
      if (start > 0 && /[/:\w]/.test(text[start - 1])) continue;
      const path = this.resolve(m[0]);
      if (!path) continue;
      if (start > last) out.push(text.slice(last, start));
      out.push({ text: m[0], path });
      last = start + m[0].length;
    }
    if (!out.length) return [text];
    if (last < text.length) out.push(text.slice(last));
    return out;
  }

  // The model often names a file without its folder; the newest file of that name wins.
  private names() {
    if (!this.byName) {
      this.byName = new Map();
      const files = this.ws.walk('', 5000).sort((a, b) => a.modified - b.modified);
      for (const f of files) this.byName.set(f.path.split('/').pop()!.toLowerCase(), f.path);
    }
    return this.byName;
  }
}
