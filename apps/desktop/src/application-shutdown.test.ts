import { describe, expect, it, vi } from "vitest";
import { createApplicationShutdownController } from "./application-shutdown.js";

describe("ApplicationShutdownController", () => {
  it("prevents quit until the Agent Host stop settles, then allows the recursive quit", async () => {
    let finishStop!: () => void;
    const stopAgentHost = vi.fn(() => new Promise<void>((resolve) => { finishStop = resolve; }));
    const quit = vi.fn();
    const controller = createApplicationShutdownController({ stopAgentHost, quit });
    const firstEvent = { preventDefault: vi.fn() };
    const repeatedEvent = { preventDefault: vi.fn() };

    controller.handleBeforeQuit(firstEvent);
    controller.handleBeforeQuit(repeatedEvent);
    await Promise.resolve();
    expect(controller.isShuttingDown()).toBe(true);
    expect(firstEvent.preventDefault).toHaveBeenCalledOnce();
    expect(repeatedEvent.preventDefault).toHaveBeenCalledOnce();
    expect(stopAgentHost).toHaveBeenCalledOnce();
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
});
