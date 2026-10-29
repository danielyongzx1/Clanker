import { create } from 'zustand';
import { uid } from '@/lib/storage';

/** Which chat is on screen, or what the chat about to be started will be. */
type ChatView = {
  /** Conversation shown on the chat screen; null is the "new chat" state. */
  currentId: string | null;
  /** Memory is turned off for the chat about to be started (a temporary chat). */
  newChatMemoryOff: boolean;
  /** The project the chat about to be started goes in, if any. */
  newChatProjectId: string | null;
};

interface UIState extends ChatView {
  /** Effort slider panel is up; the drawer swipe is disabled while it is. */
  effortOpen: boolean;
  /**
   * Screens pushed over the main chat screen (a project page, a project's chat) each show their
   * own chat view. Each layer keeps the view beneath it, put back when the layer is popped.
   */
  layers: { token: string; beneath: ChatView }[];
  open: (id: string | null) => void;
  /** Shows the "new chat" state for a chat in the project. */
  openNewInProject: (projectId: string) => void;
  setEffortOpen: (open: boolean) => void;
  setNewChatMemoryOff: (off: boolean) => void;
  /** Shows `view` until the returned token is popped. */
  pushLayer: (view: ChatView) => string;
  /** Takes a layer away, in any order: an inner layer's view beneath passes to the one above it. */
  popLayer: (token: string) => void;
}

const viewOf = ({ currentId, newChatMemoryOff, newChatProjectId }: ChatView): ChatView => ({
  currentId,
  newChatMemoryOff,
  newChatProjectId,
});

export const useUI = create<UIState>()((set, get) => ({
  currentId: null,
  effortOpen: false,
  newChatMemoryOff: false,
  newChatProjectId: null,
  layers: [],
  open: (currentId) => set({ currentId, effortOpen: false, newChatMemoryOff: false, newChatProjectId: null }),
  openNewInProject: (newChatProjectId) =>
    set({ currentId: null, effortOpen: false, newChatMemoryOff: false, newChatProjectId }),
  setEffortOpen: (effortOpen) => set({ effortOpen }),
  setNewChatMemoryOff: (newChatMemoryOff) => set({ newChatMemoryOff }),
  pushLayer: (view) => {
    const token = uid();
    set((s) => ({ ...view, effortOpen: false, layers: [...s.layers, { token, beneath: viewOf(s) }] }));
    return token;
  },
  popLayer: (token) => {
    const { layers } = get();
    const index = layers.findIndex((l) => l.token === token);
    if (index < 0) return;
    if (index === layers.length - 1) {
      set({ ...layers[index].beneath, effortOpen: false, layers: layers.slice(0, -1) });
      return;
    }
    // Popped from under another layer: that one will now restore what this one would have.
    const next = layers.map((l, i) => (i === index + 1 ? { ...l, beneath: layers[index].beneath } : l));
    set({ layers: next.filter((_, i) => i !== index) });
  },
}));
