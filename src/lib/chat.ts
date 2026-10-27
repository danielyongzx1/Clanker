import { messageText, useChats, type Message } from '@/store/chats';
import { useSettings } from '@/store/settings';
import { readAttachmentBase64 } from './attachments';
import { getAdapter, type Endpoint, type ImagePart, type WireMessage } from './providers';
import { apiKeys } from './storage';

const controllers = new Map<string, AbortController>();

// Batch tokens so the store (and the markdown re-render) updates at most ~25 times a second.
const FLUSH_MS = 40;

async function toWire(message: Message): Promise<WireMessage> {
  const images: WireMessage['images'] = [];
  for (const part of message.content) {
    if (part.type !== 'image') continue;
    try {
      images.push({ base64: await readAttachmentBase64(part.file), mimeType: part.mimeType });
    } catch {
      // The attachment file is gone; send the text alone rather than failing the request.
    }
  }
  return { role: message.role, text: messageText(message), images };
}

function fallbackTitle(text: string) {
  const line = text.trim().split('\n')[0];
  return line ? (line.length > 40 ? line.slice(0, 40).trimEnd() + '…' : line) : 'Image';
}

/** Starts a new conversation (when `conversationId` is null) or continues one, and streams the reply. */
export function sendMessage(conversationId: string | null, text: string, images: ImagePart[]) {
  const { active } = useSettings.getState();
  if (!active) throw new Error('Add an endpoint in Settings to start chatting.');
  const chats = useChats.getState();

  const id = conversationId ?? chats.create(active.endpointId, active.model);
  chats.setModel(id, active.endpointId, active.model);
  chats.addMessage(id, {
    role: 'user',
    content: [...images, ...(text ? [{ type: 'text' as const, text }] : [])],
    status: 'done',
  });
  if (!conversationId) chats.rename(id, fallbackTitle(text), false);

  void runCompletion(id);
  return id;
}

/** Drops `messageId` (an assistant reply) and everything after it, then asks the model again. */
export function regenerate(conversationId: string, messageId: string) {
  const { active } = useSettings.getState();
  const chats = useChats.getState();
  if (active) chats.setModel(conversationId, active.endpointId, active.model);
  chats.truncateFrom(conversationId, messageId);
  void runCompletion(conversationId);
}

export function stopStreaming(conversationId: string) {
  controllers.get(conversationId)?.abort();
}

async function runCompletion(id: string) {
  const chats = useChats.getState();
  const conversation = chats.conversations[id];
  if (!conversation) return;
  const endpoint = useSettings.getState().endpoints.find((e) => e.id === conversation.endpointId);

  const history = conversation.messages.filter((m) => m.status === 'done');
  const replyId = chats.addMessage(id, {
    role: 'assistant',
    content: [],
    status: 'streaming',
    model: conversation.model,
  });

  if (!endpoint) {
    chats.updateMessage(id, replyId, { status: 'error', error: 'This endpoint no longer exists. Pick another model.' });
    return;
  }

  const controller = new AbortController();
  controllers.set(id, controller);
  let buffer = '';
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    timer = null;
    if (buffer) useChats.getState().appendText(id, replyId, buffer);
    buffer = '';
  };

  let apiKey: string | undefined;
  try {
    apiKey = (await apiKeys.get(endpoint.id)) ?? undefined;
    await getAdapter(endpoint.type).stream({
      endpoint,
      apiKey,
      model: conversation.model,
      messages: await Promise.all(history.map(toWire)),
      signal: controller.signal,
      onToken: (token) => {
        buffer += token;
        timer ??= setTimeout(flush, FLUSH_MS);
      },
    });
    flush();
    useChats.getState().updateMessage(id, replyId, { status: 'done' });
  } catch (e) {
    flush();
    if (controller.signal.aborted) {
      useChats.getState().updateMessage(id, replyId, { status: 'done' });
    } else {
      const error = e instanceof Error ? e.message : String(e);
      useChats.getState().updateMessage(id, replyId, { status: 'error', error });
      return;
    }
  } finally {
    if (timer) clearTimeout(timer);
    controllers.delete(id);
  }

  const latest = useChats.getState().conversations[id];
  if (latest && !latest.titled) void generateTitle(id, endpoint, apiKey, conversation.model);
}

async function generateTitle(id: string, endpoint: Endpoint, apiKey: string | undefined, model: string) {
  const conversation = useChats.getState().conversations[id];
  const firstUser = conversation?.messages.find((m) => m.role === 'user');
  if (!firstUser) return;
  const userText = messageText(firstUser).slice(0, 1500) || '(the user sent an image)';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  let title = '';
  try {
    await getAdapter(endpoint.type).stream({
      endpoint,
      apiKey,
      model,
      signal: controller.signal,
      messages: [
        {
          role: 'user',
          images: [],
          text:
            'Write a short title (2-6 words) for a conversation that starts with the message below. ' +
            'Reply with the title only: no quotes, no punctuation at the end.\n\n' +
            `Message: ${userText}`,
        },
      ],
      onToken: (t) => (title += t),
    });
  } catch {
    return;
  } finally {
    clearTimeout(timeout);
  }

  title = title
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .trim()
    .split('\n')[0]
    .replace(/^(title:\s*)/i, '')
    .replace(/^["'*#\s]+|["'*.\s]+$/g, '')
    .slice(0, 60);
  const current = useChats.getState().conversations[id];
  if (title && current && !current.titled) useChats.getState().rename(id, title);
}
