import { describe, expect, it } from "vitest";
import { harness } from "./team-chat-controller-test-support.js";

describe("team chat search", () => {
  it("searches with filters, lets the newest search win, pages and closes", async () => {
    const hit = (id: string) => ({ messageId: id, conversationId: "c1", seq: 2, senderUserId: "u2", createdAt: 1, field: "message" as const, snippet: "口径" });
    const pending: Array<(page: unknown) => void> = [];
    const { controller, calls } = harness({
      "teamChat.search": (payload: { cursor?: string }) => payload.cursor
        ? { results: [hit("m3")] }
        : new Promise((resolve) => pending.push(resolve))
    });
    const first = controller.search({ query: " 口径 " });
    const second = controller.search({ query: "口径", conversationId: "c1" });
    expect(controller.store.getState()).toMatchObject({ panel: "search", search: { query: "口径", conversationId: "c1", status: "loading" } });
    pending[1]!({ results: [hit("m2")], nextCursor: "1_00000000-0000-4000-8000-000000000001" });
    pending[0]!({ results: [hit("stale")] });
    await Promise.all([first, second]);
    expect(controller.store.getState().search?.results.map((item) => item.messageId)).toEqual(["m2"]);
    expect(calls.map((call) => call.payload)).toEqual([{ query: "口径" }, { query: "口径", conversationId: "c1" }]);
    await controller.loadMoreSearch();
    expect(controller.store.getState().search).toMatchObject({ loadingMore: false });
    expect(controller.store.getState().search?.results.map((item) => item.messageId)).toEqual(["m2", "m3"]);
    expect(controller.store.getState().search).not.toHaveProperty("nextCursor");
    expect(calls.at(-1)?.payload).toEqual({ query: "口径", conversationId: "c1", cursor: "1_00000000-0000-4000-8000-000000000001" });
    controller.openActivity();
    controller.openSearch();
    expect(controller.store.getState().panel).toBe("search");
    controller.closeSearch();
    expect(controller.store.getState()).toMatchObject({ panel: undefined, search: undefined });
  });

  it("records a failed search and retries it", async () => {
    let fail = true;
    const { controller } = harness({
      "teamChat.search": () => { if (fail) throw new Error("offline"); return { results: [] }; }
    });
    await controller.search({ query: "x" });
    expect(controller.store.getState().search?.status).toBe("error");
    fail = false;
    await controller.search(controller.store.getState().search!);
    expect(controller.store.getState().search).toMatchObject({ status: "ready", results: [] });
  });
});
