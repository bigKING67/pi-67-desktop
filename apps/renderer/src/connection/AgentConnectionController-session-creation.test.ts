import { responseEnvelope } from "@pi67/protocol";
import { afterEach, expect, it, vi } from "vitest";
import { createController, createHost, disposeAgentConnectionFixtures, FakeHandoffTarget,
  flushMessagePorts } from "./AgentConnectionController.test-fixture.js";

afterEach(() => { disposeAgentConnectionFixtures(); vi.useRealTimers(); });

it.each(["complete", "timeout"] as const)("bounds cold Session creation without duplicate authority: %s", async (outcome) => {
  const target = new FakeHandoffTarget();
  const controller = createController(target);
  const host = createHost(9);
  host.handoff(target);
  await controller.waitForConnection();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const delayed = vi.fn();
  const settled = vi.fn();
  const pending = controller.request("session.create", { creationId: "cold-memory-session" }, [], {
    onAcknowledgementDelayed: delayed
  });
  void pending.then(settled, settled);
  const first = await host.nextRequest("session.create");
  await vi.advanceTimersByTimeAsync(5_000);
  const retry = await host.nextRequest("session.create");
  expect(delayed).toHaveBeenCalledOnce();
  expect(retry.idempotencyKey).toBe(first.idempotencyKey);
  expect(retry.payload).toEqual(first.payload);
  await vi.advanceTimersByTimeAsync(18_000);
  expect(settled).not.toHaveBeenCalled();
  if (outcome === "complete") {
    const result = { accepted: true as const, hostEpoch: 9, sessionId: "session-1",
      sessionFileIdentity: "session-file-session-1", sessionGeneration: 1, eventSequence: 1 };
    host.send(responseEnvelope(retry.requestId, 9, retry.context, { ok: true, type: "session.create", result }));
    await expect(pending).resolves.toEqual(result);
  } else {
    await vi.advanceTimersByTimeAsync(6_999);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).rejects.toMatchObject({ code: "REQUEST_OUTCOME_UNKNOWN" });
    expect(controller.hasOpenPort).toBe(true);
  }
  await flushMessagePorts();
  expect(host.requests).toHaveLength(0);
});
