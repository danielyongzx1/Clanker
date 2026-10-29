import { create } from 'zustand';

interface UIState {
  /** Conversation shown on the chat screen; null is the "new chat" state. */
  currentId: string | null;
  /** Effort slider panel is up; the drawer swipe is disabled while it is. */
  effortOpen: boolean;
  /** Memory is turned off for the chat about to be started (a temporary chat). */
  newChatMemoryOff: boolean;
  open: (id: string | null) => void;
  setEffortOpen: (open: boolean) => void;
  setNewChatMemoryOff: (off: boolean) => void;
}

export const useUI = create<UIState>()((set) => ({
  currentId: null,
  effortOpen: false,
  newChatMemoryOff: false,
  open: (currentId) => set({ currentId, effortOpen: false, newChatMemoryOff: false }),
  setEffortOpen: (effortOpen) => set({ effortOpen }),
  setNewChatMemoryOff: (newChatMemoryOff) => set({ newChatMemoryOff }),
}));
