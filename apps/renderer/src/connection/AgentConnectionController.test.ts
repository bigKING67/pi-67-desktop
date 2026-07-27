import {
  eventEnvelope, isRendererHello, isRequestEnvelope, responseEnvelope, welcomeEnvelope,
  type AgentCommandType, type RendererHello, type RequestEnvelope
} from "@pi67/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AgentConnectionController,
  prepareSameHostTransportRetry,
  type AgentPortHandoffTarget
} from "./AgentConnectionController.js";

const controllers: AgentConnectionController[] = [];
const hosts: HostConnection[] = [];

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose();
  for (const host of hosts.splice(0)) host.dispose();
  vi.useRealTimers();
});

describe("AgentConnectionController", () => {
  it("accepts only an exact source and origin handoff", async () => {
    const target = new FakeHandoffTarget();
    const controller = createController(target);
    const wrongSource = createHost(1);
    const wrongOrigin = createHost(1);
    const malformed = createHost(1);

    wrongSource.handoff(target, { source: {} as MessageEventSource });
    wrongOrigin.handoff(target, { origin: "https://attacker.invalid" });
    malformed.handoff(target, { data: { source: "pi67-preload", type: "agent-port", appInstanceId: "app-1", hostEpoch: -1 } });
    await flushMessagePorts();

    expect(controller.hasOpenPort).toBe(false);
    expect(wrongSource.hello).toBeUndefined();
    expect(wrongOrigin.hello).toBeUndefined();
    expect(malformed.hello).toBeUndefined();

    const trusted = createHost(4);
    trusted.handoff(target);
    await expect(controller.waitForConnection()).resolves.toMatchObject({ hostEpoch: 4, appInstanceId: "app-4" });
  });

  it("publishes a connected identity once and replays it to a later subscriber", async () => {
    const target = new FakeHandoffTarget();
    const controller = createController(target);
    const onConnected = vi.fn();
    controller.subscribe({ onConnected });

    createHost(2).handoff(target);
    const identity = await controller.waitForConnection();
    expect(identity).toMatchObject({ hostEpoch: 2, hostInstanceId: "host-2" });
    expect(onConnected).toHaveBeenCalledOnce();

    const lateSubscriber = vi.fn();
    controller.subscribe({ onConnected: lateSubscriber });
    await Promise.resolve();
    expect(lateSubscriber).toHaveBeenCalledOnce();
    expect(lateSubscriber).toHaveBeenCalledWith(identity);
  });

  it("rejects pending work immediately and emits one teardown when the Port closes", async () => {
    const target = new FakeHandoffTarget();
    const controller = createController(target);
    const host = createHost(3);
    const onTeardown = vi.fn();
    controller.subscribe({ onTeardown });
    host.handoff(target);
    await controller.waitForConnection();

    const pending = controller.request("runtime.getStatus", {});
    const rejection = expect(pending).rejects.toMatchObject({ code: "CONNECTION_CLOSED" });
    await host.nextRequest("runtime.getStatus");
    host.closeControllerPort();

    await rejection;
    await vi.waitFor(() => expect(onTeardown).toHaveBeenCalledOnce());
    expect(controller.identity).toBeUndefined();
    expect(controller.hasOpenPort).toBe(false);
  });

  it("tears down once when the Port emits messageerror", async () => {
    const target = new FakeHandoffTarget();
    const controller = createController(target);
    const host = createHost(4);
    const onTeardown = vi.fn();
    controller.subscribe({ onTeardown });
    host.handoff(target);
    await controller.waitForConnection();

    host.controllerPort.dispatchEvent(new Event("messageerror"));

    await vi.waitFor(() => expect(onTeardown).toHaveBeenCalledOnce());
    expect(controller.hasOpenPort).toBe(false);
  });

  it("replaces Host generations without allowing old pending work to survive", async () => {
    const target = new FakeHandoffTarget();
    const controller = createController(target);
    const connectedEpochs: number[] = [];
    controller.subscribe({ onConnected: (identity) => connectedEpochs.push(identity.hostEpoch) });
    const oldHost = createHost(5);
    oldHost.handoff(target);
    await controller.waitForConnection();

    const staleRequest = controller.request("runtime.getStatus", {});
    const rejection = expect(staleRequest).rejects.toMatchObject({ code: "CONNECTION_CLOSED" });
    await oldHost.nextRequest("runtime.getStatus");
    const newHost = createHost(6);
    newHost.handoff(target);

    await rejection;
    await expect(controller.waitForConnection()).resolves.toMatchObject({ hostEpoch: 6, hostInstanceId: "host-6" });
    expect(controller.identity?.hostEpoch).toBe(6);
    expect(connectedEpochs).toEqual([5, 6]);
  });

  it("forwards one sequence gap and resumes events only after projection resync", async () => {
    const target = new FakeHandoffTarget();
    const controller = createController(target);
    const host = createHost(7, 5);
    const onEvent = vi.fn();
    const onSequenceGap = vi.fn();
    controller.subscribe({ onEvent, onSequenceGap });
    host.handoff(target);
    await controller.waitForConnection();

    host.send(eventEnvelope("runtime.statusChanged", readyStatus("gap"), { hostEpoch: 7, sequence: 7 }));
    host.send(eventEnvelope("runtime.statusChanged", readyStatus("still blocked"), { hostEpoch: 7, sequence: 8 }));
    await vi.waitFor(() => expect(onSequenceGap).toHaveBeenCalledOnce());
    expect(onSequenceGap).toHaveBeenCalledWith({ expected: 6, received: 7, hostEpoch: 7 });
    expect(onEvent).not.toHaveBeenCalled();

    const install = vi.fn(() => true);
    const resync = controller.resyncProjection(install);
    const request = await host.nextRequest("projection.resync");
    host.send(responseEnvelope(request.requestId, 7, {
      ok: true,
      type: "projection.resync",
      result: projectionResyncResult(7, 8)
    }));
    await expect(resync).resolves.toBe(true);
    expect(install).toHaveBeenCalledWith(expect.objectContaining({ hostEpoch: 7, eventSequence: 8 }));

    host.send(eventEnvelope("runtime.statusChanged", readyStatus("resynced"), { hostEpoch: 7, sequence: 9 }));
    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledOnce());
    expect(onEvent.mock.calls[0]?.[0]).toEqual({
      type: "runtime.statusChanged",
      payload: readyStatus("resynced")
    });
  });

  it("waits for a future handoff and times out with a structured transport error", async () => {
    vi.useFakeTimers();
    const target = new FakeHandoffTarget();
    const controller = createController(target);
    const waiting = controller.waitForConnection(100);
    let failure: unknown;
    void waiting.catch((error: unknown) => { failure = error; });

    await vi.advanceTimersByTimeAsync(99);
    expect(failure).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(failure).toMatchObject({ code: "CONNECTION_CLOSED" });
  });

  it("disposes its listener, rejects waiters, and ignores later handoffs", async () => {
    const target = new FakeHandoffTarget();
    const controller = createController(target);
    const onTeardown = vi.fn();
    controller.subscribe({ onTeardown });
    const waiting = controller.waitForConnection();

    controller.dispose();

    await expect(waiting).rejects.toMatchObject({ code: "CONNECTION_CLOSED" });
    expect(onTeardown).toHaveBeenCalledOnce();
    expect(target.listenerCount).toBe(0);
    await expect(controller.waitForConnection()).rejects.toMatchObject({ code: "CONNECTION_CLOSED" });
    await expect(controller.request("runtime.getStatus", {})).rejects.toMatchObject({ code: "CONNECTION_CLOSED" });

    const lateHost = createHost(8);
    lateHost.handoff(target);
    await flushMessagePorts();
    expect(lateHost.hello).toBeUndefined();
  });

  it("replays a control mutation once on the same Host epoch with one idempotency key", async () => {
    const target = new FakeHandoffTarget();
    const controller = createController(target);
    const firstHost = createHost(9);
    firstHost.handoff(target);
    await controller.waitForConnection();

    const pending = controller.request("session.create", {});
    const firstRequest = await firstHost.nextRequest("session.create");
    firstHost.closeControllerPort();
    const replacement = createHost(9, 0, "host-9-restarted");
    replacement.handoff(target);
    const secondRequest = await replacement.nextRequest("session.create");
    expect(secondRequest.idempotencyKey).toBe(firstRequest.idempotencyKey);
    const acknowledgement = {
      accepted: true as const,
      hostEpoch: 9,
      sessionId: "session-1",
      sessionGeneration: 1,
      eventSequence: 1
    };
    replacement.send(responseEnvelope(secondRequest.requestId, 9, {
      ok: true,
      type: "session.create",
      result: acknowledgement
    }));

    await expect(pending).resolves.toEqual(acknowledgement);
  });

  it("does not replay an operation acknowledgement after Host authority changes", async () => {
    const target = new FakeHandoffTarget();
    const controller = createController(target);
    const firstHost = createHost(10);
    firstHost.handoff(target);
    await controller.waitForConnection();

    const pending = controller.request("prompt.submit", {
      submissionId: "submission-1",
      text: "test",
      delivery: "new-turn"
    });
    const rejection = expect(pending).rejects.toMatchObject({ code: "CONNECTION_CLOSED" });
    await firstHost.nextRequest("prompt.submit");
    firstHost.closeControllerPort();
    const replacement = createHost(11);
    replacement.handoff(target);
    await controller.waitForConnection();

    await rejection;
    await flushMessagePorts();
    expect(replacement.requests).toHaveLength(0);
  });
});

describe("prepareSameHostTransportRetry", () => {
  it("allows one retry after reconnecting to the same Host epoch", async () => {
    const waitForConnection = vi.fn(async () => identity(4));

    await expect(prepareSameHostTransportRetry(4, waitForConnection)).resolves.toBe(true);
    expect(waitForConnection).toHaveBeenCalledOnce();
  });

  it("fails closed after Host replacement", async () => {
    const waitForConnection = vi.fn(async () => identity(5));

    await expect(prepareSameHostTransportRetry(4, waitForConnection)).resolves.toBe(false);
    expect(waitForConnection).toHaveBeenCalledOnce();
  });

  it("does not wait when the original Host epoch was unavailable", async () => {
    const waitForConnection = vi.fn(async () => identity(4));

    await expect(prepareSameHostTransportRetry(undefined, waitForConnection)).resolves.toBe(false);
    expect(waitForConnection).not.toHaveBeenCalled();
  });
});

class FakeHandoffTarget implements AgentPortHandoffTarget {
  readonly source = {} as MessageEventSource;
  readonly origin = "app://pi67";
  private readonly listeners = new Set<(event: MessageEvent) => void>();

  get listenerCount(): number {
    return this.listeners.size;
  }

  addMessageListener(listener: (event: MessageEvent) => void): void {
    this.listeners.add(listener);
  }

  removeMessageListener(listener: (event: MessageEvent) => void): void {
    this.listeners.delete(listener);
  }

  dispatch(
    port: MessagePort,
    overrides: { source?: MessageEventSource; origin?: string; data?: unknown } = {}
  ): void {
    const event = {
      source: overrides.source ?? this.source,
      origin: overrides.origin ?? this.origin,
      data: overrides.data ?? handoff(1),
      ports: [port]
    } as unknown as MessageEvent;
    for (const listener of this.listeners) listener(event);
  }
}

class HostConnection {
  readonly channel = new MessageChannel();
  readonly requests: RequestEnvelope[] = [];
  hello: RendererHello | undefined;
  private readonly requestWaiters: Array<(request: RequestEnvelope) => void> = [];

  constructor(
    readonly hostEpoch: number,
    private readonly eventSequence = 0,
    private readonly hostInstanceId = `host-${hostEpoch}`
  ) {
    this.channel.port2.addEventListener("message", this.onMessage);
    this.channel.port2.start();
  }

  get controllerPort(): MessagePort {
    return this.channel.port1;
  }

  handoff(
    target: FakeHandoffTarget,
    overrides: { source?: MessageEventSource; origin?: string; data?: unknown } = {}
  ): void {
    target.dispatch(this.channel.port1, {
      ...overrides,
      data: overrides.data ?? handoff(this.hostEpoch)
    });
  }

  send(message: unknown): void {
    this.channel.port2.postMessage(message);
  }

  closeControllerPort(): void {
    this.channel.port1.close();
  }

  async nextRequest<T extends AgentCommandType>(type: T): Promise<RequestEnvelope<T>> {
    const existingIndex = this.requests.findIndex((request) => request.type === type);
    if (existingIndex >= 0) return this.requests.splice(existingIndex, 1)[0] as RequestEnvelope<T>;
    return new Promise((resolve) => {
      this.requestWaiters.push((request) => {
        if (request.type !== type) throw new Error(`Expected ${type}, received ${request.type}.`);
        resolve(request as RequestEnvelope<T>);
      });
    });
  }

  dispose(): void {
    this.channel.port2.removeEventListener("message", this.onMessage);
    this.channel.port1.close();
    this.channel.port2.close();
  }

  private readonly onMessage = (event: MessageEvent<unknown>): void => {
    if (isRendererHello(event.data)) {
      this.hello = event.data;
      this.send(welcomeEnvelope({
        appInstanceId: event.data.appInstanceId,
        hostInstanceId: this.hostInstanceId,
        hostEpoch: this.hostEpoch,
        sdkVersion: "0.81.1",
        eventSequence: this.eventSequence,
        capabilities: {
          operations: true,
          eventSequence: true,
          structuredErrors: true,
          transferableImages: true,
          transferableAssets: true,
          idempotentControlMutations: true
        },
        maxEnvelopeBytes: 2 * 1024 * 1024
      }));
      return;
    }
    if (!isRequestEnvelope(event.data)) return;
    const waiter = this.requestWaiters.shift();
    if (waiter) waiter(event.data);
    else this.requests.push(event.data);
  };
}

function createController(target: FakeHandoffTarget): AgentConnectionController {
  const controller = new AgentConnectionController(target);
  controllers.push(controller);
  return controller;
}

function createHost(hostEpoch: number, eventSequence = 0, hostInstanceId?: string): HostConnection {
  const host = new HostConnection(hostEpoch, eventSequence, hostInstanceId);
  hosts.push(host);
  return host;
}

function handoff(hostEpoch: number) {
  return {
    source: "pi67-preload" as const,
    type: "agent-port" as const,
    appInstanceId: `app-${hostEpoch}`,
    hostEpoch
  };
}

function identity(hostEpoch: number) {
  return {
    appInstanceId: "app-retry",
    hostInstanceId: `host-${hostEpoch}`,
    hostEpoch,
    sdkVersion: "0.81.1",
    eventSequence: 0
  };
}

function readyStatus(detail: string) {
  return { phase: "ready" as const, detail, recoverable: true };
}

function projectionResyncResult(hostEpoch: number, eventSequence: number) {
  return {
    snapshot: emptySnapshot(),
    changes: { sessionId: "session-1", items: [], truncated: false, total: 0 },
    extensionCatalog: { items: [], total: 0, truncated: false },
    sessionCatalogStatus: {
      revision: 1,
      itemCount: 0,
      source: "sqlite" as const,
      state: "ready" as const,
      rebuilding: false,
      reconciledAt: 1_700_000_000_000,
      incomplete: false,
      skippedCount: 0
    },
    eventSequence,
    hostEpoch,
    sessionGeneration: 1
  };
}

function emptySnapshot() {
  return {
    sessionId: "session-1",
    cwd: "/tmp",
    streaming: false,
    messages: [],
    messagePage: { hasOlder: false, hasNewer: false },
    models: [],
    providers: [],
    thinkingLevel: "off" as const,
    availableThinkingLevels: ["off" as const],
    steeringQueue: [],
    followUpQueue: [],
    tree: { nodes: [], truncated: false, total: 0 },
    resources: []
  };
}

async function flushMessagePorts(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}
