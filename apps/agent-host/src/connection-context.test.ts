import { describe, expect, it, vi } from "vitest";
import {
  PROTOCOL_REVISION,
  isResponseEnvelope,
  type ProtocolError,
  type ProtocolPort,
  type RendererHello
} from "@pi67/protocol";
import { HostConnectionContext } from "./connection-context.js";
import {
  commandEnvelope,
  commandEnvelopeForContext,
  TEST_APP_CONTEXT,
  TEST_TASK_CONTEXT,
  TEST_WORKSPACE_CONTEXT
} from "./protocol-test-fixtures.js";

class FakePort implements ProtocolPort {
  readonly sent: unknown[] = [];
  readonly transfers: Array<Transferable[] | undefined> = [];
  readonly argumentCounts: number[] = [];
  readonly listeners = new Map<string, Set<(event: unknown) => void>>();
  closed = false;

  postMessage(message: unknown, transfer?: Transferable[]): void {
    this.sent.push(message);
    this.transfers.push(transfer);
    this.argumentCounts.push(arguments.length);
  }
  close(): void { this.closed = true; }
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
  emitPortEvent(type: "messageerror" | "close"): void {
    for (const listener of this.listeners.get(type) ?? []) listener({});
  }
}

describe("HostConnectionContext", () => {
  it("transfers asset chunks without copying the response through structured clone", () => {
    const port = new FakePort();
    const connection = new HostConnectionContext(
      port,
      { appInstanceId: "app-assets", hostInstanceId: "host-assets", hostEpoch: 6 },
      async () => ({ sdkVersion: "0.81.1", eventSequence: 0 }),
      () => undefined
    );
    const data = Uint8Array.from([1, 2, 3]).buffer;
    connection.beginResponse({
      requestId: "asset-request",
      type: "asset.read",
      context: TEST_APP_CONTEXT
    });
    connection.sendSuccess("asset-request", "asset.read", {
      assetId: "asset-1",
      mimeType: "image/png",
      byteLength: 3,
      offset: 0,
      data,
      done: true
    });

    expect(port.sent.at(-1)).toMatchObject({
      kind: "response",
      context: TEST_APP_CONTEXT,
      ok: true,
      type: "asset.read",
      result: { assetId: "asset-1", data }
    });
    expect(port.transfers.at(-1)).toEqual([data]);
    expect(port.argumentCounts.at(-1)).toBe(2);
  });

  it("replaces a malformed success result with a valid correlated INTERNAL error", () => {
    const port = new FakePort();
    const connection = new HostConnectionContext(
      port,
      { appInstanceId: "app-invalid-result", hostInstanceId: "host-invalid-result", hostEpoch: 6 },
      async () => ({ sdkVersion: "0.81.1", eventSequence: 0 }),
      () => undefined
    );
    connection.beginResponse({
      requestId: "invalid-result",
      type: "runtime.getStatus",
      context: TEST_APP_CONTEXT
    });
    connection.sendSuccess("invalid-result", "runtime.getStatus", {
      initialized: "secret-result-must-not-leak",
      loaded: true
    } as never);

    expect(port.sent).toHaveLength(1);
    expect(isResponseEnvelope(port.sent[0])).toBe(true);
    expect(port.sent[0]).toMatchObject({
      kind: "response",
      requestId: "invalid-result",
      hostEpoch: 6,
      context: TEST_APP_CONTEXT,
      type: "runtime.getStatus",
      ok: false,
      error: {
        code: "INTERNAL",
        message: "The Pi runtime service produced an invalid response.",
        recoverable: true
      }
    });
    expect(JSON.stringify(port.sent[0])).not.toContain("secret-result-must-not-leak");
    expect(connection.isCurrentCandidate).toBe(true);
    expect(port.closed).toBe(false);
  });

  it("replaces a mismatched response type with an error under the request authority", () => {
    const port = new FakePort();
    const connection = new HostConnectionContext(
      port,
      { appInstanceId: "app-wrong-type", hostInstanceId: "host-wrong-type", hostEpoch: 6 },
      async () => ({ sdkVersion: "0.81.1", eventSequence: 0 }),
      () => undefined
    );
    connection.beginResponse({
      requestId: "wrong-type",
      type: "runtime.getStatus",
      context: TEST_TASK_CONTEXT
    });

    connection.sendSuccess("wrong-type", "doctor.run", {} as never);

    expect(port.sent).toHaveLength(1);
    expect(port.sent[0]).toMatchObject({
      kind: "response",
      requestId: "wrong-type",
      context: TEST_TASK_CONTEXT,
      type: "runtime.getStatus",
      ok: false,
      error: { code: "INTERNAL" }
    });
  });

  it("validates error responses and replaces malformed details with a fixed safe error", () => {
    const port = new FakePort();
    const connection = new HostConnectionContext(
      port,
      { appInstanceId: "app-invalid-error", hostInstanceId: "host-invalid-error", hostEpoch: 7 },
      async () => ({ sdkVersion: "0.81.1", eventSequence: 0 }),
      () => undefined
    );
    connection.beginResponse({
      requestId: "invalid-error",
      type: "runtime.getStatus",
      context: TEST_APP_CONTEXT
    });
    connection.sendError("invalid-error", "runtime.getStatus", {
      code: "INTERNAL",
      message: "secret-error-must-not-leak",
      recoverable: true,
      credential: "sk-secret-error-must-not-leak"
    } as ProtocolError);

    expect(port.sent).toHaveLength(1);
    expect(isResponseEnvelope(port.sent[0])).toBe(true);
    expect(port.sent[0]).toMatchObject({
      requestId: "invalid-error",
      context: TEST_APP_CONTEXT,
      type: "runtime.getStatus",
      ok: false,
      error: { code: "INTERNAL", recoverable: true }
    });
    expect(JSON.stringify(port.sent[0])).not.toContain("secret-error-must-not-leak");
    expect(connection.isCurrentCandidate).toBe(true);
  });

  it("uses a bounded resource-limit error when a valid error exceeds the negotiated limit", async () => {
    const port = new FakePort();
    const connection = new HostConnectionContext(
      port,
      { appInstanceId: "app-large-error", hostInstanceId: "host-large-error", hostEpoch: 8 },
      async () => ({ sdkVersion: "0.81.1", eventSequence: 0 }),
      () => undefined
    );
    port.emit({
      protocolVersion: 3,
      protocolRevision: PROTOCOL_REVISION,
      kind: "hello",
      rendererInstanceId: "renderer-large-error",
      appInstanceId: "app-large-error",
      maxEnvelopeBytes: 65_536
    } satisfies RendererHello);
    await vi.waitFor(() => expect(port.sent).toHaveLength(1));

    connection.beginResponse({
      requestId: "large-error",
      type: "runtime.getStatus",
      context: TEST_APP_CONTEXT
    });
    connection.sendError("large-error", "runtime.getStatus", {
      code: "INTERNAL",
      message: "A bounded message",
      recoverable: true,
      details: Object.fromEntries(Array.from(
        { length: 700 },
        (_, index) => [`detail-${index}`, "x".repeat(128)]
      ))
    });

    expect(port.sent).toHaveLength(2);
    expect(isResponseEnvelope(port.sent[1])).toBe(true);
    expect(port.sent[1]).toMatchObject({
      requestId: "large-error",
      context: TEST_APP_CONTEXT,
      ok: false,
      error: {
        code: "RESOURCE_LIMIT_EXCEEDED",
        message: "The Pi runtime service response exceeds the negotiated envelope limit."
      }
    });
    expect(connection.isCurrentCandidate).toBe(true);
  });

  it("does not let stale or duplicate errors consume an accepted response authority", async () => {
    const port = new FakePort();
    let captured: HostConnectionContext | undefined;
    new HostConnectionContext(
      port,
      { appInstanceId: "app-correlation", hostInstanceId: "host-correlation", hostEpoch: 9 },
      async () => ({ sdkVersion: "0.81.1", eventSequence: 0 }),
      (origin) => { captured = origin; }
    );
    port.emit({
      protocolVersion: 3,
      protocolRevision: PROTOCOL_REVISION,
      kind: "hello",
      rendererInstanceId: "renderer-correlation",
      appInstanceId: "app-correlation",
      maxEnvelopeBytes: 2 * 1024 * 1024
    } satisfies RendererHello);
    await vi.waitFor(() => expect(port.sent).toHaveLength(1));

    const request = commandEnvelopeForContext(
      "runtime.getStatus",
      {},
      TEST_TASK_CONTEXT,
      9
    );
    port.emit(request);
    expect(captured).toBeDefined();

    port.emit({ ...request, hostEpoch: 8, context: TEST_WORKSPACE_CONTEXT });
    port.emit(request);
    captured!.sendSuccess(request.requestId, request.type, { initialized: false, loaded: true });

    const responses = port.sent.filter((value) => (
      isResponseEnvelope(value) && value.requestId === request.requestId
    ));
    expect(responses).toHaveLength(3);
    expect(responses[0]).toMatchObject({
      ok: false,
      context: TEST_WORKSPACE_CONTEXT,
      error: { code: "STALE_HOST_EPOCH" }
    });
    expect(responses[1]).toMatchObject({
      ok: false,
      context: TEST_TASK_CONTEXT,
      error: { code: "DUPLICATE_REQUEST" }
    });
    expect(responses[2]).toMatchObject({
      ok: true,
      context: TEST_TASK_CONTEXT,
      result: { initialized: false, loaded: true }
    });
  });

  it("drops a request with malformed Task authority before dispatch", async () => {
    const port = new FakePort();
    const onRequest = vi.fn();
    new HostConnectionContext(
      port,
      { appInstanceId: "app-malformed-context", hostInstanceId: "host-malformed-context", hostEpoch: 3 },
      async () => ({ sdkVersion: "0.81.1", eventSequence: 0 }),
      onRequest
    );
    port.emit({
      protocolVersion: 3,
      protocolRevision: PROTOCOL_REVISION,
      kind: "hello",
      rendererInstanceId: "renderer-malformed-context",
      appInstanceId: "app-malformed-context",
      maxEnvelopeBytes: 65_536
    } satisfies RendererHello);
    await vi.waitFor(() => expect(port.sent).toHaveLength(1));

    const request = commandEnvelope("runtime.getStatus", {}, 3);
    port.emit({
      ...request,
      context: {
        scope: "task",
        workspaceId: "workspace-test",
        taskGeneration: 1
      }
    });

    expect(onRequest).not.toHaveBeenCalled();
    expect(port.sent).toHaveLength(1);
    expect(port.closed).toBe(false);
  });

  it("returns a correlated resource error for an oversized request", async () => {
    const port = new FakePort();
    let requests = 0;
    new HostConnectionContext(
      port,
      { appInstanceId: "app-1", hostInstanceId: "host-1", hostEpoch: 3 },
      async () => ({ sdkVersion: "0.81.1", eventSequence: 0 }),
      () => { requests += 1; }
    );
    port.emit({
      protocolVersion: 3,
      protocolRevision: PROTOCOL_REVISION,
      kind: "hello",
      rendererInstanceId: "renderer-1",
      appInstanceId: "app-1",
      maxEnvelopeBytes: 65_536
    } satisfies RendererHello);
    await Promise.resolve();

    port.emit(commandEnvelope("prompt.submit", {
      submissionId: "submission-large",
      text: "中".repeat(30_000),
      delivery: "new-turn"
    }, 3));
    expect(requests).toBe(0);
    expect(port.sent.at(-1)).toMatchObject({
      kind: "response",
      ok: false,
      error: { code: "RESOURCE_LIMIT_EXCEEDED" }
    });
  });

  it("bounds pending requests before dispatching more Host work", async () => {
    const port = new FakePort();
    const onRequest = vi.fn();
    new HostConnectionContext(
      port,
      { appInstanceId: "app-pending-limit", hostInstanceId: "host-pending-limit", hostEpoch: 3 },
      async () => ({ sdkVersion: "0.81.1", eventSequence: 0 }),
      onRequest,
      () => undefined,
      2_048,
      2
    );
    port.emit({
      protocolVersion: 3,
      protocolRevision: PROTOCOL_REVISION,
      kind: "hello",
      rendererInstanceId: "renderer-pending-limit",
      appInstanceId: "app-pending-limit",
      maxEnvelopeBytes: 65_536
    } satisfies RendererHello);
    await vi.waitFor(() => expect(port.sent).toHaveLength(1));

    const requests = Array.from({ length: 3 }, () => (
      commandEnvelope("runtime.getStatus", {}, 3)
    ));
    requests.forEach((request) => port.emit(request));

    expect(onRequest).toHaveBeenCalledTimes(2);
    expect(port.sent.at(-1)).toMatchObject({
      kind: "response",
      requestId: requests[2]?.requestId,
      ok: false,
      error: { code: "RESOURCE_LIMIT_EXCEEDED" }
    });
  });

  it("rejects a control mutation that omits its idempotency key", async () => {
    const port = new FakePort();
    const onRequest = vi.fn();
    new HostConnectionContext(
      port,
      { appInstanceId: "app-control", hostInstanceId: "host-control", hostEpoch: 3 },
      async () => ({ sdkVersion: "0.81.1", eventSequence: 0 }),
      onRequest
    );
    port.emit({
      protocolVersion: 3,
      protocolRevision: PROTOCOL_REVISION,
      kind: "hello",
      rendererInstanceId: "renderer-control",
      appInstanceId: "app-control",
      maxEnvelopeBytes: 65_536
    } satisfies RendererHello);
    await Promise.resolve();

    const request = commandEnvelope("session.create", { creationId: "session-creation-context" }, 3);
    const { idempotencyKey: _idempotencyKey, ...missingKey } = request;
    port.emit(missingKey);
    expect(onRequest).not.toHaveBeenCalled();
    expect(port.sent.at(-1)).toMatchObject({
      kind: "response",
      requestId: request.requestId,
      ok: false,
      error: { code: "INVALID_PAYLOAD" }
    });
  });

});
