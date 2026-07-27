import { describe, expect, it, vi } from "vitest";
import type { AgentRuntime } from "@pi67/pi-runtime";
import {
  commandEnvelope,
  isEventEnvelope,
  isHostWelcome,
  isResponseEnvelope,
  type ProtocolPort,
  type RendererHello
} from "@pi67/protocol";
import { AgentHostServer } from "./host-server.js";

class FakePort implements ProtocolPort {
  readonly sent: unknown[] = [];
  readonly close = vi.fn();
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>();

  postMessage(message: unknown): void { this.sent.push(message); }

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

describe("AgentHostServer shutdown", () => {
  it("fences admission, aborts the active operation and disposes once", async () => {
    const order: string[] = [];
    let finishDispose!: () => void;
    const cancelInteractiveRequests = vi.fn((reason: string) => {
      order.push(`interactive.cancel:${reason}`);
      return reason === "runtime-dispose" ? ["extension-1", "approval-1"] : [];
    });
    const abort = vi.fn(async () => {
      order.push("operation.abort");
    });
    const dispose = vi.fn(() => new Promise<void>((resolve) => {
      order.push("runtime.dispose");
      finishDispose = resolve;
    }));
    const flushStream = vi.fn(() => order.push("stream.flush"));
    const runtime = {
      getSdkVersion: () => "0.81.1",
      subscribe: () => () => undefined,
      getIdentity: () => ({ sessionId: "session-1", sessionGeneration: 2 }),
      submitPrompt: () => new Promise<void>(() => undefined),
      abort,
      flushStream,
      cancelInteractiveRequests,
      dispose
    } as unknown as AgentRuntime;
    const server = new AgentHostServer(async () => runtime, { abortWatchdogMs: 100 });
    const port = new FakePort();
    server.attachPort(port, { appInstanceId: "app-1", hostInstanceId: "host-1", hostEpoch: 4 });
    port.emit(hello("app-1"));
    await vi.waitFor(() => expect(port.sent.some(isHostWelcome)).toBe(true));

    const submit = commandEnvelope("prompt.submit", {
      submissionId: "shutdown-operation",
      text: "run until the application closes",
      delivery: "new-turn"
    }, 4);
    port.emit(submit);
    await vi.waitFor(() => {
      expect(port.sent.find((value) => isResponseEnvelope(value) && value.requestId === submit.requestId))
        .toMatchObject({ ok: true });
      expect(port.sent.some((value) => isEventEnvelope(value) && value.type === "operation.started")).toBe(true);
    });

    const firstShutdown = server.shutdown(1_000);
    const secondShutdown = server.shutdown(1_000);
    expect(secondShutdown).toBe(firstShutdown);
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce());

    const lateRequest = commandEnvelope("runtime.getStatus", {}, 4);
    port.emit(lateRequest);
    await vi.waitFor(() => {
      expect(port.sent.find((value) => isResponseEnvelope(value) && value.requestId === lateRequest.requestId))
        .toMatchObject({ ok: false, error: { code: "CONNECTION_CLOSED" } });
    });

    finishDispose();
    await expect(firstShutdown).resolves.toEqual({
      activeOperation: "cancelled",
      queuedCommandsDropped: 0,
      extensionRequestsCancelled: 2
    });
    expect(order).toEqual([
      "interactive.cancel:runtime-dispose",
      "operation.abort",
      "stream.flush",
      "runtime.dispose",
      "interactive.cancel:connection-close"
    ]);
    expect(abort).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
    expect(port.close).toHaveBeenCalledOnce();

    const latePort = new FakePort();
    server.attachPort(latePort);
    expect(latePort.close).toHaveBeenCalledOnce();
  });
});

function hello(appInstanceId: string): RendererHello {
  return {
    protocolVersion: 2,
    kind: "hello",
    rendererInstanceId: "renderer-1",
    appInstanceId,
    maxEnvelopeBytes: 2 * 1024 * 1024
  };
}
