import type { OperationView } from "@pi67/domain";
import { eventEnvelope } from "@pi67/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { useApprovalStore } from "../approval/approval-store.js";
import { taskEventFixture } from "../connection/protocol-test-fixtures.js";
import { useExtensionUiStore } from "../extension-ui/extension-ui-store.js";
import { handleAgentEvent } from "./app-events.js";

const operation: OperationView = {
  operationId: "operation-1",
  kind: "prompt",
  lifecycle: "running",
  cancellable: true,
  sessionId: "session-1",
  sessionFileIdentity: "session-file-session-1",
  sessionGeneration: 3,
  startedAt: 1
};

describe("runtime crash event", () => {
  beforeEach(() => {
    useExtensionUiStore.setState(useExtensionUiStore.getInitialState(), true);
    useApprovalStore.setState(useApprovalStore.getInitialState(), true);
  });

  it("clears every Extension UI projection before exposing the failed runtime", () => {
    const extensionStore = useExtensionUiStore.getState();
    useApprovalStore.getState().upsertRequest({
      requestId: "approval-1",
      toolCallId: "tool-1",
      toolName: "bash",
      toolSource: "Pi 内置",
      category: "ambiguous-command",
      reason: "Confirm",
      targetKind: "command",
      target: "pnpm test",
      targetTruncated: false,
      cwd: "/workspace",
      cwdTruncated: false,
      scope: "single-tool-call"
    });
    extensionStore.upsertRequest({
      requestId: "extension-1",
      kind: "confirm",
      blocking: true
    });
    extensionStore.installCatalog({
      hostEpoch: 9,
      sessionId: "session-1",
      sessionFileIdentity: "session-file-session-1",
      sessionGeneration: 3,
      projectionRevision: 1
    }, { items: [], total: 0, truncated: false });
    const state = eventState();
    const payload = { detail: "Runtime exited", recoverable: true };
    const envelope = eventEnvelope("runtime.crashed", payload, taskEventFixture({
      hostEpoch: 9,
      sequence: 1,
      sessionId: "session-1",
      sessionGeneration: 3,
      operationId: "operation-1"
    }));

    handleAgentEvent({ type: "runtime.crashed", payload }, envelope, () => state, (update) => {
      Object.assign(state, typeof update === "function" ? update(state) : update);
    });

    expect(useExtensionUiStore.getState()).toMatchObject({ requests: [], catalog: undefined });
    expect(useApprovalStore.getState().requests).toEqual([]);
    expect(state.runtime).toEqual({ phase: "failed", detail: "Runtime exited", recoverable: true });
  });
});

function eventState() {
  return {
    connected: true,
    hostEpoch: 9,
    runtime: { phase: "busy" as const, detail: "Running", recoverable: true },
    operation,
    operationDetail: undefined as string | undefined,
    operationProgress: undefined as string | undefined,
    sessionTransitionPending: false
  };
}
