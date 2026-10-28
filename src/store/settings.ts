import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { defaultEffort, type Endpoint } from '@/lib/providers';
import { apiKeys, jsonFileStorage } from '@/lib/storage';

export type ThemePreference = 'system' | 'light' | 'dark';

export type ModelRef = { endpointId: string; model: string };

export type SearchProvider = 'duckduckgo' | 'brave' | 'tavily' | 'searxng';

/** Where web_search sends queries. Keys live in SecureStore under `search-<provider>`. */
export type SearchConfig = { provider: SearchProvider; /** SearXNG instance URL. */ url?: string };

// Hosted APIs whose current models all have windows of 128K tokens or more, though not every one reports it.
const LARGE_CONTEXT_HOSTS = /api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|api\.deepseek\.com|api\.mistral\.ai|api\.x\.ai/i;

const DEFAULT_BUDGET = 32_000;

const effortKey = (ref: ModelRef) => `${ref.endpointId}/${ref.model}`;

interface SettingsState {
  endpoints: Endpoint[];
  active: ModelRef | null;
  theme: ThemePreference;
  /** Chosen effort level per model, keyed by `endpointId/model`. */
  efforts: Record<string, string>;
  /** Whether models get the file, script and shell tools. */
  tools: boolean;
  /** Whether the composer shows a context usage meter while typing. */
  contextUsage: boolean;
  /** Whether models with tools also get web search and fetch. */
  web: boolean;
  search: SearchConfig;
  upsertEndpoint: (endpoint: Endpoint) => void;
  removeEndpoint: (id: string) => void;
  setActive: (ref: ModelRef) => void;
  setTheme: (theme: ThemePreference) => void;
  setEffort: (ref: ModelRef, level: string) => void;
  setTools: (on: boolean) => void;
  setContextUsage: (on: boolean) => void;
  setWeb: (on: boolean) => void;
  setSearch: (search: SearchConfig) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set, get) => ({
      endpoints: [],
      active: null,
      theme: 'system',
      efforts: {},
      tools: true,
      contextUsage: false,
      web: true,
      search: { provider: 'duckduckgo' },
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
      setContextUsage: (contextUsage) => set({ contextUsage }),
      setWeb: (web) => set({ web }),
      setSearch: (search) => set({ search }),
    }),
    {
      name: 'settings',
      storage: jsonFileStorage,
      version: 1,
      migrate: (persisted, version) => {
        const state = persisted as SettingsState & { contextBudget?: number };
        // v0 had one budget for every model whose window wasn't known; keep it on those models.
        const old = state.contextBudget;
        if (version < 1 && old && old !== DEFAULT_BUDGET) {
          state.endpoints = state.endpoints.map((e) => {
            if (LARGE_CONTEXT_HOSTS.test(e.baseUrl)) return e;
            const unknown = e.models.filter((m) => !e.contexts?.[m] && !e.budgets?.[m]);
            if (!unknown.length) return e;
            return { ...e, budgets: { ...e.budgets, ...Object.fromEntries(unknown.map((m) => [m, old])) } };
          });
        }
        delete state.contextBudget;
        return state;
      },
    }
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

/**
 * Tokens of history to aim for: the budget the user set for the model; otherwise three quarters
 * of its reported window (the rest is for the system prompt, tool definitions and the reply);
 * 96K on large-context hosted APIs that don't report one; otherwise 32K, which suits most local servers.
 */
export function resolveBudget(endpoint: Pick<Endpoint, 'baseUrl' | 'contexts' | 'budgets'>, model: string) {
  const set = endpoint.budgets?.[model];
  if (set) return set;
  const window = endpoint.contexts?.[model];
  if (window) return Math.floor(window * 0.75);
  return LARGE_CONTEXT_HOSTS.test(endpoint.baseUrl) ? 96_000 : DEFAULT_BUDGET;
}

export function useEndpoint(id: string | undefined) {
  return useSettings((s) => s.endpoints.find((e) => e.id === id));
}
