import { describe, expect, it } from "vitest";
import {
  conversationArchiveBlocker,
  conversationKeyIdentity,
  taskCanBeStopped,
  taskConsumesRunSlot,
  type TaskLifecycle
} from "./workbench.js";

describe("workbench task admission", () => {
  it("counts only active and interactive-wait task lifecycles", () => {
    const counted: TaskLifecycle[] = [
      "accepted",
      "running",
      "waiting-approval",
      "waiting-extension-input"
    ];
    const notCounted: TaskLifecycle[] = [
      "draft",
      "initializing",
      "idle",
      "completed",
      "failed",
      "cancelled",
      "lost",
      "stopped"
    ];

    expect(counted.every(taskConsumesRunSlot)).toBe(true);
    expect(notCounted.some(taskConsumesRunSlot)).toBe(false);
  });
});

describe("conversation organization policy", () => {
  it("only exposes Stop task for task lifecycles that can still consume a run slot", () => {
    expect(taskCanBeStopped("running")).toBe(true);
    expect(taskCanBeStopped("waiting-approval")).toBe(true);
    expect(taskCanBeStopped("idle")).toBe(false);
    expect(taskCanBeStopped("completed")).toBe(false);
  });

  it("blocks archive for provisional, initializing, active, and draft conversations", () => {
    expect(conversationArchiveBlocker({ kind: "provisional" })).toBe("provisional");
    expect(conversationArchiveBlocker({ kind: "session", lifecycle: "initializing" })).toBe("initializing");
    expect(conversationArchiveBlocker({ kind: "session", lifecycle: "running" })).toBe("active-task");
    expect(conversationArchiveBlocker({ kind: "session", lifecycle: "idle", hasDraft: true })).toBe("draft");
    expect(conversationArchiveBlocker({ kind: "session", lifecycle: "completed" })).toBeUndefined();
  });
});

describe("conversation identity", () => {
  it("keeps Session and provisional conversations Workspace-scoped", () => {
    expect(conversationKeyIdentity({
      kind: "session",
      workspaceId: "workspace-a",
      sessionPath: "/sessions/a.jsonl"
    })).toBe("session:workspace-a:/sessions/a.jsonl");
    expect(conversationKeyIdentity({
      kind: "provisional",
      workspaceId: "workspace-b",
      draftId: "draft-1"
    })).toBe("provisional:workspace-b:draft-1");
  });
});
