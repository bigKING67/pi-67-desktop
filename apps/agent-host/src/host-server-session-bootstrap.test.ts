import type { AgentRuntime } from "@pi67/pi-runtime";
import {
  PROTOCOL_REVISION,
  isEventEnvelope,
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
  readonly listeners = new Map<string, Set<(event: unknown) => void>>();
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

describe("AgentHostServer session bootstrap", () => {
  it("publishes the authoritative generation before workspace and session transition responses", async () => {
    let sessionId = "session-workspace";
    let sessionGeneration = 1;
    const currentSnapshot = () => ({ ...emptySnapshot(), sessionId });
    const runtime = {
      getSdkVersion: () => "0.81.1",
      getExtensionUiCapabilities: () => ({
        primitives: [],
        attribution: "none",
        recognizedCompatibilityLevels: [],
        adapterRegistry: {
          available: false,
          manifestSchemaVersions: [],
          supportedSurfaces: [],
          realtimeUiAttribution: false,
          activeAdapterCount: 0
        },
        limitations: {
          workingIndicator: "unsupported",
          editorMutation: "unsupported",
          customComponents: "tui-only",
          autocomplete: "tui-only",
          widgetPlacements: ["aboveEditor", "belowEditor"]
        }
      }),
      subscribe: () => () => undefined,
      initialize: async () => currentSnapshot(),
      createSession: async () => {
        sessionId = "session-created";
        sessionGeneration += 1;
        return currentSnapshot();
      },
      forkSession: async () => {
        sessionId = "session-forked";
        sessionGeneration += 1;
        return currentSnapshot();
      },
      getIdentity: () => ({ sessionId, sessionGeneration }),
      cancelInteractiveRequests: () => [],
      dispose: async () => undefined
    } as unknown as AgentRuntime;
    const server = new AgentHostServer(async () => runtime);
    const port = new FakePort();
    server.attachPort(port, { appInstanceId: "app-bootstrap", hostInstanceId: "host-bootstrap", hostEpoch: 6 });
    port.emit({
      protocolVersion: 3,
      protocolRevision: PROTOCOL_REVISION,
      kind: "hello",
      rendererInstanceId: "renderer-bootstrap",
      appInstanceId: "app-bootstrap",
      maxEnvelopeBytes: 2 * 1024 * 1024
    } satisfies RendererHello);
    await vi.waitFor(() => expect(port.sent.some(isHostWelcome)).toBe(true));

    const workspaceOpen = commandEnvelope("workspace.open", {
      cwd: "/tmp/workspace",
      trust: "unknown",
      approvalMode: "guided"
    }, 6);
    port.emit(workspaceOpen);
    await waitForResponse(port, workspaceOpen.requestId);
    const readyIndex = port.sent.findIndex((value) => isEventEnvelope(value) && value.type === "runtime.ready");
    expect(readyIndex).toBeLessThan(responseIndex(port, workspaceOpen.requestId));
    expect(port.sent[readyIndex]).toMatchObject({
      context: {
        scope: "task",
        sessionId: "session-workspace",
        sessionGeneration: 1
      },
      payload: { snapshot: { sessionId: "session-workspace" } }
    });
    expect(successResult(port, workspaceOpen.requestId)).toEqual({
      accepted: true,
      hostEpoch: 6,
      sessionId: "session-workspace",
      sessionGeneration: 1,
      eventSequence: eventSequenceAt(port, readyIndex)
    });

    const create = commandEnvelope("session.create", {}, 6);
    port.emit(create);
    await waitForResponse(port, create.requestId);
    const bootstrapIndex = port.sent.findIndex((value) => isEventEnvelope(value) && value.type === "session.bootstrap");
    expect(bootstrapIndex).toBeLessThan(responseIndex(port, create.requestId));
    expect(port.sent[bootstrapIndex]).toMatchObject({
      context: {
        scope: "task",
        sessionId: "session-created",
        sessionGeneration: 2
      },
      payload: { snapshot: { sessionId: "session-created" }, reason: "session-create" }
    });
    expect(successResult(port, create.requestId)).toEqual({
      accepted: true,
      hostEpoch: 6,
      sessionId: "session-created",
      sessionGeneration: 2,
      eventSequence: eventSequenceAt(port, bootstrapIndex)
    });

    const fork = commandEnvelope("session.fork", { entryId: "entry-2" }, 6);
    port.emit(fork);
    await waitForResponse(port, fork.requestId);
    const forkBootstrapIndex = port.sent.findIndex((value, index) => (
      index > bootstrapIndex && isEventEnvelope(value) && value.type === "session.bootstrap"
    ));
    expect(forkBootstrapIndex).toBeLessThan(responseIndex(port, fork.requestId));
    expect(port.sent[forkBootstrapIndex]).toMatchObject({
      context: {
        scope: "task",
        sessionId: "session-forked",
        sessionGeneration: 3
      },
      payload: { snapshot: { sessionId: "session-forked" }, reason: "session-fork" }
    });
    expect(successResult(port, fork.requestId)).toEqual({
      accepted: true,
      hostEpoch: 6,
      sessionId: "session-forked",
      sessionGeneration: 3,
      eventSequence: eventSequenceAt(port, forkBootstrapIndex)
    });
    await server.shutdown();
  });

  it("captures recovery projection after an admitted Session transition completes", async () => {
    let sessionId = "session-before-open";
    let sessionGeneration = 4;
    let finishOpen!: () => void;
    const currentSnapshot = () => ({ ...emptySnapshot(), sessionId });
    const runtime = {
      getSdkVersion: () => "0.81.1",
      subscribe: () => () => undefined,
      getIdentity: () => ({ sessionId, sessionGeneration }),
      getSnapshot: currentSnapshot,
      getWorkspaceChanges: () => ({ sessionId, items: [], truncated: false, total: 0 }),
      getExtensionCatalog: () => ({ items: [], total: 0, truncated: false }),
      getSessionCatalogStatus: () => ({
        revision: 1,
        itemCount: 1,
        source: "sqlite",
        state: "ready",
        rebuilding: false,
        incomplete: false,
        skippedCount: 0
      }),
      openSession: () => new Promise<ReturnType<typeof currentSnapshot>>((resolve) => {
        finishOpen = () => {
          sessionId = "session-after-open";
          sessionGeneration += 1;
          resolve(currentSnapshot());
        };
      }),
      cancelInteractiveRequests: () => [],
      dispose: async () => undefined
    } as unknown as AgentRuntime;
    const server = new AgentHostServer(async () => runtime);
    const port = new FakePort();
    server.attachPort(port, { appInstanceId: "app-recovery", hostInstanceId: "host-recovery", hostEpoch: 7 });
    port.emit({
      protocolVersion: 3,
      protocolRevision: PROTOCOL_REVISION,
      kind: "hello",
      rendererInstanceId: "renderer-recovery",
      appInstanceId: "app-recovery",
      maxEnvelopeBytes: 2 * 1024 * 1024
    } satisfies RendererHello);
    await vi.waitFor(() => expect(port.sent.some(isHostWelcome)).toBe(true));

    const open = commandEnvelope("session.open", { path: "/tmp/after.jsonl" }, 7);
    port.emit(open);
    await vi.waitFor(() => expect(finishOpen).toBeTypeOf("function"));
    const resync = commandEnvelope("projection.resync", {}, 7);
    port.emit(resync);
    await Promise.resolve();
    expect(responseIndex(port, resync.requestId)).toBe(-1);

    finishOpen();
    await waitForResponse(port, open.requestId);
    await waitForResponse(port, resync.requestId);
    const response = port.sent[responseIndex(port, resync.requestId)];
    expect(response).toMatchObject({
      ok: true,
      result: {
        hostEpoch: 7,
        sessionGeneration: 5,
        snapshot: { sessionId: "session-after-open" },
        changes: { sessionId: "session-after-open" }
      }
    });
    await server.shutdown();
  });

  it("publishes bootstrap before a failed import terminal when runtime authority already changed", async () => {
    let sessionId = "session-before-import";
    let sessionGeneration = 2;
    const currentSnapshot = () => ({ ...emptySnapshot(), sessionId });
    const runtime = {
      getSdkVersion: () => "0.81.1",
      subscribe: () => () => undefined,
      getIdentity: () => ({ sessionId, sessionGeneration }),
      getSnapshot: currentSnapshot,
      importSession: async () => {
        sessionId = "session-after-import";
        sessionGeneration += 1;
        throw new Error("Catalog update failed after session switch");
      },
      cancelInteractiveRequests: () => [],
      dispose: async () => undefined
    } as unknown as AgentRuntime;
    const server = new AgentHostServer(async () => runtime);
    const port = new FakePort();
    server.attachPort(port, { appInstanceId: "app-import", hostInstanceId: "host-import", hostEpoch: 8 });
    port.emit({
      protocolVersion: 3,
      protocolRevision: PROTOCOL_REVISION,
      kind: "hello",
      rendererInstanceId: "renderer-import",
      appInstanceId: "app-import",
      maxEnvelopeBytes: 2 * 1024 * 1024
    } satisfies RendererHello);
    await vi.waitFor(() => expect(port.sent.some(isHostWelcome)).toBe(true));

    const request = commandEnvelope("session.import", {
      submissionId: "import-with-post-switch-failure",
      path: "/tmp/import.jsonl"
    }, 8);
    port.emit(request);
    await waitForResponse(port, request.requestId);
    await vi.waitFor(() => {
      expect(port.sent.some((value) => isEventEnvelope(value) && value.type === "operation.failed")).toBe(true);
    });

    const bootstrapIndex = port.sent.findIndex((value) => (
      isEventEnvelope(value) && value.type === "session.bootstrap"
    ));
    const failureIndex = port.sent.findIndex((value) => (
      isEventEnvelope(value) && value.type === "operation.failed"
    ));
    expect(bootstrapIndex).toBeGreaterThan(responseIndex(port, request.requestId));
    expect(bootstrapIndex).toBeLessThan(failureIndex);
    expect(port.sent[bootstrapIndex]).toMatchObject({
      hostEpoch: 8,
      context: {
        scope: "task",
        sessionId: "session-after-import",
        sessionGeneration: 3
      },
      payload: {
        snapshot: { sessionId: "session-after-import" },
        reason: "session-import"
      }
    });
    await server.shutdown();
  });

  it("requests Host replacement when a switched import cannot produce an authoritative projection", async () => {
    let sessionId = "session-before-import";
    let sessionGeneration = 2;
    const onRuntimePoisoned = vi.fn();
    const runtime = {
      getSdkVersion: () => "0.81.1",
      subscribe: () => () => undefined,
      getIdentity: () => ({ sessionId, sessionGeneration }),
      getSnapshot: () => {
        throw new Error("Projection unavailable after session switch");
      },
      importSession: async () => {
        sessionId = "session-after-import";
        sessionGeneration += 1;
        throw new Error("Catalog update failed after session switch");
      },
      cancelInteractiveRequests: () => [],
      dispose: async () => undefined
    } as unknown as AgentRuntime;
    const server = new AgentHostServer(async () => runtime, { onRuntimePoisoned });
    const port = new FakePort();
    server.attachPort(port, { appInstanceId: "app-import", hostInstanceId: "host-import", hostEpoch: 9 });
    port.emit({
      protocolVersion: 3,
      protocolRevision: PROTOCOL_REVISION,
      kind: "hello",
      rendererInstanceId: "renderer-import",
      appInstanceId: "app-import",
      maxEnvelopeBytes: 2 * 1024 * 1024
    } satisfies RendererHello);
    await vi.waitFor(() => expect(port.sent.some(isHostWelcome)).toBe(true));

    const request = commandEnvelope("session.import", {
      submissionId: "import-with-poisoned-projection",
      path: "/tmp/import.jsonl"
    }, 9);
    port.emit(request);
    await waitForResponse(port, request.requestId);
    await vi.waitFor(() => expect(onRuntimePoisoned).toHaveBeenCalledOnce());

    expect(onRuntimePoisoned).toHaveBeenCalledWith({
      type: "agent-host-runtime-poisoned",
      code: "SESSION_IMPORT_PROJECTION_FAILED",
      operationId: expect.any(String)
    });
    expect(port.sent.some((value) => isEventEnvelope(value) && value.type === "session.bootstrap")).toBe(false);
    expect(port.sent.some((value) => isEventEnvelope(value) && value.type === "operation.failed")).toBe(false);
    expect(port.sent.some((value) => isEventEnvelope(value) && value.type === "operation.lost")).toBe(true);
    expect(port.sent).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "runtime.statusChanged",
        payload: expect.objectContaining({
          phase: "recovering",
          detail: "Pi 导入会话投影无法恢复，正在替换 Pi 运行服务"
        })
      })
    ]));
    await server.shutdown();
  });
});

async function waitForResponse(port: FakePort, requestId: string): Promise<void> {
  await vi.waitFor(() => expect(responseIndex(port, requestId)).toBeGreaterThanOrEqual(0));
}

function responseIndex(port: FakePort, requestId: string): number {
  return port.sent.findIndex((value) => isResponseEnvelope(value) && value.requestId === requestId);
}

function successResult(port: FakePort, requestId: string): unknown {
  const response = port.sent[responseIndex(port, requestId)];
  if (!isResponseEnvelope(response) || !response.ok) throw new Error("Expected successful response.");
  return response.result;
}

function eventSequenceAt(port: FakePort, index: number): number {
  const event = port.sent[index];
  if (!isEventEnvelope(event)) throw new Error("Expected event envelope.");
  return event.sequence;
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
