import { create } from "zustand";

interface ConversationSnoozeClockState {
  now: number;
  revision: number;
  refresh: (now?: number) => void;
}

export const useConversationSnoozeClock = create<ConversationSnoozeClockState>((set) => ({
  now: Date.now(),
  revision: 0,
  refresh(now = Date.now()) {
    set((state) => ({ now, revision: state.revision + 1 }));
  }
}));

export function refreshConversationSnoozeClock(now = Date.now()): void {
  useConversationSnoozeClock.getState().refresh(now);
}
