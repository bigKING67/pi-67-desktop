import type { UsageWindow } from "@pi67/domain";
import type { CommandResults, WorkspaceProtocolContext } from "@pi67/protocol";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceUsageReportCoordinator } from "./workspace-usage-report-coordinator.js";

const WORKSPACE: WorkspaceProtocolContext = {
  scope: "workspace",
  workspaceId: "workspace-usage"
};

describe("WorkspaceUsageReportCoordinator", () => {
  it("single-flights equal Workspace windows while preserving per-caller cancellation", async () => {
    const scan = deferred<CommandResults["workspace.usage.report"]>();
    let scanSignal: AbortSignal | undefined;
    const usageReport = vi.fn((_context, _command, signal?: AbortSignal) => {
      scanSignal = signal;
      return scan.promise;
    });
    const coordinator = new WorkspaceUsageReportCoordinator({ usageReport });
    const firstController = new AbortController();
    const secondController = new AbortController();

    const first = coordinator.request(WORKSPACE, command("30d"), firstController.signal);
    const second = coordinator.request(WORKSPACE, command("30d"), secondController.signal);
    await vi.waitFor(() => expect(usageReport).toHaveBeenCalledOnce());

    firstController.abort();
    await expect(first).rejects.toMatchObject({ code: "CONNECTION_CLOSED" });
    expect(scanSignal?.aborted).toBe(false);

    scan.resolve(report("30d"));
    await expect(second).resolves.toMatchObject({ window: "30d" });
    await coordinator.shutdown();
  });

  it("aborts the cold scan when its last waiter leaves", async () => {
    const scan = deferred<CommandResults["workspace.usage.report"]>();
    let scanSignal: AbortSignal | undefined;
    const coordinator = new WorkspaceUsageReportCoordinator({
      usageReport: vi.fn((_context, _command, signal?: AbortSignal) => {
        scanSignal = signal;
        return scan.promise;
      })
    });
    const caller = new AbortController();
    const request = coordinator.request(WORKSPACE, command("7d"), caller.signal);
    await vi.waitFor(() => expect(scanSignal).toBeDefined());

    caller.abort();
    await expect(request).rejects.toMatchObject({ code: "CONNECTION_CLOSED" });
    expect(scanSignal?.aborted).toBe(true);

    scan.reject(new Error("cancelled"));
    await coordinator.shutdown();
  });

  it("replaces an older window and keeps one active scan per Workspace", async () => {
    const firstScan = deferred<CommandResults["workspace.usage.report"]>();
    const secondScan = deferred<CommandResults["workspace.usage.report"]>();
    const signals: AbortSignal[] = [];
    const usageReport = vi.fn((_context, command, signal?: AbortSignal) => {
      if (signal) signals.push(signal);
      return command.payload.window === "30d" ? firstScan.promise : secondScan.promise;
    });
    const coordinator = new WorkspaceUsageReportCoordinator({ usageReport });

    const first = coordinator.request(WORKSPACE, command("30d"), new AbortController().signal);
    await vi.waitFor(() => expect(usageReport).toHaveBeenCalledOnce());
    const second = coordinator.request(WORKSPACE, command("90d"), new AbortController().signal);

    await expect(first).rejects.toMatchObject({
      code: "CONNECTION_CLOSED",
      details: { reason: "superseded" }
    });
    expect(signals[0]?.aborted).toBe(true);
    expect(usageReport).toHaveBeenCalledOnce();

    firstScan.reject(new Error("superseded"));
    await vi.waitFor(() => expect(usageReport).toHaveBeenCalledTimes(2));
    secondScan.resolve(report("90d"));
    await expect(second).resolves.toMatchObject({ window: "90d" });
    await coordinator.shutdown();
  });
});

function command(window: UsageWindow) {
  return { type: "workspace.usage.report" as const, payload: { window } };
}

function report(window: UsageWindow): CommandResults["workspace.usage.report"] {
  return {
    workspaceId: WORKSPACE.workspaceId,
    generatedAt: 1,
    window,
    buckets: [],
    models: [],
    totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    coverage: {
      discoveredSessions: 0,
      scannedSessions: 0,
      skippedSessions: 0,
      unavailableSessions: 0,
      invalidSessions: 0,
      futureVersionSessions: 0,
      undatedUsageEntries: 0,
      complete: true
    }
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
