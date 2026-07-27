import { describe, expect, it, vi } from "vitest";
import { commandEnvelope, type ProtocolPort, type RendererHello } from "@pi67/protocol";
import { HostConnectionContext } from "./connection-context.js";

class FakePort implements ProtocolPort {
  readonly sent: unknown[] = [];
  readonly transfers: Array<Transferable[] | undefined> = [];
  readonly argumentCounts: number[] = [];
  readonly listeners = new Map<string, Set<(event: unknown) => void>>();
  closed = false;

  postMessage(message: unknown, transfer?: Transferable[]): void {
    this.sent.push(message);
    this.transfers.push(transfer);
    this.argumentCounts.push(arguments.length);
  }
  close(): void { this.closed = true; }
  addEventListener(type: "message" | "messageerror" | "close", listener: (event: unknown) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type: "message" | "messageerror" | "close", listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }
  emit(data: unknown): void {
    for (const listener of this.listeners.get("message") ?? []) listener({ data });
  }
  emitPortEvent(type: "messageerror" | "close"): void {
    for (const listener of this.listeners.get(type) ?? []) listener({});
  }
}

describe("HostConnectionContext", () => {
  it("loads welcome state once while duplicate hello frames are pending", async () => {
    const port = new FakePort();
    let resolveWelcome!: (value: { sdkVersion: string; eventSequence: number }) => void;
    const getWelcomeRuntime = vi.fn(() => new Promise<{ sdkVersion: string; eventSequence: number }>((resolve) => {
      resolveWelcome = resolve;
    }));
    new HostConnectionContext(
      port,
      { appInstanceId: "app-handshake", hostInstanceId: "host-handshake", hostEpoch: 2 },
      getWelcomeRuntime,
      () => undefined
    );
    const hello = {
      protocolVersion: 2,
      kind: "hello",
      rendererInstanceId: "renderer-handshake",
      appInstanceId: "app-handshake",
      maxEnvelopeBytes: 65_536
    } satisfies RendererHello;

    port.emit(hello);
    port.emit(hello);
    expect(getWelcomeRuntime).toHaveBeenCalledOnce();
    expect(port.sent).toHaveLength(0);

    resolveWelcome({ sdkVersion: "0.81.1", eventSequence: 7 });
    await vi.waitFor(() => expect(port.sent).toHaveLength(1));
    expect(port.sent[0]).toMatchObject({
      kind: "welcome",
      hostEpoch: 2,
      sdkVersion: "0.81.1",
      eventSequence: 7
    });

    port.emit(hello);
    await Promise.resolve();
    expect(getWelcomeRuntime).toHaveBeenCalledOnce();
    expect(port.sent).toHaveLength(1);
  });

  it("transfers asset chunks without copying the response through structured clone", () => {
    const port = new FakePort();
    const connection = new HostConnectionContext(
      port,
      { appInstanceId: "app-assets", hostInstanceId: "host-assets", hostEpoch: 6 },
      async () => ({ sdkVersion: "0.81.1", eventSequence: 0 }),
      () => undefined
    );
    const data = Uint8Array.from([1, 2, 3]).buffer;
    connection.beginResponse();
    connection.sendSuccess("asset-request", "asset.read", {
      assetId: "asset-1",
      mimeType: "image/png",
      byteLength: 3,
      offset: 0,
      data,
      done: true
    });

    expect(port.sent.at(-1)).toMatchObject({
      kind: "response",
      ok: true,
      type: "asset.read",
      result: { assetId: "asset-1", data }
    });
    expect(port.transfers.at(-1)).toEqual([data]);
    expect(port.argumentCounts.at(-1)).toBe(2);
  });

  it("keeps a retired origin alive until its correlated response is sent", async () => {
    const port = new FakePort();
    let captured: HostConnectionContext | undefined;
    const connection = new HostConnectionContext(
      port,
      { appInstanceId: "app-1", hostInstanceId: "host-1", hostEpoch: 9 },
      async () => ({ sdkVersion: "0.81.1", eventSequence: 4 }),
      (origin) => { captured = origin; }
    );
    const hello: RendererHello = {
      protocolVersion: 2,
      kind: "hello",
      rendererInstanceId: "renderer-1",
      appInstanceId: "app-1",
      maxEnvelopeBytes: 2 * 1024 * 1024
    };
    port.emit(hello);
    await Promise.resolve();
    const request = commandEnvelope("runtime.getStatus", {}, 9);
    port.emit(request);
    expect(captured).toBe(connection);
    connection.retire();
    expect(port.closed).toBe(false);

    captured!.sendSuccess(request.requestId, request.type, { initialized: false, loaded: true });
    expect((port.sent.at(-1) as { requestId: string }).requestId).toBe(request.requestId);
    expect(port.argumentCounts.at(-1)).toBe(1);
    expect(port.closed).toBe(true);
  });

  it("returns a correlated resource error for an oversized request", async () => {
    const port = new FakePort();
    let requests = 0;
    new HostConnectionContext(
      port,
      { appInstanceId: "app-1", hostInstanceId: "host-1", hostEpoch: 3 },
      async () => ({ sdkVersion: "0.81.1", eventSequence: 0 }),
      () => { requests += 1; }
    );
    port.emit({
      protocolVersion: 2,
      kind: "hello",
      rendererInstanceId: "renderer-1",
      appInstanceId: "app-1",
      maxEnvelopeBytes: 65_536
    } satisfies RendererHello);
    await Promise.resolve();

    port.emit(commandEnvelope("prompt.submit", {
      submissionId: "submission-large",
      text: "中".repeat(30_000),
      delivery: "new-turn"
    }, 3));
    expect(requests).toBe(0);
    expect(port.sent.at(-1)).toMatchObject({
      kind: "response",
      ok: false,
      error: { code: "RESOURCE_LIMIT_EXCEEDED" }
    });
  });

  it("rejects a control mutation that omits its idempotency key", async () => {
    const port = new FakePort();
    const onRequest = vi.fn();
    new HostConnectionContext(
      port,
      { appInstanceId: "app-control", hostInstanceId: "host-control", hostEpoch: 3 },
      async () => ({ sdkVersion: "0.81.1", eventSequence: 0 }),
      onRequest
    );
    port.emit({
      protocolVersion: 2,
      kind: "hello",
      rendererInstanceId: "renderer-control",
      appInstanceId: "app-control",
      maxEnvelopeBytes: 65_536
    } satisfies RendererHello);
    await Promise.resolve();

    const request = commandEnvelope("session.create", {}, 3);
    const { idempotencyKey: _idempotencyKey, ...missingKey } = request;
    port.emit(missingKey);
    expect(onRequest).not.toHaveBeenCalled();
    expect(port.sent.at(-1)).toMatchObject({
      kind: "response",
      requestId: request.requestId,
      ok: false,
      error: { code: "INVALID_PAYLOAD" }
    });
  });

  it("notifies a peer close exactly once without closing the peer-owned port again", async () => {
    const port = new FakePort();
    const onDisconnect = vi.fn();
    const onRequest = vi.fn();
    const connection = new HostConnectionContext(
      port,
      { appInstanceId: "app-close", hostInstanceId: "host-close", hostEpoch: 4 },
      async () => ({ sdkVersion: "0.81.1", eventSequence: 0 }),
      onRequest,
      onDisconnect
    );
    port.emit({
      protocolVersion: 2,
      kind: "hello",
      rendererInstanceId: "renderer-close",
      appInstanceId: "app-close",
      maxEnvelopeBytes: 65_536
    } satisfies RendererHello);
    await vi.waitFor(() => expect(port.sent.some((value) => (value as { kind?: string }).kind === "welcome")).toBe(true));

    port.emitPortEvent("close");
    port.emitPortEvent("close");
    port.emit(commandEnvelope("runtime.getStatus", {}, 4));
    expect(connection.isCurrentCandidate).toBe(false);
    expect(onDisconnect).toHaveBeenCalledOnce();
    expect(onRequest).not.toHaveBeenCalled();
    expect(port.closed).toBe(false);
  });

  it("retires and closes the port once after a message error", async () => {
    const port = new FakePort();
    const onDisconnect = vi.fn();
    const onRequest = vi.fn();
    const connection = new HostConnectionContext(
      port,
      { appInstanceId: "app-error", hostInstanceId: "host-error", hostEpoch: 5 },
      async () => ({ sdkVersion: "0.81.1", eventSequence: 0 }),
      onRequest,
      onDisconnect
    );
    port.emit({
      protocolVersion: 2,
      kind: "hello",
      rendererInstanceId: "renderer-error",
      appInstanceId: "app-error",
      maxEnvelopeBytes: 65_536
    } satisfies RendererHello);
    await vi.waitFor(() => expect(port.sent.some((value) => (value as { kind?: string }).kind === "welcome")).toBe(true));

    port.emitPortEvent("messageerror");
    port.emitPortEvent("close");
    port.emit(commandEnvelope("runtime.getStatus", {}, 5));
    expect(connection.isCurrentCandidate).toBe(false);
    expect(onDisconnect).toHaveBeenCalledOnce();
    expect(onRequest).not.toHaveBeenCalled();
    expect(port.closed).toBe(true);
  });
});
