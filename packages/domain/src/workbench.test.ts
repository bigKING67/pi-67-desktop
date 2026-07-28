import { describe, expect, it } from "vitest";
import { conversationKeyIdentity, taskConsumesRunSlot, type TaskLifecycle } from "./workbench.js";

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
