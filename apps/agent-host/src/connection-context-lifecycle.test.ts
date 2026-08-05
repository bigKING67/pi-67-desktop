import { describe, expect, it, vi } from "vitest";
import {
  PROTOCOL_REVISION,
  type ProtocolPort,
  type RendererHello
} from "@pi67/protocol";
import { HostConnectionContext } from "./connection-context.js";
import { commandEnvelope } from "./protocol-test-fixtures.js";

class LifecyclePort implements ProtocolPort {
  readonly sent: unknown[] = [];
  readonly argumentCounts: number[] = [];
  readonly listeners = new Map<string, Set<(event: unknown) => void>>();
  closed = false;

  postMessage(message: unknown): void {
    this.sent.push(message);
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

describe("HostConnectionContext lifecycle", () => {
  it("keeps a retired origin alive until its correlated response is sent", async () => {
    const port = new LifecyclePort();
    let captured: HostConnectionContext | undefined;
    const connection = new HostConnectionContext(
      port,
      { appInstanceId: "app-1", hostInstanceId: "host-1", hostEpoch: 9 },
      async () => ({ sdkVersion: "0.81.1", eventSequence: 4 }),
      (origin) => { captured = origin; }
    );
    const hello: RendererHello = {
      protocolVersion: 3,
      protocolRevision: PROTOCOL_REVISION,
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
    const requestSignal = connection.signalForRequest(request.requestId);
    expect(requestSignal.aborted).toBe(false);
    connection.retire();
    expect(requestSignal.aborted).toBe(true);
    expect(port.closed).toBe(false);

    captured!.sendSuccess(request.requestId, request.type, { initialized: false, loaded: true });
    expect((port.sent.at(-1) as { requestId: string }).requestId).toBe(request.requestId);
    expect(port.argumentCounts.at(-1)).toBe(1);
    expect(port.closed).toBe(true);
  });

  it("notifies a peer close exactly once without closing the peer-owned port again", async () => {
    const port = new LifecyclePort();
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
      protocolVersion: 3,
      protocolRevision: PROTOCOL_REVISION,
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
    const port = new LifecyclePort();
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
      protocolVersion: 3,
      protocolRevision: PROTOCOL_REVISION,
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
