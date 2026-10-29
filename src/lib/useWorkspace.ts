import { useMemo } from 'react';
import { useChats } from '@/store/chats';
import { useUI } from '@/store/ui';
import { workspaceKeyOf } from './projects';
import { Workspace } from './workspace';

/**
 * The workspace of the chat on screen, for file chips and images that name workspace paths. The
 * replies on screen always belong to the current chat, so it is read from the stores rather than
 * handed down; null on the new-chat screen.
 */
export function useWorkspace() {
  const currentId = useUI((s) => s.currentId);
  const key = useChats((s) => {
    const c = currentId ? s.conversations[currentId] : undefined;
    return c ? workspaceKeyOf(c) : null;
  });
  return useMemo(() => (key ? new Workspace(key) : null), [key]);
}
