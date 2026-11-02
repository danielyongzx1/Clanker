import type { NotificationResponse } from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Notifications } from '@/lib/expoNotifications';
import { useChats } from '@/store/chats';
import { useUI } from '@/store/ui';
import { openProjectChat } from './ProjectMenu';

/** Shows the chat from on top of whatever screens are open. */
function openChat(id: string) {
  const conversation = useChats.getState().conversations[id];
  if (!conversation || useUI.getState().currentId === id) return;
  if (router.canDismiss()) router.dismissAll();
  // A project's chats open over its page, with a back button to it.
  if (conversation.projectId) return openProjectChat(conversation.projectId, id);
  // The dismissed screens put back the main chat view as they unmount; open it after that.
  if (!useUI.getState().layers.length) return useUI.getState().open(id);
  const unsubscribe = useUI.subscribe((s) => {
    if (s.layers.length) return;
    unsubscribe();
    s.open(id);
  });
}

/** Opens the chat of a tapped reply notification (see lib/notifications). */
export function ReplyNotifications() {
  useEffect(() => {
    const notifications = Notifications;
    if (!notifications) return;
    // The launch tap can arrive both ways; each notification is handled once.
    let handled = 0;
    const handle = (response: NotificationResponse | null) => {
      if (!response || response.notification.date === handled) return;
      handled = response.notification.date;
      notifications.clearLastNotificationResponse();
      const id = response.notification.request.content.data?.conversationId;
      if (typeof id === 'string') openChat(id);
    };
    // Tapped while the app wasn't running.
    handle(notifications.getLastNotificationResponse());
    const subscription = notifications.addNotificationResponseReceivedListener(handle);
    return () => subscription.remove();
  }, []);
  return null;
}
