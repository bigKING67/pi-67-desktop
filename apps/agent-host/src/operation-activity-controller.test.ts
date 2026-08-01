import type { AgentEvent } from "@pi67/protocol";
import { describe, expect, it } from "vitest";
import {
  OperationActivityController,
  type OperationActivityTarget
} from "./operation-activity-controller.js";

describe("OperationActivityController", () => {
  it("restores the latest Pi activity after an interactive wait completes", () => {
    const events: AgentEvent[] = [];
    const controller = new OperationActivityController((event) => events.push(event));
    const target = operationTarget();

    expect(controller.updateBase(target, {
      kind: "tool",
      toolCallId: "tool-1",
      toolName: "bash",
      toolKind: "shell",
      status: "running"
    })).toBe(true);
    expect(controller.beginInteractive(target, { kind: "approval", requestId: "approval-1" })).toBe(true);
    expect(controller.updateBase(target, { kind: "responding" })).toBe(false);
    expect(controller.completeInteractive(target, "approval-1")).toBe(true);
    expect(target.view).toMatchObject({ lifecycle: "running", activity: { kind: "responding" } });
    expect(events.map((event) => event.type)).toEqual([
      "operation.activityChanged",
      "operation.activityChanged",
      "operation.activityChanged"
    ]);
  });

  it("keeps nested waits ordered and emits explicit activity clearing", () => {
    const events: AgentEvent[] = [];
    const controller = new OperationActivityController((event) => events.push(event));
    const target = operationTarget();

    expect(controller.updateBase(target, { kind: "thinking" })).toBe(true);
    expect(controller.beginInteractive(target, { kind: "approval", requestId: "approval-1" })).toBe(true);
    expect(controller.beginInteractive(target, { kind: "extension-input", requestId: "extension-1" })).toBe(true);
    expect(controller.completeInteractive(target, "approval-1")).toBe(false);
    expect(controller.completeInteractive(target, "extension-1")).toBe(true);
    expect(controller.updateBase(target, null)).toBe(true);
    expect(controller.updateBase(target, null)).toBe(false);
    expect(target.view.lifecycle).toBe("running");
    expect(target.view.activity).toBeUndefined();
    expect(events.at(-1)).toEqual({
      type: "operation.activityChanged",
      payload: { operationId: "operation-1", activity: null }
    });
  });

  it("forwards a late AUTO reason for the current running Tool", () => {
    const events: AgentEvent[] = [];
    const controller = new OperationActivityController((event) => events.push(event));
    const target = operationTarget();
    const runningTool = {
      kind: "tool" as const,
      toolCallId: "tool-auto",
      toolName: "read",
      toolKind: "read" as const,
      status: "running" as const
    };

    expect(controller.updateBase(target, runningTool)).toBe(true);
    expect(controller.updateBase(target, {
      ...runningTool,
      authorization: { mode: "auto", reason: "read-only" }
    })).toBe(true);
    expect(events.at(-1)).toEqual({
      type: "operation.activityChanged",
      payload: {
        operationId: "operation-1",
        activity: {
          ...runningTool,
          authorization: { mode: "auto", reason: "read-only" }
        }
      }
    });
  });
});

function operationTarget(): OperationActivityTarget {
  return {
    view: {
      operationId: "operation-1",
      kind: "prompt" as const,
      lifecycle: "running" as const,
      cancellable: true,
      sessionId: "session-1",
      sessionGeneration: 1,
      startedAt: 1
    }
  };
}
