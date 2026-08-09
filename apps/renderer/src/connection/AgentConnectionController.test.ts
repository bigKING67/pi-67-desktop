import {
  eventEnvelope,
  responseEnvelope
} from "@pi67/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createController,
  createHost,
  disposeAgentConnectionFixtures,
  FakeHandoffTarget,
  flushMessagePorts,
  projectionResyncResult,
  readyStatus
} from "./AgentConnectionController.test-fixture.js";
import { taskEventFixture } from "./protocol-test-fixtures.js";

afterEach(() => {
  disposeAgentConnectionFixtures();
  vi.useRealTimers();
});

describe("AgentConnectionController", () => {
  it("accepts only an exact source and origin handoff", async () => {
    const target = new FakeHandoffTarget();
    const controller = createController(target);
    const wrongSource = createHost(1);
    const wrongOrigin = createHost(1);
    const malformed = createHost(1);

    wrongSource.handoff(target, { source: {} as MessageEventSource });
    wrongOrigin.handoff(target, { origin: "https://attacker.invalid" });
    malformed.handoff(target, { data: { source: "pi67-preload", type: "agent-port", appInstanceId: "app-1", hostEpoch: -1 } });
    await flushMessagePorts();

    expect(controller.hasOpenPort).toBe(false);
    expect(wrongSource.hello).toBeUndefined();
    expect(wrongOrigin.hello).toBeUndefined();
    expect(malformed.hello).toBeUndefined();

    const trusted = createHost(4);
    trusted.handoff(target);
    await expect(controller.waitForConnection()).resolves.toMatchObject({ hostEpoch: 4, appInstanceId: "app-4" });
  });

  it("publishes a connected identity once and replays it to a later subscriber", async () => {
    const target = new FakeHandoffTarget();
    const controller = createController(target);
    const onConnected = vi.fn();
    controller.subscribe({ onConnected });

    createHost(2).handoff(target);
    const identity = await controller.waitForConnection();
    expect(identity).toMatchObject({ hostEpoch: 2, hostInstanceId: "host-2" });
    expect(onConnected).toHaveBeenCalledOnce();

    const lateSubscriber = vi.fn();
    controller.subscribe({ onConnected: lateSubscriber });
    await Promise.resolve();
    expect(lateSubscriber).toHaveBeenCalledOnce();
    expect(lateSubscriber).toHaveBeenCalledWith(identity);
  });

  it("rejects pending work immediately and emits one teardown when the Port closes", async () => {
    const target = new FakeHandoffTarget();
    const controller = createController(target);
    const host = createHost(3);
    const onTeardown = vi.fn();
    controller.subscribe({ onTeardown });
    host.handoff(target);
    await controller.waitForConnection();

    const pending = controller.request("runtime.getStatus", {});
    const rejection = expect(pending).rejects.toMatchObject({ code: "CONNECTION_CLOSED" });
    await host.nextRequest("runtime.getStatus");
    host.closeControllerPort();

    await rejection;
    await vi.waitFor(() => expect(onTeardown).toHaveBeenCalledOnce());
    expect(controller.identity).toBeUndefined();
    expect(controller.hasOpenPort).toBe(false);
  });

  it("forwards per-request cancellation without tearing down the Host connection", async () => {
    const target = new FakeHandoffTarget();
    const controller = createController(target);
    const host = createHost(3);
    host.handoff(target);
    await controller.waitForConnection();
    const abort = new AbortController();

    const pending = controller.request("workspace.usage.report", { window: "30d" }, [], {
      context: { scope: "workspace", workspaceId: "workspace-1" },
      signal: abort.signal
    });
    const request = await host.nextRequest("workspace.usage.report");
    abort.abort();

    await expect(pending).rejects.toMatchObject({ code: "CONNECTION_CLOSED" });
    await vi.waitFor(() => expect(host.cancellations).toContainEqual(expect.objectContaining({
      requestId: request.requestId,
      hostEpoch: 3
    })));
    expect(controller.hasOpenPort).toBe(true);
    expect(controller.identity?.hostEpoch).toBe(3);
  });

  it("records bounded acknowledgement latency without command payloads", async () => {
    let now = 100;
    const target = new FakeHandoffTarget();
    const controller = createController(target, {
      now: () => now,
      slowAcknowledgementThresholdMs: 2_000
    });
    const host = createHost(3);
    host.handoff(target);
    await controller.waitForConnection();

    const pending = controller.request("runtime.getStatus", {});
    const request = await host.nextRequest("runtime.getStatus");
    expect(controller.diagnostics()).toMatchObject({ activeRequestCount: 1, sampleCount: 0 });
    now = 2_250;
    host.send(responseEnvelope(request.requestId, 3, request.context, {
      ok: true,
      type: "runtime.getStatus",
      result: { initialized: true, loaded: true }
    }));

    await expect(pending).resolves.toEqual({ initialized: true, loaded: true });
    expect(controller.diagnostics()).toEqual({
      activeRequestCount: 0,
      sampleCount: 1,
      slowAcknowledgementCount: 1,
      slowThresholdMs: 2_000,
      lastAcknowledgementLatencyMs: 2_150,
      maxAcknowledgementLatencyMs: 2_150
    });
    expect(JSON.stringify(controller.diagnostics())).not.toContain("runtime.getStatus");
  });

  it("tears down once when the Port emits messageerror", async () => {
    const target = new FakeHandoffTarget();
    const controller = createController(target);
    const host = createHost(4);
    const onTeardown = vi.fn();
    controller.subscribe({ onTeardown });
    host.handoff(target);
    await controller.waitForConnection();

    host.controllerPort.dispatchEvent(new Event("messageerror"));

    await vi.waitFor(() => expect(onTeardown).toHaveBeenCalledOnce());
    expect(controller.hasOpenPort).toBe(false);
  });

  it("replaces Host generations without allowing old pending work to survive", async () => {
    const target = new FakeHandoffTarget();
    const controller = createController(target);
    const connectedEpochs: number[] = [];
    controller.subscribe({ onConnected: (identity) => connectedEpochs.push(identity.hostEpoch) });
    const oldHost = createHost(5);
    oldHost.handoff(target);
    await controller.waitForConnection();

    const staleRequest = controller.request("runtime.getStatus", {});
    const rejection = expect(staleRequest).rejects.toMatchObject({ code: "CONNECTION_CLOSED" });
    await oldHost.nextRequest("runtime.getStatus");
    const newHost = createHost(6);
    newHost.handoff(target);

    await rejection;
    await expect(controller.waitForConnection()).resolves.toMatchObject({ hostEpoch: 6, hostInstanceId: "host-6" });
    expect(controller.identity?.hostEpoch).toBe(6);
    expect(connectedEpochs).toEqual([5, 6]);
  });

  it("forwards one sequence gap and resumes events only after projection resync", async () => {
    const target = new FakeHandoffTarget();
    const controller = createController(target);
    const host = createHost(7, 5);
    const onEvent = vi.fn();
    const onSequenceGap = vi.fn();
    controller.subscribe({ onEvent, onSequenceGap });
    host.handoff(target);
    await controller.waitForConnection();

    host.send(eventEnvelope("runtime.statusChanged", readyStatus("gap"), taskEventFixture({ hostEpoch: 7, sequence: 7 })));
    host.send(eventEnvelope("runtime.statusChanged", readyStatus("still blocked"), taskEventFixture({ hostEpoch: 7, sequence: 8 })));
    await vi.waitFor(() => expect(onSequenceGap).toHaveBeenCalledOnce());
    expect(onSequenceGap).toHaveBeenCalledWith({ expected: 6, received: 7, hostEpoch: 7 });
    expect(onEvent).not.toHaveBeenCalled();

    const install = vi.fn(() => true);
    const resync = controller.resyncProjection(install);
    const request = await host.nextRequest("projection.resync");
    host.send(responseEnvelope(request.requestId, 7, request.context, {
      ok: true,
      type: "projection.resync",
      result: projectionResyncResult(7, 8)
    }));
    await expect(resync).resolves.toBe(true);
    expect(install).toHaveBeenCalledWith(expect.objectContaining({ hostEpoch: 7, eventSequence: 8 }));

    host.send(eventEnvelope("runtime.statusChanged", readyStatus("resynced"), taskEventFixture({ hostEpoch: 7, sequence: 9 })));
    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledOnce());
    expect(onEvent.mock.calls[0]?.[0]).toEqual({
      type: "runtime.statusChanged",
      payload: readyStatus("resynced")
    });
  });

  it("waits for a future handoff and times out with a structured transport error", async () => {
    vi.useFakeTimers();
    const target = new FakeHandoffTarget();
    const controller = createController(target);
    const waiting = controller.waitForConnection(100);
    let failure: unknown;
    void waiting.catch((error: unknown) => { failure = error; });

    await vi.advanceTimersByTimeAsync(99);
    expect(failure).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(failure).toMatchObject({ code: "CONNECTION_CLOSED" });
  });

  it("disposes its listener, rejects waiters, and ignores later handoffs", async () => {
    const target = new FakeHandoffTarget();
    const controller = createController(target);
    const onTeardown = vi.fn();
    controller.subscribe({ onTeardown });
    const waiting = controller.waitForConnection();

    controller.dispose();

    await expect(waiting).rejects.toMatchObject({ code: "CONNECTION_CLOSED" });
    expect(onTeardown).toHaveBeenCalledOnce();
    expect(target.listenerCount).toBe(0);
    await expect(controller.waitForConnection()).rejects.toMatchObject({ code: "CONNECTION_CLOSED" });
    await expect(controller.request("runtime.getStatus", {})).rejects.toMatchObject({ code: "CONNECTION_CLOSED" });

    const lateHost = createHost(8);
    lateHost.handoff(target);
    await flushMessagePorts();
    expect(lateHost.hello).toBeUndefined();
  });

  it("replays a control mutation once on the same Host epoch with one idempotency key", async () => {
    const target = new FakeHandoffTarget();
    const controller = createController(target);
    const firstHost = createHost(9);
    firstHost.handoff(target);
    await controller.waitForConnection();

    const pending = controller.request("session.create", { creationId: "session-creation-controller" });
    const firstRequest = await firstHost.nextRequest("session.create");
    firstHost.closeControllerPort();
    const replacement = createHost(9, 0, "host-9-restarted");
    replacement.handoff(target);
    const secondRequest = await replacement.nextRequest("session.create");
    expect(secondRequest.idempotencyKey).toBe(firstRequest.idempotencyKey);
    const acknowledgement = {
      accepted: true as const,
      hostEpoch: 9,
      sessionId: "session-1",
      sessionFileIdentity: "session-file-session-1",
      sessionGeneration: 1,
      eventSequence: 1
    };
    replacement.send(responseEnvelope(secondRequest.requestId, 9, secondRequest.context, {
      ok: true,
      type: "session.create",
      result: acknowledgement
    }));

    await expect(pending).resolves.toEqual(acknowledgement);
  });

  it("does not replay an operation acknowledgement after Host authority changes", async () => {
    const target = new FakeHandoffTarget();
    const controller = createController(target);
    const firstHost = createHost(10);
    firstHost.handoff(target);
    await controller.waitForConnection();

    const pending = controller.request("prompt.submit", {
      submissionId: "submission-1",
      text: "test",
      delivery: "new-turn"
    });
    const rejection = expect(pending).rejects.toMatchObject({ code: "CONNECTION_CLOSED" });
    await firstHost.nextRequest("prompt.submit");
    firstHost.closeControllerPort();
    const replacement = createHost(11);
    replacement.handoff(target);
    await controller.waitForConnection();

    await rejection;
    await flushMessagePorts();
    expect(replacement.requests).toHaveLength(0);
  });
});
