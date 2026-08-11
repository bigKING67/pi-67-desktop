import type { OperationView, ToolExecutionView } from "@pi67/domain";
import type { AgentEvent } from "@pi67/protocol";
import { describe, expect, it, vi } from "vitest";
import { OperationToolExecutionController } from "./operation-tool-execution-controller.js";

describe("OperationToolExecutionController", () => {
  it("updates parallel tools by toolCallId instead of replacing the latest step", () => {
    const emitted: AgentEvent[] = [];
    const controller = new OperationToolExecutionController((event) => emitted.push(event));
    const target = { view: operation() };

    controller.update(target, execution("a", "running"));
    controller.update(target, execution("b", "running"));
    controller.update(target, execution("a", "completed"));

    expect(target.view.toolExecutions).toEqual([
      expect.objectContaining({ toolCallId: "b", status: "running" }),
      expect.objectContaining({ toolCallId: "a", status: "completed" })
    ]);
    expect(emitted.map((event) => event.type)).toEqual([
      "operation.toolExecutionChanged",
      "operation.toolExecutionChanged",
      "operation.toolExecutionChanged"
    ]);
  });

  it.each([
    ["completed", "interrupted"],
    ["failed", "interrupted"],
    ["cancelled", "cancelled"],
    ["lost", "lost"]
  ] as const)("settles unfinished tools for an Operation %s terminal", (lifecycle, expected) => {
    const emit = vi.fn();
    const controller = new OperationToolExecutionController(emit);
    const target = { view: operation() };
    controller.update(target, execution("running", "running", 10));
    controller.update(target, execution("done", "completed", 12));

    controller.settle(target, lifecycle, 25);

    expect(target.view.toolExecutions).toEqual([
      expect.objectContaining({
        toolCallId: "running",
        status: expected,
        completedAt: 25,
        durationMs: 15,
        resultState: "unreconciled"
      }),
      expect.objectContaining({ toolCallId: "done", status: "completed" })
    ]);
  });

  it("bounds the active Operation projection and records truncation", () => {
    const controller = new OperationToolExecutionController(() => undefined);
    const target = { view: operation() };
    for (let index = 0; index < 65; index += 1) {
      controller.update(target, execution(`tool-${index}`, "completed"));
    }

    expect(target.view.toolExecutions).toHaveLength(64);
    expect(target.view.toolExecutions?.[0]?.toolCallId).toBe("tool-1");
    expect(target.view.toolExecutionsTruncated).toBe(true);
  });
});

function operation(): OperationView {
  return {
    operationId: "operation-1",
    kind: "prompt",
    lifecycle: "running",
    cancellable: true,
    sessionId: "session-1",
    sessionFileIdentity: "session-file-1",
    sessionGeneration: 1,
    startedAt: 1
  };
}

function execution(
  toolCallId: string,
  status: ToolExecutionView["status"],
  startedAt?: number
): ToolExecutionView {
  return {
    toolCallId,
    toolName: "bash",
    toolKind: "shell",
    status,
    projectionSource: "live",
    resultState: status === "running" ? "pending" : "present",
    ...(startedAt === undefined ? {} : { startedAt })
  };
}
