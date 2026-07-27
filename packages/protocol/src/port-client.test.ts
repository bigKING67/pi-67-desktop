import { describe, expect, it, vi } from "vitest";
import type { RuntimeCapabilities } from "@pi67/domain";
import {
  AgentPortClient,
  CONTROL_MUTATION_ACK_TIMEOUT_MS,
  type ProtocolPort
} from "./port-client.js";
import { eventEnvelope, responseEnvelope, welcomeEnvelope, type RendererHello } from "./envelope.js";

class FakePort implements ProtocolPort {
  readonly sent: unknown[] = [];
  readonly listeners = new Map<string, Set<(event: unknown) => void>>();
  throwOnPost = false;
  closed = false;

  postMessage(message: unknown): void {
    if (this.throwOnPost) throw new Error("port failed");
    this.sent.push(message);
  }

  close(): void {
    this.closed = true;
  }

  addEventListener(type: "message" | "messageerror" | "close", listener: (event: unknown) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: "message" | "messageerror" | "close", listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: "message" | "messageerror" | "close", data?: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(type === "message" ? { data } : {});
  }
}

describe("AgentPortClient", () => {
  it("handshakes before sending a typed request", async () => {
    const port = new FakePort();
    const client = new AgentPortClient(port);
    const hello = port.sent[0] as RendererHello;
    expect(hello.kind).toBe("hello");
    port.emit("message", hostWelcome(hello, 4));

    const response = client.request("runtime.getStatus", {});
    await Promise.resolve();
    const request = port.sent[1] as { requestId: string; hostEpoch: number };
    expect(request.hostEpoch).toBe(4);
    port.emit("message", responseEnvelope(request.requestId, 4, {
      ok: true,
      type: "runtime.getStatus",
      result: { initialized: true, loaded: true }
    }));
    await expect(response).resolves.toEqual({ initialized: true, loaded: true });
  });

  it("uses a stable key and a 60 second acknowledgement timeout for control mutations", async () => {
    vi.useFakeTimers();
    try {
      const port = new FakePort();
      const client = new AgentPortClient(port);
      const hello = port.sent[0] as RendererHello;
      port.emit("message", hostWelcome(hello, 4));

      const pending = client.request("session.create", {}, [], { idempotencyKey: "create-session-1" });
      let failure: unknown;
      void pending.catch((error: unknown) => { failure = error; });
      await Promise.resolve();
      expect(port.sent[1]).toMatchObject({ idempotencyKey: "create-session-1" });

      await vi.advanceTimersByTimeAsync(CONTROL_MUTATION_ACK_TIMEOUT_MS - 1);
      expect(failure).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      expect(failure).toMatchObject({ code: "REQUEST_TIMEOUT" });
      expect(client.isClosed).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects idempotency metadata on query commands before sending", async () => {
    const port = new FakePort();
    const client = new AgentPortClient(port);
    const hello = port.sent[0] as RendererHello;
    port.emit("message", hostWelcome(hello, 4));

    await expect(client.request("runtime.getStatus", {}, [], { idempotencyKey: "invalid-query-key" }))
      .rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    expect(port.sent).toHaveLength(1);
  });

  it("accepts a validated transferred asset chunk response", async () => {
    const port = new FakePort();
    const client = new AgentPortClient(port);
    const hello = port.sent[0] as RendererHello;
    port.emit("message", hostWelcome(hello, 4));

    const pending = client.request("asset.read", {
      assetId: "asset-1",
      sessionGeneration: 2,
      offset: 0,
      length: 3
    });
    await Promise.resolve();
    const request = port.sent[1] as { requestId: string };
    const data = Uint8Array.from([1, 2, 3]).buffer;
    port.emit("message", responseEnvelope(request.requestId, 4, {
      ok: true,
      type: "asset.read",
      result: {
        assetId: "asset-1",
        mimeType: "image/png",
        byteLength: 3,
        offset: 0,
        data,
        done: true
      }
    }));

    await expect(pending).resolves.toMatchObject({ assetId: "asset-1", data, done: true });
  });

  it("rejects all pending work immediately when the Port closes", async () => {
    const port = new FakePort();
    const client = new AgentPortClient(port);
    const hello = port.sent[0] as RendererHello;
    port.emit("message", hostWelcome(hello, 1));
    const pending = client.request("session.catalog.query", { scope: "workspace" });
    await Promise.resolve();
    port.emit("close");
    await expect(pending).rejects.toMatchObject({ code: "CONNECTION_CLOSED" });
    expect(client.isClosed).toBe(true);
  });

  it("tears down immediately when the current Host sends a context-invalid event", async () => {
    const port = new FakePort();
    const onEvent = vi.fn();
    const client = new AgentPortClient(port);
    client.onEvent(onEvent);
    const hello = port.sent[0] as RendererHello;
    port.emit("message", hostWelcome(hello, 1));

    const pending = client.request("runtime.getStatus", {});
    await Promise.resolve();
    port.emit("message", eventEnvelope("runtime.ready", {
      capabilities: runtimeCapabilities(),
      snapshot: emptySnapshot()
    }, { hostEpoch: 1, sequence: 1 }));

    await expect(pending).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    expect(onEvent).not.toHaveBeenCalled();
    expect(client.isClosed).toBe(true);
    expect(port.closed).toBe(true);
  });

  it("tears down when postMessage throws", async () => {
    const port = new FakePort();
    const client = new AgentPortClient(port);
    const hello = port.sent[0] as RendererHello;
    port.emit("message", hostWelcome(hello, 1));
    port.throwOnPost = true;
    await expect(client.request("runtime.getStatus", {})).rejects.toMatchObject({ code: "CONNECTION_CLOSED" });
    expect(client.isClosed).toBe(true);
  });

  it("reports one sequence gap and drops events until resync", async () => {
    const port = new FakePort();
    const onGap = vi.fn();
    const onEvent = vi.fn();
    const client = new AgentPortClient(port, { onSequenceGap: onGap });
    client.onEvent(onEvent);
    const hello = port.sent[0] as RendererHello;
    port.emit("message", hostWelcome(hello, 2, 5));
    await client.waitUntilReady();

    port.emit("message", eventEnvelope("runtime.statusChanged", {
      phase: "ready", detail: "ready", recoverable: true
    }, { hostEpoch: 2, sequence: 7 }));
    port.emit("message", eventEnvelope("runtime.statusChanged", {
      phase: "ready", detail: "still ready", recoverable: true
    }, { hostEpoch: 2, sequence: 8 }));
    expect(onGap).toHaveBeenCalledOnce();
    expect(onGap).toHaveBeenCalledWith({ expected: 6, received: 7, hostEpoch: 2 });
    expect(onEvent).not.toHaveBeenCalled();

    const install = vi.fn(() => true);
    const resync = client.resyncProjection(install);
    await Promise.resolve();
    const request = port.sent.at(-1) as { requestId: string };
    port.emit("message", responseEnvelope(request.requestId, 2, {
      ok: true,
      type: "projection.resync",
      result: projectionResyncResult(2, 8)
    }));
    await expect(resync).resolves.toBe(true);
    expect(install).toHaveBeenCalledWith(expect.objectContaining({ eventSequence: 8, hostEpoch: 2 }));
    port.emit("message", eventEnvelope("runtime.statusChanged", {
      phase: "ready", detail: "resynced", recoverable: true
    }, { hostEpoch: 2, sequence: 9 }));
    expect(onEvent).toHaveBeenCalledOnce();
  });

  it("keeps events blocked when the authoritative projection is not installed", async () => {
    const port = new FakePort();
    const onEvent = vi.fn();
    const client = new AgentPortClient(port);
    client.onEvent(onEvent);
    const hello = port.sent[0] as RendererHello;
    port.emit("message", hostWelcome(hello, 2, 5));
    await client.waitUntilReady();

    const resync = client.resyncProjection(() => false);
    await Promise.resolve();
    const request = port.sent.at(-1) as { requestId: string };
    port.emit("message", responseEnvelope(request.requestId, 2, {
      ok: true,
      type: "projection.resync",
      result: projectionResyncResult(2, 8)
    }));

    await expect(resync).resolves.toBe(false);
    port.emit("message", eventEnvelope("runtime.statusChanged", {
      phase: "ready", detail: "must remain blocked", recoverable: true
    }, { hostEpoch: 2, sequence: 9 }));
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("keeps events blocked when authoritative projection installation throws", async () => {
    const port = new FakePort();
    const onEvent = vi.fn();
    const client = new AgentPortClient(port);
    client.onEvent(onEvent);
    const hello = port.sent[0] as RendererHello;
    port.emit("message", hostWelcome(hello, 2, 5));
    await client.waitUntilReady();

    const resync = client.resyncProjection(() => {
      throw new Error("projection install failed");
    });
    await Promise.resolve();
    const request = port.sent.at(-1) as { requestId: string };
    port.emit("message", responseEnvelope(request.requestId, 2, {
      ok: true,
      type: "projection.resync",
      result: projectionResyncResult(2, 8)
    }));

    await expect(resync).rejects.toThrow("projection install failed");
    port.emit("message", eventEnvelope("runtime.statusChanged", {
      phase: "ready", detail: "must remain blocked", recoverable: true
    }, { hostEpoch: 2, sequence: 9 }));
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("commits only the latest resync attempt when responses arrive out of order", async () => {
    const port = new FakePort();
    const onEvent = vi.fn();
    const client = new AgentPortClient(port);
    client.onEvent(onEvent);
    const hello = port.sent[0] as RendererHello;
    port.emit("message", hostWelcome(hello, 2, 5));
    await client.waitUntilReady();

    const firstInstall = vi.fn(() => true);
    const first = client.resyncProjection(firstInstall);
    await Promise.resolve();
    const firstRequest = port.sent.at(-1) as { requestId: string };
    const secondInstall = vi.fn(() => true);
    const second = client.resyncProjection(secondInstall);
    await Promise.resolve();
    const secondRequest = port.sent.at(-1) as { requestId: string };

    port.emit("message", responseEnvelope(secondRequest.requestId, 2, {
      ok: true,
      type: "projection.resync",
      result: projectionResyncResult(2, 8)
    }));
    await expect(second).resolves.toBe(true);
    port.emit("message", responseEnvelope(firstRequest.requestId, 2, {
      ok: true,
      type: "projection.resync",
      result: projectionResyncResult(2, 7)
    }));
    await expect(first).resolves.toBe(false);

    expect(secondInstall).toHaveBeenCalledOnce();
    expect(firstInstall).not.toHaveBeenCalled();
    port.emit("message", eventEnvelope("runtime.statusChanged", {
      phase: "ready", detail: "latest sequence", recoverable: true
    }, { hostEpoch: 2, sequence: 9 }));
    expect(onEvent).toHaveBeenCalledOnce();
  });

  it("rejects a regressive current resync without reopening the event stream", async () => {
    const port = new FakePort();
    const onEvent = vi.fn();
    const install = vi.fn(() => true);
    const client = new AgentPortClient(port);
    client.onEvent(onEvent);
    const hello = port.sent[0] as RendererHello;
    port.emit("message", hostWelcome(hello, 2, 5));
    await client.waitUntilReady();

    const resync = client.resyncProjection(install);
    await Promise.resolve();
    const request = port.sent.at(-1) as { requestId: string };
    port.emit("message", responseEnvelope(request.requestId, 2, {
      ok: true,
      type: "projection.resync",
      result: projectionResyncResult(2, 4)
    }));

    await expect(resync).rejects.toMatchObject({
      code: "INVALID_PAYLOAD",
      details: { currentEventSequence: 5, receivedEventSequence: 4 }
    });
    expect(install).not.toHaveBeenCalled();
    port.emit("message", eventEnvelope("runtime.statusChanged", {
      phase: "ready", detail: "must remain blocked", recoverable: true
    }, { hostEpoch: 2, sequence: 6 }));
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("fails closed when welcome does not match the expected Host epoch", async () => {
    const port = new FakePort();
    const client = new AgentPortClient(port, { expectedHostEpoch: 8 });
    const hello = port.sent[0] as RendererHello;
    port.emit("message", hostWelcome(hello, 7));
    await expect(client.waitUntilReady()).rejects.toMatchObject({ code: "STALE_HOST_EPOCH" });
    expect(client.isClosed).toBe(true);
  });

  it("rejects oversized outgoing requests before posting private content", async () => {
    const port = new FakePort();
    const client = new AgentPortClient(port, { maxEnvelopeBytes: 65_536 });
    const hello = port.sent[0] as RendererHello;
    port.emit("message", { ...hostWelcome(hello, 1), maxEnvelopeBytes: 65_536 });

    await expect(client.request("prompt.submit", {
      submissionId: "submission-large",
      text: "中".repeat(30_000),
      delivery: "new-turn"
    })).rejects.toMatchObject({ code: "RESOURCE_LIMIT_EXCEEDED" });
    expect(port.sent).toHaveLength(1);
  });

  it("tears down when the Host sends an oversized envelope", async () => {
    const port = new FakePort();
    const client = new AgentPortClient(port, { maxEnvelopeBytes: 65_536 });
    const hello = port.sent[0] as RendererHello;
    port.emit("message", { ...hostWelcome(hello, 1), maxEnvelopeBytes: 65_536 });
    await client.waitUntilReady();

    port.emit("message", eventEnvelope("runtime.statusChanged", {
      phase: "ready",
      detail: "中".repeat(30_000),
      recoverable: true
    }, { hostEpoch: 1, sequence: 1 }));
    expect(client.isClosed).toBe(true);
    expect(port.closed).toBe(true);
  });
});

function hostWelcome(hello: RendererHello, hostEpoch: number, eventSequence = 0) {
  return welcomeEnvelope({
    appInstanceId: hello.appInstanceId,
    hostInstanceId: "host-1",
    hostEpoch,
    sdkVersion: "0.81.1",
    eventSequence,
    capabilities: {
      operations: true,
      eventSequence: true,
      structuredErrors: true,
      transferableImages: true,
      transferableAssets: true,
      idempotentControlMutations: true
    },
    maxEnvelopeBytes: 2 * 1024 * 1024
  });
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
    thinkingLevel: "off",
    availableThinkingLevels: ["off"],
    steeringQueue: [],
    followUpQueue: [],
    tree: { nodes: [], truncated: false, total: 0 },
    resources: []
  };
}

function projectionResyncResult(hostEpoch: number, eventSequence: number) {
  return {
    snapshot: emptySnapshot(),
    changes: { sessionId: "session-1", items: [], truncated: false, total: 0 },
    extensionCatalog: { items: [], total: 0, truncated: false },
    sessionCatalogStatus: sessionCatalogStatus(),
    eventSequence,
    hostEpoch,
    sessionGeneration: 1
  };
}

function runtimeCapabilities(): RuntimeCapabilities {
  return {
    sdkVersion: "0.81.1",
    supportsFollowUp: true,
    supportsSessionTree: true,
    extensionUi: {
      primitives: [],
      attribution: "none" as const,
      recognizedCompatibilityLevels: [],
      adapterRegistry: {
        available: false,
        manifestSchemaVersions: [],
        supportedSurfaces: [],
        realtimeUiAttribution: false,
        activeAdapterCount: 0
      },
      limitations: {
        workingIndicator: "unsupported" as const,
        editorMutation: "unsupported" as const,
        customComponents: "tui-only" as const,
        autocomplete: "tui-only" as const,
        widgetPlacements: ["aboveEditor" as const, "belowEditor" as const]
      }
    }
  };
}

function sessionCatalogStatus() {
  return {
    revision: 1,
    itemCount: 0,
    source: "sqlite" as const,
    state: "ready" as const,
    rebuilding: false,
    reconciledAt: 1_700_000_000_000,
    incomplete: false,
    skippedCount: 0
  };
}
