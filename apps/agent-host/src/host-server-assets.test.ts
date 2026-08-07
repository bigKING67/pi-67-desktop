import { describe, expect, it, vi } from "vitest";
import type { AgentRuntime } from "@pi67/pi-runtime";
import {
  PROTOCOL_REVISION,
  PROTOCOL_VERSION,
  isHostWelcome,
  isResponseEnvelope,
  type ProtocolPort,
  type RendererHello
} from "@pi67/protocol";
import { AgentHostServer } from "./host-server.js";
import { commandEnvelope } from "./protocol-test-fixtures.js";

class AssetPort implements ProtocolPort {
  readonly sent: unknown[] = [];
  readonly transfers: Array<Transferable[] | undefined> = [];
  readonly listeners = new Map<string, Set<(event: unknown) => void>>();

  postMessage(message: unknown, transfer?: Transferable[]): void {
    this.sent.push(message);
    this.transfers.push(transfer);
  }
  close(): void {}
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

describe("AgentHostServer assets", () => {
  it("reads only the active session generation and transfers the chunk", async () => {
    const data = Uint8Array.from([1, 2, 3]).buffer;
    const readAsset = vi.fn(() => ({
      assetId: "asset-1",
      mimeType: "image/png",
      byteLength: 3,
      offset: 0,
      data,
      done: true
    }));
    const runtime = {
      getSdkVersion: () => "0.81.1",
      subscribe: () => () => undefined,
      getIdentity: () => ({ sessionId: "session-assets", sessionFileIdentity: "session-file-session-assets", sessionGeneration: 5 }),
      readAsset,
      cancelInteractiveRequests: () => [],
      dispose: async () => undefined
    } as unknown as AgentRuntime;
    const server = new AgentHostServer(async () => runtime);
    const port = new AssetPort();
    server.attachPort(port, { appInstanceId: "app-assets", hostInstanceId: "host-assets", hostEpoch: 8 });
    port.emit({
      protocolVersion: PROTOCOL_VERSION,
      protocolRevision: PROTOCOL_REVISION,
      kind: "hello",
      rendererInstanceId: "renderer-assets",
      appInstanceId: "app-assets",
      maxEnvelopeBytes: 2 * 1024 * 1024
    } satisfies RendererHello);
    await vi.waitFor(() => expect(port.sent.some(isHostWelcome)).toBe(true));

    const request = commandEnvelope("asset.read", {
      assetId: "asset-1",
      sessionGeneration: 5,
      offset: 0,
      length: 3
    }, 8);
    port.emit(request);
    await vi.waitFor(() => {
      const responseIndex = port.sent.findIndex((value) => (
        isResponseEnvelope(value) && value.requestId === request.requestId
      ));
      expect(port.sent[responseIndex]).toMatchObject({ ok: true, type: "asset.read", result: { data } });
      expect(port.transfers[responseIndex]).toEqual([data]);
    });
    expect(readAsset).toHaveBeenCalledWith(request.payload);

    const stale = commandEnvelope("asset.read", {
      assetId: "asset-1",
      sessionGeneration: 4,
      offset: 0,
      length: 3
    }, 8);
    port.emit(stale);
    await vi.waitFor(() => {
      const response = port.sent.find((value) => isResponseEnvelope(value) && value.requestId === stale.requestId);
      expect(response).toMatchObject({ ok: false, error: { code: "STALE_SESSION_GENERATION" } });
    });
    expect(readAsset).toHaveBeenCalledOnce();
    await server.shutdown();
  });
});
