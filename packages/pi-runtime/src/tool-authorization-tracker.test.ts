import { describe, expect, it } from "vitest";
import { ToolAuthorizationTracker } from "./tool-authorization-tracker.js";

describe("ToolAuthorizationTracker", () => {
  it("tracks bounded non-sensitive reasons until the Tool outcome completes", () => {
    const tracker = new ToolAuthorizationTracker();
    tracker.record("tool-1", "configured-source");
    expect(tracker.get("tool-1")).toEqual({ mode: "auto", reason: "configured-source" });
    tracker.complete("tool-1");
    expect(tracker.get("tool-1")).toBeUndefined();
  });

  it("bounds pending Tool decisions and resets on Session transitions", () => {
    const tracker = new ToolAuthorizationTracker();
    for (let index = 0; index < 65; index += 1) tracker.record(`tool-${index}`, "read-only");
    expect(tracker.get("tool-0")).toBeUndefined();
    expect(tracker.get("tool-64")).toEqual({ mode: "auto", reason: "read-only" });
    tracker.reset();
    expect(tracker.get("tool-64")).toBeUndefined();
  });
});
