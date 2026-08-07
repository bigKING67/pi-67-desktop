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

describe("AgentHostServer queue lane", () => {
  it("cancels pending deliveries and clears Pi through an ordered barrier", async () => {
    const order: string[] = [];
    let releaseSteer!: () => void;
    const submitPrompt = vi.fn(() => new Promise<void>(() => undefined));
    const steer = vi.fn((text: string) => new Promise<void>((resolve) => {
      order.push(`steer:${text}:start`);
      releaseSteer = () => {
        order.push(`steer:${text}:end`);
        resolve();
      };
    }));
    const followUp = vi.fn(async (text: string) => {
      order.push(`follow-up:${text}`);
    });
    const clearQueue = vi.fn(() => {
      order.push("runtime:clear");
      return { steeringCount: 2, followUpCount: 1 };
    });
    const runtime = {
      getSdkVersion: () => "0.81.1",
      subscribe: () => () => undefined,
      getIdentity: () => ({ sessionId: "session-queue", sessionFileIdentity: "session-file-session-queue", sessionGeneration: 4 }),
      submitPrompt,
      steer,
      followUp,
      clearQueue,
      flushStream: () => undefined,
      cancelInteractiveRequests: () => [],
      dispose: async () => undefined
    } as unknown as AgentRuntime;
    const server = new AgentHostServer(async () => runtime, { maxQueuedCommands: 3 });
    const port = new FakePort();
    server.attachPort(port, { appInstanceId: "app-queue", hostInstanceId: "host-queue", hostEpoch: 9 });
    port.emit({
      protocolVersion: PROTOCOL_VERSION,
      protocolRevision: PROTOCOL_REVISION,
      kind: "hello",
      rendererInstanceId: "renderer-queue",
      appInstanceId: "app-queue",
      maxEnvelopeBytes: 2 * 1024 * 1024
    } satisfies RendererHello);
    await vi.waitFor(() => expect(port.sent.some(isHostWelcome)).toBe(true));

    const turn = commandEnvelope("prompt.submit", {
      submissionId: "turn-1",
      text: "keep running",
      delivery: "new-turn"
    }, 9);
    port.emit(turn);
    await waitForSuccess(port, turn.requestId);
    await vi.waitFor(() => expect(submitPrompt).toHaveBeenCalledOnce());

    const running = commandEnvelope("prompt.submit", {
      submissionId: "queue-running",
      text: "running",
      delivery: "steer"
    }, 9);
    const pending = commandEnvelope("prompt.submit", {
      submissionId: "queue-pending",
      text: "pending",
      delivery: "follow-up"
    }, 9);
    port.emit(running);
    port.emit(pending);
    await vi.waitFor(() => expect(steer).toHaveBeenCalledOnce());

    const clear = commandEnvelope("queue.clear", {}, 9);
    const afterClear = commandEnvelope("prompt.submit", {
      submissionId: "queue-after-clear",
      text: "after-clear",
      delivery: "follow-up"
    }, 9);
    port.emit(clear);
    port.emit(afterClear);
    expect(clearQueue).not.toHaveBeenCalled();
    expect(followUp).not.toHaveBeenCalled();

    releaseSteer();
    await waitForSuccess(port, running.requestId);
    await vi.waitFor(() => {
      expect(responseFor(port, pending.requestId)).toMatchObject({
        ok: false,
        error: { code: "STALE_OPERATION", details: { queueCleared: true } }
      });
      expect(responseFor(port, clear.requestId)).toMatchObject({
        ok: true,
        result: { steeringCount: 2, followUpCount: 1, pendingCount: 1 }
      });
      expect(responseFor(port, afterClear.requestId)).toMatchObject({ ok: true });
    });
    expect(order).toEqual([
      "steer:running:start",
      "steer:running:end",
      "runtime:clear",
      "follow-up:after-clear"
    ]);
    expect(followUp).toHaveBeenCalledOnce();
    await server.shutdown();
  });
});

async function waitForSuccess(port: FakePort, requestId: string): Promise<void> {
  await vi.waitFor(() => expect(responseFor(port, requestId)).toMatchObject({ ok: true }));
}

function responseFor(port: FakePort, requestId: string) {
  return port.sent.find((value) => isResponseEnvelope(value) && value.requestId === requestId);
}
