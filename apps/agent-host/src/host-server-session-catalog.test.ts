import type { AgentRuntime } from "@pi67/pi-runtime";
import {
  commandEnvelope,
  isEventEnvelope,
  isHostWelcome,
  isResponseEnvelope,
  type AgentEvent,
  type ProtocolPort,
  type RendererHello
} from "@pi67/protocol";
import { describe, expect, it, vi } from "vitest";
import { AgentHostServer } from "./host-server.js";

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

describe("AgentHostServer Session Catalog", () => {
  it("returns bounded pages, publishes metadata-only invalidation and resyncs status only", async () => {
    let emit: ((event: AgentEvent) => void) | undefined;
    const status = {
      revision: 7,
      itemCount: 2,
      source: "sqlite" as const,
      state: "ready" as const,
      rebuilding: false,
      incomplete: false,
      skippedCount: 0
    };
    const page = {
      ...status,
      items: [{
        id: "session-1",
        path: "/sessions/one.jsonl",
        cwd: "/workspace",
        name: "One",
        modifiedAt: 100,
        messageCount: 2
      }],
      total: 1,
      hasMore: false
    };
    const querySessionCatalog = vi.fn(async () => page);
    const getSnapshot = vi.fn(() => emptySnapshot());
    const runtime = {
      getSdkVersion: () => "0.81.1",
      subscribe: (listener: (event: AgentEvent) => void) => { emit = listener; return () => undefined; },
      getIdentity: () => ({ sessionId: "session-1", sessionGeneration: 3 }),
      querySessionCatalog,
      getSessionCatalogStatus: () => status,
      getSnapshot,
      getWorkspaceChanges: () => ({ sessionId: "session-1", items: [], truncated: false, total: 0 }),
      getExtensionCatalog: () => ({ items: [], total: 0, truncated: false }),
      cancelInteractiveRequests: () => [],
      dispose: async () => undefined
    } as unknown as AgentRuntime;
    const server = new AgentHostServer(async () => runtime);
    const port = new FakePort();
    server.attachPort(port, { appInstanceId: "app", hostInstanceId: "host", hostEpoch: 9 });
    port.emit({
      protocolVersion: 2,
      kind: "hello",
      rendererInstanceId: "renderer",
      appInstanceId: "app",
      maxEnvelopeBytes: 2 * 1024 * 1024
    } satisfies RendererHello);
    await vi.waitFor(() => expect(port.sent.some(isHostWelcome)).toBe(true));

    const query = commandEnvelope("session.catalog.query", { scope: "workspace", limit: 50 }, 9);
    port.emit(query);
    await vi.waitFor(() => {
      expect(port.sent.find((value) => isResponseEnvelope(value) && value.requestId === query.requestId))
        .toMatchObject({ ok: true, type: "session.catalog.query", result: page });
    });
    expect(querySessionCatalog).toHaveBeenCalledWith({ scope: "workspace", limit: 50 });
    expect(getSnapshot).not.toHaveBeenCalled();

    emit?.({ type: "session.catalog.changed", payload: { revision: 8, reason: "reconciled" } });
    await vi.waitFor(() => {
      const changed = port.sent.find((value) => isEventEnvelope(value) && value.type === "session.catalog.changed");
      expect(changed).toMatchObject({ payload: { revision: 8, reason: "reconciled" } });
      expect(JSON.stringify(changed)).not.toMatch(/"(?:items|sessions)"/u);
    });

    const resync = commandEnvelope("projection.resync", {}, 9);
    port.emit(resync);
    await vi.waitFor(() => {
      const response = port.sent.find((value) => isResponseEnvelope(value) && value.requestId === resync.requestId);
      expect(response).toMatchObject({ ok: true, result: { sessionCatalogStatus: status } });
      expect(JSON.stringify(response)).not.toContain('"sessionCatalogStatus":{"items"');
    });
    expect(getSnapshot).toHaveBeenCalledOnce();
    await server.shutdown();
  });
});

function emptySnapshot() {
  return {
    sessionId: "session-1",
    cwd: "/workspace",
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
