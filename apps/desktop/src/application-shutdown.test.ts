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
});
