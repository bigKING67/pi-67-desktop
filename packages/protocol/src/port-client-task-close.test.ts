import { describe, expect, it } from "vitest";
import { responseEnvelope, type ProtocolContext, type RendererHello } from "./envelope.js";
import { AgentPortClient } from "./port-client.js";
import { FakePort, hostWelcome, taskContext } from "./port-client-test-fixtures.js";

describe("AgentPortClient task close correlation", () => {
  it("correlates a replay-safe acknowledgement under Task authority", async () => {
    const port = new FakePort();
    const client = new AgentPortClient(port);
    const hello = port.sent[0] as RendererHello;
    port.emit("message", hostWelcome(hello, 4));
    const context = taskContext(3);

    const pending = client.request("task.close", { mode: "stop" }, [], {
      context,
      idempotencyKey: "close-task-stable-1"
    });
    await Promise.resolve();
    const request = port.sent[1] as {
      requestId: string;
      context: ProtocolContext;
      idempotencyKey?: string;
    };
    expect(request).toMatchObject({
      context,
      idempotencyKey: "close-task-stable-1",
      payload: { mode: "stop" },
      type: "task.close"
    });
    port.emit("message", responseEnvelope(request.requestId, 4, request.context, {
      ok: true,
      type: "task.close",
      result: { closed: true, stopped: true }
    }));

    await expect(pending).resolves.toEqual({ closed: true, stopped: true });
    expect(client.isClosed).toBe(false);
  });

  it("rejects close without Task authority before posting it", async () => {
    const port = new FakePort();
    const client = new AgentPortClient(port);
    const hello = port.sent[0] as RendererHello;
    port.emit("message", hostWelcome(hello, 4));

    await expect(client.request("task.close", { mode: "dispose" }, [], {
      idempotencyKey: "close-task-invalid-scope"
    })).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    expect(port.sent).toHaveLength(1);
    expect(client.isClosed).toBe(false);
  });

  it("fails closed when close is acknowledged for another Task generation", async () => {
    const port = new FakePort();
    const client = new AgentPortClient(port);
    const hello = port.sent[0] as RendererHello;
    port.emit("message", hostWelcome(hello, 4));

    const pending = client.request("task.close", { mode: "dispose" }, [], {
      context: taskContext(3),
      idempotencyKey: "close-task-context-1"
    });
    await Promise.resolve();
    const request = port.sent[1] as { requestId: string };
    port.emit("message", responseEnvelope(request.requestId, 4, taskContext(2), {
      ok: true,
      type: "task.close",
      result: { closed: true, stopped: false }
    }));

    await expect(pending).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    expect(client.isClosed).toBe(true);
    expect(port.closed).toBe(true);
  });
});
