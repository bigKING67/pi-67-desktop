import type { AgentEvent } from "@pi67/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OperationRegistry } from "./operation-registry.js";

describe("OperationRegistry heartbeat", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits periodic heartbeats without treating the heartbeat itself as business activity", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const events: AgentEvent[] = [];
    const registry = createRegistry(events);
    const accepted = await registry.accept({
      submissionId: "heartbeat-active",
      fingerprint: "same",
      kind: "prompt",
      execute: () => new Promise<void>(() => undefined)
    });
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(registry.diagnostics()).toEqual({
      accepting: false,
      active: true,
      terminating: false,
      poisoned: false,
      heartbeat: { active: true, lastActivityAt: 1_000, quietForMs: 5_000 }
    });
    expect(heartbeats(events)).toEqual([{
      type: "operation.heartbeat",
      payload: {
        operationId: accepted.operationId,
        observedAt: 6_000,
        lastActivityAt: 1_000
      }
    }]);

    await vi.advanceTimersByTimeAsync(1_000);
    registry.observeEventActivity({
      type: "turn.streamBatch",
      payload: { events: [{ assistantMessageEvent: { type: "text_delta", delta: "still working" } }] }
    });
    await vi.advanceTimersByTimeAsync(4_000);

    expect(heartbeats(events).at(-1)).toMatchObject({
      payload: { observedAt: 11_000, lastActivityAt: 7_000 }
    });
    await registry.loseActive("test cleanup");
    expect(registry.diagnostics()).toMatchObject({ active: false, heartbeat: { active: false } });
  });

  it("keeps heartbeats active while waiting for input and stops them after terminal settlement", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const events: AgentEvent[] = [];
    let complete!: () => void;
    const registry = createRegistry(events);
    await registry.accept({
      submissionId: "heartbeat-waiting",
      fingerprint: "same",
      kind: "prompt",
      execute: () => new Promise<void>((resolve) => { complete = resolve; })
    });
    await vi.advanceTimersByTimeAsync(0);
    registry.beginInteractiveWait({ kind: "approval", requestId: "approval-1" });

    await vi.advanceTimersByTimeAsync(5_000);
    expect(heartbeats(events)).toHaveLength(1);
    expect(registry.activeView()).toMatchObject({
      lifecycle: "waiting-input",
      activity: { kind: "approval", requestId: "approval-1" }
    });

    complete();
    await vi.advanceTimersByTimeAsync(0);
    const heartbeatCount = heartbeats(events).length;
    await vi.advanceTimersByTimeAsync(15_000);

    expect(heartbeats(events)).toHaveLength(heartbeatCount);
    expect(events.at(-1)?.type).toBe("operation.completed");
    expect(vi.getTimerCount()).toBe(0);
  });
});

function createRegistry(events: AgentEvent[]): OperationRegistry {
  return new OperationRegistry(
    3,
    () => ({
      sessionId: "session-1",
      sessionFileIdentity: "session-file-session-1",
      sessionGeneration: 2
    }),
    (event) => events.push(event),
    { heartbeatIntervalMs: 5_000 }
  );
}

function heartbeats(events: AgentEvent[]) {
  return events.filter((event): event is Extract<AgentEvent, { type: "operation.heartbeat" }> => (
    event.type === "operation.heartbeat"
  ));
}
