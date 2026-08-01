import type { AgentRuntime } from "@pi67/pi-runtime";
import { isEventEnvelope, type AgentEvent, type ProtocolContext } from "@pi67/protocol";
import { describe, expect, it, vi } from "vitest";
import type { HostConnectionContext } from "./connection-context.js";
import { HostEventChannel } from "./host-event-channel.js";
import type { OperationRegistry } from "./operation-registry.js";
import {
  TEST_APP_CONTEXT,
  TEST_TASK_CONTEXT,
  testTaskContext
} from "./protocol-test-fixtures.js";

describe("HostEventChannel", () => {
  it("publishes App events without a Task sequence", () => {
    const fixture = createFixture(TEST_APP_CONTEXT);

    fixture.channel.send({
      type: "runtime.statusChanged",
      payload: { phase: "ready", detail: "Pi SDK ready", recoverable: true }
    });

    const envelope = fixture.postEvent.mock.calls[0]?.[0];
    expect(isEventEnvelope(envelope)).toBe(true);
    expect(envelope).toMatchObject({
      type: "runtime.statusChanged",
      sequence: 1,
      context: TEST_APP_CONTEXT
    });
    expect(envelope).not.toHaveProperty("taskSequence");
  });

  it("increments Task event sequence independently from the Host sequence", () => {
    const fixture = createFixture();
    const event: AgentEvent = {
      type: "runtime.statusChanged",
      payload: { phase: "ready", detail: "Pi SDK ready", recoverable: true }
    };

    fixture.channel.send(event);
    fixture.channel.send(event);

    expect(fixture.postEvent.mock.calls.map(([envelope]) => envelope)).toMatchObject([
      { sequence: 1, taskSequence: 1 },
      { sequence: 2, taskSequence: 2 }
    ]);
  });

  it("tracks Task sequences independently and resets them for a new Task generation", () => {
    let protocolContext: ProtocolContext = TEST_TASK_CONTEXT;
    const fixture = createFixture(() => protocolContext);
    const event: AgentEvent = {
      type: "runtime.statusChanged",
      payload: { phase: "ready", detail: "Pi SDK ready", recoverable: true }
    };

    fixture.channel.send(event);
    protocolContext = testTaskContext(1, { taskId: "task-other" });
    fixture.channel.send(event);
    protocolContext = TEST_TASK_CONTEXT;
    fixture.channel.send(event);
    protocolContext = testTaskContext(2);
    fixture.channel.send(event);

    expect(fixture.postEvent.mock.calls.map(([envelope]) => envelope)).toMatchObject([
      { sequence: 1, taskSequence: 1 },
      { sequence: 2, taskSequence: 1 },
      { sequence: 3, taskSequence: 2 },
      { sequence: 4, taskSequence: 1 }
    ]);
  });

  it("drops an invalid event before consuming sequence or updating operation activity", () => {
    const fixture = createFixture();

    fixture.channel.send({
      type: "runtime.statusChanged",
      payload: { phase: "secret-invalid-phase", detail: "must not cross the port", recoverable: true }
    } as unknown as AgentEvent);

    expect(fixture.channel.eventSequence).toBe(0);
    expect(fixture.postEvent).not.toHaveBeenCalled();
    expect(fixture.observeEventActivity).not.toHaveBeenCalled();

    fixture.channel.send({
      type: "runtime.statusChanged",
      payload: { phase: "ready", detail: "Pi SDK ready", recoverable: true }
    });

    expect(fixture.channel.eventSequence).toBe(1);
    expect(fixture.observeEventActivity).toHaveBeenCalledOnce();
    expect(fixture.postEvent).toHaveBeenCalledOnce();
    const envelope = fixture.postEvent.mock.calls[0]?.[0];
    expect(isEventEnvelope(envelope)).toBe(true);
    expect(envelope).toMatchObject({
      type: "runtime.statusChanged",
      sequence: 1,
      taskSequence: 1,
      context: {
        ...TEST_TASK_CONTEXT,
        sessionId: "session-events",
        sessionGeneration: 3,
        operationId: "operation-events"
      }
    });
  });

  it("fails an invalid approval request closed without publishing or beginning a wait", () => {
    const fixture = createFixture();
    fixture.resolveApproval.mockReturnValue(false);

    fixture.channel.send({
      type: "approval.requested",
      payload: {
        ...approvalRequest("approval-invalid", "tool-invalid"),
        reason: 42
      }
    } as unknown as AgentEvent);

    expect(fixture.resolveApproval).toHaveBeenCalledWith(
      "approval-invalid",
      "tool-invalid",
      false
    );
    expect(fixture.cancelInteractiveRequests).toHaveBeenCalledWith("abort");
    expect(fixture.channel.eventSequence).toBe(0);
    expect(fixture.postEvent).not.toHaveBeenCalled();
    expect(fixture.observeEventActivity).not.toHaveBeenCalled();
    expect(fixture.beginInteractiveWait).not.toHaveBeenCalled();
  });

  it("fails an invalid blocking Extension request closed without publishing it", () => {
    const fixture = createFixture();

    fixture.channel.send({
      type: "extension.ui.requested",
      payload: {
        requestId: "extension-invalid",
        kind: "input",
        title: 42,
        blocking: true
      }
    } as unknown as AgentEvent);

    expect(fixture.resolveExtensionUi).toHaveBeenCalledWith(
      "extension-invalid",
      undefined,
      true
    );
    expect(fixture.channel.eventSequence).toBe(0);
    expect(fixture.postEvent).not.toHaveBeenCalled();
    expect(fixture.observeEventActivity).not.toHaveBeenCalled();
    expect(fixture.beginInteractiveWait).not.toHaveBeenCalled();
  });

  it("cancels pending interactive state when a malformed blocking request has no identity", () => {
    const fixture = createFixture();

    fixture.channel.send({
      type: "extension.ui.requested",
      payload: null
    } as unknown as AgentEvent);

    expect(fixture.cancelInteractiveRequests).toHaveBeenCalledWith("abort");
    expect(fixture.channel.eventSequence).toBe(0);
    expect(fixture.postEvent).not.toHaveBeenCalled();
    expect(fixture.observeEventActivity).not.toHaveBeenCalled();
    expect(fixture.beginInteractiveWait).not.toHaveBeenCalled();
  });

  it("publishes a valid approval only after it can establish the interactive wait", () => {
    const fixture = createFixture();

    fixture.channel.send({
      type: "approval.requested",
      payload: approvalRequest("approval-valid", "tool-valid")
    });

    expect(fixture.resolveApproval).not.toHaveBeenCalled();
    expect(fixture.channel.eventSequence).toBe(1);
    expect(fixture.observeEventActivity).toHaveBeenCalledOnce();
    expect(fixture.beginInteractiveWait).toHaveBeenCalledWith({
      kind: "approval",
      requestId: "approval-valid"
    });
    expect(fixture.postEvent).toHaveBeenCalledOnce();
    const envelope = fixture.postEvent.mock.calls[0]?.[0];
    expect(isEventEnvelope(envelope)).toBe(true);
    expect(envelope).toMatchObject({
      type: "approval.requested",
      sequence: 1,
      taskSequence: 1,
      context: {
        ...TEST_TASK_CONTEXT,
        sessionId: "session-events",
        sessionGeneration: 3,
        operationId: "operation-events"
      },
      payload: {
        requestId: "approval-valid",
        hostEpoch: 11,
        sessionId: "session-events",
        sessionGeneration: 3,
        operationId: "operation-events"
      }
    });
  });

  it("serializes synchronous activity emitted while an approval wait is established", () => {
    const fixture = createFixture();
    fixture.beginInteractiveWait.mockImplementation(() => {
      fixture.channel.send({
        type: "operation.activityChanged",
        payload: {
          operationId: "operation-events",
          activity: { kind: "approval", requestId: "approval-reentrant" }
        }
      });
      return true;
    });

    fixture.channel.send({
      type: "approval.requested",
      payload: approvalRequest("approval-reentrant", "tool-reentrant")
    });

    expect(fixture.postEvent.mock.calls.map(([envelope]) => envelope)).toMatchObject([
      {
        type: "approval.requested",
        sequence: 1,
        taskSequence: 1,
        payload: { requestId: "approval-reentrant" }
      },
      {
        type: "operation.activityChanged",
        sequence: 2,
        taskSequence: 2,
        payload: {
          operationId: "operation-events",
          activity: { kind: "approval", requestId: "approval-reentrant" }
        }
      }
    ]);
    expect(fixture.resolveApproval).not.toHaveBeenCalled();
  });
});

function createFixture(
  protocolContext: ProtocolContext | (() => ProtocolContext) = TEST_TASK_CONTEXT
) {
  const postEvent = vi.fn((_envelope: unknown) => true);
  const observeEventActivity = vi.fn(() => true);
  const beginInteractiveWait = vi.fn(() => true);
  const completeInteractiveWait = vi.fn(() => true);
  const resolveApproval = vi.fn(() => true);
  const resolveExtensionUi = vi.fn(() => true);
  const cancelInteractiveRequests = vi.fn(() => []);
  const runtime = {
    getIdentity: () => ({ sessionId: "session-events", sessionGeneration: 3 }),
    resolveApproval,
    resolveExtensionUi,
    cancelInteractiveRequests
  } as unknown as AgentRuntime;
  const operations = {
    activeAccepted: () => ({ operationId: "operation-events" }),
    observeEventActivity,
    beginInteractiveWait,
    completeInteractiveWait
  } as unknown as OperationRegistry;
  const connection = { postEvent } as unknown as HostConnectionContext;
  const channel = new HostEventChannel({
    getConnection: () => connection,
    getHostEpoch: () => 11,
    getOperations: () => operations,
    getRuntime: () => runtime,
    getProtocolContext: typeof protocolContext === "function"
      ? protocolContext
      : () => protocolContext
  });

  return {
    channel,
    postEvent,
    observeEventActivity,
    beginInteractiveWait,
    completeInteractiveWait,
    resolveApproval,
    resolveExtensionUi,
    cancelInteractiveRequests
  };
}

function approvalRequest(requestId: string, toolCallId: string) {
  return {
    requestId,
    toolCallId,
    toolName: "bash",
    category: "ambiguous-command" as const,
    reason: "Confirm command",
    targetKind: "command" as const,
    target: "pnpm test",
    targetTruncated: false,
    cwd: "/workspace",
    cwdTruncated: false,
    scope: "single-tool-call" as const
  };
}
