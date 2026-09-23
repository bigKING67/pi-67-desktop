import { describe, expect, it, vi } from "vitest";
import {
  PROTOCOL_REVISION, PROTOCOL_VERSION, isEventEnvelope,
  type AgentEvent, type ProtocolPort, type RendererHello
} from "@pi67/protocol";
import { HostConnectionContext } from "./connection-context.js";
import { HostEventChannel } from "./host-event-channel.js";
import { TEST_APP_CONTEXT } from "./protocol-test-fixtures.js";

class FakePort implements ProtocolPort {
  readonly sent: unknown[] = [];
  readonly listeners = new Map<string, Set<(event: unknown) => void>>();
  closed = false;
  postMessage(message: unknown): void { this.sent.push(message); }
  close(): void { this.closed = true; }
  addEventListener(type: string, listener: (event: unknown) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }
  emit(data: unknown): void {
    for (const listener of this.listeners.get("message") ?? []) listener({ data });
  }
}

describe("Host event delivery boundary", () => {
  it("delivers only channel-validated events and retains the negotiated transport limit", async () => {
    const port = new FakePort();
    const connection = new HostConnectionContext(
      port,
      { appInstanceId: "app-events", hostInstanceId: "host-events", hostEpoch: 3 },
      async () => ({ sdkVersion: "0.86.1", eventSequence: 0 }),
      vi.fn()
    );
    port.emit({
      protocolVersion: PROTOCOL_VERSION,
      protocolRevision: PROTOCOL_REVISION,
      kind: "hello",
      rendererInstanceId: "renderer-events",
      appInstanceId: "app-events",
      maxEnvelopeBytes: 65_536
    } satisfies RendererHello);
    await vi.waitFor(() => expect(port.sent).toHaveLength(1));
    const channel = new HostEventChannel({
      getConnection: () => connection,
      getHostEpoch: () => 3,
      getOperations: () => undefined,
      getRuntime: () => undefined,
      getProtocolContext: () => TEST_APP_CONTEXT
    });
    expect(channel.send({
      type: "runtime.statusChanged",
      payload: { phase: "invalid", detail: "must not cross the port", recoverable: true }
    } as unknown as AgentEvent)).toBe(false);
    expect(channel.eventSequence).toBe(0);
    expect(port.sent).toHaveLength(1);

    channel.send({
      type: "runtime.statusChanged",
      payload: { phase: "ready", detail: "Pi SDK ready", recoverable: true }
    });
    expect(port.sent).toHaveLength(2);
    expect(isEventEnvelope(port.sent[1])).toBe(true);
    expect(port.sent[1]).toMatchObject({ sequence: 1, type: "runtime.statusChanged" });

    channel.send({
      type: "runtime.statusChanged",
      payload: { phase: "ready", detail: "x".repeat(65_536), recoverable: true }
    });
    expect(port.sent).toHaveLength(2);
    expect(port.closed).toBe(true);
  });

});
