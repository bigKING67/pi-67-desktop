import type { OperationView } from "@pi67/domain";
import { eventEnvelope } from "@pi67/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../app/app-store.js";
import {
  installOperationFreshnessController,
  observeOperationFreshnessEvent
} from "./operation-freshness-controller.js";
import { useOperationFreshnessStore } from "./operation-freshness-store.js";

describe("operation freshness controller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    useAppStore.setState(useAppStore.getInitialState(), true);
    useOperationFreshnessStore.setState(useOperationFreshnessStore.getInitialState(), true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("isolates heartbeat updates, rejects stale authority and disposes timers", () => {
    const dispose = installOperationFreshnessController();
    useAppStore.setState({
      connected: true,
      hostEpoch: 9,
      operation: operation(),
      runtime: { phase: "busy", detail: "running", recoverable: true }
    });
    expect(useOperationFreshnessStore.getState().freshness).toMatchObject({
      operationId: "operation-1",
      phase: "fresh"
    });
    expect(vi.getTimerCount()).toBe(1);

    const firstObservedAt = useOperationFreshnessStore.getState().freshness?.observedAt;
    observeOperationFreshnessEvent({
      type: "operation.heartbeat",
      payload: { operationId: "operation-1", observedAt: 105_000, lastActivityAt: 105_000 }
    }, heartbeatEnvelope({ sessionId: "session-2" }));
    observeOperationFreshnessEvent({
      type: "operation.heartbeat",
      payload: { operationId: "operation-2", observedAt: 105_000, lastActivityAt: 105_000 }
    }, heartbeatEnvelope({ operationId: "operation-2" }));
    observeOperationFreshnessEvent({
      type: "operation.heartbeat",
      payload: { operationId: "operation-1", observedAt: 105_000, lastActivityAt: 105_000 }
    }, heartbeatEnvelope({ hostEpoch: 8 }));

    expect(useOperationFreshnessStore.getState().freshness?.observedAt).toBe(firstObservedAt);

    useAppStore.setState({
      operation: operation({
        lifecycle: "waiting-input",
        activity: { kind: "extension-input", requestId: "extension-1" }
      })
    });
    expect(vi.getTimerCount()).toBe(0);

    useAppStore.setState({ operation: operation() });
    expect(vi.getTimerCount()).toBe(1);
    dispose();

    expect(vi.getTimerCount()).toBe(0);
    expect(useOperationFreshnessStore.getState().freshness).toBeUndefined();
  });
});

function operation(overrides: Partial<OperationView> = {}): OperationView {
  return {
    operationId: "operation-1",
    kind: "prompt",
    lifecycle: "running",
    cancellable: true,
    sessionId: "session-1",
    sessionGeneration: 3,
    startedAt: 100_000,
    ...overrides
  };
}

function heartbeatEnvelope(overrides: Partial<{
  hostEpoch: number;
  sessionId: string;
  sessionGeneration: number;
  operationId: string;
}> = {}) {
  const context = {
    hostEpoch: 9,
    sequence: 1,
    sessionId: "session-1",
    sessionGeneration: 3,
    operationId: "operation-1",
    ...overrides
  };
  return eventEnvelope("operation.heartbeat", {
    operationId: context.operationId,
    observedAt: 105_000,
    lastActivityAt: 105_000
  }, context);
}
