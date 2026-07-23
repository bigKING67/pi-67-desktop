import { describe, expect, it, vi } from "vitest";
import { StreamBatcher } from "./stream-batcher.js";

describe("StreamBatcher", () => {
  it("coalesces token events", () => {
    vi.useFakeTimers();
    const batches: unknown[][] = [];
    const batcher = new StreamBatcher((events) => batches.push(events), 24);
    batcher.push({ delta: "a" });
    batcher.push({ delta: "b" });
    vi.advanceTimersByTime(24);
    expect(batches).toEqual([[{ delta: "a" }, { delta: "b" }]]);
    vi.useRealTimers();
  });
});
