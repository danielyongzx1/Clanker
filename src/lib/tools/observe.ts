import { useChats } from '@/store/chats';
import { workspaceFor } from '../projects';
import type { Workspace } from '../workspace';

/**
 * The read-before-write policy. Each chat remembers the version (mtime:size) of every workspace
 * file the model has read or written. write_file won't overwrite, and edit_file won't edit, a file
 * the model hasn't seen, or one that changed since it last did. Chats in a project share a
 * workspace but not what they've seen, so a file another chat changed must be read again.
 */

export function signature(ws: Workspace, path: string) {
  const file = ws.fileAt(path);
  return file.exists ? `${file.modificationTime ?? 0}:${file.size}` : null;
}

/** Records the current versions of `paths` as seen by the model in this chat. */
export function markObserved(conversationId: string, paths: string[]) {
  if (!paths.length) return;
  const ws = workspaceFor(conversationId);
  const entries: Record<string, string | null> = {};
  for (const path of paths) {
    const rel = ws.normalizePath(path);
    entries[rel] = signature(ws, rel);
  }
  useChats.getState().observe(conversationId, entries);
}

export function forgetObserved(conversationId: string, paths: string[]) {
  if (!paths.length) return;
  const ws = workspaceFor(conversationId);
  useChats.getState().observe(conversationId, Object.fromEntries(paths.map((p) => [ws.normalizePath(p), null])));
}

/** Whether the model has seen the file as it is now. */
export function isObserved(conversationId: string, path: string) {
  const ws = workspaceFor(conversationId);
  const rel = ws.normalizePath(path);
  const seen = useChats.getState().conversations[conversationId]?.observed?.[rel];
  return !!seen && seen === signature(ws, rel);
}

/** Throws unless the model may change `path`: it doesn't exist yet, or the model has seen it as it is now. */
export function requireObserved(conversationId: string, path: string, action: 'overwrite' | 'edit') {
  const ws = workspaceFor(conversationId);
  const rel = ws.normalizePath(path);
  const current = signature(ws, rel);
  if (!current) return;
  const seen = useChats.getState().conversations[conversationId]?.observed?.[rel];
  if (!seen) {
    throw new Error(
      `${rel} already exists and you haven't read it in this chat. Read it with read_file before you ${action} it, so nothing is lost by accident.`
    );
  }
  if (seen !== current) {
    throw new Error(
      `${rel} changed since you last read it (a script, the shell, another chat or the user modified it). Read it again before you ${action} it.`
    );
  }
}
