import type { AgentRuntime } from "@pi67/pi-runtime";
import {
  PROTOCOL_REVISION,
  PROTOCOL_VERSION,
  isEventEnvelope,
  isHostWelcome,
  isResponseEnvelope,
  type AgentEvent,
  type EventEnvelope,
  type ProtocolPort,
  type RendererHello
} from "@pi67/protocol";
import { describe, expect, it, vi } from "vitest";
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
  emitMessage(data: unknown): void {
    for (const listener of this.listeners.get("message") ?? []) listener({ data });
  }
  emitPortEvent(type: "messageerror" | "close"): void {
    for (const listener of this.listeners.get(type) ?? []) listener({});
  }
}

describe("AgentHostServer safety approval", () => {
  it("binds approval responses to the active Host, session, operation and tool call", async () => {
    let emit: ((event: AgentEvent) => void) | undefined;
    let finishPrompt!: () => void;
    const resolveApproval = vi.fn((requestId: string, toolCallId: string) => ({
      resolved: requestId === "approval-request-1" && toolCallId === "tool-call-1",
      taskToolMode: "auto" as const
    }));
    const runtime = {
      getSdkVersion: () => "0.81.1",
      subscribe: (listener: (event: AgentEvent) => void) => {
        emit = listener;
        return () => undefined;
      },
      getIdentity: () => ({ sessionId: "session-approval", sessionFileIdentity: "session-file-session-approval", sessionGeneration: 7 }),
      getTaskToolMode: () => "auto",
      getModels: () => [],
      submitPrompt: () => new Promise<void>((resolve) => {
        finishPrompt = resolve;
        emit?.({
          type: "approval.requested",
          payload: {
            requestId: "approval-request-1",
            toolCallId: "tool-call-1",
            toolName: "bash",
            toolSource: "Pi 内置",
            category: "git-external-action",
            reason: "访问或修改远程 Git 状态",
            targetKind: "command",
            target: "git push origin main",
            targetTruncated: false,
            cwd: "/workspace",
            cwdTruncated: false,
            scope: "single-tool-call"
          }
        });
      }),
      resolveApproval,
      flushStream: () => undefined,
      cancelInteractiveRequests: () => [],
      dispose: async () => undefined
    } as unknown as AgentRuntime;
    const server = new AgentHostServer(async () => runtime);
    const port = new FakePort();
    server.attachPort(port, { appInstanceId: "app-approval", hostInstanceId: "host-approval", hostEpoch: 12 });
    handshake(port, "app-approval");
    await vi.waitFor(() => expect(port.sent.some(isHostWelcome)).toBe(true));

    const prompt = commandEnvelope("prompt.submit", {
      submissionId: "approval-submission",
      text: "publish the branch",
      delivery: "new-turn"
    }, 12);
    port.emitMessage(prompt);
    await vi.waitFor(() => {
      expect(port.sent.find((value) => isResponseEnvelope(value) && value.requestId === prompt.requestId))
        .toMatchObject({ ok: true, result: { operationId: expect.any(String) } });
    });
    const approval = await waitForEvent(port, "approval.requested");
    expect(approval).toMatchObject({
      hostEpoch: 12,
      taskSequence: expect.any(Number),
      context: {
        scope: "task",
        sessionId: "session-approval",
        sessionGeneration: 7,
        operationId: expect.any(String)
      },
      payload: {
        hostEpoch: 12,
        sessionId: "session-approval",
        sessionGeneration: 7,
        operationId: expect.any(String),
        toolCallId: "tool-call-1"
      }
    });
    const operationId = approval.context.scope === "task"
      ? approval.context.operationId
      : undefined;
    if (!operationId) throw new Error("Expected approval operation identity.");

    const staleSession = commandEnvelope("approval.respond", {
      requestId: "approval-request-1",
      toolCallId: "tool-call-1",
      sessionId: "session-approval",
      sessionGeneration: 6,
      operationId,
      decision: "allow-once"
    }, 12);
    port.emitMessage(staleSession);
    await expectResponse(port, staleSession.requestId, { ok: false, error: { code: "STALE_SESSION_GENERATION" } });

    const staleOperation = commandEnvelope("approval.respond", {
      requestId: "approval-request-1",
      toolCallId: "tool-call-1",
      sessionId: "session-approval",
      sessionGeneration: 7,
      operationId: "operation-stale",
      decision: "allow-once"
    }, 12);
    port.emitMessage(staleOperation);
    await expectResponse(port, staleOperation.requestId, { ok: false, error: { code: "STALE_OPERATION" } });

    const wrongTool = commandEnvelope("approval.respond", {
      requestId: "approval-request-1",
      toolCallId: "tool-call-wrong",
      sessionId: "session-approval",
      sessionGeneration: 7,
      operationId,
      decision: "allow-once"
    }, 12);
    port.emitMessage(wrongTool);
    await expectResponse(port, wrongTool.requestId, { ok: true, result: { resolved: false } });

    const current = commandEnvelope("approval.respond", {
      requestId: "approval-request-1",
      toolCallId: "tool-call-1",
      sessionId: "session-approval",
      sessionGeneration: 7,
      operationId,
      decision: "allow-once"
    }, 12);
    port.emitMessage(current);
    await expectResponse(port, current.requestId, { ok: true, result: { resolved: true } });
    expect(resolveApproval).toHaveBeenCalledTimes(2);

    finishPrompt();
    await server.shutdown();
  });

  it("fails an approval closed instead of publishing it without active operation authority", async () => {
    let emit: ((event: AgentEvent) => void) | undefined;
    const resolveApproval = vi.fn(() => ({ resolved: true, taskToolMode: "auto" as const }));
    const runtime = {
      getSdkVersion: () => "0.81.1",
      subscribe: (listener: (event: AgentEvent) => void) => {
        emit = listener;
        return () => undefined;
      },
      getIdentity: () => ({ sessionId: "session-idle", sessionFileIdentity: "session-file-session-idle", sessionGeneration: 2 }),
      resolveApproval,
      cancelInteractiveRequests: () => [],
      dispose: async () => undefined
    } as unknown as AgentRuntime;
    const server = new AgentHostServer(async () => runtime);
    const port = new FakePort();
    server.attachPort(port, { appInstanceId: "app-idle", hostInstanceId: "host-idle", hostEpoch: 3 });
    handshake(port, "app-idle");
    await vi.waitFor(() => expect(port.sent.some(isHostWelcome)).toBe(true));

    emit?.({
      type: "approval.requested",
      payload: {
        requestId: "approval-without-operation",
        toolCallId: "tool-call-idle",
        toolName: "bash",
        toolSource: "Pi 内置",
        category: "ambiguous-command",
        reason: "执行无法安全分类的命令",
        targetKind: "command",
        target: "pwd",
        targetTruncated: false,
        cwd: "/workspace",
        cwdTruncated: false,
        scope: "single-tool-call"
      }
    });

    expect(resolveApproval).toHaveBeenCalledWith("approval-without-operation", "tool-call-idle", "deny");
    expect(port.sent.some((value) => isEventEnvelope(value) && value.type === "approval.requested")).toBe(false);
    await server.shutdown();
  });

  it("routes a background child approval with Session authority and no parent operation", async () => {
    let emit: ((event: AgentEvent) => void) | undefined;
    const resolveApproval = vi.fn(() => ({ resolved: true, taskToolMode: "auto" as const }));
    const runtime = {
      getSdkVersion: () => "0.81.1",
      subscribe: (listener: (event: AgentEvent) => void) => {
        emit = listener;
        return () => undefined;
      },
      getIdentity: () => ({
        sessionId: "session-child-approval",
        sessionFileIdentity: "session-file-child-approval",
        sessionGeneration: 4
      }),
      getTaskToolMode: () => "auto",
      getModels: () => [],
      hasPendingSubagentApproval: (requestId: string, toolCallId: string) => (
        requestId === "approval-child-1" && toolCallId === "tool-child-1"
      ),
      resolveApproval,
      cancelInteractiveRequests: () => [],
      dispose: async () => undefined
    } as unknown as AgentRuntime;
    const server = new AgentHostServer(async () => runtime);
    const port = new FakePort();
    server.attachPort(port, { appInstanceId: "app-child", hostInstanceId: "host-child", hostEpoch: 6 });
    handshake(port, "app-child");
    await vi.waitFor(() => expect(port.sent.some(isHostWelcome)).toBe(true));

    const loadTask = commandEnvelope("model.list", {}, 6);
    port.emitMessage(loadTask);
    await expectResponse(port, loadTask.requestId, { ok: true, result: [] });

    emit?.({
      type: "approval.requested",
      payload: {
        requestId: "approval-child-1",
        toolCallId: "tool-child-1",
        toolName: "bash",
        toolSource: "Pi 内置",
        category: "ambiguous-command",
        reason: "执行无法安全分类的命令",
        targetKind: "command",
        target: "pwd",
        targetTruncated: false,
        cwd: "/workspace",
        cwdTruncated: false,
        scope: "single-tool-call",
        subagent: {
          runId: "run-child-1",
          childId: "child-1",
          activationId: "activation-1",
          depth: 1,
          role: "worker"
        }
      }
    });

    expect(resolveApproval).not.toHaveBeenCalled();
    const approval = await waitForEvent(port, "approval.requested");
    expect(approval).toMatchObject({
      context: {
        scope: "task",
        sessionId: "session-child-approval",
        sessionGeneration: 4
      },
      payload: {
        requestId: "approval-child-1",
        sessionId: "session-child-approval",
        sessionGeneration: 4,
        subagent: { runId: "run-child-1", childId: "child-1" }
      }
    });
    if (approval.context.scope !== "task") throw new Error("Expected Task authority.");
    expect(approval.context.operationId).toBeUndefined();
    expect(approval.payload.operationId).toBeUndefined();

    const response = commandEnvelope("approval.respond", {
      requestId: "approval-child-1",
      toolCallId: "tool-child-1",
      sessionId: "session-child-approval",
      sessionGeneration: 4,
      decision: "allow-once"
    }, 6);
    port.emitMessage(response);
    await expectResponse(port, response.requestId, { ok: true, result: { resolved: true } });
    expect(resolveApproval).toHaveBeenCalledWith("approval-child-1", "tool-child-1", "allow-once");
    await server.shutdown();
  });

  it("cancels interactive requests on connection replacement, message errors and close", async () => {
    const cancelInteractiveRequests = vi.fn(() => []);
    const runtime = {
      getSdkVersion: () => "0.81.1",
      subscribe: () => () => undefined,
      cancelInteractiveRequests,
      dispose: async () => undefined
    } as unknown as AgentRuntime;
    const server = new AgentHostServer(async () => runtime);

    const first = new FakePort();
    server.attachPort(first, { appInstanceId: "app-connections", hostInstanceId: "host-connections", hostEpoch: 5 });
    handshake(first, "app-connections");
    await vi.waitFor(() => expect(first.sent.some(isHostWelcome)).toBe(true));

    const second = new FakePort();
    server.attachPort(second, { appInstanceId: "app-connections", hostInstanceId: "host-connections", hostEpoch: 5 });
    expect(cancelInteractiveRequests).toHaveBeenLastCalledWith("connection-close");
    handshake(second, "app-connections");
    await vi.waitFor(() => expect(second.sent.some(isHostWelcome)).toBe(true));
    second.emitPortEvent("messageerror");
    expect(cancelInteractiveRequests).toHaveBeenCalledTimes(2);

    const third = new FakePort();
    server.attachPort(third, { appInstanceId: "app-connections", hostInstanceId: "host-connections", hostEpoch: 5 });
    handshake(third, "app-connections");
    await vi.waitFor(() => expect(third.sent.some(isHostWelcome)).toBe(true));
    third.emitPortEvent("close");
    expect(cancelInteractiveRequests).toHaveBeenCalledTimes(3);
    expect(cancelInteractiveRequests).toHaveBeenLastCalledWith("connection-close");
    await server.shutdown();
  });

  it("denies a new approval immediately when its active operation has no deliverable connection", async () => {
    let emit: ((event: AgentEvent) => void) | undefined;
    let finishPrompt!: () => void;
    const resolveApproval = vi.fn(() => ({ resolved: true, taskToolMode: "auto" as const }));
    const runtime = {
      getSdkVersion: () => "0.81.1",
      subscribe: (listener: (event: AgentEvent) => void) => {
        emit = listener;
        return () => undefined;
      },
      getIdentity: () => ({ sessionId: "session-disconnected", sessionFileIdentity: "session-file-session-disconnected", sessionGeneration: 9 }),
      submitPrompt: () => new Promise<void>((resolve) => { finishPrompt = resolve; }),
      resolveApproval,
      flushStream: () => undefined,
      cancelInteractiveRequests: () => [],
      dispose: async () => undefined
    } as unknown as AgentRuntime;
    const server = new AgentHostServer(async () => runtime);
    const port = new FakePort();
    server.attachPort(port, { appInstanceId: "app-disconnected", hostInstanceId: "host-disconnected", hostEpoch: 8 });
    handshake(port, "app-disconnected");
    await vi.waitFor(() => expect(port.sent.some(isHostWelcome)).toBe(true));

    const prompt = commandEnvelope("prompt.submit", {
      submissionId: "disconnected-submission",
      text: "wait for a tool",
      delivery: "new-turn"
    }, 8);
    port.emitMessage(prompt);
    await vi.waitFor(() => {
      expect(port.sent.find((value) => isResponseEnvelope(value) && value.requestId === prompt.requestId))
        .toMatchObject({ ok: true });
    });
    port.emitPortEvent("close");

    emit?.({
      type: "approval.requested",
      payload: {
        requestId: "approval-after-close",
        toolCallId: "tool-call-after-close",
        toolName: "bash",
        toolSource: "Pi 内置",
        category: "ambiguous-command",
        reason: "执行无法安全分类的命令",
        targetKind: "command",
        target: "pwd",
        targetTruncated: false,
        cwd: "/workspace",
        cwdTruncated: false,
        scope: "single-tool-call"
      }
    });

    expect(resolveApproval).toHaveBeenCalledWith("approval-after-close", "tool-call-after-close", "deny");
    expect(port.sent.some((value) => isEventEnvelope(value)
      && value.type === "approval.requested"
      && (value as EventEnvelope<"approval.requested">).payload.requestId === "approval-after-close")).toBe(false);

    const unhandshaken = new FakePort();
    server.attachPort(unhandshaken, {
      appInstanceId: "app-disconnected",
      hostInstanceId: "host-disconnected",
      hostEpoch: 8
    });
    emit?.({
      type: "approval.requested",
      payload: {
        requestId: "approval-before-handshake",
        toolCallId: "tool-call-before-handshake",
        toolName: "bash",
        toolSource: "Pi 内置",
        category: "ambiguous-command",
        reason: "执行无法安全分类的命令",
        targetKind: "command",
        target: "pwd",
        targetTruncated: false,
        cwd: "/workspace",
        cwdTruncated: false,
        scope: "single-tool-call"
      }
    });
    expect(resolveApproval).toHaveBeenCalledWith(
      "approval-before-handshake",
      "tool-call-before-handshake",
      "deny"
    );
    expect(unhandshaken.sent).toEqual([]);
    finishPrompt();
    await server.shutdown();
  });
});

function handshake(port: FakePort, appInstanceId: string): void {
  port.emitMessage({
    protocolVersion: PROTOCOL_VERSION,
    protocolRevision: PROTOCOL_REVISION,
    kind: "hello",
    rendererInstanceId: `renderer-${appInstanceId}`,
    appInstanceId,
    maxEnvelopeBytes: 2 * 1024 * 1024
  } satisfies RendererHello);
}

async function waitForEvent(port: FakePort, type: "approval.requested") {
  let event: EventEnvelope<"approval.requested"> | undefined;
  await vi.waitFor(() => {
    event = eventOfType(port, type);
    expect(event).toBeDefined();
  });
  if (!event) throw new Error(`Expected ${type}.`);
  return event;
}

function eventOfType(port: FakePort, type: "approval.requested") {
  return port.sent.find((value) => isEventEnvelope(value) && value.type === type) as
    | EventEnvelope<"approval.requested">
    | undefined;
}

async function expectResponse(port: FakePort, requestId: string, expected: object): Promise<void> {
  await vi.waitFor(() => {
    expect(port.sent.find((value) => isResponseEnvelope(value) && value.requestId === requestId))
      .toMatchObject(expected);
  });
}
