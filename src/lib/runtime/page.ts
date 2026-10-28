/**
 * The page inside the hidden runtime WebView. Python (Pyodide) and JavaScript each run in their
 * own Web Worker so a runaway script can be killed by terminating the worker. Each worker keeps a
 * copy of the workspace: the app sends files that changed since the last run, and the worker
 * reports back the files the script created, changed or deleted.
 */

export const PYODIDE_URL = 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/';

// Import names whose PyPI distribution is called something else.
const PY_ALIASES: Record<string, string> = {
  docx: 'python-docx',
  pptx: 'python-pptx',
  fitz: 'pymupdf',
  fpdf: 'fpdf2',
  bs4: 'beautifulsoup4',
  yaml: 'pyyaml',
  PIL: 'pillow',
  cv2: 'opencv-python',
  sklearn: 'scikit-learn',
  odf: 'odfpy',
  pdfminer: 'pdfminer.six',
  dateutil: 'python-dateutil',
  Crypto: 'pycryptodome',
  magic: 'python-magic',
};

const SHARED = String.raw`
function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fmt(v) {
  if (typeof v === 'string') return v;
  if (v instanceof Error) return v.stack || String(v);
  try { return JSON.stringify(v, null, 2) ?? String(v); } catch { return String(v); }
}
`;

const PYTHON_WORKER = String.raw`
${SHARED}
const INDEX = ${JSON.stringify(PYODIDE_URL)};
const ALIASES = ${JSON.stringify(PY_ALIASES)};
let py, ready, loadError;
try {
  importScripts(INDEX + 'pyodide.js');
} catch (x) {
  loadError = x;
}

async function init() {
  if (loadError) {
    throw new Error('Could not download the Python runtime from ' + INDEX + ' (the first run needs an internet connection; it is cached after that): ' + (loadError.message || loadError));
  }
  py = await loadPyodide({ indexURL: INDEX });
  // ssl ships unvendored, but urllib.request needs it and many packages import that at load time.
  await py.loadPackage(['micropip', 'ssl'], { messageCallback: () => {} });
  py.FS.mkdirTree('/workspace');
  py.globals.set('_aliases', py.toPy(ALIASES));
  await py.runPythonAsync(${'`'}
import os, sys, importlib.util, micropip
from pyodide.code import find_imports
sys.dont_write_bytecode = True
os.chdir('/workspace')
os.environ['HOME'] = '/workspace'
os.environ['MPLBACKEND'] = 'Agg'

async def _install(code, extra):
    names = list(extra)
    try:
        mods = find_imports(code)
    except Exception:
        mods = []
    for mod in mods:
        top = mod.split('.')[0]
        if importlib.util.find_spec(top) is None:
            names.append(_aliases.get(top, top))
    failed = []
    for name in dict.fromkeys(names):
        try:
            await micropip.install(name)
        except Exception as e:
            failed.append(f"{name}: {e}")
    return failed
${'`'});
}

function walk(dir, prefix, out) {
  for (const name of py.FS.readdir(dir)) {
    if (name === '.' || name === '..') continue;
    const full = dir + '/' + name;
    const rel = prefix ? prefix + '/' + name : name;
    const st = py.FS.stat(full);
    if (py.FS.isDir(st.mode)) walk(full, rel, out);
    else out[rel] = +st.mtime + ':' + st.size;
  }
  return out;
}

function applyFiles(files, deleted) {
  for (const rel of deleted) {
    try { py.FS.unlink('/workspace/' + rel); } catch {}
  }
  for (const rel in files) {
    const full = '/workspace/' + rel;
    py.FS.mkdirTree(full.slice(0, full.lastIndexOf('/')));
    py.FS.writeFile(full, b64ToBytes(files[rel]));
  }
}

onmessage = async (e) => {
  const m = e.data;
  const out = [];
  const err = [];
  let value, error, before;
  try {
    ready ??= init().catch((x) => {
      ready = undefined;
      throw x;
    });
    await ready;
    applyFiles(m.files, m.deleted);
    before = walk('/workspace', '', {});
    // Installer progress isn't the script's output; only failures are worth reporting.
    py.setStdout({ batched: () => {} });
    py.setStderr({ batched: () => {} });
    py.runPython('import os; os.chdir("/workspace")');
    await py.loadPackagesFromImports(m.code, { messageCallback: () => {}, errorCallback: (s) => err.push(s) });
    const failed = (await py.globals.get('_install')(m.code, py.toPy(m.packages || []))).toJs();
    for (const f of failed) err.push('[could not install ' + f + ']');
    py.setStdout({ batched: (s) => out.push(s) });
    py.setStderr({ batched: (s) => err.push(s) });
    const globals = py.globals.get('dict')();
    globals.set('__name__', '__main__');
    const result = await py.runPythonAsync(m.code, { globals });
    if (result !== undefined) {
      value = String(result);
      if (result && typeof result.destroy === 'function') result.destroy();
    }
    globals.destroy();
  } catch (x) {
    // Drop Pyodide's own frames so the traceback starts at the script.
    error = (x && x.message ? String(x.message) : String(x))
      .replace(/  File "\/lib\/python[^"]*\/_pyodide\/[^\n]*\n(    [^\n]*\n)*/g, '')
      .replace(/"<exec>"/g, '"<script>"');
  }
  const files = {};
  const deleted = [];
  if (before) {
    try {
      const after = walk('/workspace', '', {});
      for (const rel in after) {
        if (after[rel] !== before[rel]) files[rel] = bytesToB64(py.FS.readFile('/workspace/' + rel));
      }
      for (const rel in before) if (!(rel in after)) deleted.push(rel);
    } catch (x) {
      err.push('[could not collect changed files: ' + x + ']');
    }
  }
  // A failed download can't be retried inside this worker, so ask for a fresh one.
  postMessage({ type: 'result', id: m.id, stdout: out.join('\n'), stderr: err.join('\n'), value, error, files, deleted, fatal: !!loadError });
};
`;

const JS_WORKER = String.raw`
${SHARED}
const store = new Map();
let dirty = new Set();
let removed = new Set();
const enc = new TextEncoder();
const dec = new TextDecoder();
const norm = (p) => String(p ?? '').replace(/\\/g, '/').replace(/^\/?workspace(\/|$)/, '').split('/').filter((s) => s && s !== '.').join('/');
function toBytes(data) {
  if (typeof data === 'string') return enc.encode(data);
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  throw new TypeError('fs.write expects a string, Uint8Array or ArrayBuffer (for a Blob, await blob.arrayBuffer() first)');
}
const fs = {
  list(dir = '') {
    const d = norm(dir);
    return [...store.keys()].filter((k) => !d || k === d || k.startsWith(d + '/')).sort();
  },
  exists: (p) => store.has(norm(p)),
  readBytes(p) {
    const k = norm(p);
    if (!store.has(k)) throw new Error('No such file: ' + k);
    return store.get(k);
  },
  readText: (p) => dec.decode(fs.readBytes(p)),
  readJSON: (p) => JSON.parse(fs.readText(p)),
  write(p, data) {
    const k = norm(p);
    if (!k) throw new Error('fs.write needs a file path');
    store.set(k, toBytes(data));
    dirty.add(k);
    removed.delete(k);
  },
  writeText: (p, s) => fs.write(p, String(s)),
  writeBytes: (p, b) => fs.write(p, b),
  writeJSON: (p, v) => fs.write(p, JSON.stringify(v, null, 2)),
  remove(p) {
    for (const k of fs.list(p)) {
      store.delete(k);
      dirty.delete(k);
      removed.add(k);
    }
  },
};
const AsyncFunction = (async () => {}).constructor;

onmessage = async (e) => {
  const m = e.data;
  for (const rel of m.deleted) store.delete(rel);
  for (const rel in m.files) store.set(rel, b64ToBytes(m.files[rel]));
  dirty = new Set();
  removed = new Set();
  const out = [];
  const line = (prefix) => (...a) => out.push(prefix + a.map(fmt).join(' '));
  const con = { log: line(''), info: line(''), debug: line(''), warn: line('[warn] '), error: line('[error] '), table: line('') };
  let value, error;
  try {
    const fn = new AsyncFunction('fs', 'console', 'print', m.code);
    const result = await fn(fs, con, con.log);
    if (result !== undefined) value = fmt(result);
  } catch (x) {
    error = x && x.stack ? String(x.stack) : String(x);
  }
  const files = {};
  for (const k of dirty) files[k] = bytesToB64(store.get(k));
  postMessage({ type: 'result', id: m.id, stdout: out.join('\n'), stderr: '', value, error, files, deleted: [...removed] });
};
`;

export const RUNTIME_HTML = `<!doctype html>
<html><head><meta charset="utf-8"></head><body><script>
(function () {
  const send = (m) => window.ReactNativeWebView.postMessage(JSON.stringify(m));
  const SOURCES = { python: ${JSON.stringify(PYTHON_WORKER)}, javascript: ${JSON.stringify(JS_WORKER)} };
  // Keyed by name: one worker per language for ordinary runs, plus one per background job.
  const workers = {};
  function worker(key, lang) {
    if (workers[key]) return workers[key];
    const url = URL.createObjectURL(new Blob([SOURCES[lang]], { type: 'text/javascript' }));
    const w = new Worker(url, lang === 'javascript' ? { type: 'module' } : undefined);
    w.onmessage = (e) => send(e.data);
    w.onerror = (e) => {
      e.preventDefault && e.preventDefault();
      send({ type: 'crash', worker: key, error: e.message || 'The ' + lang + ' worker crashed' });
      w.terminate();
      delete workers[key];
    };
    return (workers[key] = w);
  }
  window.__clanker = {
    run(m) { worker(m.worker, m.lang).postMessage(m); },
    kill(key) { if (workers[key]) { workers[key].terminate(); delete workers[key]; } },
  };
  send({ type: 'ready' });
})();
</script></body></html>`;
