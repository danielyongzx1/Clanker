import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { deleteAttachment } from '@/lib/attachments';
import type { ContentPart, Role } from '@/lib/providers';
import { jsonFileStorage, uid } from '@/lib/storage';

export type MessageStatus = 'streaming' | 'done' | 'error';

export interface Message {
  id: string;
  role: Role;
  content: ContentPart[];
  createdAt: number;
  status: MessageStatus;
  error?: string;
  model?: string;
  /** Streamed thinking/reasoning text, when the provider surfaces it. Not sent back to the model. */
  reasoning?: string;
  /** How long the model spent thinking before answering, in ms; set only when reasoning streamed. */
  thoughtMs?: number;
}

export interface Conversation {
  id: string;
  title: string;
  /** True once a model-generated (or user-set) title replaced the placeholder. */
  titled: boolean;
  createdAt: number;
  updatedAt: number;
  endpointId: string;
  model: string;
  messages: Message[];
}

interface ChatsState {
  conversations: Record<string, Conversation>;
  create: (endpointId: string, model: string) => string;
  remove: (id: string) => void;
  rename: (id: string, title: string, titled?: boolean) => void;
  setModel: (id: string, endpointId: string, model: string) => void;
  addMessage: (id: string, message: Omit<Message, 'id' | 'createdAt'>) => string;
  updateMessage: (id: string, messageId: string, patch: Partial<Message>) => void;
  appendText: (id: string, messageId: string, text: string) => void;
  appendReasoning: (id: string, messageId: string, text: string) => void;
  /** Removes the message with `messageId` and everything after it. */
  truncateFrom: (id: string, messageId: string) => void;
}

function imagesOf(messages: Message[]) {
  return messages.flatMap((m) =>
    m.content.flatMap((p) => ((p.type === 'image' || p.type === 'file') && p.file ? [p.file] : []))
  );
}

export const useChats = create<ChatsState>()(
  persist(
    (set, get) => {
      const patchConversation = (id: string, fn: (c: Conversation) => Partial<Conversation>) =>
        set((s) => {
          const c = s.conversations[id];
          if (!c) return s;
          return { conversations: { ...s.conversations, [id]: { ...c, ...fn(c) } } };
        });

      const patchMessage = (id: string, messageId: string, fn: (m: Message) => Partial<Message>) =>
        patchConversation(id, (c) => ({
          messages: c.messages.map((m) => (m.id === messageId ? { ...m, ...fn(m) } : m)),
        }));

      return {
        conversations: {},
        create: (endpointId, model) => {
          const id = uid();
          const now = Date.now();
          set((s) => ({
            conversations: {
              ...s.conversations,
              [id]: { id, title: 'New chat', titled: false, createdAt: now, updatedAt: now, endpointId, model, messages: [] },
            },
          }));
          return id;
        },
        remove: (id) => {
          const c = get().conversations[id];
          if (!c) return;
          imagesOf(c.messages).forEach(deleteAttachment);
          set((s) => {
            const { [id]: _, ...rest } = s.conversations;
            return { conversations: rest };
          });
        },
        rename: (id, title, titled = true) => patchConversation(id, () => ({ title, titled })),
        setModel: (id, endpointId, model) => patchConversation(id, () => ({ endpointId, model })),
        addMessage: (id, message) => {
          const messageId = uid();
          const now = Date.now();
          patchConversation(id, (c) => ({
            updatedAt: now,
            messages: [...c.messages, { ...message, id: messageId, createdAt: now }],
          }));
          return messageId;
        },
        updateMessage: (id, messageId, patch) => patchMessage(id, messageId, () => patch),
        appendText: (id, messageId, text) =>
          patchMessage(id, messageId, (m) => {
            const last = m.content[m.content.length - 1];
            return last?.type === 'text'
              ? { content: [...m.content.slice(0, -1), { type: 'text', text: last.text + text }] }
              : { content: [...m.content, { type: 'text', text }] };
          }),
        appendReasoning: (id, messageId, text) =>
          patchMessage(id, messageId, (m) => ({ reasoning: (m.reasoning ?? '') + text })),
        truncateFrom: (id, messageId) =>
          patchConversation(id, (c) => {
            const index = c.messages.findIndex((m) => m.id === messageId);
            if (index < 0) return {};
            // Images in the dropped messages are kept: regenerate only drops assistant replies.
            return { messages: c.messages.slice(0, index) };
          }),
      };
    },
    {
      name: 'chats',
      storage: jsonFileStorage,
      partialize: (s) => ({ conversations: s.conversations }),
      // A reply that was streaming when the app was killed can never finish.
      merge: (persisted, current) => {
        const conversations = (persisted as Pick<ChatsState, 'conversations'>)?.conversations ?? {};
        for (const c of Object.values(conversations)) {
          c.messages = c.messages.map((m) => (m.status === 'streaming' ? { ...m, status: 'done' } : m));
        }
        return { ...current, conversations };
      },
    }
  )
);

export function messageText(message: Pick<Message, 'content'>) {
  return message.content.map((p) => (p.type === 'text' ? p.text : '')).join('');
}
