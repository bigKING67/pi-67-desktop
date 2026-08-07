import type { OperationView } from "@pi67/domain";
import { eventEnvelope } from "@pi67/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { taskEventFixture } from "../connection/protocol-test-fixtures.js";
import { useConversationStore } from "../conversation/conversation-store.js";
import { useLiveTurnStore } from "../live-turn/live-turn-store.js";
import { useNotificationStore } from "../notifications/notification-store.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import {
  installSessionProjectionFixture,
  sessionSnapshotFixture
} from "../session/session-projection-test-support.js";
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

describe("handleAgentEvent operation recovery", () => {
  beforeEach(() => {
    useConversationStore.getState().reset();
    useLiveTurnStore.getState().reset();
    useNotificationStore.setState(useNotificationStore.getInitialState(), true);
    useSessionProjectionStore.setState(useSessionProjectionStore.getInitialState(), true);
    installSessionProjectionFixture(
      { connected: true, hostEpoch: 9 },
      sessionSnapshotFixture(),
      3
    );
  });

  it("keeps the runtime recovering after an operation is lost", () => {
    const state = {
      connected: true,
      hostEpoch: 9,
      runtime: { phase: "busy" as const, detail: "运行中", recoverable: true },
      operation,
      operationDetail: undefined as string | undefined,
      operationProgress: undefined as string | undefined,
      sessionTransitionPending: false
    };
    const payload = {
      operationId: "operation-1",
      lostAt: 2,
      reason: "Agent Host replacement is required."
    };
    handleAgentEvent(
      { type: "operation.lost", payload },
      eventEnvelope("operation.lost", payload, taskEventFixture({
        hostEpoch: 9,
        sequence: 1,
        sessionId: "session-1",
        sessionGeneration: 3,
        operationId: "operation-1"
      })),
      () => state,
      (update) => Object.assign(state, typeof update === "function" ? update(state) : update)
    );

    expect(state.operation?.lifecycle).toBe("lost");
    expect(state.runtime).toMatchObject({ phase: "recovering" });
    expect(useNotificationStore.getState().items).toEqual([
      expect.objectContaining({ level: "warning", title: "任务已中断" })
    ]);
  });
});
