import type { AgentRuntime } from "@pi67/pi-runtime";
import {
  PROTOCOL_REVISION,
  isHostWelcome,
  isResponseEnvelope,
  type ProtocolPort,
  type RendererHello
} from "@pi67/protocol";
import { describe, expect, it, vi } from "vitest";
import { AgentHostServer } from "./host-server.js";
import { commandEnvelope } from "./protocol-test-fixtures.js";

class FakePort implements ProtocolPort {
  readonly sent: unknown[] = [];
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>();

  postMessage(message: unknown): void { this.sent.push(message); }
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

describe("AgentHostServer projection queries", () => {
  it("returns recorded workspace changes without rebuilding the session snapshot", async () => {
    const changes = {
      sessionId: "session-changes",
      items: [{
        kind: "edit" as const,
        toolCallId: "edit-1",
        path: "src/index.ts",
        pathTruncated: false,
        status: "completed" as const,
        patch: "@@ -1 +1 @@\n-old\n+new",
        patchTruncated: false,
        additions: 1,
        deletions: 1,
        firstChangedLine: 1
      }],
      truncated: false,
      total: 1
    };
    const getWorkspaceChanges = vi.fn(() => changes);
    const getSnapshot = vi.fn();
    const runtime = {
      getSdkVersion: () => "0.81.1",
      subscribe: () => () => undefined,
      getIdentity: () => ({ sessionId: "session-changes", sessionGeneration: 3 }),
      getWorkspaceChanges,
      getSnapshot,
      cancelInteractiveRequests: () => [],
      dispose: async () => undefined
    } as unknown as AgentRuntime;
    const server = new AgentHostServer(async () => runtime);
    const port = new FakePort();
    server.attachPort(port, { appInstanceId: "app-changes", hostInstanceId: "host-changes", hostEpoch: 6 });
    port.emit({
      protocolVersion: 3,
      protocolRevision: PROTOCOL_REVISION,
      kind: "hello",
      rendererInstanceId: "renderer-changes",
      appInstanceId: "app-changes",
      maxEnvelopeBytes: 2 * 1024 * 1024
    } satisfies RendererHello);
    await vi.waitFor(() => expect(port.sent.some(isHostWelcome)).toBe(true));

    const request = commandEnvelope("workspace.changes", {}, 6);
    port.emit(request);
    await vi.waitFor(() => {
      expect(port.sent.find((value) => isResponseEnvelope(value) && value.requestId === request.requestId))
        .toMatchObject({ ok: true, type: "workspace.changes", result: changes });
    });
    expect(getWorkspaceChanges).toHaveBeenCalledOnce();
    expect(getSnapshot).not.toHaveBeenCalled();
    await server.shutdown();
  });

  it("returns the independent Extension Catalog without rebuilding the session snapshot", async () => {
    const catalog = {
      items: [],
      total: 0,
      truncated: false
    };
    const getExtensionCatalog = vi.fn(() => catalog);
    const getSnapshot = vi.fn();
    const runtime = {
      getSdkVersion: () => "0.81.1",
      subscribe: () => () => undefined,
      getIdentity: () => ({ sessionId: "session-extension", sessionGeneration: 4 }),
      getExtensionCatalog,
      getSnapshot,
      cancelInteractiveRequests: () => [],
      dispose: async () => undefined
    } as unknown as AgentRuntime;
    const server = new AgentHostServer(async () => runtime);
    const port = new FakePort();
    server.attachPort(port, { appInstanceId: "app-extension", hostInstanceId: "host-extension", hostEpoch: 7 });
    port.emit({
      protocolVersion: 3,
      protocolRevision: PROTOCOL_REVISION,
      kind: "hello",
      rendererInstanceId: "renderer-extension",
      appInstanceId: "app-extension",
      maxEnvelopeBytes: 2 * 1024 * 1024
    } satisfies RendererHello);
    await vi.waitFor(() => expect(port.sent.some(isHostWelcome)).toBe(true));

    const request = commandEnvelope("extension.catalog.list", {}, 7);
    port.emit(request);
    await vi.waitFor(() => {
      expect(port.sent.find((value) => isResponseEnvelope(value) && value.requestId === request.requestId))
        .toMatchObject({ ok: true, type: "extension.catalog.list", result: catalog });
    });
    expect(getExtensionCatalog).toHaveBeenCalledOnce();
    expect(getSnapshot).not.toHaveBeenCalled();
    await server.shutdown();
  });
});
