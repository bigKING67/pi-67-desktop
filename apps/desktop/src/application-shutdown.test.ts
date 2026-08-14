import { afterEach, describe, expect, it, vi } from "vitest";
import { createApplicationShutdownController } from "./application-shutdown.js";

describe("ApplicationShutdownController", () => {
  afterEach(() => vi.useRealTimers());

  it("prevents quit until the Agent Host stop settles, then allows the recursive quit", async () => {
    let finishStop!: () => void;
    const stopAgentHost = vi.fn(() => new Promise<void>((resolve) => { finishStop = resolve; }));
    const quit = vi.fn();
    const controller = createApplicationShutdownController({ stopAgentHost, quit });
    const firstEvent = { preventDefault: vi.fn() };
    const repeatedEvent = { preventDefault: vi.fn() };

    controller.handleBeforeQuit(firstEvent);
    controller.handleBeforeQuit(repeatedEvent);
    await vi.waitFor(() => expect(stopAgentHost).toHaveBeenCalledOnce());
    expect(controller.isShuttingDown()).toBe(true);
    expect(firstEvent.preventDefault).toHaveBeenCalledOnce();
    expect(repeatedEvent.preventDefault).toHaveBeenCalledOnce();
    expect(quit).not.toHaveBeenCalled();

    finishStop();
    await vi.waitFor(() => expect(quit).toHaveBeenCalledOnce());

    const recursiveEvent = { preventDefault: vi.fn() };
    controller.handleBeforeQuit(recursiveEvent);
    expect(recursiveEvent.preventDefault).not.toHaveBeenCalled();
    expect(stopAgentHost).toHaveBeenCalledOnce();
  });

  it("reports stop failures but still releases the application quit gate", async () => {
    const failure = new Error("stop failed");
    const onError = vi.fn();
    const quit = vi.fn();
    const controller = createApplicationShutdownController({
      stopAgentHost: async () => { throw failure; },
      quit,
      onError
    });

    controller.handleBeforeQuit({ preventDefault: vi.fn() });
    await vi.waitFor(() => expect(quit).toHaveBeenCalledOnce());
    expect(onError).toHaveBeenCalledWith(failure);
  });

  it("marks the workbench clean only after the Agent Host stops", async () => {
    const order: string[] = [];
    const controller = createApplicationShutdownController({
      stopAgentHost: async () => { order.push("host-stopped"); },
      markCleanExit: async () => { order.push("workbench-clean"); },
      quit: () => { order.push("quit"); }
    });

    controller.handleBeforeQuit({ preventDefault: vi.fn() });
    await vi.waitFor(() => expect(order).toEqual(["host-stopped", "workbench-clean", "quit"]));
  });

  it("checkpoints renderer-owned state before stopping the Agent Host", async () => {
    const order: string[] = [];
    const controller = createApplicationShutdownController({
      checkpointRenderer: async () => { order.push("renderer-checkpointed"); return true; },
      stopAgentHost: async () => { order.push("host-stopped"); },
      markCleanExit: async () => { order.push("workbench-clean"); },
      quit: () => { order.push("quit"); }
    });

    controller.handleBeforeQuit({ preventDefault: vi.fn() });
    await vi.waitFor(() => expect(order).toEqual([
      "renderer-checkpointed",
      "host-stopped",
      "workbench-clean",
      "quit"
    ]));
  });

  it("keeps the workbench dirty when the renderer checkpoint is not acknowledged", async () => {
    const markCleanExit = vi.fn();
    const stopAgentHost = vi.fn(async () => undefined);
    const quit = vi.fn();
    const controller = createApplicationShutdownController({
      checkpointRenderer: async () => false,
      stopAgentHost,
      markCleanExit,
      quit
    });

    controller.handleBeforeQuit({ preventDefault: vi.fn() });
    await vi.waitFor(() => expect(quit).toHaveBeenCalledOnce());
    expect(stopAgentHost).toHaveBeenCalledOnce();
    expect(markCleanExit).not.toHaveBeenCalled();
  });

  it("cleans Main-owned transient resources after the Agent Host stops", async () => {
    const order: string[] = [];
    const controller = createApplicationShutdownController({
      stopAgentHost: async () => { order.push("host-stopped"); },
      afterAgentHostStop: async () => { order.push("transient-cleaned"); },
      markCleanExit: async () => { order.push("workbench-clean"); },
      quit: () => { order.push("quit"); }
    });

    controller.handleBeforeQuit({ preventDefault: vi.fn() });
    await vi.waitFor(() => expect(order).toEqual([
      "host-stopped",
      "transient-cleaned",
      "workbench-clean",
      "quit"
    ]));
  });

  it("keeps the workbench dirty when Agent Host shutdown fails", async () => {
    const markCleanExit = vi.fn();
    const quit = vi.fn();
    const controller = createApplicationShutdownController({
      stopAgentHost: async () => { throw new Error("stop failed"); },
      markCleanExit,
      quit
    });

    controller.handleBeforeQuit({ preventDefault: vi.fn() });
    await vi.waitFor(() => expect(quit).toHaveBeenCalledOnce());
    expect(markCleanExit).not.toHaveBeenCalled();
  });

  it("shares one bounded deadline across a slow renderer checkpoint and Agent Host stop", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const checkpointRenderer = vi.fn((deadlineMs: number) => new Promise<boolean>((resolve) => {
      setTimeout(() => resolve(false), deadlineMs);
    }));
    const stopAgentHost = vi.fn((deadlineMs: number) => new Promise<void>((resolve) => {
      setTimeout(resolve, deadlineMs);
    }));
    const markCleanExit = vi.fn(async () => undefined);
    const quit = vi.fn();
    const onComplete = vi.fn();
    const controller = createApplicationShutdownController({
      checkpointRenderer,
      stopAgentHost,
      markCleanExit,
      quit,
      onComplete,
      shutdownBudgetMs: 2_000,
      rendererCheckpointBudgetMs: 400,
      finalizationReserveMs: 300,
      now: () => Date.now()
    });

    controller.handleBeforeQuit({ preventDefault: vi.fn() });
    expect(checkpointRenderer).toHaveBeenCalledWith(400);
    await vi.advanceTimersByTimeAsync(400);
    expect(stopAgentHost).toHaveBeenCalledWith(1_300);
    await vi.advanceTimersByTimeAsync(1_300);

    expect(markCleanExit).not.toHaveBeenCalled();
    expect(quit).toHaveBeenCalledOnce();
    expect(onComplete).toHaveBeenCalledWith({
      agentHostStopDurationMs: 1_300,
      agentHostStopped: true,
      budgetMs: 2_000,
      deadlineExceeded: false,
      durationMs: 1_700,
      rendererCheckpointDurationMs: 400,
      rendererCheckpointed: false
    });
  });

  it("releases the application at the total deadline when a shutdown stage hangs", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const stopAgentHost = vi.fn(() => new Promise<never>(() => undefined));
    const markCleanExit = vi.fn(async () => undefined);
    const quit = vi.fn();
    const onComplete = vi.fn();
    const controller = createApplicationShutdownController({
      checkpointRenderer: async () => true,
      stopAgentHost,
      markCleanExit,
      quit,
      onComplete,
      shutdownBudgetMs: 1_000,
      rendererCheckpointBudgetMs: 200,
      finalizationReserveMs: 200,
      now: () => Date.now()
    });

    controller.handleBeforeQuit({ preventDefault: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    expect(stopAgentHost).toHaveBeenCalledWith(800);
    await vi.advanceTimersByTimeAsync(999);
    expect(quit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(quit).toHaveBeenCalledOnce();
    expect(markCleanExit).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledWith({
      agentHostStopped: false,
      budgetMs: 1_000,
      deadlineExceeded: true,
      durationMs: 1_000,
      rendererCheckpointDurationMs: 0,
      rendererCheckpointed: true
    });
  });

  it("keeps the workbench dirty if Main-owned finalization misses the total deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const markCleanExit = vi.fn(async () => undefined);
    const quit = vi.fn();
    const controller = createApplicationShutdownController({
      checkpointRenderer: async () => true,
      stopAgentHost: async () => undefined,
      afterAgentHostStop: () => new Promise<never>(() => undefined),
      markCleanExit,
      quit,
      shutdownBudgetMs: 1_000,
      rendererCheckpointBudgetMs: 200,
      finalizationReserveMs: 200,
      now: () => Date.now()
    });

    controller.handleBeforeQuit({ preventDefault: vi.fn() });
    await vi.advanceTimersByTimeAsync(1_000);

    expect(quit).toHaveBeenCalledOnce();
    expect(markCleanExit).not.toHaveBeenCalled();
  });

  it("rejects stage budgets that cannot fit inside the application deadline", () => {
    expect(() => createApplicationShutdownController({
      stopAgentHost: async () => undefined,
      quit: vi.fn(),
      shutdownBudgetMs: 1_000,
      rendererCheckpointBudgetMs: 700,
      finalizationReserveMs: 300
    })).toThrow("Application shutdown stage budgets exceed the total budget.");
  });
});
