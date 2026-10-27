import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Endpoint } from '@/lib/providers';
import { apiKeys, jsonFileStorage } from '@/lib/storage';

export type ThemePreference = 'system' | 'light' | 'dark';

export type ModelRef = { endpointId: string; model: string };

interface SettingsState {
  endpoints: Endpoint[];
  active: ModelRef | null;
  theme: ThemePreference;
  upsertEndpoint: (endpoint: Endpoint) => void;
  removeEndpoint: (id: string) => void;
  setActive: (ref: ModelRef) => void;
  setTheme: (theme: ThemePreference) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set, get) => ({
      endpoints: [],
      active: null,
      theme: 'system',
      upsertEndpoint: (endpoint) => {
        const exists = get().endpoints.some((e) => e.id === endpoint.id);
        const endpoints = exists
          ? get().endpoints.map((e) => (e.id === endpoint.id ? endpoint : e))
          : [...get().endpoints, endpoint];
        let active = get().active;
        // Pick a model for the user if nothing usable is selected yet.
        const activeValid = active && endpoints.some((e) => e.id === active!.endpointId && e.models.includes(active!.model));
        if (!activeValid && endpoint.models.length) active = { endpointId: endpoint.id, model: endpoint.models[0] };
        set({ endpoints, active });
      },
      removeEndpoint: (id) => {
        apiKeys.remove(id);
        const endpoints = get().endpoints.filter((e) => e.id !== id);
        let active = get().active;
        if (active?.endpointId === id) {
          const next = endpoints.find((e) => e.models.length);
          active = next ? { endpointId: next.id, model: next.models[0] } : null;
        }
        set({ endpoints, active });
      },
      setActive: (active) => set({ active }),
      setTheme: (theme) => set({ theme }),
    }),
    { name: 'settings', storage: jsonFileStorage }
  )
);

export function useEndpoint(id: string | undefined) {
  return useSettings((s) => s.endpoints.find((e) => e.id === id));
}
