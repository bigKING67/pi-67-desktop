import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { PlanImplementationRequestLineage } from "@pi67/domain";
import type { AgentEvent } from "@pi67/protocol";
import { describe, expect, it, vi } from "vitest";
import {
  INTERACTION_MODE_ENTRY_TYPE,
  PLAN_DECISION_ENTRY_TYPE,
  PLAN_IMPLEMENTATION_ENTRY_TYPE,
  PLAN_IMPLEMENTATION_MESSAGE_TYPE,
  PROPOSED_PLAN_ENTRY_TYPE,
  PlanModeController
} from "./plan-mode-controller.js";

describe("PlanModeController", () => {
  it("uses the Plan tool-call lineage for replay-safe proposal identity", () => {
    const events: AgentEvent[] = [];
    const manager = SessionManager.inMemory("/workspace", { id: "plan-session" });
    const controller = new PlanModeController((event) => events.push(event));
    controller.bind(session(manager));

    controller.setInteractionMode("plan");
    const first = controller.proposePlan("tool-call-a", "# Plan\n\n1. Inspect\n2. Implement");
    const replay = controller.proposePlan("tool-call-a", "# Plan\n\n1. Inspect\n2. Implement");
    const distinct = controller.proposePlan("tool-call-b", "# Plan\n\n1. Inspect\n2. Implement");

    expect(replay).toEqual(first);
    expect(distinct.planId).not.toBe(first.planId);
    expect(controller.snapshot()).toEqual({ interactionMode: "plan", activeProposedPlan: distinct });
    expect(customEntryTypes(manager)).toEqual([
      INTERACTION_MODE_ENTRY_TYPE,
      PROPOSED_PLAN_ENTRY_TYPE,
      PROPOSED_PLAN_ENTRY_TYPE
    ]);
    expect(events.map((event) => event.type)).toEqual([
      "session.interactionModeChanged",
      "plan.proposed",
      "plan.proposed"
    ]);

    const restored = new PlanModeController(vi.fn());
    restored.bind(session(manager));
    expect(restored.snapshot()).toEqual(controller.snapshot());
  });

  it("consumes an active Plan only after the authoritative Pi agent_start", async () => {
    const manager = SessionManager.inMemory("/workspace", { id: "plan-implementation" });
    const run = deferred<void>();
    const sendCustomMessage = vi.fn(() => run.promise);
    const events: AgentEvent[] = [];
    const controller = new PlanModeController((event) => events.push(event));
    const boundSession = session(manager, sendCustomMessage);
    controller.bind(boundSession);
    controller.setInteractionMode("plan");
    const plan = controller.proposePlan("tool-call", "# Approved Plan\n\n1. Change one file");

    const implementing = controller.implementPlan(plan.planId, lineage(manager));

    expect(controller.snapshot()).toMatchObject({
      interactionMode: "execute",
      activeProposedPlan: plan,
      planLifecycle: {
        phase: "implementation-requested",
        operationId: "operation-implement"
      }
    });
    expect(customEntryTypes(manager)).not.toContain(PLAN_DECISION_ENTRY_TYPE);

    controller.observeSessionEvent(boundSession, { type: "agent_start" });
    expect(controller.snapshot()).toMatchObject({
      interactionMode: "execute",
      planLifecycle: {
        phase: "implementation-started",
        operationId: "operation-implement"
      }
    });
    expect(controller.snapshot().activeProposedPlan).toBeUndefined();
    run.resolve();
    await implementing;

    expect(sendCustomMessage).toHaveBeenCalledWith(expect.objectContaining({
      customType: PLAN_IMPLEMENTATION_MESSAGE_TYPE,
      display: false,
      content: expect.stringContaining(plan.markdown)
    }), { triggerTurn: true });
    expect(customEntryTypes(manager)).toEqual([
      INTERACTION_MODE_ENTRY_TYPE,
      PROPOSED_PLAN_ENTRY_TYPE,
      PLAN_IMPLEMENTATION_ENTRY_TYPE,
      INTERACTION_MODE_ENTRY_TYPE,
      PLAN_IMPLEMENTATION_ENTRY_TYPE,
      PLAN_DECISION_ENTRY_TYPE
    ]);
    expect(events.map((event) => event.type)).toContain("plan.lifecycleChanged");
    await expect(controller.implementPlan(plan.planId, lineage(manager, "operation-retry")))
      .rejects.toThrow("no longer active");
  });

  it("restores the Plan for a retry when startup fails before agent_start", async () => {
    const manager = SessionManager.inMemory("/workspace", { id: "plan-start-failed" });
    const controller = new PlanModeController(vi.fn());
    controller.bind(session(manager, vi.fn().mockRejectedValue(new Error("provider unavailable"))));
    controller.setInteractionMode("plan");
    const plan = controller.proposePlan("tool-call", "# Retryable Plan");

    await expect(controller.implementPlan(plan.planId, lineage(manager)))
      .rejects.toThrow("provider unavailable");

    expect(controller.snapshot()).toMatchObject({
      interactionMode: "plan",
      activeProposedPlan: plan,
      planLifecycle: {
        phase: "implementation-start-failed",
        operationId: "operation-implement"
      }
    });
    expect(customEntryTypes(manager)).not.toContain(PLAN_DECISION_ENTRY_TYPE);

    const restored = new PlanModeController(vi.fn());
    restored.bind(session(manager));
    expect(restored.snapshot()).toMatchObject({
      interactionMode: "plan",
      activeProposedPlan: plan,
      planLifecycle: { phase: "implementation-start-failed" }
    });
  });

  it("restores the Plan when Pi returns without emitting agent_start", async () => {
    const manager = SessionManager.inMemory("/workspace", { id: "plan-no-start" });
    const controller = new PlanModeController(vi.fn());
    controller.bind(session(manager));
    controller.setInteractionMode("plan");
    const plan = controller.proposePlan("tool-call", "# No Start Plan");

    await expect(controller.implementPlan(plan.planId, lineage(manager)))
      .rejects.toThrow("returned before the Plan implementation Turn started");

    expect(controller.snapshot()).toMatchObject({
      interactionMode: "plan",
      activeProposedPlan: plan,
      planLifecycle: { phase: "implementation-start-failed" }
    });
  });

  it("does not reactivate a Plan when the implementation fails after agent_start", async () => {
    const manager = SessionManager.inMemory("/workspace", { id: "plan-after-start" });
    const controller = new PlanModeController(vi.fn());
    let boundSession!: ReturnType<typeof session>;
    const sendCustomMessage = vi.fn(async () => {
      controller.observeSessionEvent(boundSession, { type: "agent_start" });
      throw new Error("turn failed");
    });
    boundSession = session(manager, sendCustomMessage);
    controller.bind(boundSession);
    controller.setInteractionMode("plan");
    const plan = controller.proposePlan("tool-call", "# Started Plan");

    await expect(controller.implementPlan(plan.planId, lineage(manager))).rejects.toThrow("turn failed");
    expect(controller.snapshot()).toMatchObject({
      interactionMode: "execute",
      planLifecycle: { phase: "implementation-started" }
    });
    expect(controller.snapshot().activeProposedPlan).toBeUndefined();
    expect(customEntryTypes(manager)).toContain(PLAN_DECISION_ENTRY_TYPE);
  });

  it("recovers a dangling requested attempt as a proposed Plan after Runtime rebind", async () => {
    const manager = SessionManager.inMemory("/workspace", { id: "plan-dangling" });
    const controller = new PlanModeController(vi.fn());
    controller.bind(session(manager, vi.fn(() => new Promise<void>(() => undefined))));
    controller.setInteractionMode("plan");
    const plan = controller.proposePlan("tool-call", "# Dangling Plan");

    void controller.implementPlan(plan.planId, lineage(manager));

    const restored = new PlanModeController(vi.fn());
    restored.bind(session(manager));
    expect(restored.snapshot()).toEqual({ interactionMode: "plan", activeProposedPlan: plan });
  });

  it("ignores unrelated agent_start events and rejects stale Session lineage", async () => {
    const manager = SessionManager.inMemory("/workspace", { id: "plan-authority" });
    const run = deferred<void>();
    const controller = new PlanModeController(vi.fn());
    const boundSession = session(manager, vi.fn(() => run.promise));
    controller.bind(boundSession);
    controller.setInteractionMode("plan");
    const plan = controller.proposePlan("tool-call", "# Authority Plan");

    controller.observeSessionEvent(boundSession, { type: "agent_start" });
    expect(controller.snapshot().activeProposedPlan).toEqual(plan);
    await expect(controller.implementPlan(plan.planId, {
      ...lineage(manager),
      sessionId: "stale-session"
    })).rejects.toThrow("stale Pi Session");

    const implementing = controller.implementPlan(plan.planId, lineage(manager));
    const unrelatedManager = SessionManager.inMemory("/workspace", { id: "unrelated-session" });
    controller.observeSessionEvent(session(unrelatedManager), { type: "agent_start" });
    expect(controller.snapshot().activeProposedPlan).toEqual(plan);

    controller.observeSessionEvent(boundSession, { type: "agent_start" });
    run.resolve();
    await implementing;
    expect(controller.snapshot().activeProposedPlan).toBeUndefined();
  });
});

function session(
  manager: SessionManager,
  sendCustomMessage = vi.fn().mockResolvedValue(undefined)
) {
  return {
    sessionId: manager.getSessionId(),
    sessionManager: manager,
    isStreaming: false,
    sendCustomMessage
  };
}

function lineage(
  manager: SessionManager,
  operationId = "operation-implement"
): PlanImplementationRequestLineage {
  return {
    submissionId: `submission-${operationId}`,
    operationId,
    hostEpoch: 7,
    sessionId: manager.getSessionId(),
    sessionFileIdentity: `session-file-${manager.getSessionId()}`,
    sessionGeneration: 3
  };
}

function customEntryTypes(manager: SessionManager): string[] {
  return manager.getBranch()
    .filter((entry) => entry.type === "custom")
    .map((entry) => entry.customType);
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}
