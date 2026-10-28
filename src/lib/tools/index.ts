import { Directory, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { useSettings } from '@/store/settings';
import { ClankerShell } from '../../../modules/clanker-shell';
import { importAsset } from '../attachments';
import { compress, contextStatus, decompress, searchContext } from '../context';
import { describeJob, getJob, jobsOf, killJob, startJob, waitForJob } from '../jobs';
import type { ImagePart, ToolCall, ToolSpec } from '../providers';
import { releaseWorker, runScript, type ScriptResult } from '../runtime';
import { uid } from '../storage';
import {
  dirAt,
  ensureParent,
  ensureWorkspace,
  fileAt,
  formatSize,
  freePath,
  normalizePath,
  walk,
  workspacePath,
  type WorkspaceEntry,
} from '../workspace';
import { describeCall } from './describe';
import { extractZipDocument, ZIP_DOCUMENT_EXT } from './documents';
import { forgetObserved, isObserved, markObserved, requireObserved } from './observe';
import { download, htmlToMarkdown, searchWeb } from './web';

export type ToolOutcome = {
  output: string;
  isError?: boolean;
  images?: ImagePart[];
  /** Workspace files the call created or changed. */
  files?: string[];
};

export type ToolContext = {
  signal: AbortSignal;
  conversationId: string;
  /** The assistant reply making the call. */
  messageId: string;
  callId: string;
  /** The model response the call belongs to. */
  step?: string;
  /** Estimated token budget for the history. */
  budget: number;
};

type Tool = ToolSpec & { run: (input: any, ctx: ToolContext) => Promise<ToolOutcome> };

// Results above this are cut down to their head and tail before going back to the model.
const MAX_OUTPUT_CHARS = 30_000;
const DEFAULT_READ_LINES = 2000;
const MAX_LINE_CHARS = 2000;
// Files above this aren't scanned by search_files or decoded as text by read_file.
const MAX_TEXT_BYTES = 10 * 1024 * 1024;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|heic|heif)$/i;
const SKIP_SEARCH_EXT = /\.(png|jpe?g|gif|webp|bmp|heic|heif|ico|pdf|zip|gz|tgz|7z|rar|docx|xlsx|pptx|odt|ods|odp|epub|mp[34]|mov|wav|ogg|woff2?|ttf|otf|so|dex|apk|bin|db|sqlite)$/i;

class ToolError extends Error {}

function clip(text: string, max = MAX_OUTPUT_CHARS) {
  if (text.length <= max) return text;
  const head = text.slice(0, Math.floor(max * 0.7));
  const tail = text.slice(-Math.floor(max * 0.25));
  return `${head}\n\n[… ${text.length - head.length - tail.length} characters omitted …]\n\n${tail}`;
}

function str(value: unknown, name: string, required = true): string {
  if (value == null || value === '') {
    if (required) throw new ToolError(`Missing required argument "${name}".`);
    return '';
  }
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function seconds(value: unknown, fallback: number, max: number) {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  return Math.min(Number.isFinite(n) && n > 0 ? n : fallback, max) * 1000;
}

/** Glob → RegExp over workspace-relative paths: `*` stays within a folder, `**` crosses them. */
function globToRegex(glob: string) {
  let re = '';
  const g = normalizeGlob(glob);
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        i++;
        if (g[i + 1] === '/') {
          i++;
          re += '(?:.*/)?';
        } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '{') {
      const end = g.indexOf('}', i);
      if (end > i) {
        re += `(?:${g.slice(i + 1, end).split(',').map(escapeRe).join('|')})`;
        i = end;
      } else re += '\\{';
    } else re += escapeRe(c);
  }
  // A pattern without a folder matches the name anywhere, as most glob tools do.
  return new RegExp(g.includes('/') ? `^${re}$` : `(?:^|/)${re}$`, 'i');
}

const normalizeGlob = (g: string) => g.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/?workspace\//, '');
const escapeRe = (s: string) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&');

function isBinary(bytes: Uint8Array) {
  const n = Math.min(bytes.length, 8000);
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true;
  return false;
}

/** Snapshot of the workspace for spotting what a shell command or script changed. */
function snapshot() {
  return new Map(walk().map((e) => [e.path, `${e.modified}:${e.size}`]));
}

function changedSince(before: Map<string, string>) {
  return walk()
    .filter((e) => before.get(e.path) !== `${e.modified}:${e.size}`)
    .map((e) => e.path);
}

function existing(path: string) {
  const file = fileAt(path);
  if (!file.exists) {
    const dir = dirAt(path);
    throw new ToolError(
      dir.exists ? `"${normalizePath(path)}" is a folder; use list_files.` : `No such file: "${normalizePath(path)}".`
    );
  }
  return file;
}

// ---- read_file -----------------------------------------------------------------------------

/**
 * Lines from `offset` with their numbers, stopping at a whole line once the output would pass
 * the result cap, so the "read on" offset never skips anything.
 */
function numbered(text: string, offset: number, limit: number) {
  const lines = text.split(/\r?\n/);
  const start = Math.max(1, offset);
  const width = String(Math.min(lines.length, start + limit - 1)).length;
  const out: string[] = [];
  let size = 0;
  for (let i = start - 1; i < Math.min(lines.length, start - 1 + limit); i++) {
    const l = lines[i];
    const line = `${String(i + 1).padStart(width)}\t${l.length > MAX_LINE_CHARS ? l.slice(0, MAX_LINE_CHARS) + '…' : l}`;
    if (out.length && size + line.length + 1 > MAX_OUTPUT_CHARS - 300) break;
    out.push(line);
    size += line.length + 1;
  }
  const end = start + out.length - 1;
  const more = end < lines.length ? `\n\n[Lines ${start}-${end} of ${lines.length}. Pass offset=${end + 1} to read on.]` : '';
  return { body: out.join('\n') + more, total: lines.length };
}

async function readPdf(path: string, offset: number, limit: number, signal: AbortSignal) {
  const code = `
import json, pypdf
reader = pypdf.PdfReader(${JSON.stringify(path)})
total = len(reader.pages)
start = max(1, ${offset})
end = min(total, start + ${limit} - 1)
print(f"[PDF: {total} pages; showing {start}-{end}]")
for i in range(start - 1, end):
    print(f"\\n--- Page {i + 1} ---")
    print(reader.pages[i].extract_text() or "[no extractable text on this page]")
if end < total:
    print(f"\\n[Pass offset={end + 1} to read further pages.]")
`;
  const r = await runScript({ lang: 'python', code, packages: ['pypdf'], timeoutMs: 120_000, signal });
  if (r.error) {
    throw new ToolError(
      `Could not extract the PDF's text: ${r.error}\nWrite a run_python script (pypdf, pdfminer.six or pymupdf) to process it instead.`
    );
  }
  const text = r.stdout.trim();
  const sparse = text.replace(/\[[^\]]*\]|--- Page \d+ ---/g, '').trim().length < 20;
  return sparse
    ? `${text}\n\n[Little or no text was found; this may be a scanned PDF. Render pages to images with run_python (e.g. pymupdf) and read the images.]`
    : text;
}

const readFile: Tool = {
  name: 'read_file',
  description:
    'Read a workspace file. Text and code files come back with line numbers (use offset/limit to page through large ones). ' +
    'Images are returned so you can see them. PDFs, Word (.docx), Excel (.xlsx), PowerPoint (.pptx), OpenDocument and EPUB files come back as extracted text ' +
    '(for PDFs, offset/limit count pages). Other binary files return their size and a hex preview: process those with run_python or run_javascript.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace-relative path.' },
      offset: { type: 'integer', description: 'First line (or PDF page) to read, from 1.' },
      limit: { type: 'integer', description: `How many lines (or PDF pages) to read. Default ${DEFAULT_READ_LINES} lines / 30 pages.` },
    },
    required: ['path'],
  },
  async run(input, { signal }) {
    const path = normalizePath(str(input.path, 'path'));
    const file = existing(path);
    const offset = Math.max(1, Number(input.offset) || 1);

    if (IMAGE_EXT.test(path)) {
      const image = await importAsset({ uri: file.uri });
      return { output: `Image ${path} (${formatSize(file.size)}, shown as ${image.width}×${image.height}).`, images: [image] };
    }
    if (/\.pdf$/i.test(path)) {
      return { output: clip(await readPdf(path, offset, Math.max(1, Number(input.limit) || 30), signal)) };
    }
    if (ZIP_DOCUMENT_EXT.test(path)) {
      let text: string;
      try {
        text = extractZipDocument(path, await file.bytes());
      } catch (e) {
        throw new ToolError(`Could not read ${path} as a document (${e instanceof Error ? e.message : e}). Try run_python.`);
      }
      const { body } = numbered(text || '[no text found]', offset, Number(input.limit) || DEFAULT_READ_LINES);
      return { output: clip(`[Text extracted from ${path}]\n${body}`) };
    }
    if (file.size > MAX_TEXT_BYTES) {
      throw new ToolError(`${path} is ${formatSize(file.size)}, too large to read whole. Use search_files, or a script to read part of it.`);
    }
    const bytes = await file.bytes();
    if (isBinary(bytes)) {
      const hex = Array.from(bytes.subarray(0, 64), (b) => b.toString(16).padStart(2, '0')).join(' ');
      return {
        output: `${path} is a binary file (${formatSize(file.size)}, ${file.type || 'unknown type'}).\nFirst bytes: ${hex}\nUse run_python or run_javascript to process it.`,
      };
    }
    const text = new TextDecoder().decode(bytes);
    if (!text) return { output: `${path} is empty.` };
    const { body } = numbered(text, offset, Number(input.limit) || DEFAULT_READ_LINES);
    return { output: clip(body) };
  },
};

// ---- writing -----------------------------------------------------------------------------

const writeFile: Tool = {
  name: 'write_file',
  description:
    'Create or overwrite a workspace file, creating folders as needed. For text, pass the full content. ' +
    'An existing file must have been read in this chat (since it last changed), or the write is refused. ' +
    'For binary data pass base64 with encoding "base64". To produce Office documents, PDFs, images and other binary formats, ' +
    'prefer a run_python script (python-docx, openpyxl, python-pptx, fpdf2/reportlab, Pillow, matplotlib).',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace-relative path.' },
      content: { type: 'string', description: 'The complete file content.' },
      encoding: { type: 'string', enum: ['utf8', 'base64'], description: 'How content is encoded. Default utf8.' },
    },
    required: ['path', 'content'],
  },
  async run(input, { conversationId }) {
    const path = normalizePath(str(input.path, 'path'));
    const content = typeof input.content === 'string' ? input.content : str(input.content, 'content', false);
    if (dirAt(path).exists && path) throw new ToolError(`"${path}" is a folder.`);
    requireObserved(conversationId, path, 'overwrite');
    ensureParent(path);
    const file = fileAt(path);
    const existed = file.exists;
    await file.write(content, input.encoding === 'base64' ? { encoding: 'base64' } : undefined);
    return { output: `${existed ? 'Overwrote' : 'Created'} ${path} (${formatSize(file.size)}).`, files: [path] };
  },
};

const editFile: Tool = {
  name: 'edit_file',
  description:
    'Replace an exact string in a text file. old_string must match the file exactly (including whitespace) and be unique unless replace_all is true. ' +
    'The file must have been read (or written by you) since it last changed, or the edit is refused. ' +
    'For Office documents and other binary formats, use run_python instead.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      old_string: { type: 'string', description: 'Exact text to replace.' },
      new_string: { type: 'string', description: 'Replacement text.' },
      replace_all: { type: 'boolean', description: 'Replace every occurrence. Default false.' },
    },
    required: ['path', 'old_string', 'new_string'],
  },
  async run(input, { conversationId }) {
    const path = normalizePath(str(input.path, 'path'));
    const file = existing(path);
    requireObserved(conversationId, path, 'edit');
    const oldString = str(input.old_string, 'old_string');
    const newString = typeof input.new_string === 'string' ? input.new_string : '';
    const text = await file.text();
    const count = text.split(oldString).length - 1;
    if (count === 0) throw new ToolError(`old_string was not found in ${path}. Read the file and copy the text exactly.`);
    if (count > 1 && !input.replace_all) {
      throw new ToolError(`old_string occurs ${count} times in ${path}. Add surrounding context to make it unique, or set replace_all.`);
    }
    const next = input.replace_all ? text.split(oldString).join(newString) : text.replace(oldString, () => newString);
    await file.write(next);
    return { output: `Edited ${path} (${count} replacement${count === 1 ? '' : 's'}).`, files: [path] };
  },
};

const deletePath: Tool = {
  name: 'delete_path',
  description: 'Delete a workspace file or folder (folders are deleted with everything in them).',
  parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  async run(input, { conversationId }) {
    const path = normalizePath(str(input.path, 'path'));
    if (!path) throw new ToolError('Refusing to delete the whole workspace.');
    const dir = dirAt(path);
    if (dir.exists) {
      dir.delete();
      return { output: `Deleted folder ${path}.` };
    }
    existing(path).delete();
    forgetObserved(conversationId, [path]);
    return { output: `Deleted ${path}.` };
  },
};

const movePath: Tool = {
  name: 'move_path',
  description: 'Move, rename or copy a workspace file or folder.',
  parameters: {
    type: 'object',
    properties: {
      from: { type: 'string' },
      to: { type: 'string' },
      copy: { type: 'boolean', description: 'Copy instead of moving. Default false.' },
    },
    required: ['from', 'to'],
  },
  async run(input, { conversationId }) {
    const from = normalizePath(str(input.from, 'from'));
    const to = normalizePath(str(input.to, 'to'));
    if (!from || !to) throw new ToolError('Both paths must be inside the workspace and not the root.');
    const dir = dirAt(from);
    const source = dir.exists ? dir : existing(from);
    if (!dir.exists) requireObserved(conversationId, to, 'overwrite');
    // The model knows the destination's contents only if it knew the source's.
    const known = !dir.exists && isObserved(conversationId, from);
    ensureParent(to);
    const target = dir.exists ? dirAt(to) : fileAt(to);
    if (input.copy) source.copySync(target, { overwrite: true });
    else source.moveSync(target, { overwrite: true });
    if (!input.copy) forgetObserved(conversationId, [from]);
    if (known) markObserved(conversationId, [to]);
    return { output: `${input.copy ? 'Copied' : 'Moved'} ${from} → ${to}.`, files: dir.exists ? [] : [to] };
  },
};

// ---- discovery -----------------------------------------------------------------------------

const listFiles: Tool = {
  name: 'list_files',
  description:
    'List workspace files. Without a pattern, lists one folder (default: the root). With a glob pattern such as "**/*.py" or "*.{docx,pdf}", lists matching files under the folder recursively.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Folder to list. Default the workspace root.' },
      pattern: { type: 'string', description: 'Glob to match file paths recursively.' },
    },
  },
  async run(input) {
    ensureWorkspace();
    const path = normalizePath(typeof input.path === 'string' ? input.path : '');
    const dir = dirAt(path);
    if (!dir.exists) throw new ToolError(`No such folder: "${path || '/'}".`);
    if (input.pattern) {
      const re = globToRegex(String(input.pattern));
      const matches = walk(path).filter((e) => re.test(e.path));
      if (!matches.length) return { output: `No files match ${input.pattern}.` };
      return { output: clip(matches.slice(0, 1000).map((e) => `${e.path}  (${formatSize(e.size)})`).join('\n')) };
    }
    const entries = dir.list();
    if (!entries.length) return { output: path ? `${path}/ is empty.` : 'The workspace is empty.' };
    const lines = entries
      .map((e) => (e instanceof Directory ? `${e.name}/` : `${e.name}  (${formatSize(e.size)})`))
      .sort((a, b) => Number(b.endsWith('/')) - Number(a.endsWith('/')) || a.localeCompare(b));
    return { output: clip(`${path ? `${path}/` : '(workspace root)'}\n${lines.join('\n')}`) };
  },
};

const searchFiles: Tool = {
  name: 'search_files',
  description:
    'Search text file contents with a regular expression. Returns matching lines as path:line: text. Binary and document formats are skipped (read those with read_file).',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'JavaScript regular expression.' },
      path: { type: 'string', description: 'Folder to search. Default the whole workspace.' },
      glob: { type: 'string', description: 'Only search files matching this glob, e.g. "*.ts".' },
      ignore_case: { type: 'boolean' },
    },
    required: ['pattern'],
  },
  async run(input) {
    let re: RegExp;
    try {
      re = new RegExp(str(input.pattern, 'pattern'), input.ignore_case ? 'i' : '');
    } catch (e) {
      throw new ToolError(`Invalid regular expression: ${e instanceof Error ? e.message : e}`);
    }
    const only = input.glob ? globToRegex(String(input.glob)) : null;
    const files: WorkspaceEntry[] = walk(typeof input.path === 'string' ? input.path : '').filter(
      (e) => e.size <= MAX_TEXT_BYTES && !SKIP_SEARCH_EXT.test(e.path) && (!only || only.test(e.path))
    );
    const out: string[] = [];
    let total = 0;
    for (const e of files) {
      const bytes = await fileAt(e.path).bytes();
      if (isBinary(bytes)) continue;
      const lines = new TextDecoder().decode(bytes).split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (!re.test(lines[i])) continue;
        total++;
        if (out.length < 300) out.push(`${e.path}:${i + 1}: ${lines[i].trim().slice(0, 300)}`);
      }
    }
    if (!total) return { output: `No matches in ${files.length} file${files.length === 1 ? '' : 's'}.` };
    return { output: clip(out.join('\n') + (total > out.length ? `\n\n[${total - out.length} more matches not shown]` : '')) };
  },
};

// ---- execution -----------------------------------------------------------------------------

function scriptReport(r: ScriptResult) {
  const parts: string[] = [];
  if (r.stdout) parts.push(r.stdout);
  if (r.value !== undefined && r.value !== 'None') parts.push(`=> ${r.value}`);
  if (r.stderr) parts.push(`[stderr]\n${r.stderr}`);
  if (r.error) parts.push(`[error]\n${r.error}`);
  if (r.written.length) parts.push(`[files written: ${r.written.join(', ')}]`);
  if (r.deleted.length) parts.push(`[files deleted: ${r.deleted.join(', ')}]`);
  if (r.skipped.length) parts.push(`[too large to copy into the runtime, so not visible to the script: ${r.skipped.join(', ')}]`);
  return clip(parts.join('\n\n') || '(no output)');
}

const BACKGROUND_PARAM = {
  type: 'boolean',
  description:
    'Run as a background job and return at once with its id; collect the result later with job_output. Use for long work you can overlap with other steps.',
};

/** Starts `run` as a background job and reports its id; the result arrives via job_output. */
function background(
  ctx: ToolContext,
  tool: string,
  label: string,
  run: (signal: AbortSignal, jobId: string) => Promise<ToolOutcome>
): ToolOutcome {
  const job = startJob({ conversationId: ctx.conversationId, messageId: ctx.messageId, toolId: ctx.callId, tool, label, run });
  return {
    output:
      `Started background job ${job.id}. Keep working; its status shows in the job list of the system prompt. ` +
      'Collect the result with job_output (wait only if you are blocked on it), or stop it with job_kill.',
  };
}

function scriptLabel(code: string) {
  return code.trim().split('\n')[0].slice(0, 60);
}

const runPython: Tool = {
  name: 'run_python',
  description:
    'Run a Python 3 script (Pyodide/WebAssembly) with the workspace as the current directory; files it writes are saved to the workspace. ' +
    'Packages imported by the script install automatically (numpy, pandas, openpyxl, lxml, Pillow, matplotlib, python-docx, python-pptx, pypdf, fpdf2, beautifulsoup4, ...); ' +
    'list any others in `packages`. Only pure-Python wheels or Pyodide builds work: no subprocess, no native binaries, no threads. ' +
    'Top-level await works; network access is via pyodide.http.pyfetch. Print results you need to see. Each run starts with fresh variables.',
  parameters: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'Python source.' },
      packages: { type: 'array', items: { type: 'string' }, description: 'Extra PyPI packages to install first.' },
      timeout_seconds: { type: 'number', description: 'Default 120 (600 in the background), max 1800.' },
      background: BACKGROUND_PARAM,
    },
    required: ['code'],
  },
  async run(input, ctx) {
    const code = str(input.code, 'code');
    const exec = async (signal: AbortSignal, worker?: string): Promise<ToolOutcome> => {
      const r = await runScript({
        lang: 'python',
        code,
        packages: Array.isArray(input.packages) ? input.packages.map(String) : [],
        timeoutMs: seconds(input.timeout_seconds, worker ? 600 : 120, 1800),
        signal,
        worker,
      });
      return { output: scriptReport(r), isError: !!r.error, files: r.written };
    };
    if (!input.background) return exec(ctx.signal);
    // Its own worker, so foreground runs aren't stuck behind it; freed when it ends.
    return background(ctx, 'run_python', scriptLabel(code), (signal, jobId) =>
      exec(signal, `job:${jobId}`).finally(() => releaseWorker(`job:${jobId}`))
    );
  },
};

const runJavaScript: Tool = {
  name: 'run_javascript',
  description:
    'Run JavaScript (an async function body, in a browser Web Worker) against an in-memory copy of the workspace. ' +
    'Use `fs`: fs.list(dir?), fs.exists(p), fs.readText(p), fs.readBytes(p) → Uint8Array, fs.readJSON(p), fs.writeText(p, s), fs.writeBytes(p, bytes), fs.writeJSON(p, v), fs.remove(p). ' +
    'Written files are saved to the workspace. console.log/print output and the returned value come back to you. ' +
    'fetch works, and libraries load with `await import("https://esm.sh/<package>")` (e.g. jszip, pdf-lib, exceljs, docx, papaparse). No DOM; OffscreenCanvas is available.',
  parameters: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'Body of an async function; `return` a value to see it.' },
      timeout_seconds: { type: 'number', description: 'Default 60 (600 in the background), max 1800.' },
      background: BACKGROUND_PARAM,
    },
    required: ['code'],
  },
  async run(input, ctx) {
    const code = str(input.code, 'code');
    const exec = async (signal: AbortSignal, worker?: string): Promise<ToolOutcome> => {
      const r = await runScript({
        lang: 'javascript',
        code,
        timeoutMs: seconds(input.timeout_seconds, worker ? 600 : 60, 1800),
        signal,
        worker,
      });
      return { output: scriptReport(r), isError: !!r.error, files: r.written };
    };
    if (!input.background) return exec(ctx.signal);
    return background(ctx, 'run_javascript', scriptLabel(code), (signal, jobId) =>
      exec(signal, `job:${jobId}`).finally(() => releaseWorker(`job:${jobId}`))
    );
  },
};

const runShell: Tool = {
  name: 'run_shell',
  description:
    "Run a command with Android's /system/bin/sh in the workspace folder. Only the phone's built-in utilities exist " +
    '(typically ls, cat, cp, mv, rm, mkdir, find, grep, sed, awk, sort, uniq, wc, head, tail, tar, gzip, unzip, base64, md5sum, sha256sum, date, ...): ' +
    'there is no python, node, git or package manager here, so use run_python / run_javascript for scripting. Commands run as the app, sandboxed to its own storage.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string' },
      timeout_seconds: { type: 'number', description: 'Default 60 (600 in the background), max 1800.' },
      background: BACKGROUND_PARAM,
    },
    required: ['command'],
  },
  async run(input, ctx) {
    const command = str(input.command, 'command');
    if (!input.background) return shell(command, seconds(input.timeout_seconds, 60, 1800), ctx.signal);
    return background(ctx, 'run_shell', command.split('\n')[0].slice(0, 60), (signal) =>
      shell(command, seconds(input.timeout_seconds, 600, 1800), signal)
    );
  },
};

async function shell(command: string, timeoutMs: number, signal: AbortSignal): Promise<ToolOutcome> {
  if (!ClankerShell) throw new ToolError('The shell is not available in this build of the app.');
  ensureWorkspace();
  const id = uid();
  const before = snapshot();
  const onAbort = () => ClankerShell!.kill(id);
  signal.addEventListener('abort', onAbort);
  let r;
  try {
    const tmp = new Directory(Paths.cache, 'shell-tmp');
    if (!tmp.exists) tmp.create({ intermediates: true });
    r = await ClankerShell.exec(id, command, workspacePath(), timeoutMs, {
      HOME: workspacePath(),
      TMPDIR: decodeURIComponent(tmp.uri.replace(/^file:\/\//, '')).replace(/\/+$/, ''),
    });
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
  const parts: string[] = [];
  if (r.stdout) parts.push(r.stdout.replace(/\n$/, ''));
  if (r.stderr) parts.push(`[stderr]\n${r.stderr.replace(/\n$/, '')}`);
  if (r.truncated) parts.push('[output past 256 KB was dropped]');
  parts.push(r.timedOut ? '[timed out; the process was killed]' : `[exit code: ${r.exitCode}]`);
  return { output: clip(parts.join('\n\n')), isError: r.timedOut || r.exitCode !== 0, files: changedSince(before) };
}

// ---- background jobs -----------------------------------------------------------------------

const jobOutput: Tool = {
  name: 'job_output',
  description:
    "Get a background job's status and, once it has finished, its full result. Without job_id, lists this chat's jobs. " +
    'Set wait to block until the job finishes (up to timeout_seconds); only do that when you have nothing else to do.',
  parameters: {
    type: 'object',
    properties: {
      job_id: { type: 'string' },
      wait: { type: 'boolean', description: 'Wait for the job to finish. Default false.' },
      timeout_seconds: { type: 'number', description: 'How long to wait. Default 60, max 600.' },
    },
  },
  async run(input, { conversationId, signal }) {
    if (!input.job_id) {
      const list = jobsOf(conversationId);
      return { output: list.length ? list.map(describeJob).join('\n') : 'No background jobs in this chat.' };
    }
    const job = getJob(String(input.job_id));
    if (!job || job.conversationId !== conversationId) {
      throw new ToolError(`No job "${input.job_id}" in this chat. Jobs don't survive an app restart.`);
    }
    if (job.status === 'running' && input.wait) await waitForJob(job, seconds(input.timeout_seconds, 60, 600), signal);
    if (job.status === 'running') return { output: `${describeJob(job)}. No result yet.` };
    job.collected = true;
    const outcome = job.outcome!;
    return { output: `${describeJob(job)}.\n\n${outcome.output}`, isError: outcome.isError, files: outcome.files };
  },
};

const jobKill: Tool = {
  name: 'job_kill',
  description: 'Stop a running background job whose result no longer matters.',
  parameters: { type: 'object', properties: { job_id: { type: 'string' } }, required: ['job_id'] },
  async run(input, { conversationId }) {
    const job = getJob(String(input.job_id));
    if (!job || job.conversationId !== conversationId) throw new ToolError(`No job "${input.job_id}" in this chat.`);
    if (!killJob(job.id)) return { output: `${describeJob(job)}; nothing to stop.` };
    job.collected = true;
    return { output: `Stopped ${job.id}.` };
  },
};

// ---- web -----------------------------------------------------------------------------------

// Text pages are returned this many characters at a time.
const WEB_PAGE_CHARS = 20_000;
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;
const TEXT_TYPE = /^text\/|[+/](json|xml|javascript|ecmascript|yaml|csv|markdown)$/;

const webSearch: Tool = {
  name: 'web_search',
  description:
    'Search the web. Returns titles, URLs and snippets; open the promising results with web_fetch before relying on their details. ' +
    'Use it for current events, prices, documentation, niche facts and anything you are unsure of or that may have changed since your training.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What to search for, phrased as you would in a search engine.' },
      count: { type: 'integer', description: 'How many results, 1-20. Default 8.' },
    },
    required: ['query'],
  },
  async run(input, { signal }) {
    const query = str(input.query, 'query');
    const count = Math.min(20, Math.max(1, Number(input.count) || 8));
    const results = await searchWeb(query, count, signal);
    if (!results.length) return { output: `No results for “${query}”.` };
    return {
      output: clip(
        results
          .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}${r.date ? ` · ${r.date}` : ''}${r.snippet ? `\n   ${r.snippet}` : ''}`)
          .join('\n\n')
      ),
    };
  },
};

const webFetch: Tool = {
  name: 'web_fetch',
  description:
    'Fetch a URL (http or https). Web pages come back as markdown with their links; long ones come in parts, so pass start to read on. ' +
    'Files that are not text (PDFs, images, Office documents, archives, ...) are saved to the workspace under downloads/, to open with read_file or a script. ' +
    'Pass save_as to save any response, text included, to a workspace path instead of reading it.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string' },
      start: { type: 'integer', description: 'Character offset to read from, for pages longer than one result. Default 0.' },
      raw: { type: 'boolean', description: 'Return HTML source instead of converting it to markdown. Default false.' },
      save_as: { type: 'string', description: 'Workspace path to save the response to.' },
    },
    required: ['url'],
  },
  async run(input, { conversationId, signal }) {
    const url = str(input.url, 'url').trim();
    if (!/^https?:\/\//i.test(url)) throw new ToolError('Only http and https URLs can be fetched.');
    const saveAs = input.save_as ? normalizePath(str(input.save_as, 'save_as')) : '';
    if (saveAs) {
      if (dirAt(saveAs).exists) throw new ToolError(`"${saveAs}" is a folder.`);
      requireObserved(conversationId, saveAs, 'overwrite');
    }
    const res = await download(url, signal, MAX_DOWNLOAD_BYTES, saveAs ? 300_000 : 60_000);
    const textual =
      !saveAs && res.bytes.length <= MAX_TEXT_BYTES && (TEXT_TYPE.test(res.type) || (!res.type && !isBinary(res.bytes)));

    if (!textual) {
      if (!res.ok) throw new ToolError(`HTTP ${res.status} from ${res.url}.`);
      const path = saveAs || freePath(res.filename, 'downloads');
      ensureParent(path);
      const file = fileAt(path);
      await file.write(res.bytes);
      return {
        output: `Saved ${res.url} to ${path} (${formatSize(file.size)}${res.type ? `, ${res.type}` : ''}).${
          saveAs ? '' : ' Open it with read_file, or process it with a script.'
        }`,
        files: [path],
      };
    }

    let text = new TextDecoder().decode(res.bytes);
    let title = '';
    const html = /html/.test(res.type) || (!res.type && /^\s*<(!doctype html|html)/i.test(text));
    if (html && !input.raw) ({ title, text } = htmlToMarkdown(text, res.url));
    const start = Math.max(0, Number(input.start) || 0);
    const page = text.slice(start, start + WEB_PAGE_CHARS);
    const end = start + page.length;
    const header = [
      title && `# ${title}`,
      `URL: ${res.url}`,
      !res.ok && `HTTP ${res.status}`,
      (start > 0 || end < text.length) &&
        `[Characters ${start}-${end} of ${text.length}.${end < text.length ? ` Pass start=${end} to read on.` : ''}]`,
    ].filter(Boolean);
    return { output: `${header.join('\n')}\n\n${page || '[no text]'}`, isError: !res.ok };
  },
};

// ---- context management --------------------------------------------------------------------

const scopeOf = (ctx: ToolContext) => ({ conversationId: ctx.conversationId, replyId: ctx.messageId, step: ctx.step });

const compressTool: Tool = {
  name: 'compress',
  description:
    'Replace ranges of the conversation history with summaries you write, to free context. History items are tagged [mN · ~size tokens]; ' +
    'a range from..to covers every item between them, including assistant text. The summary becomes your only record of the range ' +
    '(the user still sees the original), so make it self-contained; the system prompt says what to keep. Earlier blocks inside a range are absorbed. ' +
    'Pass every range in one call rather than calling repeatedly.',
  parameters: {
    type: 'object',
    properties: {
      ranges: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            from: { type: 'string', description: 'First ref, e.g. "m4".' },
            to: { type: 'string', description: 'Last ref, inclusive. Same as from for one item.' },
            summary: { type: 'string', description: 'What replaces the range.' },
          },
          required: ['from', 'to', 'summary'],
        },
      },
    },
    required: ['ranges'],
  },
  async run(input, ctx) {
    return { output: compress(scopeOf(ctx), input.ranges) };
  },
};

const decompressTool: Tool = {
  name: 'decompress',
  description:
    'Restore a compressed block (bN). By default goes back one level (blocks it absorbed reappear); full restores the original items. Check sizes with context_status first.',
  parameters: {
    type: 'object',
    properties: {
      block_id: { type: 'string', description: 'e.g. "b3".' },
      full: { type: 'boolean', description: 'Restore the original items. Default false.' },
    },
    required: ['block_id'],
  },
  async run(input, ctx) {
    return { output: decompress(scopeOf(ctx), input.block_id, !!input.full) };
  },
};

const searchContextTool: Tool = {
  name: 'search_context',
  description:
    "Search this chat's full history, including the originals inside compressed blocks, for words or a phrase. Use it to find which block to decompress, or to recall a detail.",
  parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  async run(input, ctx) {
    return { output: searchContext(scopeOf(ctx), input.query) };
  },
};

const contextStatusTool: Tool = {
  name: 'context_status',
  description: 'Show the estimated size of the history, the compressed blocks, and the largest items that could be compressed.',
  parameters: { type: 'object', properties: {} },
  async run(_input, ctx) {
    return { output: contextStatus(scopeOf(ctx), ctx.budget) };
  },
};

const TOOLS: Tool[] = [
  listFiles,
  readFile,
  searchFiles,
  writeFile,
  editFile,
  movePath,
  deletePath,
  runPython,
  runJavaScript,
  runShell,
  jobOutput,
  jobKill,
  webSearch,
  webFetch,
  compressTool,
  decompressTool,
  searchContextTool,
  contextStatusTool,
];

export const shellAvailable = () => Platform.OS === 'android' && !!ClankerShell;

export const webEnabled = () => useSettings.getState().web;

function enabled(tool: Tool) {
  if (tool === runShell) return shellAvailable();
  if (tool === webSearch || tool === webFetch) return webEnabled();
  return true;
}

/** Tools offered to the model on this device. */
export function availableTools(): ToolSpec[] {
  return TOOLS.filter(enabled).map(({ name, description, parameters }) => ({
    name,
    description,
    parameters,
  }));
}

export async function executeTool(call: ToolCall, ctx: Omit<ToolContext, 'callId'>): Promise<ToolOutcome> {
  const tool = TOOLS.find((t) => t.name === call.name);
  if (!tool || !enabled(tool)) {
    return { output: `Unknown tool "${call.name}".`, isError: true };
  }
  if ('_raw' in call.input) {
    return { output: `The arguments were not valid JSON: ${String(call.input._raw).slice(0, 500)}`, isError: true };
  }
  try {
    const outcome = await tool.run(call.input, { ...ctx, callId: call.id });
    if (!outcome.isError) {
      // What the model has now seen as it is: anything it read, and anything it or its scripts wrote.
      const read = call.name === 'read_file' && typeof call.input.path === 'string' ? [call.input.path] : [];
      markObserved(ctx.conversationId, [...read, ...(outcome.files ?? [])]);
    }
    return outcome;
  } catch (e) {
    return { output: e instanceof Error ? e.message : String(e), isError: true };
  }
}

export { describeCall };
