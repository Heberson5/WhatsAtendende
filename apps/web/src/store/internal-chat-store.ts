import { create } from "zustand";

/** Chat interno: whether the side panel is open, which room is on screen, and who is typing where. */
interface InternalChatState {
  open: boolean;
  activeRoomId: string | null;
  typing: Record<string, { name: string; until: number }>;
  setOpen: (open: boolean) => void;
  setActiveRoom: (roomId: string | null) => void;
  setTyping: (roomId: string, name: string) => void;
}

const TYPING_SHOWN_MS = 4_000;

export const useInternalChatStore = create<InternalChatState>((set) => ({
  open: false,
  activeRoomId: null,
  typing: {},
  setOpen: (open) => set({ open }),
  setActiveRoom: (activeRoomId) => set({ activeRoomId }),
  setTyping: (roomId, name) => set((s) => ({ typing: { ...s.typing, [roomId]: { name, until: Date.now() + TYPING_SHOWN_MS } } })),
}));
