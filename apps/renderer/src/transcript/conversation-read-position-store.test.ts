import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  conversationReadPositionKey,
  MAX_CONVERSATION_READ_POSITIONS,
  useConversationReadPositionStore
} from "./conversation-read-position-store.js";

describe("conversation read positions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useConversationReadPositionStore.getState().reset();
  });

  it("keys positions by Workspace and physical Session identity", () => {
    expect(conversationReadPositionKey("workspace-1", "file-1"))
      .toBe("workspace-1\u0000file-1");
    expect(conversationReadPositionKey("workspace-1", undefined)).toBeUndefined();
  });

  it("keeps the anchor while counting new rows only away from the bottom", () => {
    const store = useConversationReadPositionStore.getState();
    store.observeAnchor("session", "message-10");
    store.addUnseen("session", 3);
    store.setAtBottom("session", false);
    store.addUnseen("session", 3);

    expect(useConversationReadPositionStore.getState().positions.session).toMatchObject({
      anchorKey: "message-10",
      atBottom: false,
      unseenCount: 3
    });

    store.setAtBottom("session", true);
    expect(useConversationReadPositionStore.getState().positions.session?.unseenCount).toBe(0);
  });

  it("evicts the least recently touched identity at the bounded limit", () => {
    const store = useConversationReadPositionStore.getState();
    for (let index = 0; index <= MAX_CONVERSATION_READ_POSITIONS; index += 1) {
      vi.setSystemTime(index + 1);
      store.observeAnchor(`session-${index}`, `message-${index}`);
    }

    const positions = useConversationReadPositionStore.getState().positions;
    expect(Object.keys(positions)).toHaveLength(MAX_CONVERSATION_READ_POSITIONS);
    expect(positions["session-0"]).toBeUndefined();
    expect(positions[`session-${MAX_CONVERSATION_READ_POSITIONS}`]).toBeDefined();
  });
});
