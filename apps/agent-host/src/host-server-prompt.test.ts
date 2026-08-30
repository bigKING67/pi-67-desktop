import { describe, expect, it, vi } from "vitest";
import type { AgentRuntime } from "@pi67/pi-runtime";
import {
  PROTOCOL_REVISION,
  PROTOCOL_VERSION,
  isEventEnvelope,
  isHostWelcome,
  isResponseEnvelope,
  type ProtocolPort,
  type RendererHello
} from "@pi67/protocol";
import { AgentHostServer } from "./host-server.js";
import { commandEnvelope } from "./protocol-test-fixtures.js";

class PromptPort implements ProtocolPort {
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

describe("AgentHostServer prompt routing", () => {
  it("returns prompt acceptance without waiting for operation completion", async () => {
    let complete!: () => void;
    const submitPrompt = vi.fn(() => new Promise<void>((resolve) => { complete = resolve; }));
    const flushStream = vi.fn();
    const resolveExtensionUi = vi.fn(() => true);
    const runtime = {
      getSdkVersion: () => "0.81.1",
      getExtensionUiCapabilities: extensionUiCapabilities,
      subscribe: () => () => undefined,
      getIdentity: () => ({ sessionId: "session-1", sessionFileIdentity: "session-file-session-1", sessionGeneration: 3 }),
      getSnapshot: () => emptySnapshot(),
      getTaskToolMode: () => "auto" as const,
      getWorkspaceChanges: () => emptyChanges(),
      getExtensionCatalog: () => emptyCatalog(),
      getSessionCatalogStatus: () => ({ revision: 0, itemCount: 0, source: "sqlite", state: "ready", rebuilding: false, incomplete: false, skippedCount: 0 }),
      submitPrompt,
      resolveExtensionUi,
      flushStream,
      cancelInteractiveRequests: () => [],
      dispose: async () => undefined
    } as unknown as AgentRuntime;
    const server = new AgentHostServer(async () => runtime);
    const port = new PromptPort();
    server.attachPort(port, { appInstanceId: "app-1", hostInstanceId: "host-1", hostEpoch: 6 });
    const hello: RendererHello = {
      protocolVersion: PROTOCOL_VERSION,
      protocolRevision: PROTOCOL_REVISION,
      kind: "hello",
      rendererInstanceId: "renderer-1",
      appInstanceId: "app-1",
      maxEnvelopeBytes: 2 * 1024 * 1024
    };
    port.emit(hello);
    await vi.waitFor(() => expect(isHostWelcome(port.sent[0])).toBe(true));

    const resync = commandEnvelope("projection.resync", {}, 6);
    port.emit(resync);
    await vi.waitFor(() => {
      const response = port.sent.find((value) => isResponseEnvelope(value) && value.requestId === resync.requestId);
      expect(response).toMatchObject({
        ok: true,
        type: "projection.resync",
        result: { eventSequence: 0, hostEpoch: 6, sessionGeneration: 3 }
      });
    });

    const request = commandEnvelope("prompt.submit", {
      submissionId: "submission-1",
      text: "run a long task",
      delivery: "new-turn"
    }, 6);
    port.emit(request);
    await vi.waitFor(() => {
      const response = port.sent.find((value) => isResponseEnvelope(value) && value.requestId === request.requestId);
      expect(response).toMatchObject({ ok: true, type: "prompt.submit" });
    });
    await vi.waitFor(() => expect(port.sent.some(isEventEnvelope)).toBe(true));
    const responseIndex = port.sent.findIndex((value) => isResponseEnvelope(value) && value.requestId === request.requestId);
    const startedIndex = port.sent.findIndex((value) => isEventEnvelope(value) && value.type === "operation.started");
    expect(responseIndex).toBeGreaterThanOrEqual(0);
    expect(startedIndex).toBeGreaterThan(responseIndex);
    expect(submitPrompt).toHaveBeenCalledWith(
      "run a long task",
      undefined,
      expect.any(AbortSignal)
    );

    const activeResync = commandEnvelope("projection.resync", {}, 6);
    port.emit(activeResync);
    await vi.waitFor(() => {
      const response = port.sent.find((value) => isResponseEnvelope(value) && value.requestId === activeResync.requestId);
      expect(response).toMatchObject({
        ok: true,
        result: { activeOperation: { kind: "prompt", lifecycle: "running", sessionId: "session-1" } }
      });
    });

    const retry = commandEnvelope("prompt.submit", {
      submissionId: "submission-1",
      text: "run a long task",
      delivery: "new-turn"
    }, 6);
    port.emit(retry);
    await vi.waitFor(() => {
      const first = port.sent.find((value) => isResponseEnvelope(value) && value.requestId === request.requestId);
      const second = port.sent.find((value) => isResponseEnvelope(value) && value.requestId === retry.requestId);
      expect(second).toMatchObject({ ok: true, result: { operationId: (first as { result: { operationId: string } }).result.operationId } });
    });
    expect(submitPrompt).toHaveBeenCalledOnce();

    const mismatchedRetry = commandEnvelope("prompt.submit", {
      submissionId: "submission-1",
      text: "different task",
      delivery: "new-turn"
    }, 6);
    port.emit(mismatchedRetry);
    await vi.waitFor(() => {
      const response = port.sent.find((value) => isResponseEnvelope(value) && value.requestId === mismatchedRetry.requestId);
      expect(response).toMatchObject({ ok: false, error: { code: "DUPLICATE_REQUEST" } });
    });
    expect(submitPrompt).toHaveBeenCalledOnce();

    const acceptedResponse = port.sent.find((value) => isResponseEnvelope(value) && value.requestId === request.requestId);
    if (!acceptedResponse || !isResponseEnvelope(acceptedResponse) || !acceptedResponse.ok) {
      throw new Error("Expected prompt acceptance response.");
    }
    const operationId = (acceptedResponse.result as { operationId: string }).operationId;
    const staleSession = commandEnvelope("extension.ui.respond", {
      requestId: "extension-request",
      sessionId: "session-1",
      sessionGeneration: 2,
      operationId,
      value: "stale"
    }, 6);
    port.emit(staleSession);
    await vi.waitFor(() => {
      const response = port.sent.find((value) => isResponseEnvelope(value) && value.requestId === staleSession.requestId);
      expect(response).toMatchObject({ ok: false, error: { code: "STALE_SESSION_GENERATION" } });
    });

    const staleOperation = commandEnvelope("extension.ui.respond", {
      requestId: "extension-request",
      sessionId: "session-1",
      sessionGeneration: 3,
      operationId: "operation-stale",
      value: "stale"
    }, 6);
    port.emit(staleOperation);
    await vi.waitFor(() => {
      const response = port.sent.find((value) => isResponseEnvelope(value) && value.requestId === staleOperation.requestId);
      expect(response).toMatchObject({ ok: false, error: { code: "STALE_OPERATION" } });
    });

    const current = commandEnvelope("extension.ui.respond", {
      requestId: "extension-request",
      sessionId: "session-1",
      sessionGeneration: 3,
      operationId,
      value: "accepted"
    }, 6);
    port.emit(current);
    await vi.waitFor(() => {
      const response = port.sent.find((value) => isResponseEnvelope(value) && value.requestId === current.requestId);
      expect(response).toMatchObject({ ok: true, result: { resolved: true } });
    });
    expect(resolveExtensionUi).toHaveBeenCalledOnce();

    complete();
    await vi.waitFor(() => expect(flushStream).toHaveBeenCalledOnce());
    const operationEvents = port.sent.filter(isEventEnvelope)
      .map((event) => event.type)
      .filter((type) => type.startsWith("operation."));
    expect(operationEvents).toEqual(["operation.started", "operation.completed"]);
    await server.shutdown();
  });

  it("rejects prompt submission replay after the runtime Session authority changes", async () => {
    let sessionId = "session-1";
    let sessionGeneration = 3;
    const submitPrompt = vi.fn(() => new Promise<void>(() => undefined));
    const runtime = {
      getSdkVersion: () => "0.81.1",
      subscribe: () => () => undefined,
      getIdentity: () => ({ sessionId, sessionFileIdentity: `session-file-${sessionId}`, sessionGeneration }),
      submitPrompt,
      flushStream: () => undefined,
      cancelInteractiveRequests: () => [],
      dispose: async () => undefined
    } as unknown as AgentRuntime;
    const server = new AgentHostServer(async () => runtime);
    const port = new PromptPort();
    server.attachPort(port, { appInstanceId: "app-bound", hostInstanceId: "host-bound", hostEpoch: 7 });
    port.emit({
      protocolVersion: PROTOCOL_VERSION,
      protocolRevision: PROTOCOL_REVISION,
      kind: "hello",
      rendererInstanceId: "renderer-bound",
      appInstanceId: "app-bound",
      maxEnvelopeBytes: 2 * 1024 * 1024
    } satisfies RendererHello);
    await vi.waitFor(() => expect(port.sent.some(isHostWelcome)).toBe(true));

    const first = commandEnvelope("prompt.submit", {
      submissionId: "session-bound-submission",
      text: "keep this submission in session one",
      delivery: "new-turn"
    }, 7);
    port.emit(first);
    await vi.waitFor(() => {
      const response = port.sent.find((value) => isResponseEnvelope(value) && value.requestId === first.requestId);
      expect(response).toMatchObject({ ok: true, result: { sessionId: "session-1", sessionGeneration: 3 } });
    });

    sessionId = "session-2";
    sessionGeneration = 3;
    const replay = commandEnvelope("prompt.submit", {
      submissionId: "session-bound-submission",
      text: "keep this submission in session one",
      delivery: "new-turn"
    }, 7);
    port.emit(replay);
    await vi.waitFor(() => {
      const response = port.sent.find((value) => isResponseEnvelope(value) && value.requestId === replay.requestId);
      expect(response).toMatchObject({ ok: false, error: { code: "STALE_SESSION_IDENTITY" } });
    });
    await vi.waitFor(() => expect(submitPrompt).toHaveBeenCalledOnce());
    await server.shutdown();
  });
});

function emptySnapshot() {
  return {
    sessionId: "session-1",
    sessionFileIdentity: "session-file-session-1",
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

function emptyChanges() {
  return { sessionId: "session-1", items: [], truncated: false, total: 0 };
}

function emptyCatalog() {
  return { items: [], total: 0, truncated: false };
}

function extensionUiCapabilities(): ReturnType<AgentRuntime["getExtensionUiCapabilities"]> {
  return {
    primitives: ["select", "confirm", "input", "editor", "notify", "status", "text-widget", "title"],
    attribution: "none",
    recognizedCompatibilityLevels: ["native", "headless", "adapter", "partial", "tui-only", "unsupported"],
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
  };
}
