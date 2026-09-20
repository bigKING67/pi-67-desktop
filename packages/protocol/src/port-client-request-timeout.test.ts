import { describe, expect, it, vi } from "vitest";
import {
  AgentPortClient,
  OPERATION_ABORT_ACK_TIMEOUT_MS
} from "./port-client.js";
import { type RendererHello } from "./envelope.js";
import { FakePort, hostWelcome } from "./port-client-test-fixtures.js";

describe("AgentPortClient request acknowledgement overrides", () => {
  it.each(["enterprise.knowledge.sync", "enterprise.knowledge.index"] as const)("allows the %s run and cleanup margin, then cancels at its bounded deadline", async type => {
    vi.useFakeTimers();
    try {
      const port = new FakePort(), client = new AgentPortClient(port);
      port.emit("message", hostWelcome(port.sent[0] as RendererHello, 4));
      const pending = client.request(type, { teamId: "00000000-0000-4000-8000-000000000001" });
      let failure: unknown;
      void pending.catch((error: unknown) => { failure = error; });
      const deadline = type === "enterprise.knowledge.sync" ? 75_000 : 510_000;
      await vi.advanceTimersByTimeAsync(deadline - 7_000);
      expect(failure).toBeUndefined();
      await vi.advanceTimersByTimeAsync(6_999);
      expect(failure).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      expect(failure).toMatchObject({ code: "REQUEST_TIMEOUT" });
      expect(client.isClosed).toBe(false);
    } finally { vi.useRealTimers(); }
  });
  it("honors a bounded per-request acknowledgement timeout without closing the Port", async () => {
    vi.useFakeTimers();
    try {
      const port = new FakePort();
      const client = new AgentPortClient(port);
      const hello = port.sent[0] as RendererHello;
      port.emit("message", hostWelcome(hello, 4));

      const pending = client.request("session.create", { creationId: "session-creation-timeout" }, [], {
        idempotencyKey: "create-session-override",
        ackTimeoutMs: 5_000
      });
      let failure: unknown;
      void pending.catch((error: unknown) => { failure = error; });
      await vi.advanceTimersByTimeAsync(4_999);
      expect(failure).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      expect(failure).toMatchObject({ code: "REQUEST_TIMEOUT" });
      expect(client.isClosed).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects an invalid acknowledgement timeout before sending", async () => {
    const port = new FakePort();
    const client = new AgentPortClient(port);
    const hello = port.sent[0] as RendererHello;
    port.emit("message", hostWelcome(hello, 4));

    await expect(client.request("session.create", { creationId: "session-creation-timeout" }, [], {
      idempotencyKey: "create-session-invalid-timeout",
      ackTimeoutMs: 999
    })).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    expect(port.sent).toHaveLength(1);
  });

  it("keeps operation.abort alive beyond the generic deadline but remains bounded", async () => {
    vi.useFakeTimers();
    try {
      const port = new FakePort();
      const client = new AgentPortClient(port);
      const hello = port.sent[0] as RendererHello;
      port.emit("message", hostWelcome(hello, 4));

      const pending = client.request("operation.abort", { operationId: "operation-1" });
      let failure: unknown;
      void pending.catch((error: unknown) => { failure = error; });

      await vi.advanceTimersByTimeAsync(15_000);
      expect(failure).toBeUndefined();
      await vi.advanceTimersByTimeAsync(OPERATION_ABORT_ACK_TIMEOUT_MS - 15_000 - 1);
      expect(failure).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      expect(failure).toMatchObject({
        code: "REQUEST_TIMEOUT",
        message: "Agent request acknowledgement timed out: operation.abort"
      });
      expect(client.isClosed).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
