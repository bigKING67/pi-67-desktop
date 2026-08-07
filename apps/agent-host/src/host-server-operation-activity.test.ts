import type {
  ApprovalResponseDecision,
  ExtensionUiCancellationReason,
  RuntimeOperationActivity,
  TaskToolMode
} from "@pi67/domain";
import type { AgentRuntime } from "@pi67/pi-runtime";
import {
  PROTOCOL_REVISION,
  PROTOCOL_VERSION,
  isEventEnvelope,
  isHostWelcome,
  isResponseEnvelope,
  type AgentEvent,
  type AgentCommandType,
  type CommandResults,
  type EventEnvelope,
  type ProtocolPort,
  type RendererHello,
  type ResponseEnvelope
} from "@pi67/protocol";
import { describe, expect, it, vi } from "vitest";
import { AgentHostServer } from "./host-server.js";
import { commandEnvelope } from "./protocol-test-fixtures.js";

describe("AgentHostServer operation activity", () => {
  it("projects Pi activity through Host authority and restores it after interactive waits", async () => {
    const runtime = new ActivityRuntime();
    const server = new AgentHostServer(async () => runtime.asRuntime());
    const port = connect(server, 12);
    const operationId = await submitPrompt(port, 12);

    runtime.activity({ kind: "thinking" });
    runtime.activity({ kind: "responding" });
    runtime.activity({
      kind: "tool",
      toolCallId: "tool-1",
      toolName: "bash",
      toolKind: "shell",
      status: "running"
    });
    await vi.waitFor(() => expect(activityEvents(port).at(-1)?.payload.activity).toEqual({
      kind: "tool",
      toolCallId: "tool-1",
      toolName: "bash",
      toolKind: "shell",
      status: "running"
    }));

    runtime.event({
      type: "approval.requested",
      payload: approvalRequest("approval-1", "tool-1")
    });
    await vi.waitFor(() => expect(activityEvents(port).at(-1)?.payload.activity).toEqual({
      kind: "approval",
      requestId: "approval-1"
    }));

    const approval = commandEnvelope("approval.respond", {
      requestId: "approval-1",
      toolCallId: "tool-1",
      sessionId: "session-activity",
      sessionGeneration: 4,
      operationId,
      decision: "allow-once"
    }, 12);
    port.emit(approval);
    await expectSuccessfulResponse(port, approval.requestId);
    expect(activityEvents(port).at(-1)?.payload.activity).toEqual({
      kind: "tool",
      toolCallId: "tool-1",
      toolName: "bash",
      toolKind: "shell",
      status: "running"
    });

    runtime.event({
      type: "extension.ui.requested",
      payload: { requestId: "extension-1", kind: "input", title: "Value", blocking: true }
    });
    await vi.waitFor(() => expect(activityEvents(port).at(-1)?.payload.activity).toEqual({
      kind: "extension-input",
      requestId: "extension-1"
    }));

    const extension = commandEnvelope("extension.ui.respond", {
      requestId: "extension-1",
      sessionId: "session-activity",
      sessionGeneration: 4,
      operationId,
      value: "ready"
    }, 12);
    port.emit(extension);
    await expectSuccessfulResponse(port, extension.requestId);
    expect(activityEvents(port).at(-1)?.payload.activity).toEqual({
      kind: "tool",
      toolCallId: "tool-1",
      toolName: "bash",
      toolKind: "shell",
      status: "running"
    });

    runtime.activity(null);
    await vi.waitFor(() => expect(activityEvents(port).at(-1)?.payload.activity).toBeNull());
    const resync = commandEnvelope("projection.resync", {}, 12);
    port.emit(resync);
    await vi.waitFor(() => expect(responseResult(port, resync.requestId, "projection.resync")).toMatchObject({
      activeOperation: { operationId, lifecycle: "running" }
    }));
    expect(responseResult(port, resync.requestId, "projection.resync")?.activeOperation).not.toHaveProperty("activity");

    runtime.finishPrompt();
    await vi.waitFor(() => expect(operationCompletedEvents(port).some((event) => (
      event.payload.operationId === operationId
    ))).toBe(true));
    await server.shutdown();
  });

  it("fails closed and clears interactive overlays before projection resync", async () => {
    const runtime = new ActivityRuntime();
    const server = new AgentHostServer(async () => runtime.asRuntime());
    const port = connect(server, 13);
    const operationId = await submitPrompt(port, 13);

    runtime.activity({
      kind: "tool",
      toolCallId: "tool-2",
      toolName: "edit",
      toolKind: "edit",
      status: "running"
    });
    runtime.event({
      type: "approval.requested",
      payload: approvalRequest("approval-resync", "tool-2")
    });
    await vi.waitFor(() => expect(activityEvents(port).at(-1)?.payload.activity).toEqual({
      kind: "approval",
      requestId: "approval-resync"
    }));
    runtime.event({
      type: "extension.ui.requested",
      payload: { requestId: "extension-resync", kind: "input", title: "Value", blocking: true }
    });
    await vi.waitFor(() => expect(activityEvents(port).at(-1)?.payload.activity).toEqual({
      kind: "extension-input",
      requestId: "extension-resync"
    }));

    const resync = commandEnvelope("projection.resync", {}, 13);
    port.emit(resync);
    await vi.waitFor(() => expect(responseResult(port, resync.requestId, "projection.resync")).toMatchObject({
      activeOperation: {
        operationId,
        lifecycle: "running",
        activity: {
          kind: "tool",
          toolCallId: "tool-2",
          toolName: "edit",
          toolKind: "edit",
          status: "running"
        }
      }
    }));
    expect(runtime.cancelReasons).toContain("projection-resync");
    expect(runtime.resolvedApprovals).toEqual([{
      requestId: "approval-resync",
      toolCallId: "tool-2",
      decision: "deny"
    }]);
    expect(runtime.resolvedExtensions).toEqual([{
      requestId: "extension-resync",
      value: undefined,
      cancelled: true
    }]);
    expect(activityEvents(port).at(-1)?.payload.activity).toEqual({
      kind: "tool",
      toolCallId: "tool-2",
      toolName: "edit",
      toolKind: "edit",
      status: "running"
    });

    runtime.finishPrompt();
    await server.shutdown();
  });

  it("cancels a blocking Extension request that has no deliverable renderer connection", async () => {
    const runtime = new ActivityRuntime();
    const server = new AgentHostServer(async () => runtime.asRuntime());
    const port = connect(server, 14);
    await submitPrompt(port, 14);
    port.emitPortEvent("close");

    runtime.event({
      type: "extension.ui.requested",
      payload: { requestId: "extension-disconnected", kind: "input", blocking: true }
    });

    expect(runtime.resolvedExtensions).toEqual([{
      requestId: "extension-disconnected",
      value: undefined,
      cancelled: true
    }]);
    runtime.finishPrompt();
    await server.shutdown();
  });
});

class ActivityRuntime {
  private eventListener: ((event: AgentEvent) => void) | undefined;
  private activityListener: ((activity: RuntimeOperationActivity) => void) | undefined;
  private finish: (() => void) | undefined;
  private pendingApproval: { requestId: string; toolCallId: string } | undefined;
  private pendingExtensionRequestId: string | undefined;
  readonly cancelReasons: string[] = [];
  readonly resolvedApprovals: Array<{
    requestId: string;
    toolCallId: string;
    decision: "deny" | "allow-once" | "enable-task-yolo-and-allow";
  }> = [];
  readonly resolvedExtensions: Array<{ requestId: string; value: string | boolean | undefined; cancelled: boolean }> = [];

  asRuntime(): AgentRuntime {
    return {
      getSdkVersion: () => "0.81.1",
      subscribe: (listener: (event: AgentEvent) => void) => { this.eventListener = listener; return () => undefined; },
      subscribeOperationActivity: (listener: (activity: RuntimeOperationActivity) => void) => {
        this.activityListener = listener;
        return () => undefined;
      },
      getIdentity: () => ({ sessionId: "session-activity", sessionFileIdentity: "session-file-session-activity", sessionGeneration: 4 }),
      getTaskToolMode: () => "auto",
      setTaskToolMode: (mode: TaskToolMode) => mode,
      getSnapshot: () => snapshot(),
      getWorkspaceChanges: () => ({ sessionId: "session-activity", items: [], truncated: false, total: 0 }),
      getExtensionCatalog: () => ({ items: [], total: 0, truncated: false }),
      getSessionCatalogStatus: () => ({
        revision: 0,
        itemCount: 0,
        source: "sdk-fallback",
        state: "unavailable",
        rebuilding: false,
        incomplete: true,
        skippedCount: 0
      }),
      submitPrompt: () => new Promise<void>((resolve) => { this.finish = resolve; }),
      resolveApproval: (
        requestId: string,
        toolCallId: string,
        decision: ApprovalResponseDecision
      ) => {
        const pending = this.pendingApproval;
        if (pending?.requestId !== requestId || pending?.toolCallId !== toolCallId) {
          return { resolved: false, taskToolMode: "auto" };
        }
        this.pendingApproval = undefined;
        this.resolvedApprovals.push({ requestId, toolCallId, decision });
        return {
          resolved: true,
          taskToolMode: decision === "enable-task-yolo-and-allow" ? "yolo" : "auto"
        };
      },
      resolveExtensionUi: (requestId: string, value?: string | boolean, cancelled = false) => {
        if (this.pendingExtensionRequestId !== requestId) return false;
        this.pendingExtensionRequestId = undefined;
        this.resolvedExtensions.push({ requestId, value, cancelled });
        return true;
      },
      flushStream: () => undefined,
      cancelInteractiveRequests: (reason: ExtensionUiCancellationReason) => {
        this.cancelReasons.push(reason);
        const approval = this.pendingApproval;
        this.pendingApproval = undefined;
        const extensionRequestId = this.pendingExtensionRequestId;
        this.pendingExtensionRequestId = undefined;
        const requestIds: string[] = [];
        if (approval) {
          this.resolvedApprovals.push({ ...approval, decision: "deny" });
          requestIds.push(approval.requestId);
          this.event({
            type: "approval.cancelled",
            payload: { requests: [approval], reason }
          });
        }
        if (extensionRequestId) {
          this.resolvedExtensions.push({ requestId: extensionRequestId, value: undefined, cancelled: true });
          requestIds.push(extensionRequestId);
          this.event({
            type: "extension.ui.cancelled",
            payload: { requestIds: [extensionRequestId], reason }
          });
        }
        return requestIds;
      },
      dispose: async () => undefined
    } as unknown as AgentRuntime;
  }

  activity(activity: RuntimeOperationActivity): void { this.activityListener?.(activity); }

  event(event: AgentEvent): void {
    if (event.type === "approval.requested") {
      this.pendingApproval = {
        requestId: event.payload.requestId,
        toolCallId: event.payload.toolCallId
      };
    }
    if (event.type === "extension.ui.requested" && event.payload.blocking) {
      this.pendingExtensionRequestId = event.payload.requestId;
    }
    this.eventListener?.(event);
  }

  finishPrompt(): void { this.finish?.(); }
}

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
  emitPortEvent(type: "messageerror" | "close"): void {
    for (const listener of this.listeners.get(type) ?? []) listener({});
  }
}

function connect(server: AgentHostServer, hostEpoch: number): FakePort {
  const port = new FakePort();
  server.attachPort(port, {
    appInstanceId: `app-${hostEpoch}`,
    hostInstanceId: `host-${hostEpoch}`,
    hostEpoch
  });
  port.emit({
    protocolVersion: PROTOCOL_VERSION,
    protocolRevision: PROTOCOL_REVISION,
    kind: "hello",
    rendererInstanceId: `renderer-${hostEpoch}`,
    appInstanceId: `app-${hostEpoch}`,
    maxEnvelopeBytes: 2 * 1024 * 1024
  } satisfies RendererHello);
  return port;
}

async function submitPrompt(port: FakePort, hostEpoch: number): Promise<string> {
  await vi.waitFor(() => expect(port.sent.some(isHostWelcome)).toBe(true));
  const request = commandEnvelope("prompt.submit", {
    submissionId: `submission-${hostEpoch}`,
    text: "exercise activity",
    delivery: "new-turn"
  }, hostEpoch);
  port.emit(request);
  await expectSuccessfulResponse(port, request.requestId);
  const result = responseResult(port, request.requestId, "prompt.submit");
  if (result?.kind !== "accepted") throw new Error("Expected an accepted operation.");
  await vi.waitFor(() => expect(port.sent.some((value) => (
    isEventEnvelope(value) && value.type === "operation.started"
  ))).toBe(true));
  return result.operationId;
}

async function expectSuccessfulResponse(port: FakePort, requestId: string): Promise<void> {
  await vi.waitFor(() => expect(port.sent.find((value) => (
    isResponseEnvelope(value) && value.requestId === requestId
  ))).toMatchObject({ ok: true }));
}

function responseResult<T extends AgentCommandType>(
  port: FakePort,
  requestId: string,
  type: T
): CommandResults[T] | undefined {
  const response = port.sent.find((value) => (
    isResponseEnvelope(value) && value.requestId === requestId && value.type === type
  )) as ResponseEnvelope<T> | undefined;
  return response?.ok ? response.result : undefined;
}

function activityEvents(port: FakePort): Array<EventEnvelope<"operation.activityChanged">> {
  return port.sent.filter((value): value is EventEnvelope<"operation.activityChanged"> => (
    isEventEnvelope(value) && value.type === "operation.activityChanged"
  ));
}

function operationCompletedEvents(port: FakePort): Array<EventEnvelope<"operation.completed">> {
  return port.sent.filter((value): value is EventEnvelope<"operation.completed"> => (
    isEventEnvelope(value) && value.type === "operation.completed"
  ));
}

function approvalRequest(requestId: string, toolCallId: string) {
  return {
    requestId,
    toolCallId,
    toolName: "bash",
    toolSource: "Pi 内置",
    category: "ambiguous-command" as const,
    reason: "需要确认",
    targetKind: "command" as const,
    target: "pnpm test",
    targetTruncated: false,
    cwd: "/workspace",
    cwdTruncated: false,
    scope: "single-tool-call" as const
  };
}

function snapshot() {
  return {
    sessionId: "session-activity",
    cwd: "/workspace",
    streaming: false,
    messages: [],
    messagePage: { hasOlder: false, hasNewer: false },
    models: [],
    providers: [],
    thinkingLevel: "off",
    availableThinkingLevels: ["off"],
    steeringQueue: [],
    followUpQueue: [],
    tree: { nodes: [], truncated: false, total: 0 },
    resources: []
  };
}
