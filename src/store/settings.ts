import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { defaultEffort, type Endpoint } from '@/lib/providers';
import { apiKeys, jsonFileStorage } from '@/lib/storage';

export type ThemePreference = 'system' | 'light' | 'dark';

export type ModelRef = { endpointId: string; model: string };

const effortKey = (ref: ModelRef) => `${ref.endpointId}/${ref.model}`;

interface SettingsState {
  endpoints: Endpoint[];
  active: ModelRef | null;
  theme: ThemePreference;
  /** Chosen effort level per model, keyed by `endpointId/model`. */
  efforts: Record<string, string>;
  /** Whether models get the file, script and shell tools. */
  tools: boolean;
  /** History budget in tokens for models whose context window isn't known. */
  contextBudget: number;
  upsertEndpoint: (endpoint: Endpoint) => void;
  removeEndpoint: (id: string) => void;
  setActive: (ref: ModelRef) => void;
  setTheme: (theme: ThemePreference) => void;
  setEffort: (ref: ModelRef, level: string) => void;
  setTools: (on: boolean) => void;
  setContextBudget: (tokens: number) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set, get) => ({
      endpoints: [],
      active: null,
      theme: 'system',
      efforts: {},
      tools: true,
      contextBudget: 32_000,
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
        const efforts = Object.fromEntries(Object.entries(get().efforts).filter(([k]) => !k.startsWith(`${id}/`)));
        set({ endpoints, active, efforts });
      },
      setActive: (active) => set({ active }),
      setTheme: (theme) => set({ theme }),
      setEffort: (ref, level) => set({ efforts: { ...get().efforts, [effortKey(ref)]: level } }),
      setTools: (tools) => set({ tools }),
      setContextBudget: (contextBudget) => set({ contextBudget }),
    }),
    { name: 'settings', storage: jsonFileStorage }
  )
);

/** The model's effort levels and the one to use, or null when it has no effort control. */
export function resolveEffort(state: Pick<SettingsState, 'endpoints' | 'efforts'>, ref: ModelRef | null) {
  if (!ref) return null;
  const levels = state.endpoints.find((e) => e.id === ref.endpointId)?.efforts?.[ref.model];
  if (!levels?.length) return null;
  const chosen = state.efforts[effortKey(ref)];
  return { levels, level: chosen && levels.includes(chosen) ? chosen : defaultEffort(levels) };
}

// Hosted APIs whose current models all have windows of 128K tokens or more, though not every one reports it.
const LARGE_CONTEXT_HOSTS = /api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|api\.deepseek\.com|api\.mistral\.ai|api\.x\.ai/i;

/**
 * Tokens of history to aim for: three quarters of the model's reported window (the rest is for
 * the system prompt, tool definitions and the reply); 96K on large-context hosted APIs that
 * don't report one; otherwise the user's setting, which is meant for local servers.
 */
export function resolveBudget(state: Pick<SettingsState, 'contextBudget'>, endpoint: Endpoint, model: string) {
  const window = endpoint.contexts?.[model];
  if (window) return Math.floor(window * 0.75);
  return LARGE_CONTEXT_HOSTS.test(endpoint.baseUrl) ? 96_000 : state.contextBudget;
}

export function useEndpoint(id: string | undefined) {
  return useSettings((s) => s.endpoints.find((e) => e.id === id));
}
