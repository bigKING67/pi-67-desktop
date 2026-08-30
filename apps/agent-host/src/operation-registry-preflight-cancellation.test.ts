import type { AgentEvent } from "@pi67/protocol";
import { describe, expect, it, vi } from "vitest";
import { OperationRegistry } from "./operation-registry.js";

describe("OperationRegistry preflight cancellation", () => {
  it("does not publish cancellation until an accepted execution acknowledges its abort signal", async () => {
    const events: AgentEvent[] = [];
    const order: string[] = [];
    let releaseExecution!: () => void;
    const registry = new OperationRegistry(
      3,
      () => ({
        sessionId: "session-1",
        sessionFileIdentity: "session-file-session-1",
        sessionGeneration: 2
      }),
      (event) => events.push(event)
    );
    const accepted = await registry.accept({
      submissionId: "submission-preflight",
      fingerprint: "preflight",
      kind: "prompt",
      abort: async () => { order.push("pi-abort"); },
      execute: ({ signal }) => new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => {
          order.push("execution-abort");
          releaseExecution = resolve;
        }, { once: true });
      })
    });
    await vi.waitFor(() => expect(events[0]?.type).toBe("operation.started"));

    const aborting = registry.abort(accepted.operationId);
    await vi.waitFor(() => expect(order).toEqual(["pi-abort", "execution-abort"]));
    expect(events.map((event) => event.type)).toEqual(["operation.started"]);

    releaseExecution();
    await expect(aborting).resolves.toEqual({ aborted: true, operationId: accepted.operationId });
    expect(events.map((event) => event.type)).toEqual(["operation.started", "operation.cancelled"]);
  });
});
