import { Directory, File, Paths } from 'expo-file-system';

/** The agent's working folder. Tools resolve every path against it and can't reach outside. */
export const workspaceDir = new Directory(Paths.document, 'workspace');

export function ensureWorkspace() {
  if (!workspaceDir.exists) workspaceDir.create({ intermediates: true });
}

/** Plain filesystem path of the workspace, for the shell's working directory. */
export function workspacePath() {
  return decodeURIComponent(workspaceDir.uri.replace(/^file:\/\//, '')).replace(/\/+$/, '');
}

/**
 * Normalizes a model-supplied path to a workspace-relative one ("" is the root). Accepts
 * "a/b", "./a/b", "/a/b", "/workspace/a/b" and the workspace's real absolute path.
 */
export function normalizePath(input: string) {
  let p = (input ?? '').trim().replace(/\\/g, '/');
  const real = workspacePath();
  if (p.startsWith('file://')) p = decodeURIComponent(p.slice(7));
  if (p === real || p.startsWith(real + '/')) p = p.slice(real.length);
  p = p.replace(/^\/?workspace(?=\/|$)/, '').replace(/^~(?=\/|$)/, '');
  const parts: string[] = [];
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (!parts.length) throw new Error(`"${input}" points outside the workspace.`);
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}

export function fileAt(path: string) {
  const rel = normalizePath(path);
  if (!rel) throw new Error('Expected a file path, got the workspace root.');
  return new File(workspaceDir, ...rel.split('/'));
}

export function dirAt(path: string) {
  const rel = normalizePath(path);
  return rel ? new Directory(workspaceDir, ...rel.split('/')) : workspaceDir;
}

/** Creates the parent folders of a workspace file path. */
export function ensureParent(path: string) {
  ensureWorkspace();
  const rel = normalizePath(path);
  const parent = rel.split('/').slice(0, -1);
  if (parent.length) {
    const dir = new Directory(workspaceDir, ...parent);
    if (!dir.exists) dir.create({ intermediates: true });
  }
}

export type WorkspaceEntry = { path: string; size: number; modified: number };

/** Every file under `path`, recursively, with workspace-relative paths. */
export function walk(path = '', limit = 20000): WorkspaceEntry[] {
  ensureWorkspace();
  const root = normalizePath(path);
  const out: WorkspaceEntry[] = [];
  const visit = (dir: Directory, prefix: string) => {
    for (const entry of dir.list()) {
      if (out.length >= limit) return;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry instanceof Directory) visit(entry, rel);
      else out.push({ path: rel, size: entry.size, modified: entry.modificationTime ?? 0 });
    }
  };
  const dir = dirAt(root);
  if (dir.exists) visit(dir, root);
  return out;
}

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** A workspace path for `name` that doesn't clash with an existing file: "a.pdf", "a (1).pdf", ... */
export function freePath(name: string, dir = '') {
  const base = dir ? `${normalizePath(dir)}/` : '';
  const ext = name.match(/\.[^./]+$/)?.[0] ?? '';
  const stem = name.slice(0, name.length - ext.length);
  for (let i = 0; ; i++) {
    const candidate = `${base}${i ? `${stem} (${i})` : stem}${ext}`;
    if (!fileAt(candidate).exists) return candidate;
  }
}
