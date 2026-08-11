import type { NativeSubagentView } from "@pi67/domain";
import { afterEach, describe, expect, it } from "vitest";
import { useSubagentStore } from "./subagent-store.js";

describe("subagent store", () => {
  afterEach(() => {
    useSubagentStore.setState(useSubagentStore.getInitialState(), true);
  });

  it("keeps a roster bound to one exact Task Session authority", () => {
    const store = useSubagentStore.getState();
    store.replace("task-1", "session-1", 2, [view("run-2", 2, 20), view("run-1", 1, 30)]);

    expect(useSubagentStore.getState().byTaskId["task-1"]).toEqual({
      sessionId: "session-1",
      sessionGeneration: 2,
      items: [expect.objectContaining({ runId: "run-1" }), expect.objectContaining({ runId: "run-2" })]
    });

    store.upsert("task-1", "session-2", 3, view("run-new", 1, 40));
    expect(useSubagentStore.getState().byTaskId["task-1"]).toEqual({
      sessionId: "session-2",
      sessionGeneration: 3,
      items: [expect.objectContaining({ runId: "run-new" })]
    });
  });

  it("upserts by durable run identity and can clear a transitioned Task", () => {
    const store = useSubagentStore.getState();
    store.upsert("task-1", "session-1", 2, view("run-1", 1, 10));
    store.upsert("task-1", "session-1", 2, { ...view("run-1", 1, 20), state: "completed" });

    expect(useSubagentStore.getState().byTaskId["task-1"]?.items).toEqual([
      expect.objectContaining({ runId: "run-1", state: "completed", updatedAt: 20 })
    ]);

    store.clear("task-1");
    expect(useSubagentStore.getState().byTaskId["task-1"]).toBeUndefined();
  });

  it("does not let delayed list or mutation responses overwrite newer lifecycle events", () => {
    const store = useSubagentStore.getState();
    store.upsert("task-1", "session-1", 2, {
      ...view("run-1", 1, 30),
      state: "completed"
    });
    store.upsert("task-1", "session-1", 2, view("run-2", 1, 25));

    store.upsert("task-1", "session-1", 2, view("run-1", 1, 20));
    store.replace("task-1", "session-1", 2, [view("run-1", 1, 20)]);

    expect(useSubagentStore.getState().byTaskId["task-1"]?.items).toEqual([
      expect.objectContaining({ runId: "run-2", updatedAt: 25 }),
      expect.objectContaining({ runId: "run-1", state: "completed", updatedAt: 30 })
    ]);
  });
});

function view(runId: string, depth: number, updatedAt: number): NativeSubagentView {
  return {
    runId,
    childId: `child-${runId}`,
    activationId: `activation-${runId}`,
    depth,
    role: "worker",
    state: "running",
    mode: "background",
    context: "fresh",
    isolation: "shared",
    cwd: "/workspace",
    updatedAt
  };
}
