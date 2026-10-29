import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { jsonFileStorage, uid } from '@/lib/storage';

/** A fact about the user, kept across chats and sent with each one. */
export interface Memory {
  id: string;
  text: string;
  createdAt: number;
  updatedAt: number;
  /** Who saved it: the model with a tool, the after-reply pass, or the user in Settings. */
  source: 'model' | 'auto' | 'user';
  /** The chat it was saved from. */
  conversationId?: string;
  /** Set on the memories of a project with project-only memory; only its chats see them. */
  projectId?: string;
}

export const MAX_MEMORY_CHARS = 500;
// All memories together; they go into every chat's system prompt, so this bounds its size.
export const MAX_TOTAL_CHARS = 12_000;

export class MemoryError extends Error {}

const normalize = (text: string) => text.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Whether a memory belongs to a pool: the shared one (no project) or a project-only project's.
 * Pools are separate in every way: what chats see, duplicates and the size limit.
 */
export const inPool = (m: Memory, projectId: string | undefined) => m.projectId === projectId;

export function poolOf(memories: Memory[], projectId: string | undefined) {
  return memories.filter((m) => inPool(m, projectId));
}

function checked(text: string) {
  const t = text.trim().replace(/\s+/g, ' ');
  if (!t) throw new MemoryError('A memory needs some text.');
  if (t.length > MAX_MEMORY_CHARS) {
    throw new MemoryError(`A memory can be at most ${MAX_MEMORY_CHARS} characters (this one is ${t.length}). Keep it to one fact.`);
  }
  return t;
}

function checkTotal(memories: Memory[], projectId: string | undefined) {
  const total = poolOf(memories, projectId).reduce((n, m) => n + m.text.length, 0);
  if (total > MAX_TOTAL_CHARS) {
    throw new MemoryError(
      `Memory is full (${MAX_TOTAL_CHARS} characters in all). Merge related memories with memory_update, or forget ones that no longer matter, first.`
    );
  }
}

interface MemoryState {
  memories: Memory[];
  /**
   * Saves a memory to the shared pool, or to a project's when given `projectId`, and returns its
   * id. Throws a MemoryError for duplicates and over-long text.
   */
  add: (text: string, source: Memory['source'], conversationId?: string, projectId?: string) => string;
  update: (id: string, text: string) => void;
  remove: (id: string) => void;
  /** Deletes every memory in a pool (the shared one without `projectId`). */
  clear: (projectId?: string) => void;
}

export const useMemory = create<MemoryState>()(
  persist(
    (set, get) => ({
      memories: [],
      add: (text, source, conversationId, projectId) => {
        const t = checked(text);
        const same = poolOf(get().memories, projectId).find((m) => normalize(m.text) === normalize(t));
        if (same) throw new MemoryError(`That is already saved as memory ${same.id}.`);
        const now = Date.now();
        const memory: Memory = {
          id: uid(),
          text: t,
          createdAt: now,
          updatedAt: now,
          source,
          ...(conversationId ? { conversationId } : {}),
          ...(projectId ? { projectId } : {}),
        };
        const memories = [...get().memories, memory];
        checkTotal(memories, projectId);
        set({ memories });
        return memory.id;
      },
      update: (id, text) => {
        const t = checked(text);
        const old = get().memories.find((m) => m.id === id);
        if (!old) throw new MemoryError(`No memory "${id}".`);
        const memories = get().memories.map((m) => (m.id === id ? { ...m, text: t, updatedAt: Date.now() } : m));
        checkTotal(memories, old.projectId);
        set({ memories });
      },
      remove: (id) => {
        if (!get().memories.some((m) => m.id === id)) throw new MemoryError(`No memory "${id}".`);
        set({ memories: get().memories.filter((m) => m.id !== id) });
      },
      clear: (projectId) => set({ memories: get().memories.filter((m) => !inPool(m, projectId)) }),
    }),
    { name: 'memory', storage: jsonFileStorage, partialize: (s) => ({ memories: s.memories }) }
  )
);
