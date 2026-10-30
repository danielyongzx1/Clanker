import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { flushJsonStorage, jsonFileStorage } from '@/lib/storage';
import type { PromptSuggestion } from '@/lib/suggestions';
import { useSettings } from './settings';

export const SUGGESTION_INTERVAL = 24 * 60 * 60 * 1000;

type CachedSuggestions = { suggestions: PromptSuggestion[]; sourceChatIds: string[] };

interface SuggestionsState {
  lastAttemptAt: number | null;
  entries: Record<string, CachedSuggestions>;
  running: string | null;
  failed: string | null;
  refresh: (
    scope: string, sourceChatIds: string[], generate: (signal: AbortSignal) => Promise<PromptSuggestion[]>
  ) => Promise<void>;
}

let controller: AbortController | null = null;

export const useSuggestionCache = create<SuggestionsState>()(
  persist(
    (set, get) => ({
      lastAttemptAt: null,
      entries: {},
      running: null,
      failed: null,
      refresh: async (scope, sourceChatIds, generate) => {
        const now = Date.now();
        const { lastAttemptAt, running } = get();
        if (!useSettings.getState().suggestions || running ||
          (lastAttemptAt !== null && now < lastAttemptAt + SUGGESTION_INTERVAL)) return;

        const request = new AbortController();
        controller = request;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          // Reserve the single app-wide attempt before any asynchronous work. Failures count too.
          set({ lastAttemptAt: now, running: scope, failed: null });
          flushJsonStorage();
          timeout = setTimeout(() => {
            if (request.signal.aborted) return;
            request.abort();
            set({ running: null, failed: scope });
          }, 20_000);
          const suggestions = await generate(request.signal);
          if (!request.signal.aborted && useSettings.getState().suggestions) {
            set((s) => ({ entries: { ...s.entries, [scope]: { suggestions, sourceChatIds } } }));
            flushJsonStorage();
          }
        } catch {
          if (!request.signal.aborted) set({ failed: scope });
        } finally {
          clearTimeout(timeout);
          if (controller === request) {
            controller = null;
            set({ running: null });
          }
        }
      },
    }),
    {
      name: 'suggestions',
      storage: jsonFileStorage,
      partialize: (s) => ({ lastAttemptAt: s.lastAttemptAt, entries: s.entries }),
    }
  )
);

// Disabling suggestions or changing memory cancels the request without resetting the daily limit.
useSettings.subscribe((state, previous) => {
  if ((previous.suggestions && !state.suggestions) || state.memory !== previous.memory) {
    controller?.abort();
    controller = null;
    useSuggestionCache.setState({ running: null, failed: null });
  }
});
