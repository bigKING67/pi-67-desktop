import type { RuntimeCapabilities, SessionSnapshot } from "@pi67/domain";
import {
  eventEnvelope,
  type ProjectionMutationAcknowledgement
} from "@pi67/protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { taskEventFixture } from "../connection/protocol-test-fixtures.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { installSessionProjectionFixture } from "../session/session-projection-test-support.js";
import { useAppStore } from "./app-store.js";
import { runSessionBootstrapTransition } from "./session-transition.js";

describe("session bootstrap intermediate runtime", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAppStore.setState(useAppStore.getInitialState(), true);
    useSessionProjectionStore.setState(useSessionProjectionStore.getInitialState(), true);
    useAppStore.setState({
      connected: true,
      hostEpoch: 9,
      workspace: "/workspace",
      runtime: { phase: "ready", detail: "Ready", recoverable: true }
    });
    installSessionProjectionFixture(
      useAppStore.getState(),
      snapshot("session-old"),
      3
    );
    vi.spyOn(agentConnectionController, "request").mockResolvedValue({
      sessionId: "session-new",
      items: [],
      truncated: false,
      total: 0
    } as never);
  });

  it("ignores a target Task's empty runtime.ready until its requested bootstrap arrives", async () => {
    const deferred = deferredBootstrapAcknowledgement();
    const transition = runSessionBootstrapTransition(
      useAppStore.getState,
      useAppStore.setState,
      {
        detail: "Forking",
        request: () => deferred.promise,
        onError: vi.fn()
      }
    );
    await Promise.resolve();

    expect(useAppStore.getState()).toMatchObject({
      sessionTransitionPending: true,
      sessionBootstrapTransitionPending: true
    });

    const initialSnapshot = snapshot("session-target-initial");
    const readyPayload = {
      capabilities: runtimeCapabilities(),
      snapshot: initialSnapshot,
      taskToolMode: "auto" as const
    };
    useAppStore.getState().receiveAgentEvent(
      { type: "runtime.ready", payload: readyPayload },
      eventEnvelope("runtime.ready", readyPayload, taskEventFixture({
        hostEpoch: 9,
        sequence: 1,
        sessionId: initialSnapshot.sessionId,
        sessionGeneration: 1
      }))
    );

    expect(useSessionProjectionStore.getState().authority.phase).toBe("inactive");
    expect(useAppStore.getState()).toMatchObject({
      sessionTransitionPending: true,
      sessionBootstrapTransitionPending: true
    });

    const targetSnapshot = snapshot("session-new");
    const bootstrapPayload = {
      snapshot: targetSnapshot,
      reason: "session-fork" as const
    };
    useAppStore.getState().receiveAgentEvent(
      { type: "session.bootstrap", payload: bootstrapPayload },
      eventEnvelope("session.bootstrap", bootstrapPayload, taskEventFixture({
        hostEpoch: 9,
        sequence: 2,
        sessionId: targetSnapshot.sessionId,
        sessionGeneration: 2
      }))
    );
    deferred.resolve(bootstrapAcknowledgement("session-new", 2));

    await expect(transition).resolves.toBe(true);
    expect(useAppStore.getState()).toMatchObject({
      sessionTransitionPending: false,
      sessionBootstrapTransitionPending: false
    });
    expect(useSessionProjectionStore.getState().authority).toMatchObject({
      phase: "active",
      sessionId: "session-new",
      sessionGeneration: 2
    });
  });
});

function deferredBootstrapAcknowledgement() {
  let resolve!: (value: ProjectionMutationAcknowledgement) => void;
  return {
    promise: new Promise<ProjectionMutationAcknowledgement>((done) => {
      resolve = done;
    }),
    resolve
  };
}

function bootstrapAcknowledgement(
  sessionId: string,
  sessionGeneration: number
): ProjectionMutationAcknowledgement {
  return {
    accepted: true,
    hostEpoch: 9,
    sessionId,
    sessionGeneration,
    eventSequence: 2
  };
}

function snapshot(sessionId: string): SessionSnapshot {
  return {
    sessionId,
    sessionPath: `/sessions/${sessionId}.jsonl`,
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

function runtimeCapabilities(): RuntimeCapabilities {
  return {
    sdkVersion: "0.81.1",
    supportsFollowUp: true,
    supportsSessionTree: true,
    extensionUi: {
      primitives: [],
      attribution: "none",
      recognizedCompatibilityLevels: [],
      adapterRegistry: {
        available: false,
        manifestSchemaVersions: [],
        supportedSurfaces: [],
        realtimeUiAttribution: false,
        activeAdapterCount: 0
      },
      limitations: {
        workingIndicator: "unsupported",
        editorMutation: "unsupported",
        customComponents: "tui-only",
        autocomplete: "tui-only",
        widgetPlacements: []
      }
    }
  };
}
