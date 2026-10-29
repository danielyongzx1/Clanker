const ESCAPES: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

/**
 * Parses JSON that may be cut off partway, as tool arguments are while they stream. Returns what
 * is there so far: an unfinished string as far as it got, an unfinished object or array with the
 * members that have started. A key without its value yet is left out. Gives up at the first
 * character that can't be JSON and returns what came before it.
 */
export function parsePartialJson(text: string): unknown {
  let i = 0;
  // Set when a string ran to the end of the text without its closing quote.
  let cut = false;

  const skipSpace = () => {
    while (i < text.length && ' \t\n\r'.includes(text[i])) i++;
  };
  const stop = () => {
    i = text.length;
    return undefined;
  };

  function string() {
    i++;
    let out = '';
    while (i < text.length) {
      const start = i;
      while (i < text.length && text[i] !== '"' && text[i] !== '\\') i++;
      out += text.slice(start, i);
      if (i >= text.length) break;
      if (text[i] === '"') {
        i++;
        return out;
      }
      // An escape cut off partway is dropped until the rest of it arrives.
      const c = text[i + 1];
      if (c === undefined) break;
      if (c === 'u') {
        const hex = text.slice(i + 2, i + 6);
        if (hex.length < 4) break;
        out += String.fromCharCode(parseInt(hex, 16));
        i += 6;
      } else {
        out += ESCAPES[c] ?? c;
        i += 2;
      }
    }
    i = text.length;
    cut = true;
    return out;
  }

  function literal() {
    const start = i;
    while (i < text.length && /[\w.+-]/.test(text[i])) i++;
    const word = text.slice(start, i);
    if (word === 'true') return true;
    if (word === 'false') return false;
    if (word === 'null') return null;
    const n = Number(word);
    if (word && !Number.isNaN(n)) return n;
    // "tru" or "-" at the very end may still become a value; anywhere else it's garbage.
    return stop();
  }

  function array() {
    i++;
    const out: unknown[] = [];
    while (true) {
      skipSpace();
      if (i >= text.length) return out;
      if (text[i] === ']') {
        i++;
        return out;
      }
      if (text[i] === ',') {
        i++;
        continue;
      }
      const v = value();
      if (v !== undefined) out.push(v);
    }
  }

  function object() {
    i++;
    const out: Record<string, unknown> = {};
    while (true) {
      skipSpace();
      if (i >= text.length) return out;
      if (text[i] === '}') {
        i++;
        return out;
      }
      if (text[i] === ',') {
        i++;
        continue;
      }
      if (text[i] !== '"') return (stop(), out);
      const key = string();
      if (cut) return out;
      skipSpace();
      if (text[i] !== ':') return (stop(), out);
      i++;
      const v = value();
      if (v !== undefined) out[key] = v;
    }
  }

  function value(): unknown {
    skipSpace();
    if (i >= text.length) return undefined;
    const c = text[i];
    if (c === '{') return object();
    if (c === '[') return array();
    if (c === '"') return string();
    return literal();
  }

  return value();
}
