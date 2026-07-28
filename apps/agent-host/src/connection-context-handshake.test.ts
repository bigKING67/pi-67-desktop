import { describe, expect, it, vi } from "vitest";
import {
  PROTOCOL_REVISION,
  type ProtocolPort,
  type RendererHello
} from "@pi67/protocol";
import { HostConnectionContext } from "./connection-context.js";

class HandshakePort implements ProtocolPort {
  readonly sent: unknown[] = [];
  readonly listeners = new Map<string, Set<(event: unknown) => void>>();
  closed = false;

  postMessage(message: unknown): void { this.sent.push(message); }
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
}

describe("HostConnectionContext handshake", () => {
  it("loads welcome state once while duplicate hello frames are pending", async () => {
    const port = new HandshakePort();
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
      protocolVersion: 3,
      protocolRevision: PROTOCOL_REVISION,
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

  it("rejects a Protocol v2 hello without loading runtime state", () => {
    const port = new HandshakePort();
    const getWelcomeRuntime = vi.fn(async () => ({ sdkVersion: "0.81.1", eventSequence: 0 }));
    new HostConnectionContext(
      port,
      { appInstanceId: "app-v2", hostInstanceId: "host-v2", hostEpoch: 2 },
      getWelcomeRuntime,
      () => undefined
    );

    port.emit({
      protocolVersion: 2,
      kind: "hello",
      rendererInstanceId: "renderer-v2",
      appInstanceId: "app-v2",
      maxEnvelopeBytes: 65_536
    });

    expect(getWelcomeRuntime).not.toHaveBeenCalled();
    expect(port.sent).toEqual([
      expect.objectContaining({
        kind: "handshake-rejected",
        error: expect.objectContaining({ code: "PROTOCOL_MISMATCH" })
      })
    ]);
    expect(port.closed).toBe(true);
  });

  it("rejects an exact protocol revision mismatch before loading runtime state", () => {
    const port = new HandshakePort();
    const getWelcomeRuntime = vi.fn(async () => ({ sdkVersion: "0.81.1", eventSequence: 0 }));
    new HostConnectionContext(
      port,
      { appInstanceId: "app-revision", hostInstanceId: "host-revision", hostEpoch: 2 },
      getWelcomeRuntime,
      () => undefined
    );

    port.emit({
      protocolVersion: 3,
      protocolRevision: "f".repeat(64),
      kind: "hello",
      rendererInstanceId: "renderer-revision",
      appInstanceId: "app-revision",
      maxEnvelopeBytes: 65_536
    });

    expect(getWelcomeRuntime).not.toHaveBeenCalled();
    expect(port.sent).toEqual([
      expect.objectContaining({
        kind: "handshake-rejected",
        error: {
          code: "PROTOCOL_MISMATCH",
          message: "Pi 运行服务版本不一致，请重启应用。",
          recoverable: true
        }
      })
    ]);
    expect(port.closed).toBe(true);
  });
});
