import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { SharedKnowledgeSelection } from "./shared-knowledge-selection.js";

const item = { id: "asset", projectId: "project", externalRevision: "revision" };
function fixture() {
  let sessionId = "session";
  const context = { sessionManager: { getSessionId: () => sessionId } } as ExtensionContext;
  const selection = new SharedKnowledgeSelection();
  const search = () => selection.search(context, undefined, 1, async () => ({ items: [item], total: 1 }));
  const read = (value = item) => selection.read(context, undefined, item.id, async () => value);
  return { selection, context, search, read, switchSession: (id: string) => { sessionId = id; } };
}

describe("shared knowledge selection receipt", () => {
  it("requires a search and does not call the reader for arbitrary ids", async () => {
    const f = fixture(), load = vi.fn(async () => item);
    await expect(f.selection.read(f.context, undefined, item.id, load)).rejects.toThrow("Search shared");
    expect(load).not.toHaveBeenCalled();
    await f.search();
    await expect(f.read()).resolves.toEqual(item);
    await expect(f.selection.read(f.context, undefined, "other", load)).rejects.toThrow("Search shared");
    expect(load).not.toHaveBeenCalled();
  });

  it.each(["id", "projectId", "externalRevision"] as const)("rejects changed %s and invalidates the receipt", async (field) => {
    const f = fixture();
    await f.search();
    await expect(f.read({ ...item, [field]: "changed" })).rejects.toThrow("changed since search");
    await expect(f.read()).rejects.toThrow("Search shared");
  });

  it("does not carry selections to another Session or a new tool instance", async () => {
    const f = fixture();
    await f.search();
    f.switchSession("other");
    await expect(f.read()).rejects.toThrow("Search shared");
    f.switchSession("session");
    await expect(f.read()).rejects.toThrow("Search shared");
    await expect(fixture().read()).rejects.toThrow("Search shared");
  });

  it("clears prior selections when the next search fails", async () => {
    const f = fixture();
    await f.search();
    await expect(f.selection.search(f.context, undefined, 1, () => Promise.reject(new Error("offline")))).rejects.toThrow("offline");
    await expect(f.read()).rejects.toThrow("Search shared");
  });

  it.each([
    { items: [item, item], limit: 2 },
    { items: [item, { ...item, id: "second" }], limit: 1 }
  ])("rejects duplicate or over-limit results ($limit)", async ({ items, limit }) => {
    const f = fixture();
    await expect(f.selection.search(f.context, undefined, limit, async () => ({ items, total: items.length }))).rejects.toThrow("invalid selection");
    await expect(f.read()).rejects.toThrow("Search shared");
  });

  it("lets the newest search win even when an older search finishes last", async () => {
    const f = fixture();
    const pending = Promise.withResolvers<{ items: typeof item[]; total: number }>();
    const old = f.selection.search(f.context, undefined, 1, () => pending.promise);
    await f.search();
    pending.resolve({ items: [{ ...item, id: "old" }], total: 1 });
    await expect(old).rejects.toThrow("selection changed");
    await expect(f.read()).resolves.toEqual(item);
  });

  it.each(["session", "search", "abort"] as const)("rejects an in-flight read after %s changes", async (change) => {
    const f = fixture(), pending = Promise.withResolvers<typeof item>(), controller = new AbortController();
    await f.search();
    const read = f.selection.read(f.context, controller.signal, item.id, () => pending.promise);
    if (change === "session") f.switchSession("other");
    if (change === "search") await f.search();
    if (change === "abort") controller.abort();
    pending.resolve(item);
    await expect(read).rejects.toThrow();
  });

  it("does not admit an aborted search", async () => {
    const f = fixture(), controller = new AbortController();
    await expect(f.selection.search(f.context, controller.signal, 1, async () => {
      controller.abort();
      return { items: [item], total: 1 };
    })).rejects.toThrow();
    await expect(f.read()).rejects.toThrow("Search shared");
  });
});
