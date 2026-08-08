import { create } from "zustand";

export const MAX_CONVERSATION_READ_POSITIONS = 512;

export interface ConversationReadPosition {
  anchorKey?: string;
  atBottom: boolean;
  unseenCount: number;
  touchedAt: number;
}

interface ConversationReadPositionState {
  positions: Record<string, ConversationReadPosition>;
  observeAnchor: (key: string, anchorKey: string) => void;
  setAtBottom: (key: string, atBottom: boolean) => void;
  addUnseen: (key: string, count: number) => void;
  reset: () => void;
}

export const useConversationReadPositionStore = create<ConversationReadPositionState>((set) => ({
  positions: {},
  observeAnchor(key, anchorKey) {
    if (!key || !anchorKey) return;
    set((state) => withPosition(state, key, (current) => ({ ...current, anchorKey })));
  },
  setAtBottom(key, atBottom) {
    if (!key) return;
    set((state) => withPosition(state, key, (current) => ({
      ...current,
      atBottom,
      unseenCount: atBottom ? 0 : current.unseenCount
    })));
  },
  addUnseen(key, count) {
    if (!key || count <= 0) return;
    set((state) => withPosition(state, key, (current) => current.atBottom ? current : ({
      ...current,
      unseenCount: Math.min(999, current.unseenCount + Math.floor(count))
    })));
  },
  reset() { set({ positions: {} }); }
}));

export function conversationReadPositionKey(
  workspaceId: string | undefined,
  sessionFileIdentity: string | undefined
): string | undefined {
  return workspaceId && sessionFileIdentity
    ? `${workspaceId}\u0000${sessionFileIdentity}`
    : undefined;
}

function withPosition(
  state: ConversationReadPositionState,
  key: string,
  update: (position: ConversationReadPosition) => ConversationReadPosition
): Pick<ConversationReadPositionState, "positions"> {
  const now = Date.now();
  const current = state.positions[key] ?? { atBottom: true, unseenCount: 0, touchedAt: now };
  const positions = { ...state.positions, [key]: { ...update(current), touchedAt: now } };
  const keys = Object.keys(positions);
  if (keys.length <= MAX_CONVERSATION_READ_POSITIONS) return { positions };
  keys.sort((left, right) => positions[left]!.touchedAt - positions[right]!.touchedAt);
  for (const staleKey of keys.slice(0, keys.length - MAX_CONVERSATION_READ_POSITIONS)) {
    delete positions[staleKey];
  }
  return { positions };
}
