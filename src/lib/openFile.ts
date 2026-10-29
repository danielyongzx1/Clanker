import * as Sharing from 'expo-sharing';
import type { Workspace } from './workspace';

function existingFile(ws: Workspace, path: string) {
  const file = ws.fileAt(path);
  if (!file.exists) throw new Error(`"${path}" is no longer in the workspace.`);
  return file;
}

/** Shows the share sheet for a workspace file (save to Files, send to another app, ...). */
export async function shareWorkspaceFile(ws: Workspace, path: string) {
  const file = existingFile(ws, path);
  await Sharing.shareAsync(file.uri, { mimeType: file.type || undefined, dialogTitle: file.name });
}

/** Opens a workspace file in the system previewer, or the share sheet when nothing can preview it. */
export async function openWorkspaceFile(ws: Workspace, path: string) {
  const file = existingFile(ws, path);
  try {
    if (await file.canPreview()) return await file.preview({ title: file.name });
  } catch {
    // Previewing failed (no app for the type on Android, say); sharing still lets the user pick one.
  }
  await shareWorkspaceFile(ws, path);
}
