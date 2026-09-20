import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow, UtilityProcess } from "electron";

const electronMocks = vi.hoisted(() => ({
  fork: vi.fn(),
  MessageChannelMain: class {
    readonly port1 = {};
    readonly port2 = {};
  }
}));

vi.mock("electron", () => ({
  MessageChannelMain: electronMocks.MessageChannelMain,
  utilityProcess: { fork: electronMocks.fork }
}));

import { AgentHostSupervisor } from "./agent-host-supervisor.js";
import { EnterpriseCredentialSupervisor, type EnterpriseCredentialBrokerPort } from "./enterprise-credential-supervisor.js";

describe("AgentHostSupervisor readiness", () => {
  it("starts background work only after OS and Host readiness, once and after port handoff", () => {
    const host = fakeUtilityProcess(), window = fakeWindow();
    electronMocks.fork.mockReturnValue(host as unknown as UtilityProcess);
    const onReady = vi.fn(() => expect(window.postMessage).toHaveBeenCalledOnce());
    const supervisor = createSupervisor(window.value, undefined, onReady);
    supervisor.connect();
    host.emit("message", readyMessage());
    expect(onReady).not.toHaveBeenCalled();
    host.emit("spawn");
    host.emit("message", readyMessage());
    expect(onReady).toHaveBeenCalledOnce();
  });
  it.each(["power", "exit", "stop"])("routes head observations only through a ready Host and retires them on %s", async action => {
    vi.useFakeTimers(); const host = fakeUtilityProcess();
    electronMocks.fork.mockReturnValue(host as unknown as UtilityProcess);
    const supervisor = createSupervisor(fakeWindow().value), caller = new AbortController();
    const id = "00000000-0000-4000-8000-000000000001";
    const input = { owner: { userId: "user", endpoint: "https://service.invalid", teamId: id, scopeKind: "team" as const, scopeId: id },
      models: { embedding: { endpoint: "https://model.invalid/v1", model: "embed", dimension: 4 }, extraction: { endpoint: "https://model.invalid/v1", model: "extract" } },
      snapshot: { epoch: id, cursor: "7" }, permissionRevision: "a".repeat(64) };
    supervisor.connect();
    await expect(supervisor.teamIndexHeads.verify(input, caller.signal)).rejects.toThrow();
    host.emit("spawn"); host.emit("message", readyMessage());
    const pending = supervisor.teamIndexHeads.verify(input, caller.signal);
    const request = host.postMessage.mock.calls.at(-1)![0];
    expect(request.type).toBe("team-index-head-check");
    host.emit("message", { type: "team-index-head-result", requestId: request.requestId, ok: true, validUntil: Date.now() + 60_000 });
    const check = await pending; check();
    let stopping: ReturnType<typeof supervisor.stop> | undefined;
    if (action === "power") supervisor.notifyPowerTransition("suspend");
    if (action === "exit") host.emit("exit", 1);
    if (action === "stop") stopping = supervisor.stop();
    expect(check).toThrow();
    expect(host.postMessage).toHaveBeenCalledWith({ type: "team-index-head-cancel", requestId: request.requestId });
    await expect(supervisor.teamIndexHeads.verify(input, caller.signal)).rejects.toThrow();
    stopping ??= supervisor.stop(); host.emit("exit", 0); await stopping;
  });
  it("answers a receipt request through the actual Main dispatcher without opening access before sign-in", async () => {
    const host = fakeUtilityProcess();
    electronMocks.fork.mockReturnValue(host as unknown as UtilityProcess);
    const supervisor = createSupervisor(fakeWindow().value);
    supervisor.connect();
    const id = "00000000-0000-4000-8000-000000000001";
    host.emit("message", { type: "shared-knowledge-receipt-open", requestId: "receipt-open",
      scope: { teamId: id, scopeKind: "team", scopeId: id } });
    await Promise.resolve(); await Promise.resolve();
    expect(host.postMessage).toHaveBeenCalledWith({ type: "shared-knowledge-receipt-open-result",
      requestId: "receipt-open", ok: false, errorCode: "NOT_SIGNED_IN" });
  });
  it("invalidates receipt bindings on start, exact Host exit and stop", async () => {
    vi.useFakeTimers();
    const invalidation = vi.spyOn(EnterpriseCredentialSupervisor.prototype, "invalidateReceiptBindings");
    const host = fakeUtilityProcess();
    electronMocks.fork.mockReturnValue(host as unknown as UtilityProcess);
    const supervisor = createSupervisor(fakeWindow().value);
    supervisor.connect();
    expect(invalidation).toHaveBeenCalledTimes(1);
    host.emit("exit", 1);
    expect(invalidation).toHaveBeenCalledTimes(2);
    await supervisor.stop();
    expect(invalidation).toHaveBeenCalledTimes(3);
    host.emit("exit", 1);
    expect(invalidation).toHaveBeenCalledTimes(3);
  });
  it("retains power state without starting a Host and sends it before renderer handoff", () => {
    const host = fakeUtilityProcess();
    electronMocks.fork.mockReturnValue(host as unknown as UtilityProcess);
    const supervisor = createSupervisor(fakeWindow().value);
    supervisor.notifyPowerTransition("suspend");
    expect(electronMocks.fork).not.toHaveBeenCalled();
    supervisor.connect();
    expect(host.postMessage).not.toHaveBeenCalled();
    host.emit("spawn"); host.emit("message", readyMessage());
    expect(host.postMessage.mock.calls[0]?.[0]).toEqual({ type: "enterprise-power-transition", state: "suspend" });
    supervisor.notifyPowerTransition("resume");
    expect(host.postMessage).toHaveBeenLastCalledWith({ type: "enterprise-power-transition", state: "resume" });
  });
  beforeEach(() => {
    electronMocks.fork.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does not transfer a Port until the current Host emits an exact readiness signal", () => {
    const host = fakeUtilityProcess();
    const window = fakeWindow();
    electronMocks.fork.mockReturnValue(host as unknown as UtilityProcess);
    const supervisor = createSupervisor(window.value);

    supervisor.connect();
    host.emit("spawn");
    supervisor.connect(true);
    supervisor.attachPort();
    host.emit("message", { type: "agent-host-ready", detail: "not allowed" });

    expect(supervisor.diagnostics()).toMatchObject({ phase: "starting", portHandoffCount: 0 });
    expect(host.postMessage).not.toHaveBeenCalled();
    expect(window.postMessage).not.toHaveBeenCalled();

    host.emit("message", readyMessage());
    host.emit("message", readyMessage());

    expect(supervisor.diagnostics()).toMatchObject({ phase: "running", portHandoffCount: 1 });
    expect(host.postMessage).toHaveBeenCalledOnce();
    expect(window.postMessage).toHaveBeenCalledOnce();
  });

  it("requires readiness from each exact restarted Host", async () => {
    vi.useFakeTimers();
    const firstHost = fakeUtilityProcess();
    const secondHost = fakeUtilityProcess();
    const window = fakeWindow();
    electronMocks.fork
      .mockReturnValueOnce(firstHost as unknown as UtilityProcess)
      .mockReturnValueOnce(secondHost as unknown as UtilityProcess);
    const supervisor = createSupervisor(window.value);

    supervisor.connect();
    firstHost.emit("spawn");
    firstHost.emit("exit", 1);
    await vi.advanceTimersByTimeAsync(500);
    secondHost.emit("spawn");
    firstHost.emit("message", readyMessage());

    expect(supervisor.diagnostics()).toMatchObject({ phase: "starting", hostEpoch: 2 });
    expect(window.postMessage).not.toHaveBeenCalled();

    secondHost.emit("message", readyMessage());

    expect(supervisor.diagnostics()).toMatchObject({ phase: "running", hostEpoch: 2 });
    expect(window.postMessage).toHaveBeenCalledOnce();
    expect(window.postMessage.mock.calls[0]?.[1]).toMatchObject({ hostEpoch: 2 });
  });

  it("accepts readiness before spawn but waits for OS process authority", () => {
    const host = fakeUtilityProcess();
    const window = fakeWindow();
    electronMocks.fork.mockReturnValue(host as unknown as UtilityProcess);
    const supervisor = createSupervisor(window.value);

    supervisor.connect();
    host.emit("message", readyMessage());

    expect(supervisor.diagnostics()).toMatchObject({ phase: "starting", portHandoffCount: 0 });
    expect(window.postMessage).not.toHaveBeenCalled();

    host.emit("spawn");

    expect(supervisor.diagnostics()).toMatchObject({ phase: "running", portHandoffCount: 1 });
    expect(window.postMessage).toHaveBeenCalledOnce();
  });

  it("hands off the Agent Host before enterprise credential restoration settles", async () => {
    let resolveLoad!: (value: { storage: "available" }) => void;
    const loading = new Promise<{ storage: "available" }>((resolve) => {
      resolveLoad = resolve;
    });
    const host = fakeUtilityProcess();
    const window = fakeWindow();
    electronMocks.fork.mockReturnValue(host as unknown as UtilityProcess);
    const supervisor = createSupervisor(window.value, {
      load: () => loading,
      store: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined)
    });

    supervisor.connect();
    host.emit("spawn");
    host.emit("message", readyMessage());

    expect(supervisor.diagnostics()).toMatchObject({ phase: "running", portHandoffCount: 1 });
    expect(window.postMessage).toHaveBeenCalledOnce();
    expect(host.postMessage).toHaveBeenCalledOnce();

    resolveLoad({ storage: "available" });
    await vi.waitFor(() => {
      expect(host.postMessage).toHaveBeenCalledWith({
        type: "enterprise-credential-bootstrap",
        storage: "available"
      });
    });
  });

  it("ignores readiness after shutdown begins", () => {
    const host = fakeUtilityProcess();
    const window = fakeWindow();
    electronMocks.fork.mockReturnValue(host as unknown as UtilityProcess);
    const supervisor = createSupervisor(window.value);

    supervisor.connect();
    host.emit("spawn");
    void supervisor.stop();
    host.emit("message", readyMessage());

    expect(supervisor.diagnostics()).toMatchObject({ phase: "stopping", portHandoffCount: 0 });
    expect(window.postMessage).not.toHaveBeenCalled();
    expect(host.postMessage).toHaveBeenCalledOnce();
    expect(host.postMessage).toHaveBeenCalledWith({
      type: "agent-host-shutdown",
      reason: "application-quit",
      deadlineMs: 3_750
    });
  });

  it("uses the application-provided deadline for a bounded stop", async () => {
    vi.useFakeTimers();
    const host = fakeUtilityProcess();
    const window = fakeWindow();
    electronMocks.fork.mockReturnValue(host as unknown as UtilityProcess);
    const supervisor = createSupervisor(window.value);
    supervisor.connect();
    host.emit("spawn");
    host.emit("message", readyMessage());

    const stopping = supervisor.stop(600);
    expect(host.postMessage).toHaveBeenLastCalledWith({
      type: "agent-host-shutdown",
      reason: "application-quit",
      deadlineMs: 350
    });
    await vi.advanceTimersByTimeAsync(599);
    expect(host.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    await expect(stopping).resolves.toMatchObject({ graceful: false, forced: true });
    expect(host.kill).toHaveBeenCalledOnce();
  });
});

function createSupervisor(
  window: BrowserWindow,
  enterpriseCredentials?: EnterpriseCredentialBrokerPort,
  onReady?: () => void
): AgentHostSupervisor {
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
    ...(onReady === undefined ? {} : { onReady }),
    ...(enterpriseCredentials === undefined
      ? {}
      : { getEnterpriseCredentials: () => enterpriseCredentials }),
    rendererUrl: "app://pi67/index.html"
  });
}

function fakeWindow() {
  const postMessage = vi.fn();
  return {
    postMessage,
    value: {
      isDestroyed: () => false,
      webContents: {
        id: 7,
        mainFrame: { processId: 11, routingId: 22 },
        isDestroyed: () => false,
        getURL: () => "app://pi67/index.html",
        postMessage,
        send: vi.fn()
      }
    } as unknown as BrowserWindow
  };
}

function fakeUtilityProcess() {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  return {
    postMessage: vi.fn(),
    kill: vi.fn(),
    stdout: undefined,
    stderr: undefined,
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

function readyMessage() {
  return {
    type: "agent-host-ready",
    startup: { profileMode: "fresh", status: "ready", issues: [] }
  };
}
