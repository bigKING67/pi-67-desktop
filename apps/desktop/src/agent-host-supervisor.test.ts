import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow, UtilityProcess } from "electron";

const electronMocks = vi.hoisted(() => {
  let nextPortId = 0;
  return {
    fork: vi.fn(),
    MessageChannelMain: class {
      readonly port1 = { id: `host-port-${++nextPortId}` };
      readonly port2 = { id: `renderer-port-${nextPortId}` };
    }
  };
});

vi.mock("electron", () => ({
  MessageChannelMain: electronMocks.MessageChannelMain,
  utilityProcess: { fork: electronMocks.fork }
}));

import { AgentHostSupervisor } from "./agent-host-supervisor.js";

describe("AgentHostSupervisor", () => {
  beforeEach(() => {
    electronMocks.fork.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reuses the MessagePort for the same Renderer document", () => {
    const host = fakeUtilityProcess();
    const window = fakeWindow("app://pi67/index.html");
    electronMocks.fork.mockReturnValue(host as unknown as UtilityProcess);
    const supervisor = createSupervisor(window.value);

    supervisor.connect();
    host.emit("spawn");
    const firstHandoff = window.postMessage.mock.calls[0]?.[1] as { hostEpoch?: number } | undefined;
    supervisor.connect();

    expect(electronMocks.fork).toHaveBeenCalledOnce();
    expect(host.postMessage).toHaveBeenCalledOnce();
    expect(window.postMessage).toHaveBeenCalledOnce();
    expect(firstHandoff?.hostEpoch).toBe(1);
  });

  it("hands off a new MessagePort after the Renderer document changes", () => {
    const host = fakeUtilityProcess();
    const window = fakeWindow("app://pi67/index.html");
    electronMocks.fork.mockReturnValue(host as unknown as UtilityProcess);
    const supervisor = createSupervisor(window.value);

    supervisor.connect();
    host.emit("spawn");
    window.setRoutingId(23);
    supervisor.connect();

    expect(electronMocks.fork).toHaveBeenCalledOnce();
    expect(host.postMessage).toHaveBeenCalledTimes(2);
    expect(window.postMessage).toHaveBeenCalledTimes(2);
  });

  it("allows an explicit same-document MessagePort replacement", () => {
    const host = fakeUtilityProcess();
    const window = fakeWindow("app://pi67/index.html");
    electronMocks.fork.mockReturnValue(host as unknown as UtilityProcess);
    const supervisor = createSupervisor(window.value);

    supervisor.connect();
    host.emit("spawn");
    supervisor.connect(true);

    expect(electronMocks.fork).toHaveBeenCalledOnce();
    expect(host.postMessage).toHaveBeenCalledTimes(2);
    expect(window.postMessage).toHaveBeenCalledTimes(2);
  });

  it("does not bypass the supervised restart backoff when reconnect is requested", async () => {
    vi.useFakeTimers();
    const firstHost = fakeUtilityProcess();
    const secondHost = fakeUtilityProcess();
    const window = fakeWindow("app://pi67/index.html");
    electronMocks.fork
      .mockReturnValueOnce(firstHost as unknown as UtilityProcess)
      .mockReturnValueOnce(secondHost as unknown as UtilityProcess);
    const supervisor = createSupervisor(window.value);

    supervisor.connect();
    firstHost.emit("exit", 1);
    supervisor.connect();
    expect(electronMocks.fork).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(499);
    expect(electronMocks.fork).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(electronMocks.fork).toHaveBeenCalledTimes(2);
  });

  it("hands off a new MessagePort when a restarted Host advances the epoch", async () => {
    vi.useFakeTimers();
    const firstHost = fakeUtilityProcess();
    const secondHost = fakeUtilityProcess();
    const window = fakeWindow("app://pi67/index.html");
    electronMocks.fork
      .mockReturnValueOnce(firstHost as unknown as UtilityProcess)
      .mockReturnValueOnce(secondHost as unknown as UtilityProcess);
    const supervisor = createSupervisor(window.value);

    supervisor.connect();
    firstHost.emit("spawn");
    firstHost.emit("exit", 1);
    await vi.advanceTimersByTimeAsync(500);
    secondHost.emit("spawn");

    expect(window.postMessage).toHaveBeenCalledTimes(2);
    expect(window.postMessage.mock.calls.map((call) => (
      call[1] as { hostEpoch: number }
    ).hostEpoch)).toEqual([1, 2]);
  });

  it("does not transfer a renewed Port to an unexpected renderer location", () => {
    const host = fakeUtilityProcess();
    const window = fakeWindow("https://example.invalid/");
    electronMocks.fork.mockReturnValue(host as unknown as UtilityProcess);
    const supervisor = createSupervisor(window.value);

    supervisor.connect();
    host.emit("spawn");
    supervisor.connect();

    expect(host.postMessage).not.toHaveBeenCalled();
    expect(window.postMessage).not.toHaveBeenCalled();
  });

  it("replaces a Host whose Pi runtime failed the abort watchdog", async () => {
    vi.useFakeTimers();
    const firstHost = fakeUtilityProcess();
    const secondHost = fakeUtilityProcess();
    const window = fakeWindow("app://pi67/index.html");
    electronMocks.fork
      .mockReturnValueOnce(firstHost as unknown as UtilityProcess)
      .mockReturnValueOnce(secondHost as unknown as UtilityProcess);
    const supervisor = createSupervisor(window.value);
    supervisor.connect();

    firstHost.emit("message", {
      type: "agent-host-runtime-poisoned",
      code: "ABORT_WATCHDOG_EXPIRED",
      operationId: "operation-1",
      abortTimeoutMs: 10_000,
      rawRuntime: "must be rejected"
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(firstHost.kill).not.toHaveBeenCalled();

    firstHost.emit("message", {
      type: "agent-host-runtime-poisoned",
      code: "ABORT_WATCHDOG_EXPIRED",
      operationId: "operation-1",
      abortTimeoutMs: 10_000
    });
    await vi.advanceTimersByTimeAsync(49);
    expect(firstHost.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(firstHost.kill).toHaveBeenCalledOnce();

    firstHost.emit("exit", 70);
    expect(window.send).toHaveBeenCalledWith("pi67:agent-host-failed", {
      code: 70,
      recoverable: true,
      attempt: 1
    });
    await vi.advanceTimersByTimeAsync(500);
    expect(electronMocks.fork).toHaveBeenCalledTimes(2);
  });

  it("waits for shutdown completion and process exit before resolving a graceful stop", async () => {
    const host = fakeUtilityProcess();
    const window = fakeWindow("app://pi67/index.html");
    electronMocks.fork.mockReturnValue(host as unknown as UtilityProcess);
    const supervisor = createSupervisor(window.value);
    supervisor.connect();
    host.emit("spawn");

    const firstStop = supervisor.stop();
    const secondStop = supervisor.stop();
    expect(secondStop).toBe(firstStop);
    expect(host.postMessage).toHaveBeenLastCalledWith({
      type: "agent-host-shutdown",
      reason: "application-quit",
      deadlineMs: 3_750
    });
    host.emit("message", {
      type: "agent-host-shutdown-complete",
      activeOperation: "cancelled",
      queuedCommandsDropped: 2,
      extensionRequestsCancelled: 1
    });

    let settled = false;
    void firstStop.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    host.emit("exit", 0);
    await expect(firstStop).resolves.toEqual({
      graceful: true,
      forced: false,
      activeOperation: "cancelled",
      queuedCommandsDropped: 2,
      extensionRequestsCancelled: 1
    });
    expect(host.kill).not.toHaveBeenCalled();
  });

  it("force kills a Host that misses the bounded shutdown deadline", async () => {
    vi.useFakeTimers();
    const host = fakeUtilityProcess();
    const window = fakeWindow("app://pi67/index.html");
    electronMocks.fork.mockReturnValue(host as unknown as UtilityProcess);
    const supervisor = createSupervisor(window.value, 100);
    supervisor.connect();
    host.emit("spawn");

    const stopping = supervisor.stop();
    supervisor.connect();
    supervisor.attachPort();
    expect(host.postMessage).toHaveBeenCalledTimes(2);
    expect(window.postMessage).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(100);

    await expect(stopping).resolves.toEqual({
      graceful: false,
      forced: true,
      activeOperation: "none",
      queuedCommandsDropped: 0,
      extensionRequestsCancelled: 0
    });
    expect(host.kill).toHaveBeenCalledOnce();
  });
});

function createSupervisor(window: BrowserWindow, shutdownDeadlineMs?: number): AgentHostSupervisor {
  return new AgentHostSupervisor({
    agentHostEntry: "/app/agent-host.mjs",
    appInstanceId: "app-1",
    expectedRendererOrigin: "app://pi67",
    getStoragePaths: () => ({
      storageRoot: "/private/user-data",
      capabilityProbeDirectory: "/private/user-data",
      sessionCatalogDirectory: "/private/user-data/projections/session-catalog"
    }),
    getMainWindow: () => window,
    rendererUrl: "app://pi67/index.html",
    ...(shutdownDeadlineMs === undefined ? {} : { shutdownDeadlineMs })
  });
}

function fakeWindow(url: string) {
  const postMessage = vi.fn();
  const send = vi.fn();
  const frame = { processId: 11, routingId: 22 };
  return {
    postMessage,
    send,
    setRoutingId(routingId: number) {
      frame.routingId = routingId;
    },
    value: {
      isDestroyed: () => false,
      webContents: {
        id: 7,
        mainFrame: frame,
        isDestroyed: () => false,
        getURL: () => url,
        postMessage,
        send
      }
    } as unknown as BrowserWindow
  };
}

function fakeUtilityProcess() {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const stream = { on: vi.fn() };
  return {
    postMessage: vi.fn(),
    kill: vi.fn(),
    stdout: stream,
    stderr: stream,
    on(event: string, listener: (...args: unknown[]) => void) {
      const eventListeners = listeners.get(event) ?? [];
      eventListeners.push(listener);
      listeners.set(event, eventListeners);
      return this;
    },
    emit(event: string, ...args: unknown[]) {
      for (const listener of listeners.get(event) ?? []) listener(...args);
    }
  };
}
