import { describe, expect, it, vi } from "vitest";
import {
  measureElectronApplicationShutdown,
  parseApplicationShutdownReport,
  productShutdownWithinBudget,
  requireGracefulApplicationShutdown
} from "./electron-shutdown-measurement.mjs";

describe("Electron shutdown measurement", () => {
  it("rejects forced, incomplete and unconfirmed Main shutdown even after all PIDs exit", () => {
    const graceful = { budgetMs: 3_000, deadlineExceeded: false, durationMs: 800,
      rendererCheckpointed: true, agentHostStopped: true, agentHostGraceful: true, agentHostForced: false };
    const output = (report) => `Application shutdown: ${JSON.stringify({ ...report, private: "drop" })}`;
    expect(requireGracefulApplicationShutdown(output(graceful))).toEqual(graceful);
    for (const incomplete of [
      { agentHostGraceful: false, agentHostForced: true }, { agentHostGraceful: undefined },
      { agentHostForced: undefined }, { agentHostStopped: false },
      { rendererCheckpointed: false }, { deadlineExceeded: true }
    ]) {
      expect(() => requireGracefulApplicationShutdown(output({ ...graceful, ...incomplete })))
        .toThrow("did not confirm graceful shutdown");
    }
    expect(() => requireGracefulApplicationShutdown("private invalid output"))
      .toThrow("did not confirm graceful shutdown: null");
  });

  it("retains explicit graceful and forced outcomes without treating stop completion as graceful", () => {
    const report = { budgetMs: 3_000, deadlineExceeded: false, durationMs: 2_500,
      rendererCheckpointed: true, agentHostStopped: true, agentHostGraceful: false, agentHostForced: true };
    expect(parseApplicationShutdownReport(`Application shutdown: ${JSON.stringify({ ...report, private: "drop" })}`)).toEqual(report);
    for (const invalid of [{ agentHostGraceful: "true" }, { agentHostForced: 1 }]) {
      expect(parseApplicationShutdownReport(`Application shutdown: ${JSON.stringify({ ...report, ...invalid })}`)).toBeNull();
    }
  });

  it("extracts only the bounded application shutdown stage report", () => {
    const report = parseApplicationShutdownReport([
      "unrelated output",
      "Application shutdown: {\"budgetMs\":3000,\"deadlineExceeded\":true,\"durationMs\":3000.04,\"rendererCheckpointed\":true,\"rendererCheckpointDurationMs\":20.04,\"agentHostStopped\":false,\"agentHostStopDurationMs\":2479.96}",
      "private payload that must not be projected"
    ].join("\n"));

    expect(report).toEqual({
      agentHostStopDurationMs: 2_480,
      agentHostStopped: false,
      budgetMs: 3_000,
      deadlineExceeded: true,
      durationMs: 3_000,
      rendererCheckpointDurationMs: 20,
      rendererCheckpointed: true
    });
    expect(JSON.stringify(report)).not.toContain("private payload");
    expect(parseApplicationShutdownReport(
      "Application shutdown: {\"budgetMs\":3000,\"deadlineExceeded\":\"yes\"}"
    )).toBeNull();
  });

  it("records bounded product process exit timing", async () => {
    vi.useFakeTimers();
    try {
      const alive = new Set([101, 201, 202, 301]);
      const application = {
        close: () => new Promise((resolve) => {
          setTimeout(() => alive.delete(301), 100);
          setTimeout(() => alive.delete(201), 200);
          setTimeout(() => alive.delete(202), 400);
          setTimeout(() => {
            alive.delete(101);
            resolve();
          }, 600);
        })
      };

      const closing = measureElectronApplicationShutdown({
        application,
        budgetMs: 5_000,
        childPid: 301,
        mainPid: 101,
        pollIntervalMs: 50,
        processAlive: (pid) => alive.has(pid),
        utilityPids: [201, 202]
      });
      await vi.advanceTimersByTimeAsync(600);
      const result = await closing;

      expect(result.driverCloseDurationMs).toBe(600);
      expect(result.driverCloseTimedOut).toBe(false);
      expect(result.forcedTerminationRequested).toBe(false);
      expect(result.productExitDurationMs).toBe(600);
      expect(result.sampling.maximumGapMs).toBe(50);
      expect(result.sampling.sampleCount).toBeGreaterThanOrEqual(12);
      expect(productShutdownWithinBudget(result, 5_000)).toBe(true);
      expect(result.processes.main).toMatchObject({
        aliveAfterClose: false,
        aliveBeforeClose: true,
        present: true,
        processId: 101
      });
      expect(result.processes.controlledChild).toMatchObject({
        aliveAfterClose: false,
        aliveBeforeClose: true,
        present: true
      });
      expect(result.processes.utilities).toMatchObject({
        aliveAfterCloseCount: 0,
        aliveBeforeCloseCount: 2,
        count: 2,
        observedExitCount: 2
      });
      expect(result.processes.utilities.firstExitObservedMs)
        .toBeLessThan(result.processes.utilities.lastExitObservedMs);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not charge Playwright driver teardown latency to the product budget", async () => {
    vi.useFakeTimers();
    try {
      const alive = new Set([101, 201, 301]);
      const application = {
        close: () => new Promise((resolve) => {
          setTimeout(() => alive.delete(301), 100);
          setTimeout(() => alive.delete(201), 300);
          setTimeout(() => alive.delete(101), 600);
          setTimeout(resolve, 5_600);
        })
      };

      const closing = measureElectronApplicationShutdown({
        application,
        budgetMs: 5_000,
        childPid: 301,
        mainPid: 101,
        processAlive: (pid) => alive.has(pid),
        utilityPids: [201]
      });
      await vi.advanceTimersByTimeAsync(5_600);
      const result = await closing;

      expect(result.driverCloseDurationMs).toBe(5_600);
      expect(result.driverCloseTimedOut).toBe(false);
      expect(result.productExitDurationMs).toBeGreaterThanOrEqual(600);
      expect(result.productExitDurationMs).toBeLessThanOrEqual(650);
      expect(productShutdownWithinBudget(result, 5_000)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("exposes delayed sampling without exempting an observed over-budget exit", async () => {
    let clock = 0;
    let alive = true;
    const result = await measureElectronApplicationShutdown({
      application: { close: async () => { alive = false; clock = 6_500; } },
      budgetMs: 5_000,
      mainPid: 101,
      utilityPids: [],
      now: () => clock,
      processAlive: () => alive
    });
    expect(result.sampling.maximumGapMs).toBe(6_500);
    expect(result.productExitDurationMs).toBe(6_500);
    expect(productShutdownWithinBudget(result, 5_000)).toBe(false);
  });

  it("bounds a hung Playwright close and fails the shutdown gate closed", async () => {
    vi.useFakeTimers();
    try {
      const alive = new Set([101, 201]);
      const application = { close: () => new Promise(() => undefined) };
      const closing = measureElectronApplicationShutdown({
        application,
        budgetMs: 5_000,
        driverCloseTimeoutMs: 1_000,
        forcedTerminationGraceMs: 100,
        mainPid: 101,
        processAlive: (pid) => alive.has(pid),
        terminateProcess: (pid) => alive.delete(pid),
        utilityPids: [201]
      });
      await vi.advanceTimersByTimeAsync(5_000);
      const result = await closing;

      expect(result.driverCloseDurationMs).toBe(1_100);
      expect(result.driverCloseTimedOut).toBe(true);
      expect(result.forcedTerminationRequested).toBe(true);
      expect(result.processes.main.aliveAfterClose).toBe(false);
      expect(result.processes.utilities.aliveAfterCloseCount).toBe(1);
      expect(productShutdownWithinBudget(result, 5_000)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails closed when a required product process is not observed exiting", async () => {
    vi.useFakeTimers();
    try {
      const alive = new Set([101, 201]);
      const application = { close: () => new Promise((resolve) => setTimeout(resolve, 100)) };
      const closing = measureElectronApplicationShutdown({
        application,
        budgetMs: 5_000,
        mainPid: 101,
        processAlive: (pid) => alive.has(pid),
        utilityPids: [201]
      });
      await vi.advanceTimersByTimeAsync(5_000);
      const result = await closing;

      expect(result.productExitDurationMs).toBeNull();
      expect(productShutdownWithinBudget(result, 5_000)).toBe(false);
      expect(result.processes.main.aliveAfterClose).toBe(true);
      expect(result.processes.utilities.aliveAfterCloseCount).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
