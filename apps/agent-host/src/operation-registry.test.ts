import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "@pi67/protocol";
import { OperationRegistry } from "./operation-registry.js";
import type { OperationExecutionContext } from "./operation-execution-runner.js";

describe("OperationRegistry", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("accepts immediately, deduplicates submission IDs and completes asynchronously", async () => {
    const events: AgentEvent[] = [];
    let complete!: () => void;
    let executionContext: OperationExecutionContext | undefined;
    const registry = createRegistry(events);
    const accepted = await registry.accept({
      submissionId: "submission-1",
      fingerprint: "same",
      kind: "prompt",
      abort: async () => undefined,
      execute: (context) => {
        executionContext = context;
        return new Promise<void>((resolve) => { complete = resolve; });
      }
    });
    expect(accepted).toMatchObject({ kind: "accepted", cancellable: true });
    await expect(registry.accept({
      submissionId: "submission-1",
      fingerprint: "same",
      kind: "prompt",
      abort: async () => undefined,
      execute: vi.fn(async () => undefined)
    })).resolves.toEqual(accepted);
    await expect(registry.accept({
      submissionId: "submission-1",
      fingerprint: "different",
      kind: "prompt",
      abort: async () => undefined,
      execute: vi.fn(async () => undefined)
    })).rejects.toThrow("cannot be reused");
    await vi.waitFor(() => expect(events[0]?.type).toBe("operation.started"));
    expect(executionContext).toMatchObject({
      hostEpoch: 3,
      operation: {
        operationId: accepted.operationId,
        sessionId: "session-1",
        sessionFileIdentity: "session-file-session-1",
        sessionGeneration: 2
      }
    });
    complete();
    await vi.waitFor(() => expect(events.some((event) => event.type === "operation.completed")).toBe(true));
    expect(events.map((event) => event.type)).toEqual(["operation.started", "operation.completed"]);
    expect(registry.submissionFor("submission-1", "same")).toMatchObject({
      kind: "settled",
      operationId: accepted.operationId,
      operationKind: "prompt",
      lifecycle: "completed",
      cancellable: false,
      sessionId: "session-1",
      sessionFileIdentity: "session-file-session-1",
      sessionGeneration: 2
    });
    expect(registry.latestTerminal()).toEqual(registry.submissionFor("submission-1", "same"));
  });

  it("settles unfinished Tool executions before the Operation terminal event", async () => {
    const events: AgentEvent[] = [];
    let complete!: () => void;
    const registry = createRegistry(events);
    await registry.accept({
      submissionId: "tool-lifecycle",
      fingerprint: "tool-lifecycle",
      kind: "prompt",
      execute: () => new Promise<void>((resolve) => { complete = resolve; })
    });
    await vi.waitFor(() => expect(events[0]?.type).toBe("operation.started"));
    registry.updateToolExecution({
      toolCallId: "tool-1",
      toolName: "bash",
      toolKind: "shell",
      status: "running",
      projectionSource: "live",
      resultState: "pending",
      startedAt: 10
    });

    complete();
    await vi.waitFor(() => expect(events.some((event) => event.type === "operation.completed")).toBe(true));

    expect(events.map((event) => event.type)).toEqual([
      "operation.started",
      "operation.toolExecutionChanged",
      "operation.toolExecutionChanged",
      "operation.completed"
    ]);
    expect(events[2]).toMatchObject({
      payload: { execution: { toolCallId: "tool-1", status: "interrupted", resultState: "unreconciled" } }
    });
  });

  it("rejects a pending queued submission when its Session generation changes", async () => {
    let identity = runtimeIdentity("session-1", 2);
    let finishQueue!: () => void;
    const registry = new OperationRegistry(
      3,
      () => identity,
      () => undefined
    );
    await registry.accept({
      submissionId: "active-turn",
      fingerprint: "active-turn",
      kind: "prompt",
      execute: () => new Promise<void>(() => undefined)
    });
    const queued = registry.queueForActive(
      "queued-submission",
      "queued",
      () => new Promise<void>((resolve) => { finishQueue = resolve; })
    );
    await vi.waitFor(() => expect(finishQueue).toBeTypeOf("function"));

    identity = runtimeIdentity("session-1", 3);
    expect(() => registry.submissionFor("queued-submission", "queued"))
      .toThrowError(expect.objectContaining({ code: "STALE_SESSION_GENERATION" }));

    finishQueue();
    await expect(queued).rejects.toMatchObject({ code: "STALE_SESSION_GENERATION" });
  });

  it("claims cancellation before awaiting Pi abort", async () => {
    const events: AgentEvent[] = [];
    let complete!: () => void;
    let finishAbort!: () => void;
    const registry = createRegistry(events);
    const accepted = await registry.accept({
      submissionId: "submission-1",
      fingerprint: "same",
      kind: "prompt",
      abort: () => new Promise<void>((resolve) => { finishAbort = resolve; }),
      execute: () => new Promise<void>((resolve) => { complete = resolve; })
    });
    await vi.waitFor(() => expect(events[0]?.type).toBe("operation.started"));
    const aborting = registry.abort(accepted.operationId);
    expect(registry.canAcceptQueue()).toBe(false);
    complete();
    await Promise.resolve();
    expect(events.some((event) => event.type === "operation.completed")).toBe(false);
    expect(registry.hasActive()).toBe(true);
    finishAbort();
    await expect(aborting).resolves.toEqual({ aborted: true, operationId: accepted.operationId });
    expect(events.map((event) => event.type)).toEqual(["operation.started", "operation.cancelled"]);
    expect(registry.hasActive()).toBe(false);
  });

  it("emits one structured failure after acceptance", async () => {
    const events: AgentEvent[] = [];
    const registry = createRegistry(events);
    const accepted = await registry.accept({
      submissionId: "submission-1",
      fingerprint: "same",
      kind: "command",
      execute: async () => { throw new Error("failed"); }
    });
    await vi.waitFor(() => expect(events.some((event) => event.type === "operation.failed")).toBe(true));
    const failure = events.find((event) => event.type === "operation.failed");
    expect(failure?.type).toBe("operation.failed");
    if (failure?.type === "operation.failed") expect(failure.payload.error.code).toBe("INTERNAL");
    expect(registry.submissionFor("submission-1", "same")).toMatchObject({
      kind: "settled",
      operationId: accepted.operationId,
      lifecycle: "failed",
      error: { code: "INTERNAL", message: "failed" }
    });
  });

  it("only accepts queued prompts for prompt and command operations", async () => {
    for (const kind of ["compaction", "session-import"] as const) {
      const events: AgentEvent[] = [];
      const registry = createRegistry(events);
      await registry.accept({
        submissionId: `submission-${kind}`,
        fingerprint: kind,
        kind,
        execute: () => new Promise<void>(() => undefined)
      });
      expect(registry.canAcceptQueue()).toBe(false);
      await expect(registry.queueForActive("queued", "queued", async () => undefined))
        .rejects.toThrow("no active turn operation");
      await registry.loseActive("test cleanup");
    }

    for (const kind of ["prompt", "command"] as const) {
      const registry = createRegistry([]);
      await registry.accept({
        submissionId: `submission-${kind}`,
        fingerprint: kind,
        kind,
        execute: () => new Promise<void>(() => undefined)
      });
      expect(registry.canAcceptQueue()).toBe(true);
      await registry.loseActive("test cleanup");
    }
  });

  it("keeps the operation active when Pi rejects an abort request", async () => {
    const events: AgentEvent[] = [];
    let complete!: () => void;
    const registry = createRegistry(events);
    const accepted = await registry.accept({
      submissionId: "submission-1",
      fingerprint: "same",
      kind: "prompt",
      abort: async () => {
        throw new Error("abort unavailable");
      },
      execute: () => new Promise<void>((resolve) => { complete = resolve; })
    });
    await vi.waitFor(() => expect(events[0]?.type).toBe("operation.started"));
    await expect(registry.abort(accepted.operationId)).rejects.toThrow("abort unavailable");
    expect(registry.hasActive()).toBe(true);
    expect(events.map((event) => event.type)).toEqual(["operation.started"]);
    complete();
    await vi.waitFor(() => expect(events.some((event) => event.type === "operation.completed")).toBe(true));
    expect(events.map((event) => event.type)).toEqual(["operation.started", "operation.completed"]);
  });

  it("marks the runtime poisoned when Pi abort never settles", async () => {
    vi.useFakeTimers();
    const events: AgentEvent[] = [];
    const onRuntimePoisoned = vi.fn();
    let finishAbort!: () => void;
    const registry = new OperationRegistry(
      3,
      () => runtimeIdentity("session-1", 2),
      (event) => events.push(event),
      { abortWatchdogMs: 25, onRuntimePoisoned }
    );
    const accepted = await registry.accept({
      submissionId: "submission-hung-abort",
      fingerprint: "same",
      kind: "prompt",
      abort: () => new Promise<void>((resolve) => { finishAbort = resolve; }),
      execute: () => new Promise<void>(() => undefined)
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(events.map((event) => event.type)).toEqual(["operation.started"]);

    const aborting = registry.abort(accepted.operationId);
    const rejected = expect(aborting).rejects.toMatchObject({ code: "RUNTIME_POISONED" });
    await vi.advanceTimersByTimeAsync(24);
    expect(registry.isPoisoned()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await rejected;

    expect(registry.isPoisoned()).toBe(true);
    expect(registry.hasActive()).toBe(true);
    expect(registry.activeView()).toBeUndefined();
    expect(events.map((event) => event.type)).toEqual(["operation.started", "operation.lost"]);
    expect(onRuntimePoisoned).toHaveBeenCalledWith({
      type: "agent-host-runtime-poisoned",
      code: "ABORT_WATCHDOG_EXPIRED",
      operationId: accepted.operationId,
      abortTimeoutMs: 25
    });
    expect(() => registry.submissionFor("submission-hung-abort", "same"))
      .toThrowError(expect.objectContaining({ code: "RUNTIME_POISONED" }));

    finishAbort();
    await Promise.resolve();
    expect(events.map((event) => event.type)).toEqual(["operation.started", "operation.lost"]);
  });

  it("poisons an import whose authoritative Session projection cannot be captured", async () => {
    const events: AgentEvent[] = [];
    const onRuntimePoisoned = vi.fn();
    const registry = new OperationRegistry(
      3,
      () => runtimeIdentity("session-imported", 7),
      (event) => events.push(event),
      { onRuntimePoisoned }
    );
    const accepted = await registry.accept({
      submissionId: "submission-import",
      fingerprint: "same",
      kind: "session-import",
      execute: () => new Promise<void>(() => undefined)
    });
    await vi.waitFor(() => expect(events[0]?.type).toBe("operation.started"));

    expect(await registry.poisonSessionImportProjection()).toBe(true);
    expect(await registry.poisonSessionImportProjection()).toBe(false);

    expect(registry.isPoisoned()).toBe(true);
    expect(registry.hasActive()).toBe(true);
    expect(registry.activeView()).toBeUndefined();
    expect(events.map((event) => event.type)).toEqual(["operation.started", "operation.lost"]);
    expect(onRuntimePoisoned).toHaveBeenCalledWith({
      type: "agent-host-runtime-poisoned",
      code: "SESSION_IMPORT_PROJECTION_FAILED",
      operationId: accepted.operationId
    });
    expect(() => registry.submissionFor("submission-import", "same"))
      .toThrowError(expect.objectContaining({ code: "RUNTIME_POISONED" }));
  });

  it("does not claim cancellation for an operation without an abort contract", async () => {
    const events: AgentEvent[] = [];
    let complete!: () => void;
    const registry = createRegistry(events);
    const accepted = await registry.accept({
      submissionId: "session-import:1",
      fingerprint: "session-import:1",
      kind: "session-import",
      execute: () => new Promise<void>((resolve) => { complete = resolve; })
    });

    expect(accepted.cancellable).toBe(false);
    await vi.waitFor(() => expect(events[0]?.type).toBe("operation.started"));
    await expect(registry.abort(accepted.operationId)).resolves.toEqual({
      aborted: false,
      operationId: accepted.operationId
    });
    expect(registry.hasActive()).toBe(true);

    complete();
    await vi.waitFor(() => expect(events.some((event) => event.type === "operation.completed")).toBe(true));
  });

  it("flushes buffered stream data before a lost terminal event", async () => {
    const order: string[] = [];
    const registry = new OperationRegistry(
      3,
      () => runtimeIdentity("session-1", 2),
      (event) => order.push(event.type)
    );
    await registry.accept({
      submissionId: "submission-1",
      fingerprint: "same",
      kind: "prompt",
      execute: () => new Promise<void>(() => undefined),
      beforeTerminal: () => order.push("stream.flush")
    });
    await vi.waitFor(() => expect(order).toContain("operation.started"));
    await registry.loseActive("connection lost");
    expect(order).toEqual(["operation.started", "stream.flush", "operation.lost"]);
  });

  it("cancels an active operation with shutdown-specific semantics", async () => {
    const events: AgentEvent[] = [];
    const abort = vi.fn(async () => undefined);
    const registry = createRegistry(events);
    await registry.accept({
      submissionId: "shutdown-cancel",
      fingerprint: "same",
      kind: "prompt",
      abort,
      execute: () => new Promise<void>(() => undefined)
    });
    await vi.waitFor(() => expect(events[0]?.type).toBe("operation.started"));

    await expect(registry.shutdown()).resolves.toBe("cancelled");
    expect(abort).toHaveBeenCalledOnce();
    expect(events.map((event) => event.type)).toEqual(["operation.started", "operation.cancelled"]);
    expect(events[1]).toMatchObject({
      payload: { reason: "Cancelled because the application is shutting down." }
    });
    expect(registry.hasActive()).toBe(false);
  });

  it("marks non-cancellable or failed shutdown aborts as lost without poisoning the Host", async () => {
    const events: AgentEvent[] = [];
    const onRuntimePoisoned = vi.fn();
    const registry = new OperationRegistry(
      3,
      () => runtimeIdentity("session-1", 2),
      (event) => events.push(event),
      { onRuntimePoisoned }
    );
    await registry.accept({
      submissionId: "shutdown-lost",
      fingerprint: "same",
      kind: "prompt",
      abort: async () => { throw new Error("abort failed"); },
      execute: () => new Promise<void>(() => undefined)
    });
    await vi.waitFor(() => expect(events[0]?.type).toBe("operation.started"));

    await expect(registry.shutdown()).resolves.toBe("lost");
    expect(events.map((event) => event.type)).toEqual(["operation.started", "operation.lost"]);
    expect(registry.isPoisoned()).toBe(false);
    expect(onRuntimePoisoned).not.toHaveBeenCalled();
  });

  it("bounds a shutdown abort timeout without requesting Host replacement", async () => {
    vi.useFakeTimers();
    const events: AgentEvent[] = [];
    const onRuntimePoisoned = vi.fn();
    const registry = new OperationRegistry(
      3,
      () => runtimeIdentity("session-1", 2),
      (event) => events.push(event),
      { abortWatchdogMs: 10_000, onRuntimePoisoned }
    );
    await registry.accept({
      submissionId: "shutdown-timeout",
      fingerprint: "same",
      kind: "prompt",
      abort: () => new Promise<void>(() => undefined),
      execute: () => new Promise<void>(() => undefined)
    });
    await vi.advanceTimersByTimeAsync(0);

    const shutdown = registry.shutdown(undefined, 25);
    await vi.advanceTimersByTimeAsync(25);
    await expect(shutdown).resolves.toBe("lost");
    expect(events.map((event) => event.type)).toEqual(["operation.started", "operation.lost"]);
    expect(registry.isPoisoned()).toBe(false);
    expect(onRuntimePoisoned).not.toHaveBeenCalled();
  });

  it("does not emit a second terminal event when shutdown wins a pending user abort", async () => {
    const events: AgentEvent[] = [];
    let finishAbort!: () => void;
    const registry = createRegistry(events);
    const accepted = await registry.accept({
      submissionId: "shutdown-abort-race",
      fingerprint: "same",
      kind: "prompt",
      abort: () => new Promise<void>((resolve) => { finishAbort = resolve; }),
      execute: () => new Promise<void>(() => undefined)
    });
    await vi.waitFor(() => expect(events[0]?.type).toBe("operation.started"));
    const aborting = registry.abort(accepted.operationId);

    await expect(registry.shutdown()).resolves.toBe("lost");
    finishAbort();
    await expect(aborting).resolves.toEqual({ aborted: true, operationId: accepted.operationId });
    expect(events.map((event) => event.type)).toEqual(["operation.started", "operation.lost"]);
  });
});

function createRegistry(events: AgentEvent[]): OperationRegistry {
  return new OperationRegistry(
    3,
    () => runtimeIdentity("session-1", 2),
    (event) => events.push(event)
  );
}

function runtimeIdentity(sessionId: string, sessionGeneration: number) {
  return {
    sessionId,
    sessionFileIdentity: `session-file-${sessionId}`,
    sessionGeneration
  };
}
