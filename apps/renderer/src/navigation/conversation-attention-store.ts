import type { WorkspaceId } from "@pi67/domain";
import { create } from "zustand";

export const MAX_CONVERSATION_ATTENTION_ITEMS = 512;

interface ConversationAttentionState {
  byConversation: Record<string, true>;
  order: string[];
  mark: (workspaceId: WorkspaceId, sessionFileIdentity: string) => void;
  clear: (workspaceId: WorkspaceId, sessionFileIdentity: string) => void;
  reset: () => void;
}

export const useConversationAttentionStore = create<ConversationAttentionState>((set, get) => ({
  byConversation: {},
  order: [],
  mark(workspaceId, sessionFileIdentity) {
    const key = conversationAttentionKey(workspaceId, sessionFileIdentity);
    if (get().byConversation[key]) return;
    set((state) => {
      const order = [...state.order, key].slice(-MAX_CONVERSATION_ATTENTION_ITEMS);
      const retained = new Set(order);
      const byConversation: Record<string, true> = {};
      for (const candidate of Object.keys(state.byConversation)) {
        if (retained.has(candidate)) byConversation[candidate] = true;
      }
      byConversation[key] = true;
      return { order, byConversation };
    });
  },
  clear(workspaceId, sessionFileIdentity) {
    const key = conversationAttentionKey(workspaceId, sessionFileIdentity);
    if (!get().byConversation[key]) return;
    set((state) => {
      const byConversation = { ...state.byConversation };
      delete byConversation[key];
      return {
        byConversation,
        order: state.order.filter((candidate) => candidate !== key)
      };
    });
  },
  reset() {
    set({ byConversation: {}, order: [] });
  }
}));

export function conversationNeedsAttention(
  state: Pick<ConversationAttentionState, "byConversation">,
  workspaceId: WorkspaceId,
  sessionFileIdentity: string
): boolean {
  return Boolean(state.byConversation[conversationAttentionKey(workspaceId, sessionFileIdentity)]);
}

export function markConversationAttention(workspaceId: WorkspaceId, sessionFileIdentity: string): void {
  useConversationAttentionStore.getState().mark(workspaceId, sessionFileIdentity);
}

export function clearConversationAttention(workspaceId: WorkspaceId, sessionFileIdentity: string): void {
  useConversationAttentionStore.getState().clear(workspaceId, sessionFileIdentity);
}

function conversationAttentionKey(workspaceId: WorkspaceId, sessionFileIdentity: string): string {
  return `${workspaceId}\0${sessionFileIdentity}`;
}
