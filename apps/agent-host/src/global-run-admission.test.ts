import { describe, expect, it } from "vitest";
import { GlobalRunAdmission } from "./global-run-admission.js";

describe("GlobalRunAdmission", () => {
  it("atomically rejects a fifth running Task and releases terminal Tasks", () => {
    const admission = new GlobalRunAdmission(4);
    const leases = Array.from({ length: 4 }, (_, index) => admission.reserve(`task-${index + 1}`));

    expect(() => admission.reserve("task-5")).toThrow(expect.objectContaining({
      code: "RESOURCE_LIMIT_EXCEEDED",
      details: { maximumRunningTasks: 4 }
    }));
    expect(admission.transition("task-1", "waiting-approval")).toBe(true);
    expect(admission.transition("task-2", "waiting-extension-input")).toBe(true);
    expect(admission.snapshot()).toEqual([
      { taskKey: "task-1", state: "waiting-approval" },
      { taskKey: "task-2", state: "waiting-extension-input" },
      { taskKey: "task-3", state: "accepted" },
      { taskKey: "task-4", state: "accepted" }
    ]);

    expect(admission.release(leases[0]!)).toBe(true);
    expect(admission.reserve("task-5")).toMatchObject({ taskKey: "task-5" });
  });

  it("does not let stale leases release a newer admission", () => {
    const admission = new GlobalRunAdmission(1);
    const stale = admission.reserve("task-1");
    expect(admission.release(stale)).toBe(true);
    admission.reserve("task-1");
    expect(admission.release(stale)).toBe(false);
    expect(admission.stateFor("task-1")).toBe("accepted");
  });
});
