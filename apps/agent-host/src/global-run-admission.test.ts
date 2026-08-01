import { MAX_RUNNING_TASKS } from "@pi67/domain";
import { describe, expect, it } from "vitest";
import { GlobalRunAdmission } from "./global-run-admission.js";

describe("GlobalRunAdmission", () => {
  it("atomically rejects a Task above the shared limit and releases terminal Tasks", () => {
    const admission = new GlobalRunAdmission();
    const leases = Array.from(
      { length: MAX_RUNNING_TASKS },
      (_, index) => admission.reserve(`task-${index + 1}`)
    );

    expect(() => admission.reserve("task-over-limit")).toThrow(expect.objectContaining({
      code: "RESOURCE_LIMIT_EXCEEDED",
      details: { maximumRunningTasks: MAX_RUNNING_TASKS }
    }));
    expect(admission.transition("task-1", "waiting-approval")).toBe(true);
    expect(admission.transition("task-2", "waiting-extension-input")).toBe(true);
    const snapshot = admission.snapshot();
    expect(snapshot).toHaveLength(MAX_RUNNING_TASKS);
    expect(snapshot.slice(0, 2)).toEqual([
      { taskKey: "task-1", state: "waiting-approval" },
      { taskKey: "task-2", state: "waiting-extension-input" }
    ]);
    expect(snapshot.slice(2).every((record) => record.state === "accepted")).toBe(true);

    expect(admission.release(leases[0]!)).toBe(true);
    expect(admission.reserve("task-over-limit")).toMatchObject({ taskKey: "task-over-limit" });
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
