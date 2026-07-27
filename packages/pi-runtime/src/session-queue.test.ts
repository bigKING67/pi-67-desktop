import { describe, expect, it, vi } from "vitest";
import { clearSessionQueue } from "./session-queue.js";

describe("clearSessionQueue", () => {
  it("returns bounded counts without returning queued prompt contents", () => {
    const clearQueue = vi.fn();
    const result = clearSessionQueue({
      getSteeringMessages: () => ["adjust now", "keep the draft private"],
      getFollowUpMessages: () => ["run tests later"],
      clearQueue
    });

    expect(result).toEqual({ steeringCount: 2, followUpCount: 1 });
    expect(result).not.toHaveProperty("steering");
    expect(result).not.toHaveProperty("followUp");
    expect(clearQueue).toHaveBeenCalledOnce();
  });
});
