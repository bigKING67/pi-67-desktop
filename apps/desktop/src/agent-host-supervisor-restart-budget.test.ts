import type {} from "../../renderer/src/platform.js";
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

describe("AgentHostSupervisor restart budget", () => {
  beforeEach(() => {
    electronMocks.fork.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("blocks reconnect after the crash budget is exhausted until an explicit restart", async () => {
    vi.useFakeTimers();
    const hosts = Array.from({ length: 6 }, () => fakeUtilityProcess());
    for (const host of hosts) electronMocks.fork.mockReturnValueOnce(host as unknown as UtilityProcess);
    const supervisor = createSupervisor(fakeWindow("app://pi67/index.html").value);
    supervisor.connect();
    for (const [index, delay] of [500, 1_000, 2_000].entries()) {
      hosts[index]!.emit("exit", 1);
      await vi.advanceTimersByTimeAsync(delay);
    }
    hosts[3]!.emit("exit", 1);
    expect(supervisor.diagnostics()).toMatchObject({ phase: "failed", restartCount: 3, lastExit: { recoverable: false } });
    supervisor.connect();
    supervisor.connect(true);
    await vi.advanceTimersByTimeAsync(60_000);
    supervisor.connect(true);
    expect(electronMocks.fork).toHaveBeenCalledTimes(4);
    supervisor.restart();
    expect(electronMocks.fork).toHaveBeenCalledTimes(5);
    expect(supervisor.diagnostics()).toMatchObject({ phase: "starting", hostEpoch: 5 });
    hosts[4]!.emit("exit", 1);
    await vi.advanceTimersByTimeAsync(500);
    expect(electronMocks.fork).toHaveBeenCalledTimes(6);
  });

  it("keeps the exhausted budget closed across the Renderer automatic connection flight", async () => {
    const { ensureAgentConnection } = await import("../../renderer/src/connection/connection-recovery.js");
    const { agentConnectionController: controller } = await import("../../renderer/src/connection/AgentConnectionController.js");
    vi.useFakeTimers();
    const hosts = Array.from({ length: 5 }, () => fakeUtilityProcess());
    for (const host of hosts) electronMocks.fork.mockReturnValueOnce(host as unknown as UtilityProcess);
    const supervisor = createSupervisor(fakeWindow("app://pi67/index.html").value);
    vi.stubGlobal("window", { pi67: { system: {
      connectAgentHost: async (options: { replaceCurrent: boolean }) => supervisor.connect(options.replaceCurrent)
    } } });
    vi.spyOn(controller, "identity", "get").mockReturnValue(undefined);
    vi.spyOn(controller, "hasOpenPort", "get").mockReturnValue(false);
    vi.spyOn(controller, "hasReceivedPort", "get").mockReturnValue(true);
    vi.spyOn(controller, "waitForConnectionAfter").mockImplementation(() => (
      new Promise((_, reject) => setTimeout(() => reject(new Error("no replacement port")), 8_000))
    ));
    supervisor.connect();
    hosts[0]!.emit("exit", 1);
    const result = ensureAgentConnection().catch((error: unknown) => error);
    for (const [index, delay] of [500, 1_000, 2_000].entries()) {
      await vi.advanceTimersByTimeAsync(delay);
      hosts[index + 1]!.emit("exit", 1);
    }
    await vi.advanceTimersByTimeAsync(45_000);
    expect(await result).toEqual(new Error("no replacement port"));
    expect(electronMocks.fork).toHaveBeenCalledTimes(4);
    expect(supervisor.diagnostics()).toMatchObject({ phase: "failed", lastExit: { recoverable: false } });
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
