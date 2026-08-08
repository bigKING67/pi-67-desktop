import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../app/app-store.js";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { useLiveTurnStore } from "../live-turn/live-turn-store.js";
import { useNotificationStore } from "../notifications/notification-store.js";
import {
  implementRendererPlan,
  setRendererSessionInteractionMode
} from "./session-plan-controller.js";
import { useSessionProjectionStore } from "./session-projection-store.js";
import {
  installSessionProjectionFixture,
  sessionSnapshotFixture
} from "./session-projection-test-support.js";

const AUTHORITY = {
  hostEpoch: 9,
  sessionId: "session-1",
  sessionFileIdentity: "session-file-1",
  sessionGeneration: 3,
  projectionRevision: 1
} as const;

describe("Session Plan controller", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAppStore.setState(useAppStore.getInitialState(), true);
    useSessionProjectionStore.setState(useSessionProjectionStore.getInitialState(), true);
    useLiveTurnStore.setState(useLiveTurnStore.getInitialState(), true);
    useNotificationStore.setState(useNotificationStore.getInitialState(), true);
    useAppStore.setState({
      connected: true,
      hostEpoch: AUTHORITY.hostEpoch,
      runtime: { phase: "ready", detail: "ready", recoverable: true }
    });
    installSessionProjectionFixture(
      { connected: true, hostEpoch: AUTHORITY.hostEpoch },
      sessionSnapshotFixture({
        sessionId: AUTHORITY.sessionId,
        sessionFileIdentity: AUTHORITY.sessionFileIdentity,
        interactionMode: "execute"
      }),
      AUTHORITY.sessionGeneration
    );
  });

  it("sets the native interaction mode only after an exact Session acknowledgement", async () => {
    const request = vi.spyOn(agentConnectionController, "request").mockResolvedValue(
      acknowledgement() as never
    );

    await expect(setRendererSessionInteractionMode("plan")).resolves.toBe(true);

    expect(request).toHaveBeenCalledWith("session.interactionMode.set", { mode: "plan" });
    expect(useSessionProjectionStore.getState().interaction).toEqual({ interactionMode: "plan" });
  });

  it("ignores a stale interaction-mode acknowledgement", async () => {
    vi.spyOn(agentConnectionController, "request").mockResolvedValue({
      ...acknowledgement(),
      sessionGeneration: 4
    } as never);

    await expect(setRendererSessionInteractionMode("plan")).resolves.toBe(false);
    expect(useSessionProjectionStore.getState().interaction).toEqual({ interactionMode: "execute" });
  });

  it("implements a stored plan by sending only its identifiers and installs the Prompt operation", async () => {
    const request = vi.spyOn(agentConnectionController, "request").mockResolvedValue({
      kind: "accepted",
      operationId: "operation-implement",
      cancellable: true,
      hostEpoch: AUTHORITY.hostEpoch,
      sessionId: AUTHORITY.sessionId,
      sessionFileIdentity: AUTHORITY.sessionFileIdentity,
      sessionGeneration: AUTHORITY.sessionGeneration
    } as never);

    await expect(implementRendererPlan("plan-1", "submission-1")).resolves.toEqual({
      accepted: true,
      operationId: "operation-implement"
    });

    expect(request).toHaveBeenCalledWith("plan.implement", {
      submissionId: "submission-1",
      planId: "plan-1"
    });
    expect(JSON.stringify(request.mock.calls[0])).not.toContain("markdown");
    expect(useAppStore.getState()).toMatchObject({
      operation: {
        operationId: "operation-implement",
        kind: "prompt",
        lifecycle: "accepted"
      },
      runtime: { phase: "busy", detail: "Pi 正在按计划执行" }
    });
    expect(useLiveTurnStore.getState().authority).toMatchObject({
      hostEpoch: AUTHORITY.hostEpoch,
      operationId: "operation-implement"
    });
  });

  it("drops a plan acknowledgement after Session replacement", async () => {
    const response = deferred<ReturnType<typeof acceptedOperation>>();
    vi.spyOn(agentConnectionController, "request").mockReturnValue(response.promise as never);

    const pending = implementRendererPlan("plan-1", "submission-1");
    useSessionProjectionStore.getState().reset();
    response.resolve(acceptedOperation());

    await expect(pending).resolves.toMatchObject({ accepted: false });
    expect(useAppStore.getState().operation).toBeUndefined();
  });
});

function acknowledgement() {
  return {
    accepted: true as const,
    hostEpoch: AUTHORITY.hostEpoch,
    sessionId: AUTHORITY.sessionId,
    sessionFileIdentity: AUTHORITY.sessionFileIdentity,
    sessionGeneration: AUTHORITY.sessionGeneration,
    eventSequence: 1
  };
}

function acceptedOperation() {
  return {
    kind: "accepted" as const,
    operationId: "operation-implement",
    cancellable: true,
    hostEpoch: AUTHORITY.hostEpoch,
    sessionId: AUTHORITY.sessionId,
    sessionFileIdentity: AUTHORITY.sessionFileIdentity,
    sessionGeneration: AUTHORITY.sessionGeneration
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}
