import { beforeEach, describe, expect, it } from "vitest";
import {
  MAX_CONVERSATION_ATTENTION_ITEMS,
  conversationNeedsAttention,
  useConversationAttentionStore
} from "./conversation-attention-store.js";

describe("conversation attention store", () => {
  beforeEach(() => useConversationAttentionStore.getState().reset());

  it("marks and clears the exact physical conversation identity", () => {
    const store = useConversationAttentionStore.getState();
    store.mark("workspace-a", "session-file-a");

    expect(conversationNeedsAttention(
      useConversationAttentionStore.getState(),
      "workspace-a",
      "session-file-a"
    )).toBe(true);
    expect(conversationNeedsAttention(
      useConversationAttentionStore.getState(),
      "workspace-b",
      "session-file-a"
    )).toBe(false);

    store.clear("workspace-a", "session-file-a");
    expect(useConversationAttentionStore.getState().order).toEqual([]);
  });

  it("keeps only the newest bounded identities", () => {
    const store = useConversationAttentionStore.getState();
    for (let index = 0; index <= MAX_CONVERSATION_ATTENTION_ITEMS; index += 1) {
      store.mark("workspace-a", `session-file-${index}`);
    }

    const state = useConversationAttentionStore.getState();
    expect(state.order).toHaveLength(MAX_CONVERSATION_ATTENTION_ITEMS);
    expect(conversationNeedsAttention(state, "workspace-a", "session-file-0")).toBe(false);
    expect(conversationNeedsAttention(
      state,
      "workspace-a",
      `session-file-${MAX_CONVERSATION_ATTENTION_ITEMS}`
    )).toBe(true);
  });
});
