import { describe, expect, it, vi } from "vitest";
import type { AgentRuntime } from "@pi67/pi-runtime";
import {
  commandEnvelope,
  isEventEnvelope,
  isHostWelcome,
  isResponseEnvelope,
  type CommandPayloads,
  type ProtocolPort,
  type RendererHello
} from "@pi67/protocol";
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

describe("AgentHostServer operation replay", () => {
  it("accepts and replays a non-cancellable Session import before it changes Session authority", async () => {
    let finish!: () => void;
    let sessionId = "session-before-import";
    let sessionGeneration = 2;
    const importedSnapshot = {
      ...emptySnapshot(),
      sessionId: "session-imported",
      cwd: "/tmp/imported"
    };
    const importSession = vi.fn(() => new Promise<typeof importedSnapshot>((resolve) => {
      finish = () => {
        sessionId = importedSnapshot.sessionId;
        sessionGeneration += 1;
        resolve(importedSnapshot);
      };
    }));
    const { port, server } = await createHarness({
      getIdentity: () => ({ sessionId, sessionGeneration }),
      importSession
    });

    const accepted = await send(port, "session.import", {
      submissionId: "session-import-stable-1",
      path: "/tmp/external.jsonl"
    });
    const operationId = acceptedOperationId(accepted);
    expect(accepted).toMatchObject({ ok: true, result: { cancellable: false } });
    expect(port.sent.some((value) => isEventEnvelope(value) && value.type === "operation.completed")).toBe(false);
    await vi.waitFor(() => expect(importSession).toHaveBeenCalledOnce());

    const replay = await send(port, "session.import", {
      submissionId: "session-import-stable-1",
      path: "/tmp/external.jsonl"
    });
    expect(replay).toMatchObject({ ok: true, result: { operationId } });
    expect(importSession).toHaveBeenCalledOnce();

    const mismatch = await send(port, "session.import", {
      submissionId: "session-import-stable-1",
      path: "/tmp/different.jsonl"
    });
    expect(mismatch).toMatchObject({ ok: false, error: { code: "DUPLICATE_REQUEST" } });
    expect(importSession).toHaveBeenCalledOnce();

    const abort = await sendAbort(port, operationId);
    expect(abort).toMatchObject({ ok: true, result: { aborted: false, operationId } });

    finish();
    await vi.waitFor(() => {
      expect(port.sent.some((value) => isEventEnvelope(value) && value.type === "operation.completed")).toBe(true);
    });
    const bootstrapIndex = port.sent.findIndex((value) => isEventEnvelope(value) && value.type === "session.bootstrap");
    const completedIndex = port.sent.findIndex((value) => isEventEnvelope(value) && value.type === "operation.completed");
    expect(completedIndex).toBeGreaterThan(bootstrapIndex);
    expect(port.sent[bootstrapIndex]).toMatchObject({
      sessionId: "session-imported",
      sessionGeneration: 3,
      payload: { reason: "session-import", snapshot: { sessionId: "session-imported" } }
    });
    const settledReplay = await send(port, "session.import", {
      submissionId: "session-import-stable-1",
      path: "/tmp/external.jsonl"
    });
    expect(settledReplay).toMatchObject({
      ok: true,
      result: {
        kind: "settled",
        operationId,
        operationKind: "session-import",
        lifecycle: "completed",
        sessionId: "session-imported",
        sessionGeneration: 3
      }
    });
    expect(importSession).toHaveBeenCalledOnce();
    await server.shutdown();
  });

  it("replays one command acceptance and rejects content reuse without invoking Pi twice", async () => {
    let finish!: () => void;
    const invokeCommand = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const { port, server } = await createHarness({ invokeCommand });

    const accepted = await send(port, "command.invoke", {
      submissionId: "command-stable-1",
      command: "inspect"
    });
    expect(accepted).toMatchObject({ ok: true, result: { cancellable: false } });
    const operationId = acceptedOperationId(accepted);

    const replay = await send(port, "command.invoke", {
      submissionId: "command-stable-1",
      command: "inspect"
    });
    expect(replay).toMatchObject({ ok: true, result: { operationId } });
    expect(invokeCommand).toHaveBeenCalledOnce();

    const mismatch = await send(port, "command.invoke", {
      submissionId: "command-stable-1",
      command: "doctor"
    });
    expect(mismatch).toMatchObject({ ok: false, error: { code: "DUPLICATE_REQUEST" } });
    expect(invokeCommand).toHaveBeenCalledOnce();

    finish();
    await vi.waitFor(() => {
      expect(port.sent.some((value) => isEventEnvelope(value) && value.type === "operation.completed")).toBe(true);
    });
    const settledReplay = await send(port, "command.invoke", {
      submissionId: "command-stable-1",
      command: "inspect"
    });
    expect(settledReplay).toMatchObject({
      ok: true,
      result: { kind: "settled", operationId, operationKind: "command", lifecycle: "completed" }
    });
    expect(invokeCommand).toHaveBeenCalledOnce();
    const resync = await sendProjectionResync(port);
    expect(resync).toMatchObject({
      ok: true,
      result: {
        latestOperationTerminal: {
          kind: "settled",
          operationId,
          operationKind: "command",
          lifecycle: "completed"
        }
      }
    });
    if (!resync.ok) throw new Error("Expected a successful projection resync.");
    expect(resync.result).not.toHaveProperty("activeOperation");
    await server.shutdown();
  });

  it("replays one compaction acceptance and rejects changed instructions", async () => {
    let finish!: () => void;
    const compact = vi.fn(async () => {
      await new Promise<void>((resolve) => { finish = resolve; });
    });
    const { port, server } = await createHarness({ compact });

    const accepted = await send(port, "session.compact", {
      submissionId: "compact-stable-1",
      instructions: "Preserve architecture decisions"
    });
    const operationId = acceptedOperationId(accepted);

    const replay = await send(port, "session.compact", {
      submissionId: "compact-stable-1",
      instructions: "Preserve architecture decisions"
    });
    expect(replay).toMatchObject({ ok: true, result: { operationId } });
    expect(compact).toHaveBeenCalledOnce();

    const mismatch = await send(port, "session.compact", {
      submissionId: "compact-stable-1",
      instructions: "Discard architecture decisions"
    });
    expect(mismatch).toMatchObject({ ok: false, error: { code: "DUPLICATE_REQUEST" } });
    expect(compact).toHaveBeenCalledOnce();

    finish();
    await vi.waitFor(() => {
      expect(port.sent.some((value) => isEventEnvelope(value) && value.type === "operation.completed")).toBe(true);
    });
    const settledReplay = await send(port, "session.compact", {
      submissionId: "compact-stable-1",
      instructions: "Preserve architecture decisions"
    });
    expect(settledReplay).toMatchObject({
      ok: true,
      result: { kind: "settled", operationId, operationKind: "compaction", lifecycle: "completed" }
    });
    expect(compact).toHaveBeenCalledOnce();
    await server.shutdown();
  });
});

async function createHarness(overrides: Partial<AgentRuntime>): Promise<{
  port: FakePort;
  server: AgentHostServer;
}> {
  const runtime = {
    getSdkVersion: () => "0.81.1",
    subscribe: () => () => undefined,
    getIdentity: () => ({ sessionId: "session-operation-replay", sessionGeneration: 7 }),
    getSnapshot: () => emptySnapshot(),
    getWorkspaceChanges: () => ({
      sessionId: "session-operation-replay",
      items: [],
      truncated: false,
      total: 0
    }),
    getExtensionCatalog: () => ({ items: [], total: 0, truncated: false }),
    getSessionCatalogStatus: () => ({
      revision: 0,
      itemCount: 0,
      source: "sqlite",
      state: "ready",
      rebuilding: false,
      incomplete: false,
      skippedCount: 0
    }),
    invokeCommand: async () => undefined,
    compact: async () => undefined,
    abort: async () => undefined,
    flushStream: () => undefined,
    cancelInteractiveRequests: () => [],
    dispose: async () => undefined,
    ...overrides
  } as AgentRuntime;
  const server = new AgentHostServer(async () => runtime);
  const port = new FakePort();
  server.attachPort(port, {
    appInstanceId: "app-operation-replay",
    hostInstanceId: "host-operation-replay",
    hostEpoch: 9
  });
  port.emit({
    protocolVersion: 2,
    kind: "hello",
    rendererInstanceId: "renderer-operation-replay",
    appInstanceId: "app-operation-replay",
    maxEnvelopeBytes: 2 * 1024 * 1024
  } satisfies RendererHello);
  await vi.waitFor(() => expect(port.sent.some(isHostWelcome)).toBe(true));
  return { port, server };
}

async function send<T extends "command.invoke" | "session.compact" | "session.import">(
  port: FakePort,
  type: T,
  payload: CommandPayloads[T]
) {
  const request = commandEnvelope(type, payload, 9);
  port.emit(request);
  await vi.waitFor(() => {
    expect(port.sent.some((value) => isResponseEnvelope(value) && value.requestId === request.requestId)).toBe(true);
  });
  const response = port.sent.find((value) => isResponseEnvelope(value) && value.requestId === request.requestId);
  if (!response || !isResponseEnvelope(response)) throw new Error(`Expected a ${type} response.`);
  return response;
}

async function sendAbort(port: FakePort, operationId: string) {
  const request = commandEnvelope("operation.abort", { operationId }, 9);
  port.emit(request);
  await vi.waitFor(() => {
    expect(port.sent.some((value) => isResponseEnvelope(value) && value.requestId === request.requestId)).toBe(true);
  });
  const response = port.sent.find((value) => isResponseEnvelope(value) && value.requestId === request.requestId);
  if (!response || !isResponseEnvelope(response)) throw new Error("Expected an operation.abort response.");
  return response;
}

async function sendProjectionResync(port: FakePort) {
  const request = commandEnvelope("projection.resync", {}, 9);
  port.emit(request);
  await vi.waitFor(() => {
    expect(port.sent.some((value) => isResponseEnvelope(value) && value.requestId === request.requestId)).toBe(true);
  });
  const response = port.sent.find((value) => isResponseEnvelope(value) && value.requestId === request.requestId);
  if (!response || !isResponseEnvelope(response)) throw new Error("Expected a projection.resync response.");
  return response;
}

function acceptedOperationId(response: unknown): string {
  if (!isResponseEnvelope(response) || !response.ok) {
    throw new Error("Expected an accepted operation response.");
  }
  return (response.result as { operationId: string }).operationId;
}

function emptySnapshot() {
  return {
    sessionId: "session-operation-replay",
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
