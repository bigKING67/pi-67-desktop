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
import {
  commandEnvelope,
  commandEnvelopeForContext,
  TEST_APP_CONTEXT,
  TEST_TASK_CONTEXT,
  TEST_WORKSPACE_CONTEXT,
  testTaskContext
} from "./protocol-test-fixtures.js";

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

describe("AgentHostServer", () => {
  it("runs App diagnostics before any Task Runtime exists", async () => {
    const doctor = {
      generatedAt: 0,
      checks: []
    };
    const runDoctor = vi.fn(async () => doctor);
    const runtimeDiagnostics = {
      generatedAt: 1,
      application: "π",
      piSdkVersion: "0.81.1",
      platform: "darwin",
      architecture: "arm64",
      node: "24.18.0",
      sessionConfigured: false,
      sessionFileConfigured: false,
      extensionCount: 0,
      extensionErrors: []
    };
    const collectDiagnostics = vi.fn(async () => runtimeDiagnostics);
    const runtime = {
      getSdkVersion: () => "0.81.1",
      subscribe: () => () => undefined,
      runDoctor,
      collectDiagnostics,
      cancelInteractiveRequests: () => [],
      dispose: async () => undefined
    } as unknown as AgentRuntime;
    const server = new AgentHostServer(async () => runtime);
    const port = new FakePort();
    server.attachPort(port, {
      appInstanceId: "app-doctor",
      hostInstanceId: "host-doctor",
      hostEpoch: 14
    });
    port.emit({
      protocolVersion: PROTOCOL_VERSION,
      protocolRevision: PROTOCOL_REVISION,
      kind: "hello",
      rendererInstanceId: "renderer-doctor",
      appInstanceId: "app-doctor",
      maxEnvelopeBytes: 2 * 1024 * 1024
    } satisfies RendererHello);
    await vi.waitFor(() => expect(port.sent.some(isHostWelcome)).toBe(true));

    const request = commandEnvelopeForContext("doctor.run", {}, TEST_APP_CONTEXT, 14);
    port.emit(request);
    await expectProtocolResponse(port, request.requestId, {
      ok: true,
      context: TEST_APP_CONTEXT,
      result: doctor
    });
    expect(runDoctor).toHaveBeenCalledOnce();

    const diagnosticsRequest = commandEnvelopeForContext("diagnostics.collect", {}, TEST_APP_CONTEXT, 14);
    port.emit(diagnosticsRequest);
    await expectProtocolResponse(port, diagnosticsRequest.requestId, {
      ok: true,
      context: TEST_APP_CONTEXT,
      result: {
        ...runtimeDiagnostics,
        host: {
          hostEpoch: 14,
          taskCount: 0,
          liveRuntimeCount: 0,
          activeOperationCount: 0,
          scheduler: {
            taskCount: 0,
            activeQueryCount: 0,
            queuedControlCount: 0,
            runningControlCount: 0,
            queuedPromptCount: 0,
            runningPromptCount: 0,
            turnAdmissionCount: 0,
            closedCount: 0
          },
          operations: {
            registryCount: 0,
            acceptingCount: 0,
            activeCount: 0,
            terminatingCount: 0,
            poisonedCount: 0,
            heartbeatTrackedCount: 0,
            maxQuietForMs: 0
          },
          writerLeases: { activeCount: 0, pendingCount: 0, compromised: false },
          workspaces: [],
          workspacesTruncated: false
        }
      }
    });
    expect(collectDiagnostics).toHaveBeenCalledOnce();
    await server.shutdown();
  });

  it("fails closed for invalid scopes while routing independent Task authorities", async () => {
    const tree = { nodes: [], truncated: false, total: 0 };
    const createRuntime = () => ({
      getSdkVersion: () => "0.81.1",
      subscribe: () => () => undefined,
      getIdentity: () => ({ sessionId: "session-authority", sessionFileIdentity: "session-file-session-authority", sessionGeneration: 5 }),
      getSessionTree: () => tree,
      cancelInteractiveRequests: () => [],
      dispose: async () => undefined
    } as unknown as AgentRuntime);
    const runtimes = [createRuntime(), createRuntime()];
    const server = new AgentHostServer(async () => runtimes.shift()!);
    const port = new FakePort();
    server.attachPort(port, {
      appInstanceId: "app-authority",
      hostInstanceId: "host-authority",
      hostEpoch: 10
    });
    port.emit({
      protocolVersion: PROTOCOL_VERSION,
      protocolRevision: PROTOCOL_REVISION,
      kind: "hello",
      rendererInstanceId: "renderer-authority",
      appInstanceId: "app-authority",
      maxEnvelopeBytes: 2 * 1024 * 1024
    } satisfies RendererHello);
    await vi.waitFor(() => expect(port.sent.some(isHostWelcome)).toBe(true));

    const appScopedTaskCommand = commandEnvelopeForContext(
      "session.tree",
      {},
      TEST_APP_CONTEXT,
      10
    );
    port.emit(appScopedTaskCommand);
    await expectProtocolResponse(port, appScopedTaskCommand.requestId, {
      ok: false,
      context: TEST_APP_CONTEXT,
      error: { code: "INVALID_PAYLOAD" }
    });

    const workspaceScopedTaskCommand = commandEnvelopeForContext(
      "session.tree",
      {},
      TEST_WORKSPACE_CONTEXT,
      10
    );
    port.emit(workspaceScopedTaskCommand);
    await expectProtocolResponse(port, workspaceScopedTaskCommand.requestId, {
      ok: false,
      context: TEST_WORKSPACE_CONTEXT,
      error: { code: "INVALID_PAYLOAD" }
    });

    const acceptedTaskCommand = commandEnvelopeForContext(
      "session.tree",
      {},
      TEST_TASK_CONTEXT,
      10
    );
    port.emit(acceptedTaskCommand);
    await expectProtocolResponse(port, acceptedTaskCommand.requestId, {
      ok: true,
      context: TEST_TASK_CONTEXT,
      result: tree
    });

    const staleTaskContext = testTaskContext(2);
    const staleTaskCommand = commandEnvelopeForContext(
      "session.tree",
      {},
      staleTaskContext,
      10
    );
    port.emit(staleTaskCommand);
    await expectProtocolResponse(port, staleTaskCommand.requestId, {
      ok: false,
      context: staleTaskContext,
      error: { code: "INVALID_PAYLOAD" }
    });

    const differentTaskContext = testTaskContext(1, { taskId: "task-other" });
    const differentTaskCommand = commandEnvelopeForContext(
      "session.tree",
      {},
      differentTaskContext,
      10
    );
    port.emit(differentTaskCommand);
    await expectProtocolResponse(port, differentTaskCommand.requestId, {
      ok: true,
      context: differentTaskContext,
      result: tree
    });

    const otherWorkspaceContext = { scope: "workspace" as const, workspaceId: "workspace-other" };
    const otherWorkspaceQuery = commandEnvelopeForContext(
      "session.catalog.query",
      { scope: "workspace", limit: 50 },
      otherWorkspaceContext,
      10
    );
    port.emit(otherWorkspaceQuery);
    await expectProtocolResponse(port, otherWorkspaceQuery.requestId, {
      ok: false,
      context: otherWorkspaceContext,
      error: { code: "RUNTIME_NOT_READY" }
    });

    const appStatus = commandEnvelopeForContext(
      "runtime.getStatus",
      {},
      TEST_APP_CONTEXT,
      10
    );
    port.emit(appStatus);
    await expectProtocolResponse(port, appStatus.requestId, {
      ok: true,
      context: TEST_APP_CONTEXT,
      result: { initialized: false, loaded: true }
    });

    await server.shutdown();
  });

  it("returns the session tree without rebuilding a full snapshot", async () => {
    const tree = {
      nodes: [{
        id: "entry-1",
        parentId: null,
        type: "message",
        preview: "Tree entry",
        active: true,
        depth: 0
      }],
      truncated: false,
      total: 1
    };
    const getSessionTree = vi.fn(() => tree);
    const getSnapshot = vi.fn();
    const runtime = {
      getSdkVersion: () => "0.81.1",
      subscribe: () => () => undefined,
      getIdentity: () => ({ sessionId: "session-tree", sessionFileIdentity: "session-file-session-tree", sessionGeneration: 5 }),
      getSessionTree,
      getSnapshot,
      cancelInteractiveRequests: () => [],
      dispose: async () => undefined
    } as unknown as AgentRuntime;
    const server = new AgentHostServer(async () => runtime);
    const port = new FakePort();
    server.attachPort(port, { appInstanceId: "app-tree", hostInstanceId: "host-tree", hostEpoch: 8 });
    port.emit({
      protocolVersion: PROTOCOL_VERSION,
      protocolRevision: PROTOCOL_REVISION,
      kind: "hello",
      rendererInstanceId: "renderer-tree",
      appInstanceId: "app-tree",
      maxEnvelopeBytes: 2 * 1024 * 1024
    } satisfies RendererHello);
    await vi.waitFor(() => expect(port.sent.some(isHostWelcome)).toBe(true));

    const request = commandEnvelope("session.tree", {}, 8);
    port.emit(request);
    await vi.waitFor(() => {
      const response = port.sent.find((value) => isResponseEnvelope(value) && value.requestId === request.requestId);
      expect(response).toMatchObject({ ok: true, type: "session.tree", result: tree });
    });
    expect(getSessionTree).toHaveBeenCalledOnce();
    expect(getSnapshot).not.toHaveBeenCalled();
    await server.shutdown();
  });

  it("clears the Pi queue atomically through the interrupt lane", async () => {
    const clearQueue = vi.fn(() => ({ steeringCount: 1, followUpCount: 1 }));
    const runtime = {
      getSdkVersion: () => "0.81.1",
      subscribe: () => () => undefined,
      getIdentity: () => ({ sessionId: "session-queue", sessionFileIdentity: "session-file-session-queue", sessionGeneration: 1 }),
      clearQueue,
      cancelInteractiveRequests: () => [],
      dispose: async () => undefined
    } as unknown as AgentRuntime;
    const server = new AgentHostServer(async () => runtime);
    const port = new FakePort();
    server.attachPort(port, { appInstanceId: "app-queue", hostInstanceId: "host-queue", hostEpoch: 3 });
    port.emit({
      protocolVersion: PROTOCOL_VERSION,
      protocolRevision: PROTOCOL_REVISION,
      kind: "hello",
      rendererInstanceId: "renderer-queue",
      appInstanceId: "app-queue",
      maxEnvelopeBytes: 2 * 1024 * 1024
    } satisfies RendererHello);
    await vi.waitFor(() => expect(port.sent.some(isHostWelcome)).toBe(true));

    const request = commandEnvelope("queue.clear", {}, 3);
    port.emit(request);
    await vi.waitFor(() => {
      const response = port.sent.find((value) => isResponseEnvelope(value) && value.requestId === request.requestId);
      expect(response).toMatchObject({
        ok: true,
        type: "queue.clear",
        result: { steeringCount: 1, followUpCount: 1, pendingCount: 0 }
      });
    });
    expect(clearQueue).toHaveBeenCalledOnce();
    await server.shutdown();
  });

});

async function expectProtocolResponse(
  port: FakePort,
  requestId: string,
  expected: object
): Promise<void> {
  await vi.waitFor(() => {
    const response = port.sent.find((value) => (
      isResponseEnvelope(value) && value.requestId === requestId
    ));
    expect(response).toMatchObject(expected);
  });
}
