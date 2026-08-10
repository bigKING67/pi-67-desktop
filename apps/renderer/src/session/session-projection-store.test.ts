import type { SessionSnapshot } from "@pi67/domain";
import { eventEnvelope } from "@pi67/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { taskEventFixture } from "../connection/protocol-test-fixtures.js";
import {
  useSessionProjectionStore,
  type SessionProjectionAuthority
} from "./session-projection-store.js";
import { installSessionProjectionFixture } from "./session-projection-test-support.js";
import {
  selectSessionModels,
  selectActiveProposedPlan,
  selectInteractionMode,
  selectPlanLifecycle,
  selectSessionResources,
  selectSessionStats
} from "./session-projection-selectors.js";

const AUTHORITY: SessionProjectionAuthority = {
  hostEpoch: 9,
  sessionId: "session-1",
  sessionFileIdentity: "session-file-session-1",
  sessionGeneration: 3,
  projectionRevision: 1
};

const CONNECTION = { connected: true, hostEpoch: AUTHORITY.hostEpoch } as const;

describe("session projection store", () => {
  beforeEach(() => {
    useSessionProjectionStore.setState(useSessionProjectionStore.getInitialState(), true);
  });

  it("installs bounded Session groups under one authority", () => {
    expect(installSessionProjectionFixture(
      CONNECTION,
      snapshot("session-1"),
      AUTHORITY.sessionGeneration
    )).toEqual(AUTHORITY);

    expect(useSessionProjectionStore.getState()).toMatchObject({
      authority: { phase: "active", ...AUTHORITY },
      identity: {
        sessionPath: "/sessions/session-1.jsonl",
        sessionName: "Session session-1",
        cwd: "/workspace"
      },
      modelCatalog: {
        models: [{ provider: "openai", id: "gpt-5.6", label: "GPT-5.6", configured: true, reasoning: true }],
        providers: [{ id: "openai", label: "OpenAI", configured: true, modelCount: 1 }],
        availableThinkingLevels: ["off", "high"]
      },
      controls: {
        selectedModel: { provider: "openai", id: "gpt-5.6" },
        thinkingLevel: "high"
      },
      interaction: { interactionMode: "execute" },
      queue: { steeringQueue: ["steer"], followUpQueue: ["follow"] },
      resources: [{ kind: "skill", id: "testing", label: "Testing", status: "ready" }],
      usage: { tokens: 10, cost: 0.1, contextPercent: 5 }
    });
  });

  it("projects restored Plan state and clears a consumed plan on execute mode", () => {
    const proposedPlan = {
      planId: "plan-1",
      sourceOperationId: "operation-plan",
      markdown: "# Plan\n\n1. Inspect",
      createdAt: 67
    };
    installSessionProjectionFixture(CONNECTION, {
      ...snapshot("session-1"),
      interactionMode: "plan",
      activeProposedPlan: proposedPlan
    }, 3);

    expect(selectInteractionMode(useSessionProjectionStore.getState())).toBe("plan");
    expect(selectActiveProposedPlan(useSessionProjectionStore.getState())).toEqual(proposedPlan);

    expect(useSessionProjectionStore.getState().applyInteractionMode(AUTHORITY, "execute")).toBe(true);
    expect(selectInteractionMode(useSessionProjectionStore.getState())).toBe("execute");
    expect(selectActiveProposedPlan(useSessionProjectionStore.getState())).toBeUndefined();
  });

  it("keeps a requested Plan until started and applies lifecycle replays idempotently", () => {
    const proposedPlan = {
      planId: "plan-lifecycle",
      sourceOperationId: "operation-plan-source",
      markdown: "# Plan\n\n1. Inspect",
      createdAt: 67
    };
    installSessionProjectionFixture(CONNECTION, {
      ...snapshot("session-1"),
      interactionMode: "plan",
      activeProposedPlan: proposedPlan
    }, 3);
    const requested = planLifecycle("implementation-requested");

    expect(useSessionProjectionStore.getState().applyPlanLifecycle(AUTHORITY, requested)).toBe(true);
    expect(useSessionProjectionStore.getState().applyPlanLifecycle(AUTHORITY, requested)).toBe(true);
    expect(selectInteractionMode(useSessionProjectionStore.getState())).toBe("execute");
    expect(selectActiveProposedPlan(useSessionProjectionStore.getState())).toEqual(proposedPlan);
    expect(selectPlanLifecycle(useSessionProjectionStore.getState())).toEqual(requested);

    const started = planLifecycle("implementation-started");
    expect(useSessionProjectionStore.getState().applyPlanLifecycle(AUTHORITY, started)).toBe(true);
    expect(useSessionProjectionStore.getState().applyPlanLifecycle(AUTHORITY, started)).toBe(true);
    expect(selectActiveProposedPlan(useSessionProjectionStore.getState())).toBeUndefined();
    expect(selectPlanLifecycle(useSessionProjectionStore.getState())).toEqual(started);
  });

  it("restores a Plan after start failure and rejects stale or unrelated lifecycle changes", () => {
    const proposedPlan = {
      planId: "plan-lifecycle",
      sourceOperationId: "operation-plan-source",
      markdown: "# Plan\n\n1. Inspect",
      createdAt: 67
    };
    installSessionProjectionFixture(CONNECTION, {
      ...snapshot("session-1"),
      interactionMode: "plan",
      activeProposedPlan: proposedPlan
    }, 3);
    const requested = planLifecycle("implementation-requested");
    const failed = planLifecycle("implementation-start-failed");

    expect(useSessionProjectionStore.getState().applyPlanLifecycle(AUTHORITY, requested)).toBe(true);
    expect(useSessionProjectionStore.getState().applyPlanLifecycle({
      ...AUTHORITY,
      sessionGeneration: 4
    }, failed)).toBe(false);
    expect(useSessionProjectionStore.getState().applyPlanLifecycle(AUTHORITY, {
      ...failed,
      planId: "plan-unrelated"
    })).toBe(false);
    expect(useSessionProjectionStore.getState().applyPlanLifecycle(AUTHORITY, failed)).toBe(true);
    expect(selectInteractionMode(useSessionProjectionStore.getState())).toBe("plan");
    expect(selectActiveProposedPlan(useSessionProjectionStore.getState())).toEqual(proposedPlan);
    expect(selectPlanLifecycle(useSessionProjectionStore.getState())).toEqual(failed);
  });

  it("installs compatibility only with the exact Session snapshot authority", () => {
    const compatibility = {
      status: "future-format" as const,
      currentSupportedVersion: 3,
      sessionFormatVersion: 4,
      unknownEntryCount: 2,
      unrenderableMessageCount: 1,
      mutationSafe: false
    };

    installSessionProjectionFixture(CONNECTION, {
      ...snapshot("session-1"),
      compatibility
    }, 3);

    expect(useSessionProjectionStore.getState().compatibility).toEqual(compatibility);
    useSessionProjectionStore.getState().reset();
    expect(useSessionProjectionStore.getState().compatibility).toBeUndefined();
  });

  it("rejects proposed plans from stale Session authority", () => {
    installSessionProjectionFixture(CONNECTION, snapshot("session-1"), 3);
    const plan = {
      planId: "plan-stale",
      sourceOperationId: "operation-stale",
      markdown: "stale",
      createdAt: 68
    };

    expect(useSessionProjectionStore.getState().applyProposedPlan({
      ...AUTHORITY,
      sessionGeneration: 4
    }, plan)).toBe(false);
    expect(selectActiveProposedPlan(useSessionProjectionStore.getState())).toBeUndefined();
  });

  it("keeps canonical Session authority inactive until a snapshot installation commits", () => {
    const phases: string[] = [];
    const unsubscribe = useSessionProjectionStore.subscribe((state) => {
      phases.push(state.authority.phase);
    });

    const installation = useSessionProjectionStore.getState().beginSnapshotReplacement(
      CONNECTION,
      snapshot("session-1"),
      AUTHORITY.sessionGeneration
    );

    expect(installation).toMatchObject(AUTHORITY);
    expect(useSessionProjectionStore.getState()).toMatchObject({
      authority: { phase: "inactive", projectionRevision: 1 },
      identity: undefined,
      modelCatalog: undefined,
      controls: undefined
    });
    expect(useSessionProjectionStore.getState().currentAuthority(CONNECTION)).toBeUndefined();

    expect(useSessionProjectionStore.getState().commitSnapshotReplacement(
      CONNECTION,
      installation!,
      snapshot("session-1")
    )).toEqual(AUTHORITY);
    unsubscribe();

    expect(phases).toEqual(["inactive", "active"]);
  });

  it("does not commit or reset a snapshot installation superseded by a newer transaction", () => {
    const installation = useSessionProjectionStore.getState().beginSnapshotReplacement(
      CONNECTION,
      snapshot("session-1"),
      AUTHORITY.sessionGeneration
    );
    if (!installation) throw new Error("Expected a Session snapshot installation.");

    useSessionProjectionStore.getState().reset();

    expect(useSessionProjectionStore.getState().commitSnapshotReplacement(
      CONNECTION,
      installation,
      snapshot("session-1")
    )).toBeUndefined();
    expect(useSessionProjectionStore.getState().authority).toEqual({
      phase: "inactive",
      projectionRevision: 2
    });
  });

  it("rejects stale Host, Session, generation, and Renderer revisions", () => {
    installSessionProjectionFixture(CONNECTION, snapshot("session-1"), 3);

    for (const stale of [
      { ...AUTHORITY, hostEpoch: 10 },
      { ...AUTHORITY, sessionId: "session-2" },
      { ...AUTHORITY, sessionGeneration: 4 },
      { ...AUTHORITY, projectionRevision: 5 }
    ]) {
      expect(useSessionProjectionStore.getState().applyQueue(stale, {
        steeringQueue: ["stale"],
        followUpQueue: []
      })).toBe(false);
    }

    expect(useSessionProjectionStore.getState().queue).toEqual({
      steeringQueue: ["steer"],
      followUpQueue: ["follow"]
    });
  });

  it("does not install a new Session snapshot without authoritative generation metadata", () => {
    expect(installSessionProjectionFixture(
      CONNECTION,
      snapshot("session-1")
    )).toBeUndefined();
    expect(useSessionProjectionStore.getState().authority).toEqual({
      phase: "inactive",
      projectionRevision: 0
    });

    expect(useSessionProjectionStore.getState().acceptEvent(
      CONNECTION,
      eventEnvelope("usage.changed", { tokens: 1, cost: 0 }, taskEventFixture({
        hostEpoch: 9,
        sequence: 1,
        sessionId: "session-1",
        sessionGeneration: 3
      }))
    )).toBeUndefined();
  });

  it("reuses the generation only for a snapshot of the same active Host and Session", () => {
    installSessionProjectionFixture(CONNECTION, snapshot("session-1"), 3);
    expect(installSessionProjectionFixture(
      CONNECTION,
      { ...snapshot("session-1"), sessionName: "Updated" }
    )).toMatchObject({
      hostEpoch: 9,
      sessionId: "session-1",
      sessionGeneration: 3,
      projectionRevision: 2
    });
    expect(installSessionProjectionFixture(
      CONNECTION,
      snapshot("session-2")
    )).toBeUndefined();
    expect(installSessionProjectionFixture(
      { connected: true, hostEpoch: 10 },
      snapshot("session-1")
    )).toBeUndefined();
  });

  it("rejects mismatched events without changing active authority", () => {
    installSessionProjectionFixture(CONNECTION, snapshot("session-1"), 3);
    const exact = eventEnvelope("usage.changed", { tokens: 1, cost: 0 }, taskEventFixture({
      hostEpoch: 9,
      sequence: 1,
      sessionId: "session-1",
      sessionGeneration: 3
    }));

    expect(useSessionProjectionStore.getState().acceptEvent(CONNECTION, {
      ...exact,
      hostEpoch: 8
    })).toBeUndefined();
    expect(useSessionProjectionStore.getState().acceptEvent(CONNECTION, eventEnvelope(
      "usage.changed",
      { tokens: 1, cost: 0 },
      taskEventFixture({ hostEpoch: 9, sequence: 1, sessionId: "session-old", sessionGeneration: 3 })
    ))).toBeUndefined();
    expect(useSessionProjectionStore.getState().acceptEvent(CONNECTION, exact, "session-old")).toBeUndefined();
    expect(useSessionProjectionStore.getState().authority).toEqual({ phase: "active", ...AUTHORITY });
  });

  it("keeps newer queue and usage events when a delayed control snapshot returns", () => {
    const store = useSessionProjectionStore.getState();
    installSessionProjectionFixture(CONNECTION, snapshot("session-1"), 3);
    const target = store.capture(AUTHORITY);
    if (!target) throw new Error("Expected a Session projection target.");

    store.applyQueue(AUTHORITY, { steeringQueue: ["newer"], followUpQueue: [] });
    store.applyUsage(AUTHORITY, { tokens: 20, cost: 0.2, contextPercent: 10 });
    const delayed = {
      ...snapshot("session-1"),
      models: [{ provider: "anthropic", id: "claude", label: "Claude", configured: true, reasoning: true }],
      steeringQueue: ["old"],
      stats: { tokens: 1, cost: 0.01 }
    };

    expect(store.applySnapshot(target, delayed, ["modelCatalog", "queue", "usage"])).toBe(true);
    expect(useSessionProjectionStore.getState()).toMatchObject({
      modelCatalog: { models: delayed.models },
      queue: { steeringQueue: ["newer"], followUpQueue: [] },
      usage: { tokens: 20, cost: 0.2, contextPercent: 10 }
    });
  });

  it("installs only current resource-catalog groups from a delayed response", () => {
    installSessionProjectionFixture(CONNECTION, snapshot("session-1"), 3);
    const store = useSessionProjectionStore.getState();
    const target = store.capture(AUTHORITY);
    if (!target) throw new Error("Expected a Session projection target.");

    store.applyMeta(AUTHORITY, {
      sessionName: "Current",
      selectedModel: { provider: "openai", id: "gpt-current" },
      thinkingLevel: "high"
    });

    expect(store.applyResourceCatalogResult(target, {
      sessionId: "session-1",
      controls: {
        selectedModel: { provider: "anthropic", id: "claude-stale" },
        thinkingLevel: "off"
      },
      modelCatalog: {
        models: [{ provider: "anthropic", id: "claude", label: "Claude", configured: true, reasoning: true }],
        providers: [{ id: "anthropic", label: "Anthropic", configured: true, modelCount: 1 }],
        availableThinkingLevels: ["off", "high"]
      },
      resources: [{ kind: "extension", id: "new", label: "New", status: "ready" }]
    })).toBe(true);

    expect(useSessionProjectionStore.getState()).toMatchObject({
      controls: {
        selectedModel: { provider: "openai", id: "gpt-current" },
        thinkingLevel: "high"
      },
      modelCatalog: {
        models: [{ provider: "anthropic", id: "claude", label: "Claude", configured: true, reasoning: true }]
      },
      resources: [{ kind: "extension", id: "new", label: "New", status: "ready" }]
    });
    expect(store.applyResourceCatalogResult(target, {
      sessionId: "session-1",
      controls: { thinkingLevel: "off" },
      modelCatalog: { models: [], providers: [], availableThinkingLevels: [] },
      resources: []
    })).toBe(false);
  });

  it("keeps unrelated group references stable across usage changes", () => {
    installSessionProjectionFixture(CONNECTION, snapshot("session-1"), 3);
    const before = useSessionProjectionStore.getState();
    const models = selectSessionModels(before);
    const resources = selectSessionResources(before);
    const stats = selectSessionStats(before);

    useSessionProjectionStore.getState().applyUsage(AUTHORITY, { tokens: 30, cost: 0.3 });

    const after = useSessionProjectionStore.getState();
    expect(selectSessionModels(after)).toBe(models);
    expect(selectSessionResources(after)).toBe(resources);
    expect(selectSessionStats(after)).not.toBe(stats);
  });

  it("increments transition revisions across invalidation and rejects old targets", () => {
    installSessionProjectionFixture(CONNECTION, snapshot("session-1"), 3);
    const oldTarget = useSessionProjectionStore.getState().captureTransition(CONNECTION)!;

    useSessionProjectionStore.getState().reset({ preserveRecoverySessionIdentity: true });
    const nextTarget = useSessionProjectionStore.getState().captureTransition(CONNECTION)!;

    expect(nextTarget.projectionRevision).toBe(oldTarget.projectionRevision + 1);
    expect(useSessionProjectionStore.getState().acceptTransition(CONNECTION, oldTarget)).toBe(false);
    expect(useSessionProjectionStore.getState()).toMatchObject({
      authority: { phase: "inactive", projectionRevision: 2 },
      identity: undefined,
      modelCatalog: undefined,
      controls: undefined,
      queue: undefined,
      resources: undefined,
      usage: undefined,
      recoverySessionPath: "/sessions/session-1.jsonl"
    });
  });
});

function snapshot(sessionId: string): SessionSnapshot {
  return {
    sessionId,
    sessionFileIdentity: `session-file-${sessionId}`,
    sessionPath: `/sessions/${sessionId}.jsonl`,
    sessionName: `Session ${sessionId}`,
    cwd: "/workspace",
    streaming: false,
    messages: [],
    messagePage: { hasOlder: false, hasNewer: false },
    models: [{ provider: "openai", id: "gpt-5.6", label: "GPT-5.6", configured: true, reasoning: true }],
    providers: [{ id: "openai", label: "OpenAI", configured: true, modelCount: 1 }],
    selectedModel: { provider: "openai", id: "gpt-5.6" },
    thinkingLevel: "high",
    availableThinkingLevels: ["off", "high"],
    steeringQueue: ["steer"],
    followUpQueue: ["follow"],
    tree: { nodes: [], truncated: false, total: 0 },
    resources: [{ kind: "skill", id: "testing", label: "Testing", status: "ready" }],
    stats: { tokens: 10, cost: 0.1, contextPercent: 5 }
  };
}

function planLifecycle(
  phase: "implementation-requested" | "implementation-started" | "implementation-start-failed"
) {
  return {
    phase,
    planId: "plan-lifecycle",
    sourceOperationId: "operation-plan-source",
    submissionId: "submission-plan",
    operationId: "operation-plan",
    hostEpoch: AUTHORITY.hostEpoch,
    sessionId: AUTHORITY.sessionId,
    sessionFileIdentity: AUTHORITY.sessionFileIdentity,
    sessionGeneration: AUTHORITY.sessionGeneration,
    timestamp: 68
  };
}
