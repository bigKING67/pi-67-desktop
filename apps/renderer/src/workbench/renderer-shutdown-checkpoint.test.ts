import { describe, expect, it, vi } from "vitest";
import { runRendererShutdownCheckpoint } from "./renderer-shutdown-checkpoint.js";

describe("renderer shutdown checkpoint", () => {
  it("flushes drafts before the Workbench layout", async () => {
    const order: string[] = [];
    await expect(runRendererShutdownCheckpoint({
      initializeWorkbench: async () => { order.push("workbench-ready"); },
      initializeDraftPersistence: async () => { order.push("drafts-ready"); },
      beginDraftShutdown: () => { order.push("drafts-frozen"); },
      persistDrafts: async () => { order.push("drafts-persisted"); },
      persistWorkbench: async () => { order.push("workbench-persisted"); }
    })).resolves.toBe(true);
    expect(order.slice(-3)).toEqual([
      "drafts-frozen",
      "drafts-persisted",
      "workbench-persisted"
    ]);
  });

  it("reports failure instead of acknowledging a partial checkpoint", async () => {
    const persistWorkbench = vi.fn(async () => undefined);
    await expect(runRendererShutdownCheckpoint({
      initializeWorkbench: async () => undefined,
      initializeDraftPersistence: async () => undefined,
      beginDraftShutdown: () => undefined,
      persistDrafts: async () => { throw new Error("draft persistence failed"); },
      persistWorkbench
    })).resolves.toBe(false);
    expect(persistWorkbench).not.toHaveBeenCalled();
  });
});
