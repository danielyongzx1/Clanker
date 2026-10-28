import { create } from 'zustand';

interface UIState {
  /** Conversation shown on the chat screen; null is the "new chat" state. */
  currentId: string | null;
  /** Effort slider panel is up; the drawer swipe is disabled while it is. */
  effortOpen: boolean;
  open: (id: string | null) => void;
  setEffortOpen: (open: boolean) => void;
}

export const useUI = create<UIState>()((set) => ({
  currentId: null,
  effortOpen: false,
  open: (currentId) => set({ currentId, effortOpen: false }),
  setEffortOpen: (effortOpen) => set({ effortOpen }),
}));
