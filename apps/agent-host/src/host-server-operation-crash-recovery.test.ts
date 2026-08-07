import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentRuntime } from "@pi67/pi-runtime";
import {
  PROTOCOL_REVISION,
  PROTOCOL_VERSION,
  isEventEnvelope,
  isHostWelcome,
  isResponseEnvelope,
  type CommandPayloads,
  type ProtocolPort,
  type RendererHello
} from "@pi67/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
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

describe("AgentHostServer Operation crash recovery", () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = undefined;
  });

  it("projects an unresolved previous-Host submission as lost without replaying Pi", async () => {
    root = await mkdtemp(join(tmpdir(), "pi67-host-operation-crash-"));
    let finishFirst!: () => void;
    const firstSubmit = vi.fn(() => new Promise<void>((resolve) => { finishFirst = resolve; }));
    const first = await createHarness(1, root, firstSubmit);
    const accepted = await send(first.port, 1, "prompt.submit", {
      submissionId: "submission-host-crash",
      text: "do this once",
      delivery: "new-turn"
    });
    const operationId = acceptedOperationId(accepted);
    await vi.waitFor(() => expect(firstSubmit).toHaveBeenCalledOnce());

    const replacementSubmit = vi.fn(async () => undefined);
    const replacement = await createHarness(2, root, replacementSubmit);
    const resync = await send(replacement.port, 2, "projection.resync", {});
    expect(resync).toMatchObject({
      ok: true,
      result: {
        latestOperationTerminal: {
          operationId,
          lifecycle: "lost",
          hostEpoch: 2
        }
      }
    });
    if (!resync.ok) throw new Error("Expected projection.resync to succeed.");
    expect(resync.result).not.toHaveProperty("activeOperation");

    const replay = await send(replacement.port, 2, "prompt.submit", {
      submissionId: "submission-host-crash",
      text: "do this once",
      delivery: "new-turn"
    });
    expect(replay).toMatchObject({
      ok: true,
      result: { operationId, lifecycle: "lost", hostEpoch: 2 }
    });
    expect(replacementSubmit).not.toHaveBeenCalled();

    finishFirst();
    await vi.waitFor(() => expect(first.port.sent.some((value) => (
      isEventEnvelope(value) && value.type === "operation.lost"
    ))).toBe(true));
    expect(first.port.sent.some((value) => (
      isEventEnvelope(value) && value.type === "operation.completed"
    ))).toBe(false);
    await first.server.shutdown();
    await replacement.server.shutdown();
  });
});

async function createHarness(
  hostEpoch: number,
  operationReceiptStorageRoot: string,
  submitPrompt: AgentRuntime["submitPrompt"]
): Promise<{ port: FakePort; server: AgentHostServer }> {
  const runtime = runtimeWith(submitPrompt);
  const server = new AgentHostServer(async () => runtime, { operationReceiptStorageRoot });
  const port = new FakePort();
  server.attachPort(port, {
    appInstanceId: "app-operation-crash",
    hostInstanceId: `host-operation-crash-${hostEpoch}`,
    hostEpoch
  });
  port.emit({
    protocolVersion: PROTOCOL_VERSION,
    protocolRevision: PROTOCOL_REVISION,
    kind: "hello",
    rendererInstanceId: `renderer-operation-crash-${hostEpoch}`,
    appInstanceId: "app-operation-crash",
    maxEnvelopeBytes: 2 * 1024 * 1024
  } satisfies RendererHello);
  await vi.waitFor(() => expect(port.sent.some(isHostWelcome)).toBe(true));
  return { port, server };
}

async function send<T extends "prompt.submit" | "projection.resync">(
  port: FakePort,
  hostEpoch: number,
  type: T,
  payload: CommandPayloads[T]
) {
  const request = commandEnvelope(type, payload, hostEpoch);
  port.emit(request);
  await vi.waitFor(() => expect(port.sent.some((value) => (
    isResponseEnvelope(value) && value.requestId === request.requestId
  ))).toBe(true));
  const response = port.sent.find((value) => (
    isResponseEnvelope(value) && value.requestId === request.requestId
  ));
  if (!response || !isResponseEnvelope(response)) throw new Error(`Expected a ${type} response.`);
  return response;
}

function acceptedOperationId(response: unknown): string {
  if (!isResponseEnvelope(response) || !response.ok) throw new Error("Expected Operation acceptance.");
  return (response.result as { operationId: string }).operationId;
}

function runtimeWith(submitPrompt: AgentRuntime["submitPrompt"]): AgentRuntime {
  return {
    getSdkVersion: () => "0.81.1",
    subscribe: () => () => undefined,
    getIdentity: () => ({
      sessionId: "session-operation-crash",
      sessionFileIdentity: "session-file-operation-crash",
      sessionGeneration: 7
    }),
    getSnapshot: () => emptySnapshot(),
    getTaskToolMode: () => "auto",
    getWorkspaceChanges: () => ({
      sessionId: "session-operation-crash",
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
    submitPrompt,
    abort: async () => undefined,
    flushStream: () => undefined,
    cancelInteractiveRequests: () => [],
    dispose: async () => undefined
  } as unknown as AgentRuntime;
}

function emptySnapshot() {
  return {
    sessionId: "session-operation-crash",
    sessionFileIdentity: "session-file-operation-crash",
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
