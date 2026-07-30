import type { AgentRuntime } from "@pi67/pi-runtime";
import {
  PROTOCOL_REVISION,
  isEventEnvelope,
  isHostWelcome,
  isResponseEnvelope,
  type AgentCommand,
  type ProtocolPort,
  type RendererHello
} from "@pi67/protocol";
import { describe, expect, it, vi } from "vitest";
import { AgentHostServer } from "./host-server.js";
import {
  commandEnvelopeForContext,
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

describe("AgentHostServer cross-Task Session fork", () => {
  it("forks an idle source Session without changing source authority", async () => {
    const sourceIdentity = {
      sessionId: "session-source",
      sessionGeneration: 4,
      sessionPath: "/sessions/source.jsonl"
    };
    const sourceRuntime = forkRuntime(sourceIdentity);
    const targetRuntime = forkRuntime({
      sessionId: "session-target-initial",
      sessionGeneration: 1,
      sessionPath: "/sessions/target-initial.jsonl"
    });
    const forkSessionFrom = vi.fn(async (sourcePath: string, entryId: string) => {
      expect(sourcePath).toBe(sourceIdentity.sessionPath);
      expect(entryId).toBe("assistant-entry-8");
      targetRuntime.identity = {
        sessionId: "session-target-forked",
        sessionGeneration: 2,
        sessionPath: "/sessions/target-forked.jsonl"
      };
      return targetRuntime.snapshot();
    });
    targetRuntime.runtime.forkSessionFrom = forkSessionFrom;
    const runtimes = [sourceRuntime.runtime, targetRuntime.runtime];
    const server = new AgentHostServer(async () => {
      const runtime = runtimes.shift();
      if (!runtime) throw new Error("Unexpected Runtime load.");
      return runtime;
    });
    const port = await connect(server);

    const sourceOpen = commandEnvelopeForContext("workspace.open", {
      cwd: "/tmp/workspace",
      trust: "unknown",
      approvalMode: "guided"
    }, testTaskContext(1, { taskId: "task-source" }), 10, "open-source-task");
    port.emit(sourceOpen);
    await waitForResponse(port, sourceOpen.requestId);
    expect(successResult(port, sourceOpen.requestId)).toMatchObject({
      sessionId: "session-source",
      sessionGeneration: 4
    });

    const fork = commandEnvelopeForContext("session.forkFromTask", {
      sourceTaskId: "task-source",
      sourceTaskGeneration: 1,
      sourceSessionId: "session-source",
      sourceSessionGeneration: 4,
      entryId: "assistant-entry-8"
    }, testTaskContext(1, { taskId: "task-target" }), 10, "fork-target-task");
    port.emit(fork);
    await waitForResponse(port, fork.requestId);

    expect(successResult(port, fork.requestId)).toMatchObject({
      sessionId: "session-target-forked",
      sessionGeneration: 2
    });
    expect(forkSessionFrom).toHaveBeenCalledOnce();
    expect(sourceRuntime.runtime.getIdentity()).toEqual(sourceIdentity);
    const targetBootstrap = port.sent.find((value) => (
      isEventEnvelope(value)
      && value.type === "session.bootstrap"
      && value.context.scope === "task"
      && value.context.taskId === "task-target"
    ));
    expect(targetBootstrap).toMatchObject({
      context: {
        scope: "task",
        workspaceId: "workspace-test",
        taskId: "task-target",
        taskGeneration: 1,
        sessionId: "session-target-forked",
        sessionGeneration: 2
      },
      payload: {
        snapshot: { sessionId: "session-target-forked" },
        reason: "session-fork"
      }
    });
    expect(port.sent.some((value) => (
      isEventEnvelope(value)
      && value.type === "session.bootstrap"
      && value.context.scope === "task"
      && value.context.taskId === "task-source"
    ))).toBe(false);
    await server.shutdown();
  });

  it("rejects a stale source Task generation without forking the target Runtime", async () => {
    const harness = await createForkHarness();
    const fork = await harness.sendFork({ sourceTaskGeneration: 2 });

    expect(failureResult(harness.port, fork.requestId)).toMatchObject({
      code: "INVALID_PAYLOAD",
      message: "The source Task generation is stale."
    });
    expect(harness.targetForkSessionFrom).not.toHaveBeenCalled();
    await harness.server.shutdown();
  });

  it("rejects stale source Session authority without forking the target Runtime", async () => {
    const harness = await createForkHarness();
    const fork = await harness.sendFork({ sourceSessionGeneration: 3 });

    expect(failureResult(harness.port, fork.requestId)).toMatchObject({
      code: "STALE_SESSION_GENERATION",
      message: "The source Session authority changed before the new Task was created."
    });
    expect(harness.targetForkSessionFrom).not.toHaveBeenCalled();
    await harness.server.shutdown();
  });

  it("requires distinct source and target Task authority", async () => {
    const harness = await createForkHarness();
    const fork = await harness.sendFork({}, "task-source");

    expect(failureResult(harness.port, fork.requestId)).toMatchObject({
      code: "INVALID_PAYLOAD",
      message: "A new Task fork requires distinct source and target Task authority."
    });
    expect(harness.sourceForkSessionFrom).not.toHaveBeenCalled();
    expect(harness.targetForkSessionFrom).not.toHaveBeenCalled();
    await harness.server.shutdown();
  });

  it("returns BUSY instead of waiting behind active source work", async () => {
    const harness = await createForkHarness();
    let resolveCreate!: (snapshot: ReturnType<typeof harness.source.snapshot>) => void;
    const createSession = vi.fn(() => new Promise<ReturnType<typeof harness.source.snapshot>>((resolve) => {
      resolveCreate = resolve;
    }));
    harness.source.runtime.createSession = createSession;
    const create = commandEnvelopeForContext(
      "session.create",
      {},
      testTaskContext(1, { taskId: "task-source" }),
      10,
      "create-source-while-forking"
    );
    harness.port.emit(create);
    await vi.waitFor(() => expect(createSession).toHaveBeenCalledOnce());

    const fork = await harness.sendFork();
    const failure = failureResult(harness.port, fork.requestId);
    resolveCreate(harness.source.snapshot());
    await waitForResponse(harness.port, create.requestId);
    await harness.server.shutdown();

    expect(failure).toMatchObject({ code: "BUSY" });
    expect(harness.targetForkSessionFrom).not.toHaveBeenCalled();
  });
});

type CrossTaskForkPayload = Extract<
  AgentCommand,
  { type: "session.forkFromTask" }
>["payload"];

async function createForkHarness() {
  const source = forkRuntime({
    sessionId: "session-source",
    sessionGeneration: 4,
    sessionPath: "/sessions/source.jsonl"
  });
  const target = forkRuntime({
    sessionId: "session-target-initial",
    sessionGeneration: 1,
    sessionPath: "/sessions/target-initial.jsonl"
  });
  const sourceForkSessionFrom = vi.fn(async () => source.snapshot());
  const targetForkSessionFrom = vi.fn(async () => target.snapshot());
  source.runtime.forkSessionFrom = sourceForkSessionFrom;
  target.runtime.forkSessionFrom = targetForkSessionFrom;
  const runtimes = [source.runtime, target.runtime];
  const server = new AgentHostServer(async () => {
    const runtime = runtimes.shift();
    if (!runtime) throw new Error("Unexpected Runtime load.");
    return runtime;
  });
  const port = await connect(server);
  const sourceOpen = commandEnvelopeForContext("workspace.open", {
    cwd: "/tmp/workspace",
    trust: "unknown",
    approvalMode: "guided"
  }, testTaskContext(1, { taskId: "task-source" }), 10, "open-source-task");
  port.emit(sourceOpen);
  await waitForResponse(port, sourceOpen.requestId);

  return {
    server,
    port,
    source,
    sourceForkSessionFrom,
    targetForkSessionFrom,
    async sendFork(
      overrides: Partial<CrossTaskForkPayload> = {},
      targetTaskId = "task-target"
    ) {
      const payload: CrossTaskForkPayload = {
        sourceTaskId: "task-source",
        sourceTaskGeneration: 1,
        sourceSessionId: "session-source",
        sourceSessionGeneration: 4,
        entryId: "assistant-entry-8",
        ...overrides
      };
      const fork = commandEnvelopeForContext(
        "session.forkFromTask",
        payload,
        testTaskContext(1, { taskId: targetTaskId }),
        10,
        `fork-${targetTaskId}`
      );
      port.emit(fork);
      await waitForResponse(port, fork.requestId);
      return fork;
    }
  };
}

async function connect(server: AgentHostServer): Promise<FakePort> {
  const port = new FakePort();
  server.attachPort(port, {
    appInstanceId: "app-cross-task-fork",
    hostInstanceId: "host-cross-task-fork",
    hostEpoch: 10
  });
  port.emit({
    protocolVersion: 3,
    protocolRevision: PROTOCOL_REVISION,
    kind: "hello",
    rendererInstanceId: "renderer-cross-task-fork",
    appInstanceId: "app-cross-task-fork",
    maxEnvelopeBytes: 2 * 1024 * 1024
  } satisfies RendererHello);
  await vi.waitFor(() => expect(port.sent.some(isHostWelcome)).toBe(true));
  return port;
}

async function waitForResponse(port: FakePort, requestId: string): Promise<void> {
  await vi.waitFor(() => expect(port.sent.some((value) => (
    isResponseEnvelope(value) && value.requestId === requestId
  ))).toBe(true));
}

function successResult(port: FakePort, requestId: string): unknown {
  const response = port.sent.find((value) => (
    isResponseEnvelope(value) && value.requestId === requestId
  ));
  if (!isResponseEnvelope(response) || !response.ok) throw new Error("Expected successful response.");
  return response.result;
}

function failureResult(port: FakePort, requestId: string): unknown {
  const response = port.sent.find((value) => (
    isResponseEnvelope(value) && value.requestId === requestId
  ));
  if (!isResponseEnvelope(response) || response.ok) throw new Error("Expected failed response.");
  return response.error;
}

function forkRuntime(initialIdentity: {
  sessionId: string;
  sessionGeneration: number;
  sessionPath: string;
}) {
  const fixture = {
    identity: { ...initialIdentity },
    snapshot: () => ({
      ...emptySnapshot(),
      sessionId: fixture.identity.sessionId,
      sessionPath: fixture.identity.sessionPath
    }),
    runtime: undefined as unknown as AgentRuntime
  };
  fixture.runtime = {
    getSdkVersion: () => "0.81.1",
    getExtensionUiCapabilities: extensionUiCapabilities,
    subscribe: () => () => undefined,
    initialize: async () => fixture.snapshot(),
    getSnapshot: () => fixture.snapshot(),
    getIdentity: () => ({ ...fixture.identity }),
    forkSessionFrom: async () => fixture.snapshot(),
    cancelInteractiveRequests: () => [],
    dispose: async () => undefined
  } as unknown as AgentRuntime;
  return fixture;
}

function extensionUiCapabilities() {
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
      widgetPlacements: ["aboveEditor" as const, "belowEditor" as const]
    }
  };
}

function emptySnapshot() {
  return {
    sessionId: "session-1",
    sessionPath: "/sessions/session-1.jsonl",
    cwd: "/tmp/workspace",
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
