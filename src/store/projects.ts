import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { jsonFileStorage, uid } from '@/lib/storage';

/**
 * How a project's chats share memory. "default": they use and save the same memories as every
 * other chat. "project": they only see the project's own memories, which outside chats can't see,
 * and they can only look up other chats in the project.
 */
export type ProjectMemory = 'default' | 'project';

/** A group of chats that share a workspace, sources, instructions and (optionally) memory. */
export interface Project {
  id: string;
  name: string;
  /** Custom instructions added to the system prompt of every chat in the project. */
  instructions: string;
  memory: ProjectMemory;
  /** When it was pinned to the sidebar; unset when it isn't. */
  pinnedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export const MAX_INSTRUCTIONS_CHARS = 8000;

interface ProjectsState {
  projects: Record<string, Project>;
  create: (name: string, memory?: ProjectMemory) => string;
  update: (id: string, patch: Partial<Pick<Project, 'name' | 'instructions' | 'memory'>>) => void;
  setPinned: (id: string, pinned: boolean) => void;
  /** Forgets the project; lib/projects deleteProject also clears its chats, files and memories. */
  remove: (id: string) => void;
}

export const useProjects = create<ProjectsState>()(
  persist(
    (set, get) => {
      const patch = (id: string, fn: (p: Project) => Partial<Project>) =>
        set((s) => {
          const p = s.projects[id];
          return p ? { projects: { ...s.projects, [id]: { ...p, ...fn(p) } } } : s;
        });

      return {
        projects: {},
        create: (name, memory = 'default') => {
          const id = uid();
          const now = Date.now();
          set((s) => ({
            projects: { ...s.projects, [id]: { id, name, instructions: '', memory, createdAt: now, updatedAt: now } },
          }));
          return id;
        },
        update: (id, changes) => patch(id, () => ({ ...changes, updatedAt: Date.now() })),
        setPinned: (id, pinned) => patch(id, () => ({ pinnedAt: pinned ? Date.now() : undefined })),
        remove: (id) => {
          if (!get().projects[id]) return;
          set((s) => {
            const { [id]: _, ...rest } = s.projects;
            return { projects: rest };
          });
        },
      };
    },
    { name: 'projects', storage: jsonFileStorage, partialize: (s) => ({ projects: s.projects }) }
  )
);
