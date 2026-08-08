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
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("forwards only sanitized Agent Host initialization output in the test capture lane", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("PI67_TEST_CAPTURE_AGENT_INIT", "1");
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const host = fakeUtilityProcess();
    electronMocks.fork.mockReturnValue(host as unknown as UtilityProcess);
    const supervisor = createSupervisor(fakeWindow("app://pi67/index.html").value);

    supervisor.connect();
    host.emitStderr([
      "private utility output",
      '[agent-host:init] {"stage":"load-model-runtime","outcome":"completed","durationMs":12.4,"private":"drop"}',
      ""
    ].join("\n"));

    expect(write).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledWith(
      '[agent-host:init] {"stage":"load-model-runtime","outcome":"completed","durationMs":12}\n'
    );
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

  it("exposes a bounded Main-owned lifecycle snapshot without Host identity", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const firstHost = fakeUtilityProcess();
    const secondHost = fakeUtilityProcess();
    const window = fakeWindow("app://pi67/index.html");
    electronMocks.fork
      .mockReturnValueOnce(firstHost as unknown as UtilityProcess)
      .mockReturnValueOnce(secondHost as unknown as UtilityProcess);
    const supervisor = createSupervisor(window.value);

    expect(supervisor.diagnostics()).toEqual({
      phase: "idle",
      restartCount: 0,
      portHandoffCount: 0,
      poisonedRuntimeReplacementCount: 0,
      poisonedRuntimeReplacementPending: false
    });

    supervisor.connect();
    expect(supervisor.diagnostics()).toMatchObject({ phase: "starting", hostEpoch: 1 });

    firstHost.emit("spawn");
    expect(supervisor.diagnostics()).toEqual({
      phase: "running",
      hostEpoch: 1,
      processStartRequestedAt: 10_000,
      processStartedAt: 10_000,
      lastSpawnDurationMs: 0,
      restartCount: 0,
      portHandoffCount: 1,
      lastPortHandoffAt: 10_000,
      poisonedRuntimeReplacementCount: 0,
      poisonedRuntimeReplacementPending: false
    });

    vi.setSystemTime(11_000);
    firstHost.emit("exit", 17);
    expect(supervisor.diagnostics()).toEqual({
      phase: "restart-scheduled",
      processStartRequestedAt: 10_000,
      lastSpawnDurationMs: 0,
      lastExit: {
        at: 11_000,
        code: 17,
        recoverable: true,
        attempt: 1
      },
      restartScheduledAt: 11_500,
      restartCount: 1,
      portHandoffCount: 1,
      lastPortHandoffAt: 10_000,
      poisonedRuntimeReplacementCount: 0,
      poisonedRuntimeReplacementPending: false
    });

    await vi.advanceTimersByTimeAsync(500);
    expect(supervisor.diagnostics()).toMatchObject({
      phase: "starting",
      hostEpoch: 2,
      portHandoffCount: 1
    });
    expect(JSON.stringify(supervisor.diagnostics())).not.toContain("hostInstanceId");
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
    expect(supervisor.diagnostics()).toMatchObject({
      poisonedRuntimeReplacementCount: 0,
      poisonedRuntimeReplacementPending: false
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(firstHost.kill).not.toHaveBeenCalled();

    firstHost.emit("message", {
      type: "agent-host-runtime-poisoned",
      code: "ABORT_WATCHDOG_EXPIRED",
      operationId: "operation-1",
      abortTimeoutMs: 10_000
    });
    expect(supervisor.diagnostics()).toMatchObject({
      poisonedRuntimeReplacementCount: 1,
      poisonedRuntimeReplacementPending: true
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
  const stdout = fakeStream();
  const stderr = fakeStream();
  return {
    postMessage: vi.fn(),
    kill: vi.fn(),
    stdout,
    stderr,
    on(event: string, listener: (...args: unknown[]) => void) {
      const eventListeners = listeners.get(event) ?? [];
      eventListeners.push(listener);
      listeners.set(event, eventListeners);
      return this;
    },
    emit(event: string, ...args: unknown[]) {
      for (const listener of listeners.get(event) ?? []) listener(...args);
    },
    emitStderr(chunk: string) {
      stderr.emit("data", chunk);
    }
  };
}

function fakeStream() {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  return {
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
