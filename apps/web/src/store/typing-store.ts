import { create } from "zustand";

// WhatsApp repeats "composing" while the customer keeps typing; without a new one this long, it's considered stopped.
const TYPING_TIMEOUT_MS = 10_000;
const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** Conversations whose customer is typing right now (QR Code connections only) — "digitando…" in the card and the chat. */
interface TypingState {
  typing: Record<string, true>;
  setTyping: (conversationId: string, typing: boolean) => void;
}

export const useTypingStore = create<TypingState>((set) => ({
  typing: {},
  setTyping: (conversationId, typing) => {
    clearTimeout(timers.get(conversationId));
    timers.delete(conversationId);
    if (typing) timers.set(conversationId, setTimeout(() => useTypingStore.getState().setTyping(conversationId, false), TYPING_TIMEOUT_MS));
    set((s) => {
      if (Boolean(s.typing[conversationId]) === typing) return s;
      const next = { ...s.typing };
      if (typing) next[conversationId] = true;
      else delete next[conversationId];
      return { typing: next };
    });
  },
}));
