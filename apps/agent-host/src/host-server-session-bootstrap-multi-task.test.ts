import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AgentRuntime } from "@pi67/pi-runtime";
import {
  PROTOCOL_REVISION,
  isEventEnvelope,
  isHostWelcome,
  isResponseEnvelope,
  type ProtocolPort,
  type RendererHello
} from "@pi67/protocol";
import { AgentHostServer } from "./host-server.js";
import {
  commandEnvelope,
  commandEnvelopeForContext,
  testTaskContext
} from "./protocol-test-fixtures.js";

class BootstrapTaskPort implements ProtocolPort {
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

describe("AgentHostServer multi-Task session bootstrap", () => {
  it("lazily initializes an independent Runtime for a second Task", async () => {
    const workspaceCwd = resolve("/tmp/pi67-multi-task-workspace");
    const runtimeA = taskRuntime("session-a", "session-a-created");
    const runtimeB = taskRuntime("session-b", "session-b-created");
    const runtimes = [runtimeA.runtime, runtimeB.runtime];
    const server = new AgentHostServer(async () => runtimes.shift()!);
    const port = new BootstrapTaskPort();
    server.attachPort(port, {
      appInstanceId: "app-multi-task",
      hostInstanceId: "host-multi-task",
      hostEpoch: 12
    });
    port.emit({
      protocolVersion: 3,
      protocolRevision: PROTOCOL_REVISION,
      kind: "hello",
      rendererInstanceId: "renderer-multi-task",
      appInstanceId: "app-multi-task",
      maxEnvelopeBytes: 2 * 1024 * 1024
    } satisfies RendererHello);
    await vi.waitFor(() => expect(port.sent.some(isHostWelcome)).toBe(true));

    const openWorkspace = commandEnvelope("workspace.open", {
      cwd: workspaceCwd,
      trust: "trusted",
      approvalMode: "guided"
    }, 12);
    port.emit(openWorkspace);
    await waitForResponse(port, openWorkspace.requestId);

    const secondContext = testTaskContext(1, { taskId: "task-second" });
    const createSecond = commandEnvelopeForContext("session.create", {}, secondContext, 12);
    port.emit(createSecond);
    await waitForResponse(port, createSecond.requestId);
    expect(port.sent[responseIndex(port, createSecond.requestId)]).toMatchObject({
      ok: true
    });

    expect(runtimeA.initialize).toHaveBeenCalledOnce();
    expect(runtimeB.initialize).toHaveBeenCalledWith(
      {
        cwd: workspaceCwd,
        agentDir: expect.any(String),
        trust: "trusted",
        approvalMode: "guided"
      },
      expect.any(Function)
    );
    expect(runtimeB.createSession).not.toHaveBeenCalled();
    expect(successResult(port, createSecond.requestId)).toMatchObject({
      sessionId: "session-b",
      sessionGeneration: 1
    });
    expect(port.sent.filter(isEventEnvelope)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "runtime.ready",
        context: expect.objectContaining({ taskId: "task-second", sessionId: "session-b" })
      }),
      expect.objectContaining({
        type: "session.bootstrap",
        context: expect.objectContaining({ taskId: "task-second", sessionId: "session-b" })
      })
    ]));
    await server.shutdown();
  });
});

function taskRuntime(initialSessionId: string, createdSessionId: string) {
  let sessionId = initialSessionId;
  let sessionGeneration = 1;
  const snapshot = () => ({ ...emptySnapshot(), sessionId });
  const initialize = vi.fn(async () => snapshot());
  const createSession = vi.fn(async () => {
    sessionId = createdSessionId;
    sessionGeneration += 1;
    return snapshot();
  });
  return {
    initialize,
    createSession,
    runtime: {
      getSdkVersion: () => "0.81.1",
      getExtensionUiCapabilities: () => emptyExtensionUiCapabilities(),
      subscribe: () => () => undefined,
      initialize,
      createSession,
      getSnapshot: snapshot,
      getIdentity: () => ({ sessionId, sessionGeneration }),
      getTaskToolMode: () => "auto" as const,
      cancelInteractiveRequests: () => [],
      dispose: async () => undefined
    } as unknown as AgentRuntime
  };
}

function emptyExtensionUiCapabilities() {
  return {
    primitives: [],
    attribution: "none" as const,
    recognizedCompatibilityLevels: [],
    adapterRegistry: {
      available: false,
      manifestSchemaVersions: [],
      supportedSurfaces: [],
      realtimeUiAttribution: false,
      activeAdapterCount: 0
    },
    limitations: {
      workingIndicator: "unsupported" as const,
      editorMutation: "unsupported" as const,
      customComponents: "tui-only" as const,
      autocomplete: "tui-only" as const,
      widgetPlacements: ["aboveEditor", "belowEditor"] as const
    }
  };
}

async function waitForResponse(port: BootstrapTaskPort, requestId: string): Promise<void> {
  await vi.waitFor(() => expect(responseIndex(port, requestId)).toBeGreaterThanOrEqual(0));
}

function responseIndex(port: BootstrapTaskPort, requestId: string): number {
  return port.sent.findIndex((value) => isResponseEnvelope(value) && value.requestId === requestId);
}

function successResult(port: BootstrapTaskPort, requestId: string): unknown {
  const response = port.sent[responseIndex(port, requestId)];
  if (!isResponseEnvelope(response) || !response.ok) throw new Error("Expected successful response.");
  return response.result;
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
