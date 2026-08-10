import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { SessionInteractionMode } from "@pi67/domain";
import { describe, expect, it, vi } from "vitest";
import {
  createDesktopPlanModeExtension,
  createPlanModeTools,
  type PlanModeToolController
} from "./plan-mode-tools.js";

type BeforeAgentStartHandler = () => {
  message: { customType: string; content: string; display: boolean };
} | undefined;

type ContextHandler = (event: { messages: unknown[] }) => { messages: unknown[] } | undefined;

describe("Plan Mode tools", () => {
  it("injects a decision-complete, evidence-grounded Plan quality contract only in Plan Mode", () => {
    let mode: SessionInteractionMode = "plan";
    const handlers = extensionHandlers(() => mode);

    const result = handlers.beforeAgentStart();
    const content = result?.message.content ?? "";
    expect(content).toContain("inspect the real files, configuration, Git state, and runtime evidence");
    expect(content).toContain("Resolve facts that the environment can answer instead of asking the user");
    expect(content).toContain("2-3 mutually exclusive choices");
    expect(content).toContain("If the user cancels, do not guess");
    expect(content).toContain("scope and non-goals, concrete files/modules/symbols");
    expect(content).toContain("Every material requirement must map to a concrete change");
    expect(content).toContain("observable acceptance evidence");
    expect(content).toContain("Do not edit files, install dependencies, run builds/tests");
    expect(content).toContain("Never begin implementation");

    mode = "execute";
    expect(handlers.beforeAgentStart()).toBeUndefined();
  });

  it("removes the hidden planning context after leaving Plan Mode", () => {
    let mode: SessionInteractionMode = "execute";
    const handlers = extensionHandlers(() => mode);
    const visible = { role: "user", content: "keep" };
    const hidden = { role: "custom", customType: "pi67.plan-mode-context.v1", content: "remove" };

    expect(handlers.context({ messages: [visible, hidden] })).toEqual({ messages: [visible] });
    mode = "plan";
    expect(handlers.context({ messages: [visible, hidden] })).toBeUndefined();
  });

  it("keeps plan_ask bounded to one material choice and preserves cancellation", async () => {
    const { controller } = controllerFixture();
    const [planAsk] = createPlanModeTools(controller);
    expect(planAsk?.parameters).toMatchObject({
      properties: { options: { minItems: 2, maxItems: 3 } }
    });
    const select = vi.fn().mockResolvedValue(undefined);

    await expect(planAsk?.execute(
      "ask-call",
      { question: "Choose the durable strategy", options: ["A - safer", "B - faster"] },
      undefined,
      undefined,
      { hasUI: true, ui: { select } } as never
    )).resolves.toMatchObject({
      content: [{ text: "The user cancelled the planning question. Do not infer an answer." }]
    });
    expect(select).toHaveBeenCalledWith(
      "Choose the durable strategy",
      ["A - safer", "B - faster"]
    );
  });

  it("rejects plan_ask outside Plan Mode and forwards a complete proposal without implementing", async () => {
    const { controller, proposePlan } = controllerFixture("execute");
    const [planAsk, planComplete] = createPlanModeTools(controller);

    await expect(planAsk?.execute(
      "ask-call",
      { question: "Blocked?", options: ["A", "B"] },
      undefined,
      undefined,
      { hasUI: true } as never
    )).rejects.toThrow("PLAN_MODE_REQUIRED");

    controller.interactionMode = "plan";
    await expect(planComplete?.execute(
      "plan-call",
      { markdown: "# Plan\n\n1. Change the contract\n2. Verify acceptance" },
      undefined,
      undefined,
      {} as never
    )).resolves.toMatchObject({
      content: [{ text: expect.stringContaining("Wait for the user's explicit decision") }]
    });
    expect(proposePlan).toHaveBeenCalledWith(
      "plan-call",
      "# Plan\n\n1. Change the contract\n2. Verify acceptance"
    );
  });
});

function controllerFixture(
  interactionMode: SessionInteractionMode = "plan"
): {
  controller: PlanModeToolController & { interactionMode: SessionInteractionMode };
  proposePlan: ReturnType<typeof vi.fn>;
} {
  const proposePlan = vi.fn((sourceOperationId: string, markdown: string) => ({
      planId: "plan-test",
      sourceOperationId,
      markdown,
      createdAt: 67
  }));
  return { controller: { interactionMode, proposePlan }, proposePlan };
}

function extensionHandlers(getMode: () => SessionInteractionMode): {
  beforeAgentStart: BeforeAgentStartHandler;
  context: ContextHandler;
} {
  let beforeAgentStart: BeforeAgentStartHandler | undefined;
  let context: ContextHandler | undefined;
  const extension = createDesktopPlanModeExtension(getMode);
  if (!("factory" in extension)) throw new Error("Expected the Plan Mode extension factory.");
  void extension.factory({
    on(event: string, handler: unknown) {
      if (event === "before_agent_start") beforeAgentStart = handler as BeforeAgentStartHandler;
      if (event === "context") context = handler as ContextHandler;
    }
  } as unknown as ExtensionAPI);
  if (!beforeAgentStart || !context) throw new Error("Expected Plan Mode extension handlers.");
  return { beforeAgentStart, context };
}
