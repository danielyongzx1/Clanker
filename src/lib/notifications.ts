import { AppState, Platform } from 'react-native';
import { Notifications } from '@/lib/expoNotifications';
import { messageText, useChats } from '@/store/chats';

/**
 * A reply that finishes while the app is in the background (the user switched away, or the agent
 * is operating other apps) is announced with a notification. Tapping it opens the chat
 * (components/ReplyNotifications).
 */

const CHANNEL = 'replies';
const BODY_MAX = 200;

let ready: Promise<void> | null = null;

function setUp(Notifications: typeof import('expo-notifications')) {
  ready ??= (async () => {
    // In the foreground the chat shows the reply itself.
    Notifications.setNotificationHandler({
      handleNotification: async () => {
        const show = AppState.currentState !== 'active';
        return { shouldShowBanner: show, shouldShowList: show, shouldPlaySound: show, shouldSetBadge: false };
      },
    });
    // Android 13+ only shows the permission prompt once a channel exists.
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(CHANNEL, {
        name: 'Replies',
        description: 'When a reply finishes while Clanker is in the background',
        importance: Notifications.AndroidImportance.HIGH,
      });
    }
  })().catch(() => {});
  return ready;
}

let asked = false;

/** Asks for permission to notify, once per launch and only if never answered: on the first reply, when it's clear what for. */
export async function askToNotify() {
  if (asked || !Notifications) return;
  asked = true;
  await setUp(Notifications);
  try {
    const { status, canAskAgain } = await Notifications.getPermissionsAsync();
    if (status === 'undetermined' && canAskAgain) await Notifications.requestPermissionsAsync();
  } catch {
    // Not available in this build; replies just go unannounced.
  }
}

function preview(text: string) {
  const line = text.replace(/[*`#>]+/g, '').replace(/\s+/g, ' ').trim();
  return line.length > BODY_MAX ? `${line.slice(0, BODY_MAX).trimEnd()}…` : line;
}

/** Announces the finished reply, unless the app is on screen. */
export async function notifyReplyFinished(conversationId: string, messageId: string) {
  if (!Notifications || AppState.currentState === 'active') return;
  const conversation = useChats.getState().conversations[conversationId];
  const message = conversation?.messages.find((m) => m.id === messageId);
  if (!conversation || !message) return;
  await setUp(Notifications);
  const body =
    message.status === 'error' ? `Couldn't finish: ${message.error ?? 'something went wrong.'}` : preview(messageText(message)) || 'Done.';
  try {
    await Notifications.scheduleNotificationAsync({
      // One per chat: a newer reply replaces the one before.
      identifier: conversationId,
      content: { title: conversation.title, body, data: { conversationId } },
      trigger: Platform.OS === 'android' ? { channelId: CHANNEL } : null,
    });
  } catch {
    // Permission denied, or not available in this build.
  }
}
