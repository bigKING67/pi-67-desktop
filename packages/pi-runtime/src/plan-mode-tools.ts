import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { InlineExtension, ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  MAX_PLAN_MARKDOWN_CHARS,
  type ActiveProposedPlan,
  type SessionInteractionMode
} from "@pi67/domain";

const PLAN_MODE_CONTEXT_TYPE = "pi67.plan-mode-context.v1";

export interface PlanModeToolController {
  readonly interactionMode: SessionInteractionMode;
  proposePlan(sourceOperationId: string, markdown: string): ActiveProposedPlan;
}

export function createPlanModeTools(controller: PlanModeToolController): ToolDefinition[] {
  return [createPlanAskTool(controller), createPlanCompleteTool(controller)];
}

export function createDesktopPlanModeExtension(
  getInteractionMode: () => SessionInteractionMode
): InlineExtension {
  return {
    name: "pi67-native-plan-mode",
    hidden: true,
    factory: (pi) => {
      pi.on("before_agent_start", () => {
        if (getInteractionMode() !== "plan") return undefined;
        return {
          message: {
            customType: PLAN_MODE_CONTEXT_TYPE,
            content: `[PI-67 PLAN MODE ACTIVE]\nYou are preparing a decision-complete implementation plan, not implementing it.\n\nPlan contract:\n- Ground discoverable facts in live evidence: read applicable instructions and inspect the real files, configuration, Git state, and runtime evidence relevant to this task with read-only tools. Resolve facts that the environment can answer instead of asking the user.\n- Ask only for non-discoverable intent that materially changes implementation. Use plan_ask with 2-3 mutually exclusive choices, recommended choice first and its tradeoff in the label. If the user cancels, do not guess.\n- Specify scope and non-goals, concrete files/modules/symbols where discoverable, tests and acceptance, risks, and explicit assumptions. Address interfaces and types, data flow, dependency order, failure and recovery, and compatibility or migration where affected by this change. Keep detail proportional to the task, sufficient for another engineer to implement, without fixed headings.\n- Every material requirement must map to a concrete change and observable acceptance evidence. Before submission, resolve placeholders and remove vague steps, invented facts, and silent scope expansion.\n\nRules:\n- Use read-only tools only.\n- Do not edit files, install dependencies, run builds/tests, publish, upload, or cause external side effects.\n- When the plan is complete, call plan_complete with the full Markdown plan.\n- Never begin implementation until the user explicitly chooses Start implementation in Pi-67 Desktop.`,
            display: false
          }
        };
      });
      pi.on("context", (event) => {
        if (getInteractionMode() === "plan") return undefined;
        return {
          messages: event.messages.filter((message) => (
            (message as AgentMessage & { customType?: string }).customType !== PLAN_MODE_CONTEXT_TYPE
          ))
        };
      });
    }
  };
}

function createPlanAskTool(controller: PlanModeToolController): ToolDefinition {
  return {
    name: "plan_ask",
    label: "Ask a planning question",
    description: "Ask one materially blocking intent question that cannot be answered from the workspace or runtime. Use only in Plan Mode.",
    promptSnippet: "Ask one non-discoverable planning decision with a recommended choice.",
    promptGuidelines: [
      "Follow the active Plan contract for question scope, choices, and cancellation."
    ],
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["question"],
      properties: {
        question: { type: "string", minLength: 1, maxLength: 2_000 },
        options: {
          type: "array",
          items: { type: "string", minLength: 1, maxLength: 500 },
          minItems: 2,
          maxItems: 3
        },
        placeholder: { type: "string", maxLength: 500 }
      }
    } as ToolDefinition["parameters"],
    executionMode: "sequential",
    async execute(_toolCallId, rawInput, _signal, _onUpdate, ctx) {
      if (controller.interactionMode !== "plan") {
        throw new Error("PLAN_MODE_REQUIRED: plan_ask is available only in Plan Mode.");
      }
      if (!ctx.hasUI) throw new Error("PLAN_QUESTION_UI_UNAVAILABLE: Pi-67 cannot show the planning question.");
      const input = asRecord(rawInput);
      const question = requiredString(input.question, "question");
      const options = stringArray(input.options, 3);
      const answer = options.length > 0
        ? await ctx.ui.select(question, options)
        : await ctx.ui.input(question, optionalString(input.placeholder));
      return textToolResult(answer === undefined
        ? "The user cancelled the planning question. Do not infer an answer."
        : `User answer: ${answer}`);
    }
  };
}

function createPlanCompleteTool(controller: PlanModeToolController): ToolDefinition {
  return {
    name: "plan_complete",
    label: "Propose Plan",
    description: "Submit a decision-complete Markdown implementation Plan to the native Pi-67 review card. This never starts implementation.",
    promptSnippet: "Finish Plan Mode with a grounded, decision-complete Plan for explicit user review.",
    promptGuidelines: [
      "Call plan_complete once with the complete implementation Plan; do not implement it yourself.",
      "Submit the full Markdown after satisfying the active Plan contract; this tool proposes a Plan and never authorizes implementation."
    ],
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["markdown"],
      properties: {
        markdown: { type: "string", minLength: 1, maxLength: MAX_PLAN_MARKDOWN_CHARS }
      }
    } as ToolDefinition["parameters"],
    executionMode: "sequential",
    async execute(toolCallId, rawInput) {
      const plan = controller.proposePlan(toolCallId, requiredString(asRecord(rawInput).markdown, "markdown"));
      return textToolResult(`Plan proposed as ${plan.planId}. Wait for the user's explicit decision in Pi-67 Desktop; do not begin implementation.`);
    }
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requiredString(value: unknown, label: string): string {
  const result = optionalString(value);
  if (!result) throw new Error(`${label} must be a non-empty string.`);
  return result;
}

function stringArray(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .slice(0, maxItems)
    .map((item) => item.trim());
}

function textToolResult(text: string) {
  return { content: [{ type: "text" as const, text }], details: {} };
}
