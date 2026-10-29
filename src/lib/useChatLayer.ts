import { useLayoutEffect } from 'react';
import { useChats } from '@/store/chats';
import { useUI } from '@/store/ui';

/**
 * Shows the given chat view (see store/ui) for as long as the calling screen is mounted, and puts
 * back what was there when it goes. Pushed before the first paint, so the screen never shows the
 * view beneath it. The view is read once, at mount.
 */
export function useChatLayer(view: { currentId: string | null; newChatProjectId: string | null }) {
  useLayoutEffect(() => {
    const token = useUI.getState().pushLayer({ ...view, newChatMemoryOff: false });
    return () => {
      useUI.getState().popLayer(token);
      // The chat that was on screen may have been deleted from a project screen meanwhile.
      const ui = useUI.getState();
      if (ui.currentId && !useChats.getState().conversations[ui.currentId]) ui.open(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
