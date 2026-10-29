import { Directory, File, Paths } from 'expo-file-system';

export type WorkspaceEntry = { path: string; size: number; modified: number };

/**
 * A folder the agent works in. Tools resolve every path against it and can't reach outside.
 * Each chat has its own, except chats in a project, which share the project's. `key` names it:
 * "chat:<id>", "project:<id>", or "shared" for the one folder chats used before that.
 */
export class Workspace {
  readonly dir: Directory;

  constructor(readonly key: string) {
    const [kind, id] = key.split(':');
    this.dir =
      kind === 'chat'
        ? new Directory(Paths.document, 'workspaces', 'chats', id)
        : kind === 'project'
          ? new Directory(Paths.document, 'workspaces', 'projects', id)
          : new Directory(Paths.document, 'workspace');
  }

  ensure() {
    if (!this.dir.exists) this.dir.create({ intermediates: true });
  }

  /** Plain filesystem path of the workspace, for the shell's working directory. */
  path() {
    return decodeURIComponent(this.dir.uri.replace(/^file:\/\//, '')).replace(/\/+$/, '');
  }

  /**
   * Normalizes a model-supplied path to a workspace-relative one ("" is the root). Accepts
   * "a/b", "./a/b", "/a/b", "/workspace/a/b" and the workspace's real absolute path.
   */
  normalizePath(input: string) {
    let p = (input ?? '').trim().replace(/\\/g, '/');
    const real = this.path();
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

  fileAt(path: string) {
    const rel = this.normalizePath(path);
    if (!rel) throw new Error('Expected a file path, got the workspace root.');
    return new File(this.dir, ...rel.split('/'));
  }

  dirAt(path: string) {
    const rel = this.normalizePath(path);
    return rel ? new Directory(this.dir, ...rel.split('/')) : this.dir;
  }

  /** Creates the parent folders of a workspace file path. */
  ensureParent(path: string) {
    this.ensure();
    const parent = this.normalizePath(path).split('/').slice(0, -1);
    if (parent.length) {
      const dir = new Directory(this.dir, ...parent);
      if (!dir.exists) dir.create({ intermediates: true });
    }
  }

  /** Every file under `path`, recursively, with workspace-relative paths. */
  walk(path = '', limit = 20000): WorkspaceEntry[] {
    if (!this.dir.exists) return [];
    const root = this.normalizePath(path);
    const out: WorkspaceEntry[] = [];
    const visit = (dir: Directory, prefix: string) => {
      for (const entry of dir.list()) {
        if (out.length >= limit) return;
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry instanceof Directory) visit(entry, rel);
        else out.push({ path: rel, size: entry.size, modified: entry.modificationTime ?? 0 });
      }
    };
    const dir = this.dirAt(root);
    if (dir.exists) visit(dir, root);
    return out;
  }

  /** A workspace path for `name` that doesn't clash with an existing file: "a.pdf", "a (1).pdf", ... */
  freePath(name: string, dir = '') {
    const base = dir ? `${this.normalizePath(dir)}/` : '';
    const ext = name.match(/\.[^./]+$/)?.[0] ?? '';
    const stem = name.slice(0, name.length - ext.length);
    for (let i = 0; ; i++) {
      const candidate = `${base}${i ? `${stem} (${i})` : stem}${ext}`;
      if (!this.fileAt(candidate).exists) return candidate;
    }
  }

  /** Deletes the workspace and everything in it. */
  remove() {
    if (this.dir.exists) this.dir.delete();
  }
}

export const chatWorkspace = (conversationId: string) => new Workspace(`chat:${conversationId}`);
export const projectWorkspace = (projectId: string) => new Workspace(`project:${projectId}`);
/** The one folder every chat shared before workspaces were per chat; those chats keep using it. */
export const sharedWorkspace = new Workspace('shared');

/** Every workspace folder that exists on the device, by key. */
export function allWorkspaces(): Workspace[] {
  const found: Workspace[] = sharedWorkspace.dir.exists ? [sharedWorkspace] : [];
  for (const kind of ['chats', 'projects'] as const) {
    const dir = new Directory(Paths.document, 'workspaces', kind);
    if (!dir.exists) continue;
    for (const entry of dir.list()) {
      if (entry instanceof Directory) found.push(new Workspace(`${kind === 'chats' ? 'chat' : 'project'}:${entry.name}`));
    }
  }
  return found;
}

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
