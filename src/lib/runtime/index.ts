import { uid } from '../storage';
import type { Workspace } from '../workspace';

export type ScriptLanguage = 'python' | 'javascript';

export type ScriptResult = {
  stdout: string;
  stderr: string;
  /** Value of the last Python expression, or what the JavaScript returned. */
  value?: string;
  error?: string;
  /** Workspace paths the script created or changed. */
  written: string[];
  deleted: string[];
  /** Workspace files too large to copy into the runtime before the run. */
  skipped: string[];
};

type ResultMessage = {
  type: 'result';
  id: string;
  stdout: string;
  stderr: string;
  value?: string;
  error?: string;
  files: Record<string, string>;
  deleted: string[];
  fatal?: boolean;
};

type Pending = {
  worker: string;
  resolve: (r: ResultMessage) => void;
  reject: (e: Error) => void;
};

// Each file is base64'd through the WebView bridge, so keep copies bounded.
const MAX_SYNC_FILE = 25 * 1024 * 1024;
const MAX_SYNC_TOTAL = 60 * 1024 * 1024;

let inject: ((js: string) => void) | null = null;
let ready = false;
let readyWaiters: (() => void)[] = [];
const pending = new Map<string, Pending>();
// Per worker: the workspace it holds a copy of, and the signature (mtime:size) of each file as
// last copied into it.
const synced = new Map<string, { workspace: string; files: Map<string, string> }>();
// Per worker: the tail of its run queue. A worker runs one script at a time.
const queues = new Map<string, Promise<unknown>>();

/**
 * What the worker holds of `ws`. A worker that last ran for another workspace (or whose state is
 * unknown) is told to wipe its copy, so one chat's files never show up in another's scripts.
 */
function syncedFor(worker: string, ws: Workspace) {
  const known = synced.get(worker);
  if (known?.workspace === ws.key) return { files: known.files, reset: false };
  const files = new Map<string, string>();
  synced.set(worker, { workspace: ws.key, files });
  return { files, reset: true };
}

function failAll(worker: string | null, error: string) {
  for (const [id, p] of pending) {
    if (worker && p.worker !== worker) continue;
    pending.delete(id);
    p.reject(new Error(error));
  }
  if (worker) synced.delete(worker);
  else synced.clear();
}

/** Called by the host component with a function that runs JS in the page, or null on unmount. */
export function attachRuntime(fn: ((js: string) => void) | null) {
  inject = fn;
  if (!fn) {
    ready = false;
    failAll(null, 'The script runtime was closed.');
  }
}

/** The page reloaded (or its process died); everything inside it is gone. */
export function resetRuntime(reason: string) {
  ready = false;
  failAll(null, reason);
}

export function handleRuntimeMessage(data: string) {
  let msg: { type: string; id?: string; worker?: string; error?: string };
  try {
    msg = JSON.parse(data);
  } catch {
    return;
  }
  if (msg.type === 'ready') {
    // A fresh page has no workers.
    synced.clear();
    ready = true;
    readyWaiters.forEach((w) => w());
    readyWaiters = [];
  } else if (msg.type === 'crash' && msg.worker) {
    failAll(msg.worker, `The script runtime crashed: ${msg.error ?? 'unknown error'}`);
  } else if (msg.type === 'result' && msg.id) {
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    p.resolve(msg as ResultMessage);
  }
}

function waitReady(timeoutMs: number) {
  if (ready && inject) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The script runtime did not start.')), timeoutMs);
    readyWaiters.push(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** Terminates a worker; the next run on its key starts a fresh one. */
export function releaseWorker(worker: string) {
  inject?.(`window.__clanker && window.__clanker.kill(${JSON.stringify(worker)}); true;`);
  synced.delete(worker);
}

/** Copies workspace files that changed since the worker's last run into it. */
async function collectChanges(worker: string, ws: Workspace) {
  const { files: known, reset } = syncedFor(worker, ws);
  const entries = ws.walk();
  const files: Record<string, string> = {};
  const skipped: string[] = [];
  let total = 0;
  for (const e of entries) {
    const sig = `${e.modified}:${e.size}`;
    if (known.get(e.path) === sig) continue;
    if (e.size > MAX_SYNC_FILE || total + e.size > MAX_SYNC_TOTAL) {
      skipped.push(e.path);
      continue;
    }
    files[e.path] = await ws.fileAt(e.path).base64();
    total += e.size;
    known.set(e.path, sig);
  }
  const present = new Set(entries.map((e) => e.path));
  const deleted = [...known.keys()].filter((p) => !present.has(p));
  deleted.forEach((p) => known.delete(p));
  return { files, deleted, skipped, reset };
}

/** Writes the script's changes back to the workspace and records them as in sync. */
async function applyChanges(worker: string, ws: Workspace, msg: ResultMessage) {
  const known = syncedFor(worker, ws).files;
  const written: string[] = [];
  for (const [path, b64] of Object.entries(msg.files)) {
    try {
      ws.ensureParent(path);
      const file = ws.fileAt(path);
      await file.write(b64, { encoding: 'base64' });
      known.set(path, `${file.modificationTime ?? 0}:${file.size}`);
      written.push(path);
    } catch (e) {
      msg.stderr += `\n[could not save ${path}: ${e instanceof Error ? e.message : String(e)}]`;
    }
  }
  const deleted: string[] = [];
  for (const path of msg.deleted) {
    try {
      const file = ws.fileAt(path);
      if (file.exists) file.delete();
      known.delete(path);
      deleted.push(path);
    } catch {}
  }
  return { written, deleted };
}

/**
 * Runs Python or JavaScript in the sandboxed WebView runtime against a copy of the workspace.
 * `worker` names the worker to use (default: the language's shared one); a run waits for any
 * earlier run on the same worker, and its timeout starts once it begins.
 */
export async function runScript(opts: {
  lang: ScriptLanguage;
  code: string;
  packages?: string[];
  timeoutMs: number;
  signal?: AbortSignal;
  worker?: string;
  /** The workspace the script runs in. */
  workspace: Workspace;
}): Promise<ScriptResult> {
  const worker = opts.worker ?? opts.lang;
  const previous = queues.get(worker) ?? Promise.resolve();
  const run = previous.catch(() => {}).then(() => execute(worker, opts));
  queues.set(worker, run);
  try {
    return await run;
  } finally {
    if (queues.get(worker) === run) queues.delete(worker);
  }
}

async function execute(
  worker: string,
  opts: { lang: ScriptLanguage; code: string; packages?: string[]; timeoutMs: number; signal?: AbortSignal; workspace: Workspace }
): Promise<ScriptResult> {
  if (opts.signal?.aborted) throw new Error('Stopped by the user.');
  // The Python worker downloads Pyodide on its first run, which can take a while on mobile data.
  await waitReady(15000);
  const { lang } = opts;
  const { files, deleted, skipped, reset } = await collectChanges(worker, opts.workspace);
  const id = uid();

  const msg = await new Promise<ResultMessage>((resolve, reject) => {
    const finish = (fn: () => void) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      fn();
    };
    const timer = setTimeout(() => {
      pending.delete(id);
      releaseWorker(worker);
      finish(() => reject(new Error(`Timed out after ${Math.round(opts.timeoutMs / 1000)}s; the ${lang} runtime was restarted.`)));
    }, opts.timeoutMs);
    const onAbort = () => {
      pending.delete(id);
      releaseWorker(worker);
      finish(() => reject(new Error('Stopped.')));
    };
    opts.signal?.addEventListener('abort', onAbort);
    pending.set(id, {
      worker,
      resolve: (r) => finish(() => resolve(r)),
      reject: (e) => finish(() => reject(e)),
    });
    const payload = { type: 'run', id, worker, lang, code: opts.code, packages: opts.packages ?? [], files, deleted, reset };
    inject!(`window.__clanker.run(${JSON.stringify(payload)}); true;`);
  });

  if (msg.fatal) releaseWorker(worker);
  const changes = await applyChanges(worker, opts.workspace, msg);
  return {
    stdout: msg.stdout,
    stderr: msg.stderr,
    value: msg.value,
    error: msg.error,
    written: changes.written,
    deleted: changes.deleted,
    skipped,
  };
}
