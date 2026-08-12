import { eventEnvelope } from "@pi67/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { taskEventFixture } from "../connection/protocol-test-fixtures.js";
import {
  openActiveProvisionalTask,
  routeWorkbenchAgentEvent,
  snapshot,
  task
} from "./workbench-event-router-test-fixture.js";
import { rendererWorkbenchStore } from "./workbench-store.js";

describe("workbench Session creation selection", () => {
  beforeEach(() => {
    rendererWorkbenchStore.getState().reset();
  });

  it("reselects a pending user creation when its authoritative bootstrap materializes", () => {
    openActiveProvisionalTask();
    const workbench = rendererWorkbenchStore.getState();
    workbench.updateTask("active", {
      creationId: "session-creation-active",
      creationStatus: "confirming"
    });
    workbench.openTask(task("previous"));
    const bootstrapSnapshot = snapshot("session-created", "/sessions/created.jsonl", "Created Session");
    const payload = { snapshot: bootstrapSnapshot, reason: "session-create" as const };

    expect(routeWorkbenchAgentEvent(
      { type: "session.bootstrap", payload },
      eventEnvelope("session.bootstrap", payload, taskEventFixture({
        hostEpoch: 9,
        sequence: 2,
        workspaceId: "workspace-a",
        taskId: "active",
        taskGeneration: 1,
        sessionId: bootstrapSnapshot.sessionId,
        sessionGeneration: 4
      }))
    )).toBe("background");
    expect(rendererWorkbenchStore.getState().selectedSurface).toEqual({
      kind: "conversation",
      conversation: {
        kind: "session",
        workspaceId: "workspace-a",
        sessionFileIdentity: "session-file-session-created",
        sessionPath: "/sessions/created.jsonl"
      }
    });
  });

  it("does not steal selection after a creation became unconfirmed", () => {
    openActiveProvisionalTask();
    const workbench = rendererWorkbenchStore.getState();
    workbench.updateTask("active", {
      creationId: "session-creation-active",
      creationStatus: "unconfirmed"
    });
    workbench.openTask(task("previous"));
    const bootstrapSnapshot = snapshot("session-late", "/sessions/late.jsonl", "Late Session");
    const payload = { snapshot: bootstrapSnapshot, reason: "session-create" as const };

    expect(routeWorkbenchAgentEvent(
      { type: "session.bootstrap", payload },
      eventEnvelope("session.bootstrap", payload, taskEventFixture({
        hostEpoch: 9,
        sequence: 2,
        workspaceId: "workspace-a",
        taskId: "active",
        taskGeneration: 1,
        sessionId: bootstrapSnapshot.sessionId,
        sessionGeneration: 4
      }))
    )).toBe("background");
    expect(rendererWorkbenchStore.getState().selectedSurface).toEqual({
      kind: "conversation",
      conversation: task("previous").conversation
    });
  });
});
