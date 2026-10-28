import * as Sharing from 'expo-sharing';
import { fileAt } from './workspace';

function existingFile(path: string) {
  const file = fileAt(path);
  if (!file.exists) throw new Error(`"${path}" is no longer in the workspace.`);
  return file;
}

/** Shows the share sheet for a workspace file (save to Files, send to another app, ...). */
export async function shareWorkspaceFile(path: string) {
  const file = existingFile(path);
  await Sharing.shareAsync(file.uri, { mimeType: file.type || undefined, dialogTitle: file.name });
}

/** Opens a workspace file in the system previewer, or the share sheet when nothing can preview it. */
export async function openWorkspaceFile(path: string) {
  const file = existingFile(path);
  try {
    if (await file.canPreview()) return await file.preview({ title: file.name });
  } catch {
    // Previewing failed (no app for the type on Android, say); sharing still lets the user pick one.
  }
  await shareWorkspaceFile(path);
}
