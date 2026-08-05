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

describe("AgentHostServer replay-safe control mutations", () => {
  it("replays one mutation across a same-Host Port renewal", async () => {
    let sessionId = "session-a";
    let sessionGeneration = 1;
    let finishCreate!: () => void;
    const createSession = vi.fn(() => new Promise<ReturnType<typeof snapshot>>((resolve) => {
      finishCreate = () => {
        sessionId = "session-b";
        sessionGeneration = 2;
        resolve(snapshot("session-b"));
      };
    }));
    const runtime = {
      getSdkVersion: () => "0.81.1",
      subscribe: () => () => undefined,
      getIdentity: () => ({ sessionId, sessionGeneration }),
      createSession,
      cancelInteractiveRequests: () => [],
      dispose: async () => undefined
    } as unknown as AgentRuntime;
    const server = new AgentHostServer(async () => runtime);

    const firstPort = await attach(server);
    const createPayload = { creationId: "session-creation-b" };
    const first = commandEnvelope("session.create", createPayload, 5, "create-session-b");
    firstPort.emit(first);
    await vi.waitFor(() => expect(createSession).toHaveBeenCalledOnce());

    const renewedPort = await attach(server);
    const retry = commandEnvelope("session.create", createPayload, 5, "create-session-b");
    renewedPort.emit(retry);
    await Promise.resolve();
    expect(createSession).toHaveBeenCalledOnce();

    finishCreate();
    await expectResponse(renewedPort, retry.requestId, {
      ok: true,
      type: "session.create",
      result: {
        accepted: true,
        hostEpoch: 5,
        sessionId: "session-b",
        sessionGeneration: 2,
        eventSequence: 1
      }
    });
    expect(createSession).toHaveBeenCalledOnce();

    const settledRetry = commandEnvelope("session.create", createPayload, 5, "create-session-b");
    renewedPort.emit(settledRetry);
    await expectResponse(renewedPort, settledRetry.requestId, {
      ok: true,
      result: {
        accepted: true,
        hostEpoch: 5,
        sessionId: "session-b",
        sessionGeneration: 2,
        eventSequence: 1
      }
    });
    expect(createSession).toHaveBeenCalledOnce();

    const conflicting = commandEnvelope("session.open", { path: "/tmp/other.jsonl" }, 5, "create-session-b");
    renewedPort.emit(conflicting);
    await expectResponse(renewedPort, conflicting.requestId, {
      ok: false,
      error: { code: "DUPLICATE_REQUEST" }
    });

    sessionId = "session-c";
    sessionGeneration = 3;
    const staleRetry = commandEnvelope("session.create", createPayload, 5, "create-session-b");
    renewedPort.emit(staleRetry);
    await expectResponse(renewedPort, staleRetry.requestId, {
      ok: false,
      error: { code: "STALE_SESSION_GENERATION" }
    });
    await server.shutdown();
  });

  it("acknowledges rollback only after its incremental projection events", async () => {
    let listener: Parameters<AgentRuntime["subscribe"]>[0] = () => undefined;
    const rollback = vi.fn(async () => {
      listener({
        type: "conversation.changed",
        payload: { sessionId: "session-a", reason: "rolled-back" }
      });
      listener({ type: "tree.changed", payload: { reason: "rollback" } });
      listener({
        type: "usage.changed",
        payload: { tokens: 12, cost: 0.25, contextPercent: 4 }
      });
    });
    const runtime = {
      getSdkVersion: () => "0.81.1",
      subscribe: (next: typeof listener) => {
        listener = next;
        return () => undefined;
      },
      getIdentity: () => ({ sessionId: "session-a", sessionGeneration: 3 }),
      rollback,
      cancelInteractiveRequests: () => [],
      dispose: async () => undefined
    } as unknown as AgentRuntime;
    const server = new AgentHostServer(async () => runtime);
    const port = await attach(server);
    const request = commandEnvelope(
      "session.rollback",
      { entryId: "entry-1" },
      5,
      "rollback-entry-1"
    );

    port.emit(request);
    await expectResponse(port, request.requestId, {
      ok: true,
      type: "session.rollback",
      result: {
        accepted: true,
        hostEpoch: 5,
        sessionId: "session-a",
        sessionGeneration: 3,
        eventSequence: 3
      }
    });

    const responseIndex = port.sent.findIndex((value) => (
      isResponseEnvelope(value) && value.requestId === request.requestId
    ));
    const eventIndexes = ["conversation.changed", "tree.changed", "usage.changed"].map((type) => (
      port.sent.findIndex((value) => isEventEnvelope(value) && value.type === type)
    ));
    expect(eventIndexes).toEqual([expect.any(Number), expect.any(Number), expect.any(Number)]);
    expect(eventIndexes.every((index) => index >= 0 && index < responseIndex)).toBe(true);
    expect(rollback).toHaveBeenCalledOnce();
    await server.shutdown();
  });

  it("serves event-driven projection queries after rollback settles instead of returning BUSY", async () => {
    let listener: Parameters<AgentRuntime["subscribe"]>[0] = () => undefined;
    let finishRollback!: () => void;
    const rollback = vi.fn(async () => {
      listener({
        type: "conversation.changed",
        payload: { sessionId: "session-a", reason: "rolled-back" }
      });
      listener({ type: "tree.changed", payload: { reason: "rollback" } });
      await new Promise<void>((resolve) => { finishRollback = resolve; });
    });
    const tree = { nodes: [], truncated: false, total: 0 };
    const page = {
      sessionId: "session-a",
      messages: [],
      hasOlder: false,
      hasNewer: false
    };
    const getSessionTree = vi.fn(() => tree);
    const getMessagePage = vi.fn(() => page);
    const runtime = {
      getSdkVersion: () => "0.81.1",
      subscribe: (next: typeof listener) => {
        listener = next;
        return () => undefined;
      },
      getIdentity: () => ({ sessionId: "session-a", sessionGeneration: 3 }),
      rollback,
      getSessionTree,
      getMessagePage,
      cancelInteractiveRequests: () => [],
      dispose: async () => undefined
    } as unknown as AgentRuntime;
    const server = new AgentHostServer(async () => runtime);
    const port = await attach(server);
    const rollbackRequest = commandEnvelope(
      "session.rollback",
      { entryId: "entry-1" },
      5,
      "rollback-with-refresh"
    );
    port.emit(rollbackRequest);
    await vi.waitFor(() => {
      expect(port.sent.some((value) => isEventEnvelope(value) && value.type === "tree.changed")).toBe(true);
    });

    const treeRequest = commandEnvelope("session.tree", {}, 5);
    const pageRequest = commandEnvelope("message.page", { direction: "older", limit: 100 }, 5);
    port.emit(treeRequest);
    port.emit(pageRequest);
    await Promise.resolve();
    expect(getSessionTree).not.toHaveBeenCalled();
    expect(getMessagePage).not.toHaveBeenCalled();
    expect(port.sent.some((value) => (
      isResponseEnvelope(value)
      && (value.requestId === treeRequest.requestId || value.requestId === pageRequest.requestId)
    ))).toBe(false);

    finishRollback();
    await expectResponse(port, rollbackRequest.requestId, { ok: true, type: "session.rollback" });
    await expectResponse(port, treeRequest.requestId, { ok: true, type: "session.tree", result: tree });
    await expectResponse(port, pageRequest.requestId, { ok: true, type: "message.page", result: page });
    expect(getSessionTree).toHaveBeenCalledOnce();
    expect(getMessagePage).toHaveBeenCalledOnce();
    await server.shutdown();
  });

  it("acknowledges a Session rename only after session metadata is published", async () => {
    let listener: Parameters<AgentRuntime["subscribe"]>[0] = () => undefined;
    const setSessionName = vi.fn(async (name: string) => {
      listener({
        type: "session.metaChanged",
        payload: {
          streaming: false,
          sessionName: name,
          thinkingLevel: "off"
        }
      });
    });
    const runtime = {
      getSdkVersion: () => "0.81.1",
      subscribe: (next: typeof listener) => {
        listener = next;
        return () => undefined;
      },
      getIdentity: () => ({ sessionId: "session-a", sessionGeneration: 3 }),
      setSessionName,
      cancelInteractiveRequests: () => [],
      dispose: async () => undefined
    } as unknown as AgentRuntime;
    const server = new AgentHostServer(async () => runtime);
    const port = await attach(server);
    const request = commandEnvelope(
      "session.name",
      { mutation: { action: "set", name: "Renamed Session" } },
      5,
      "rename-session-a"
    );

    port.emit(request);
    await expectResponse(port, request.requestId, {
      ok: true,
      type: "session.name",
      result: {
        accepted: true,
        hostEpoch: 5,
        sessionId: "session-a",
        sessionGeneration: 3,
        eventSequence: 1
      }
    });

    const eventIndex = port.sent.findIndex((value) => (
      isEventEnvelope(value) && value.type === "session.metaChanged"
    ));
    const responseIndex = port.sent.findIndex((value) => (
      isResponseEnvelope(value) && value.requestId === request.requestId
    ));
    expect(eventIndex).toBeGreaterThanOrEqual(0);
    expect(eventIndex).toBeLessThan(responseIndex);
    expect(setSessionName).toHaveBeenCalledWith("Renamed Session");
    await server.shutdown();
  });
});

let rendererCounter = 0;

async function attach(server: AgentHostServer): Promise<FakePort> {
  const port = new FakePort();
  server.attachPort(port, { appInstanceId: "app-1", hostInstanceId: "host-1", hostEpoch: 5 });
  port.emit({
    protocolVersion: 3,
    protocolRevision: PROTOCOL_REVISION,
    kind: "hello",
    rendererInstanceId: `renderer-${rendererCounter += 1}`,
    appInstanceId: "app-1",
    maxEnvelopeBytes: 2 * 1024 * 1024
  } satisfies RendererHello);
  await vi.waitFor(() => expect(port.sent.some(isHostWelcome)).toBe(true));
  return port;
}

async function expectResponse(port: FakePort, requestId: string, expected: object): Promise<void> {
  await vi.waitFor(() => {
    expect(port.sent.find((value) => isResponseEnvelope(value) && value.requestId === requestId))
      .toMatchObject(expected);
  });
}

function snapshot(sessionId: string) {
  return {
    sessionId,
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
