import { describe, expect, it, vi } from "vitest";
import {
  measureElectronApplicationShutdown,
  productShutdownWithinBudget
} from "./electron-shutdown-measurement.mjs";

describe("Electron shutdown measurement", () => {
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
      expect(result.productExitDurationMs).toBe(600);
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
      expect(result.productExitDurationMs).toBeGreaterThanOrEqual(600);
      expect(result.productExitDurationMs).toBeLessThanOrEqual(650);
      expect(productShutdownWithinBudget(result, 5_000)).toBe(true);
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
