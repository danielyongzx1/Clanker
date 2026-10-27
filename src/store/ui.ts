import { create } from 'zustand';

interface UIState {
  /** Conversation shown on the chat screen; null is the "new chat" state. */
  currentId: string | null;
  open: (id: string | null) => void;
}

export const useUI = create<UIState>()((set) => ({
  currentId: null,
  open: (currentId) => set({ currentId }),
}));
