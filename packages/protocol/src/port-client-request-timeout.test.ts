import { describe, expect, it, vi } from "vitest";
import { AgentPortClient } from "./port-client.js";
import { type RendererHello } from "./envelope.js";
import { FakePort, hostWelcome } from "./port-client-test-fixtures.js";

describe("AgentPortClient request acknowledgement overrides", () => {
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
});
