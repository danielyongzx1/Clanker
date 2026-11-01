import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { RemoteBackend } from '@/lib/remote/types';
import { apiKeys, jsonFileStorage } from '@/lib/storage';

interface BackendsState {
  remotes: RemoteBackend[];
  selected: string;
  select: (id: string) => void;
  save: (backend: RemoteBackend) => void;
  remove: (id: string) => void;
}

export const useBackends = create<BackendsState>()(persist((set) => ({
  remotes: [],
  selected: 'local',
  select: (selected) => set({ selected }),
  // Updated in place: selecting a backend refreshes its models, which mustn't reorder the list.
  save: (backend) =>
    set((s) => ({
      remotes: s.remotes.some((b) => b.id === backend.id)
        ? s.remotes.map((b) => (b.id === backend.id ? backend : b))
        : [...s.remotes, backend],
    })),
  remove: (id) => {
    void apiKeys.remove(`bridge_${id}`);
    set((s) => ({ remotes: s.remotes.filter((b) => b.id !== id), selected: s.selected === id ? 'local' : s.selected }));
  },
}), { name: 'backends', storage: jsonFileStorage }));
