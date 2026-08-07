import type { OperationFreshness, OperationView } from "@pi67/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OperationFreshnessWatchdog,
  type OperationWatchdogAuthority
} from "./operation-freshness-watchdog.js";

describe("OperationFreshnessWatchdog", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("projects business inactivity as quiet while healthy heartbeats continue", async () => {
    const fixture = createFixture();
    fixture.watchdog.track(operation(), 9);

    for (let index = 1; index <= 12; index += 1) {
      await vi.advanceTimersByTimeAsync(5_000);
      fixture.watchdog.observeHeartbeat(authority(), {
        operationId: "operation-1",
        observedAt: 100_000 + index * 5_000,
        lastActivityAt: 100_000
      });
    }

    expect(fixture.latest()).toMatchObject({
      phase: "quiet",
      reason: "activity-quiet",
      lastActivityAt: 100_000,
      lastHeartbeatAt: 160_000
    });
    expect(fixture.onRecover).not.toHaveBeenCalled();

    fixture.watchdog.observeBusinessActivity(authority());
    expect(fixture.latest()).toMatchObject({ phase: "fresh", lastActivityAt: 160_000 });
  });

  it("stages heartbeat loss through stalled and one authoritative recovery", async () => {
    const fixture = createFixture();
    fixture.watchdog.track(operation(), 9);

    await vi.advanceTimersByTimeAsync(14_999);
    expect(fixture.latest().phase).toBe("fresh");
    await vi.advanceTimersByTimeAsync(1);
    expect(fixture.latest()).toMatchObject({ phase: "stalled", reason: "heartbeat-overdue" });
    expect(fixture.onRecover).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(15_000);
    expect(fixture.latest()).toMatchObject({ phase: "recovering", reason: "heartbeat-overdue" });
    expect(fixture.onRecover).toHaveBeenCalledOnce();
    expect(fixture.onRecover).toHaveBeenCalledWith(authority());

    await vi.advanceTimersByTimeAsync(60_000);
    expect(fixture.onRecover).toHaveBeenCalledOnce();
  });

  it("treats authoritative business events as control-plane activity", async () => {
    const fixture = createFixture();
    fixture.watchdog.track(operation(), 9);

    for (let index = 0; index < 7; index += 1) {
      await vi.advanceTimersByTimeAsync(10_000);
      fixture.watchdog.observeBusinessActivity(authority());
    }

    expect(fixture.latest()).toMatchObject({
      phase: "fresh",
      lastActivityAt: 170_000,
      lastHeartbeatAt: 170_000
    });
    expect(fixture.onRecover).not.toHaveBeenCalled();
  });

  it("pauses deadlines while Pi is waiting for approval and restarts fresh afterwards", async () => {
    const fixture = createFixture();
    fixture.watchdog.track(operation({
      lifecycle: "waiting-input",
      activity: { kind: "approval", requestId: "approval-1" }
    }), 9);

    await vi.advanceTimersByTimeAsync(120_000);
    expect(fixture.latest().phase).toBe("fresh");
    expect(fixture.onRecover).not.toHaveBeenCalled();

    fixture.watchdog.track(operation({ lifecycle: "running" }), 9);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(fixture.latest()).toMatchObject({
      phase: "fresh",
      lastActivityAt: 234_999 - 14_999,
      lastHeartbeatAt: 234_999 - 14_999
    });
  });

  it("ignores stale authority and resets suspend time before evaluating again", async () => {
    const fixture = createFixture();
    fixture.watchdog.track(operation(), 9);
    await vi.advanceTimersByTimeAsync(14_000);

    const heartbeat = {
      operationId: "operation-1",
      observedAt: 114_000,
      lastActivityAt: 114_000
    };
    for (const stale of [
      { ...authority(), hostEpoch: 8 },
      { ...authority(), sessionId: "session-2" },
      { ...authority(), sessionGeneration: 4 },
      { ...authority(), operationId: "operation-2" }
    ]) {
      expect(fixture.watchdog.observeHeartbeat(stale, heartbeat)).toBe(false);
      expect(fixture.watchdog.observeBusinessActivity(stale)).toBe(false);
    }
    fixture.watchdog.handlePowerResume();
    await vi.advanceTimersByTimeAsync(14_999);

    expect(fixture.latest().phase).toBe("fresh");
    expect(fixture.onRecover).not.toHaveBeenCalled();
  });

  it("translates Host activity age without trusting cross-process wall-clock equality", async () => {
    const fixture = createFixture();
    fixture.watchdog.track(operation(), 9);
    await vi.advanceTimersByTimeAsync(10_000);

    fixture.watchdog.observeHeartbeat(authority(), {
      operationId: "operation-1",
      observedAt: 900_000,
      lastActivityAt: 850_000
    });

    expect(fixture.latest()).toMatchObject({
      phase: "fresh",
      lastActivityAt: 60_000,
      lastHeartbeatAt: 110_000
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fixture.latest()).toMatchObject({ phase: "quiet", reason: "activity-quiet" });
  });

  it("disarms a terminal Operation instead of manufacturing a failure", async () => {
    const fixture = createFixture();
    fixture.watchdog.track(operation(), 9);
    fixture.watchdog.track(operation({ lifecycle: "completed", cancellable: false }), 9);

    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fixture.onRecover).not.toHaveBeenCalled();
    expect(fixture.freshness.at(-1)?.phase).toBe("fresh");
  });
});

function createFixture() {
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
  const freshness: OperationFreshness[] = [];
  const onRecover = vi.fn();
  const watchdog = new OperationFreshnessWatchdog({
    onFreshness: (next) => freshness.push(next),
    onRecover
  });
  return {
    freshness,
    onRecover,
    watchdog,
    latest: () => freshness.at(-1)!
  };
}

function operation(overrides: Partial<OperationView> = {}): OperationView {
  return {
    operationId: "operation-1",
    kind: "prompt",
    lifecycle: "running",
    cancellable: true,
    sessionId: "session-1",
    sessionFileIdentity: "session-file-1",
    sessionGeneration: 3,
    startedAt: 100_000,
    ...overrides
  };
}

function authority(): OperationWatchdogAuthority {
  return {
    hostEpoch: 9,
    operationId: "operation-1",
    sessionId: "session-1",
    sessionGeneration: 3
  };
}
