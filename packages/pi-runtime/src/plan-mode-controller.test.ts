import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { AgentEvent } from "@pi67/protocol";
import { describe, expect, it, vi } from "vitest";
import {
  INTERACTION_MODE_ENTRY_TYPE,
  PLAN_DECISION_ENTRY_TYPE,
  PLAN_IMPLEMENTATION_MESSAGE_TYPE,
  PROPOSED_PLAN_ENTRY_TYPE,
  PlanModeController
} from "./plan-mode-controller.js";

describe("PlanModeController", () => {
  it("persists mode and proposed Plan state on the active Pi branch", () => {
    const events: AgentEvent[] = [];
    const manager = SessionManager.inMemory("/workspace", { id: "plan-session" });
    const controller = new PlanModeController((event) => events.push(event));
    controller.bind(session(manager));

    controller.setInteractionMode("plan");
    const first = controller.proposePlan("tool-call-a", "# Plan\n\n1. Inspect\n2. Implement");
    const duplicate = controller.proposePlan("tool-call-b", "# Plan\n\n1. Inspect\n2. Implement");

    expect(duplicate).toEqual(first);
    expect(controller.snapshot()).toEqual({ interactionMode: "plan", activeProposedPlan: first });
    expect(manager.getBranch().filter((entry) => entry.type === "custom").map((entry) => entry.customType))
      .toEqual([INTERACTION_MODE_ENTRY_TYPE, PROPOSED_PLAN_ENTRY_TYPE]);
    expect(events.map((event) => event.type)).toEqual([
      "session.interactionModeChanged",
      "plan.proposed"
    ]);

    const restored = new PlanModeController(vi.fn());
    restored.bind(session(manager));
    expect(restored.snapshot()).toEqual(controller.snapshot());
  });

  it("implements only the active stored Plan and never accepts Renderer Markdown", async () => {
    const manager = SessionManager.inMemory("/workspace", { id: "plan-implementation" });
    const sendCustomMessage = vi.fn().mockResolvedValue(undefined);
    const controller = new PlanModeController(vi.fn());
    controller.bind(session(manager, sendCustomMessage));
    controller.setInteractionMode("plan");
    const plan = controller.proposePlan("tool-call", "# Approved Plan\n\n1. Change one file");

    await controller.implementPlan(plan.planId);

    expect(controller.snapshot()).toEqual({ interactionMode: "execute" });
    expect(sendCustomMessage).toHaveBeenCalledWith(expect.objectContaining({
      customType: PLAN_IMPLEMENTATION_MESSAGE_TYPE,
      display: false,
      content: expect.stringContaining(plan.markdown)
    }), { triggerTurn: true });
    expect(manager.getBranch().filter((entry) => entry.type === "custom").map((entry) => entry.customType))
      .toEqual([
        INTERACTION_MODE_ENTRY_TYPE,
        PROPOSED_PLAN_ENTRY_TYPE,
        PLAN_DECISION_ENTRY_TYPE,
        INTERACTION_MODE_ENTRY_TYPE
      ]);
    await expect(controller.implementPlan(plan.planId)).rejects.toThrow("no longer active");
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
