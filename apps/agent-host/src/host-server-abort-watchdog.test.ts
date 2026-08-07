import { afterEach, describe, expect, it, vi } from "vitest";
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

describe("AgentHostServer abort watchdog", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits operation.lost and poisons the Host before requesting replacement", async () => {
    const onRuntimePoisoned = vi.fn();
    const flushStream = vi.fn();
    const runtime = {
      getSdkVersion: () => "0.81.1",
      subscribe: () => () => undefined,
      getIdentity: () => ({ sessionId: "session-1", sessionFileIdentity: "session-file-session-1", sessionGeneration: 2 }),
      submitPrompt: () => new Promise<void>(() => undefined),
      abort: () => new Promise<void>(() => undefined),
      flushStream,
      cancelInteractiveRequests: () => [],
      dispose: async () => undefined
    } as unknown as AgentRuntime;
    const server = new AgentHostServer(async () => runtime, {
      abortWatchdogMs: 25,
      onRuntimePoisoned
    });
    const port = new FakePort();
    server.attachPort(port, { appInstanceId: "app-1", hostInstanceId: "host-1", hostEpoch: 5 });
    port.emit({
      protocolVersion: PROTOCOL_VERSION,
      protocolRevision: PROTOCOL_REVISION,
      kind: "hello",
      rendererInstanceId: "renderer-1",
      appInstanceId: "app-1",
      maxEnvelopeBytes: 2 * 1024 * 1024
    } satisfies RendererHello);
    await vi.waitFor(() => expect(port.sent.some(isHostWelcome)).toBe(true));

    const prompt = commandEnvelope("prompt.submit", {
      submissionId: "submission-1",
      text: "run forever",
      delivery: "new-turn"
    }, 5);
    port.emit(prompt);
    await vi.waitFor(() => expect(responseFor(port, prompt.requestId)).toMatchObject({ ok: true }));
    await vi.waitFor(() => expect(eventTypes(port)).toEqual(["operation.started"]));
    const accepted = responseFor(port, prompt.requestId);
    if (!accepted || !isResponseEnvelope(accepted) || !accepted.ok) throw new Error("Expected prompt acceptance.");
    const operationId = (accepted.result as { operationId: string }).operationId;

    vi.useFakeTimers();
    const abort = commandEnvelope("operation.abort", { operationId }, 5);
    port.emit(abort);
    await vi.advanceTimersByTimeAsync(25);
    await Promise.resolve();

    expect(responseFor(port, abort.requestId)).toMatchObject({
      ok: false,
      error: { code: "RUNTIME_POISONED" }
    });
    expect(eventTypes(port)).toEqual([
      "operation.started",
      "operation.lost",
      "runtime.statusChanged"
    ]);
    expect(onRuntimePoisoned).toHaveBeenCalledWith({
      type: "agent-host-runtime-poisoned",
      code: "ABORT_WATCHDOG_EXPIRED",
      operationId,
      abortTimeoutMs: 25
    });
    expect(flushStream).toHaveBeenCalledOnce();
    await server.shutdown();
  });
});

function responseFor(port: FakePort, requestId: string): unknown {
  return port.sent.find((value) => isResponseEnvelope(value) && value.requestId === requestId);
}

function eventTypes(port: FakePort): string[] {
  return port.sent.filter(isEventEnvelope).map((event) => event.type);
}
