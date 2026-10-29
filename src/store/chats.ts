import { useMemo } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import { deleteAttachment } from '@/lib/attachments';
import type { ContentPart, Role, ToolPart } from '@/lib/providers';
import { jsonFileStorage, uid } from '@/lib/storage';
import { chatWorkspace } from '@/lib/workspace';
import type { Memory } from './memory';

export type MessageStatus = 'streaming' | 'done' | 'error';

export interface Message {
  id: string;
  role: Role;
  content: ContentPart[];
  createdAt: number;
  status: MessageStatus;
  error?: string;
  model?: string;
  /** Thinking from replies saved before thoughts became `thought` content parts. */
  reasoning?: string;
  /** How long the legacy `reasoning` took, in ms. */
  thoughtMs?: number;
  /** Memories the after-reply pass saved or changed from this reply. */
  memorySaved?: string[];
}

/**
 * A range of the history the model replaced with its own summary, to save context. `start` and
 * `end` are history unit keys (see lib/context). The originals stay in `messages`; only what is
 * sent to the model changes. A block that swallowed earlier blocks keeps them as `children`.
 */
export interface CompressionBlock {
  id: string;
  start: string;
  end: string;
  summary: string;
  createdAt: number;
  /** Made by the app when the context ran over budget, not by the model. */
  auto?: boolean;
  children?: CompressionBlock[];
}

/**
 * The volatile state (time, history size, workspace, jobs) sent after a history unit when it was
 * the latest one. Kept and resent as it was, so earlier history never changes and prompts cache.
 */
export interface ContextNote {
  text: string;
  /** The workspace listing, when the note shows it (only when it changed since the last one). */
  workspace?: string;
  /** Memory changes since the chat began, when the note shows them (only when they changed). */
  memory?: string;
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
  /** Top-level compression blocks, in history order. */
  compressions?: CompressionBlock[];
  /**
   * Workspace files the model has seen, as path → "mtime:size" when it last read or wrote them.
   * write_file and edit_file refuse files that are missing here or changed since.
   */
  observed?: Record<string, string>;
  /** Context notes by history unit key (see lib/context). */
  notes?: Record<string, ContextNote>;
  /** False for a temporary chat, which neither uses nor saves memories. */
  memory?: false;
  /**
   * The memories as they were at the chat's first request. They go in its system prompt, which
   * must not change; later changes reach the model through context notes.
   */
  memoryBase?: Memory[];
  /** The project the chat belongs to; it works in the project's workspace. */
  projectId?: string;
  /** Set on chats from before workspaces were per chat: they keep the one they all shared. */
  workspace?: 'shared';
  /** When it was pinned to the top of the chat lists; unset when it isn't. */
  pinnedAt?: number;
  /** When it was archived: hidden from the chat lists unless Settings shows archived chats. */
  archivedAt?: number;
}

interface ChatsState {
  conversations: Record<string, Conversation>;
  create: (endpointId: string, model: string, opts?: { memory?: false; projectId?: string }) => string;
  remove: (id: string) => void;
  rename: (id: string, title: string, titled?: boolean) => void;
  setModel: (id: string, endpointId: string, model: string) => void;
  setPinned: (id: string, pinned: boolean) => void;
  /** Archiving also unpins. */
  setArchived: (id: string, archived: boolean) => void;
  /**
   * Puts the chat in a project (undefined: in none, with a workspace of its own). Only the record:
   * lib/projects moveChatToProject also brings its files. What the model has seen and the
   * memories its prompt shows start over, since its files and memory pool can change.
   */
  moveTo: (id: string, projectId: string | undefined) => void;
  addMessage: (id: string, message: Omit<Message, 'id' | 'createdAt'>) => string;
  updateMessage: (id: string, messageId: string, patch: Partial<Message>) => void;
  appendText: (id: string, messageId: string, text: string) => void;
  /** Extends the thought part at the end of the reply, or starts a new one after other parts. */
  appendReasoning: (id: string, messageId: string, text: string) => void;
  /** Records how long the reply's latest thought part took. */
  finishThought: (id: string, messageId: string, ms: number) => void;
  patchTool: (id: string, messageId: string, toolId: string, patch: Partial<ToolPart>) => void;
  /** Updates tool calls still being written in place, by id, and appends the ones that are new. */
  putDrafts: (id: string, messageId: string, drafts: ToolPart[]) => void;
  /** Replaces the calls still being written with `parts`, where the first of them was. */
  settleDrafts: (id: string, messageId: string, parts: ContentPart[]) => void;
  setCompressions: (id: string, blocks: CompressionBlock[]) => void;
  setNote: (id: string, key: string, note: ContextNote) => void;
  setMemoryBase: (id: string, memories: Memory[]) => void;
  /** Records file signatures as seen by the model; null forgets a path. */
  observe: (id: string, entries: Record<string, string | null>) => void;
  /** Removes the message with `messageId` and everything after it. */
  truncateFrom: (id: string, messageId: string) => void;
}

/** A tool call the model is still writing. */
function isDraft(part: ContentPart): boolean {
  return part.type === 'tool' && part.status === 'writing';
}

function imagesOf(messages: Message[]) {
  return messages.flatMap((m) =>
    m.content.flatMap((p) =>
      p.type === 'tool'
        ? (p.images ?? []).map((img) => img.file)
        : (p.type === 'image' || p.type === 'file') && p.file
          ? [p.file]
          : []
    )
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
        create: (endpointId, model, opts) => {
          const id = uid();
          const now = Date.now();
          set((s) => ({
            conversations: {
              ...s.conversations,
              [id]: {
                id,
                title: 'New chat',
                titled: false,
                createdAt: now,
                updatedAt: now,
                endpointId,
                model,
                messages: [],
                ...(opts?.memory === false ? { memory: false as const } : {}),
                ...(opts?.projectId ? { projectId: opts.projectId } : {}),
              },
            },
          }));
          return id;
        },
        remove: (id) => {
          const c = get().conversations[id];
          if (!c) return;
          imagesOf(c.messages).forEach(deleteAttachment);
          if (!c.projectId && !c.workspace) {
            try {
              chatWorkspace(id).remove();
            } catch {
              // The files stay behind; Settings → Workspace files can still delete them.
            }
          }
          set((s) => {
            const { [id]: _, ...rest } = s.conversations;
            return { conversations: rest };
          });
        },
        rename: (id, title, titled = true) => patchConversation(id, () => ({ title, titled })),
        setModel: (id, endpointId, model) => patchConversation(id, () => ({ endpointId, model })),
        setPinned: (id, pinned) => patchConversation(id, () => ({ pinnedAt: pinned ? Date.now() : undefined })),
        setArchived: (id, archived) =>
          patchConversation(id, (c) => ({
            archivedAt: archived ? Date.now() : undefined,
            pinnedAt: archived ? undefined : c.pinnedAt,
          })),
        moveTo: (id, projectId) =>
          patchConversation(id, () => ({ projectId, workspace: undefined, observed: undefined, memoryBase: undefined })),
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
              ? { content: [...m.content.slice(0, -1), { ...last, text: last.text + text }] }
              : { content: [...m.content, { type: 'text', text, at: Date.now() }] };
          }),
        appendReasoning: (id, messageId, text) =>
          patchMessage(id, messageId, (m) => {
            const last = m.content[m.content.length - 1];
            return last?.type === 'thought'
              ? { content: [...m.content.slice(0, -1), { ...last, text: last.text + text }] }
              : { content: [...m.content, { type: 'thought', text }] };
          }),
        finishThought: (id, messageId, ms) =>
          patchMessage(id, messageId, (m) => {
            const index = m.content.findLastIndex((p) => p.type === 'thought');
            if (index < 0) return {};
            return { content: m.content.map((p, i) => (i === index ? { ...p, ms } : p)) };
          }),
        patchTool: (id, messageId, toolId, patch) =>
          patchMessage(id, messageId, (m) => ({
            content: m.content.map((p) => (p.type === 'tool' && p.id === toolId ? { ...p, ...patch } : p)),
          })),
        putDrafts: (id, messageId, drafts) =>
          patchMessage(id, messageId, (m) => {
            const byId = new Map(drafts.map((d) => [d.id, d]));
            const content = m.content.map((p) => {
              const draft = p.type === 'tool' && isDraft(p) && byId.get(p.id);
              if (!draft) return p;
              byId.delete(draft.id);
              return draft;
            });
            return { content: [...content, ...byId.values()] };
          }),
        settleDrafts: (id, messageId, parts) =>
          patchMessage(id, messageId, (m) => {
            const first = m.content.findIndex(isDraft);
            if (first < 0) return { content: [...m.content, ...parts] };
            const before = m.content.slice(0, first);
            const after = m.content.slice(first).filter((p) => !isDraft(p));
            return { content: [...before, ...parts, ...after] };
          }),
        setCompressions: (id, compressions) => patchConversation(id, () => ({ compressions })),
        setNote: (id, key, note) => patchConversation(id, (c) => ({ notes: { ...c.notes, [key]: note } })),
        setMemoryBase: (id, memoryBase) => patchConversation(id, () => ({ memoryBase })),
        observe: (id, entries) =>
          patchConversation(id, (c) => {
            const observed = { ...c.observed };
            for (const [path, sig] of Object.entries(entries)) {
              if (sig == null) delete observed[path];
              else observed[path] = sig;
            }
            return { observed };
          }),
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
      version: 1,
      // v0 chats all worked in one shared workspace; they keep it, while new chats get their own.
      migrate: (persisted, version) => {
        const state = persisted as Pick<ChatsState, 'conversations'>;
        if (version < 1) for (const c of Object.values(state?.conversations ?? {})) c.workspace = 'shared';
        return state;
      },
      // A reply, tool call or background job that was running when the app was killed can never finish.
      merge: (persisted, current) => {
        const conversations = (persisted as Pick<ChatsState, 'conversations'>)?.conversations ?? {};
        for (const c of Object.values(conversations)) {
          c.messages = c.messages.map((m) => {
            const content = m.content.map((p) =>
              p.type === 'tool' && p.background?.status === 'running' ? { ...p, background: { ...p.background, status: 'lost' as const } } : p
            );
            return m.status === 'streaming' ? { ...m, status: 'done', content: interruptContent(content) } : { ...m, content };
          });
        }
        return { ...current, conversations };
      },
    }
  )
);

/**
 * Settles a reply that stopped partway, so the history stays valid for the API: tool calls that
 * never got a result are marked failed, and calls the model never finished writing are dropped.
 */
export function interruptContent(content: ContentPart[]): ContentPart[] {
  return content
    .filter((p) => !isDraft(p))
    .map((p) =>
      p.type === 'tool' && p.status === 'running'
        ? { ...p, status: 'error', output: p.output ?? 'Interrupted before it finished.' }
        : p
    );
}

export function messageText(message: Pick<Message, 'content'>) {
  return message.content.map((p) => (p.type === 'text' ? p.text : '')).join('');
}

/**
 * Every conversation, for lists of chats. It changes when a chat comes or goes or what lists show
 * of it does (title, times, pins, project, message count), not with every token a reply streams.
 */
export function useChatList(): Record<string, Conversation> {
  const signature = useChats(
    useShallow((s) =>
      Object.values(s.conversations).flatMap((c) => [
        c.id,
        c.title,
        c.updatedAt,
        c.pinnedAt,
        c.archivedAt,
        c.projectId,
        c.messages.length,
      ])
    )
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => useChats.getState().conversations, [signature]);
}
