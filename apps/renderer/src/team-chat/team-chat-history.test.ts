import type { TeamChatMessage } from "@pi67/domain";
import { describe, expect, it, vi } from "vitest";
import { conversation, directory, flush, harness, message } from "./team-chat-controller-test-support.js";

describe("team chat history", () => {
  it("opens the inbox and opens a message by paging back to it", async () => {
    const pages: Record<string, { messages: TeamChatMessage[]; hasMore: boolean }> = {
      latest: { messages: [message(5), message(6)], hasMore: true },
      5: { messages: [message(3), message(4)], hasMore: true },
      3: { messages: [message(1), message(2)], hasMore: false }
    };
    const { controller, connect } = harness({
      "teamChat.connection.get": () => ({ status: "connecting" }),
      "teamChat.directory.get": () => directory,
      "teamChat.activity.list": () => ({ items: [] }),
      "teamChat.messages.list": (payload: { before?: number }) => pages[payload.before === undefined ? "latest" : String(payload.before)],
      "teamChat.read.mark": () => ({ lastReadSeq: 6 })
    });
    controller.start();
    connect();
    await flush();
    controller.openActivity();
    expect(controller.store.getState().panel).toBe("activity");
    await controller.openMessage("c1", 2);
    const state = controller.store.getState();
    expect(state.panel).toBeUndefined();
    expect(state.selectedConversationId).toBe("c1");
    expect(state.threads.c1?.messages.map((item) => item.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(state.focus).toMatchObject({ conversationId: "c1", seq: 2 });
    await controller.selectConversation("c1");
    expect(controller.store.getState().focus).toBeUndefined();
  });

  it("opens a far older message in a window and loads newer history on demand", async () => {
    const far = { ...directory, conversations: [{ ...conversation, lastSeq: 2000, lastReadSeq: 2000 }] };
    const requests: unknown[] = [];
    const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => message(from + index));
    const { controller, connect } = harness({
      "teamChat.connection.get": () => ({ status: "connecting" }),
      "teamChat.directory.get": () => far,
      "teamChat.activity.list": () => ({ items: [] }),
      "teamChat.read.mark": () => ({ lastReadSeq: 2000 }),
      "teamChat.messages.list": (payload: { before?: number; after?: number; limit?: number }) => {
        requests.push(payload);
        if (payload.after !== undefined) return { messages: range(payload.after + 1, payload.after + 2), hasMore: false };
        if (payload.before !== undefined) return { messages: range(payload.before - 50, payload.before - 1), hasMore: true };
        return { messages: range(1951, 2000), hasMore: true };
      }
    });
    controller.start();
    connect();
    await flush();
    await controller.openMessage("c1", 100);
    const thread = controller.store.getState().threads.c1!;
    expect(thread).toMatchObject({ hasNewer: true });
    expect(thread.messages.some((item) => item.seq === 100)).toBe(true);
    expect(requests).toContainEqual({ conversationId: "c1", before: 126, limit: 50 });
    expect(controller.store.getState().focus).toMatchObject({ seq: 100 });
    await controller.loadNewer("c1");
    expect(controller.store.getState().threads.c1?.messages.at(-1)?.seq).toBe(127);
    expect(controller.store.getState().threads.c1?.hasNewer).toBeUndefined();
  });

  it("edits and recalls through the service and tracks the message being edited", async () => {
    const { controller, calls, connect } = harness({
      "teamChat.connection.get": () => ({ status: "connecting" }),
      "teamChat.directory.get": () => directory,
      "teamChat.activity.list": () => ({ items: [] }),
      "teamChat.read.mark": () => ({ lastReadSeq: 2 }),
      "teamChat.messages.list": () => ({ messages: [message(1, { senderUserId: "me" }), message(2)], hasMore: false }),
      "teamChat.message.edit": (payload: { body: string }) => ({ ...message(1, { senderUserId: "me" }), body: payload.body, editedAt: 9 }),
      "teamChat.message.recall": () => ({ ...message(2), body: "", recalledAt: 10, recalledBy: "me" })
    });
    controller.start();
    connect();
    await flush();
    await controller.selectConversation("c1");
    controller.startEditing("c1", "m1");
    expect(controller.store.getState().editing).toEqual({ conversationId: "c1", messageId: "m1" });
    await controller.editMessage("c1", "m1", "改后", ["u2"]);
    expect(controller.store.getState().editing).toBeUndefined();
    expect(controller.store.getState().threads.c1?.messages[0]).toMatchObject({ body: "改后", editedAt: 9 });
    await controller.recallMessage("c1", "m2");
    expect(controller.store.getState().threads.c1?.messages[1]).toMatchObject({ body: "", recalledAt: 10 });
    expect(calls.filter((call) => call.type.startsWith("teamChat.message.")).map((call) => call.payload)).toEqual([
      { conversationId: "c1", messageId: "m1", body: "改后", mentionUserIds: ["u2"] },
      { conversationId: "c1", messageId: "m2" }
    ]);
    controller.startEditing("c1", "m1");
    await controller.selectConversation("other");
    expect(controller.store.getState().editing).toBeUndefined();
  });

  it("re-reads loaded history after a reconnect so edits and recalls made while away apply", async () => {
    let recalled = false;
    const { controller, emit, connect } = harness({
      "teamChat.connection.get": () => ({ status: "live", generation: 1 }),
      "teamChat.directory.get": () => directory,
      "teamChat.activity.list": () => ({ items: [] }),
      "teamChat.read.mark": () => ({ lastReadSeq: 2 }),
      "teamChat.messages.list": (payload: { after?: number }) => {
        const second = recalled ? { ...message(2), body: "", recalledAt: 5, recalledBy: "u2" } : message(2);
        if (payload.after === 0) return { messages: [message(1), second], hasMore: false };
        if (payload.after !== undefined) return { messages: [], hasMore: false };
        return { messages: [message(1), second], hasMore: false };
      }
    });
    controller.start();
    connect();
    await flush();
    await controller.selectConversation("c1");
    recalled = true;
    emit({ type: "teamChat.connectionChanged", payload: { status: "live", generation: 2 } });
    await vi.waitFor(() => expect(controller.store.getState().threads.c1?.messages[1]).toMatchObject({ body: "", recalledAt: 5 }));
  });
});

