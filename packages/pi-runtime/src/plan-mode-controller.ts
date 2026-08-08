import { createHash } from "node:crypto";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type {
  AgentSession,
  InlineExtension,
  SessionEntry,
  ToolDefinition
} from "@earendil-works/pi-coding-agent";
import {
  MAX_PLAN_MARKDOWN_CHARS,
  RuntimeError,
  parseActiveProposedPlan,
  type ActiveProposedPlan,
  type PlanDecision,
  type SessionInteractionMode,
  type SessionInteractionState
} from "@pi67/domain";
import type { AgentEvent } from "@pi67/protocol";

export const INTERACTION_MODE_ENTRY_TYPE = "pi67.interaction-mode.v1";
export const PROPOSED_PLAN_ENTRY_TYPE = "pi67.proposed-plan.v1";
export const PLAN_DECISION_ENTRY_TYPE = "pi67.plan-decision.v1";
const PLAN_MODE_CONTEXT_TYPE = "pi67.plan-mode-context.v1";
export const PLAN_IMPLEMENTATION_MESSAGE_TYPE = "pi67.plan-implementation.v1";

type PlanModeSession = Pick<
  AgentSession,
  "isStreaming" | "sendCustomMessage" | "sessionId" | "sessionManager"
>;

interface InteractionModeEntryData {
  interactionMode: SessionInteractionMode;
  changedAt: number;
}

interface PlanDecisionEntryData {
  planId: string;
  decision: PlanDecision;
  decidedAt: number;
}

export class PlanModeController {
  private session: PlanModeSession | undefined;
  private state: SessionInteractionState = { interactionMode: "execute" };

  constructor(private readonly emit: (event: AgentEvent) => void) {}

  get interactionMode(): SessionInteractionMode {
    return this.state.interactionMode;
  }

  snapshot(): SessionInteractionState {
    return {
      interactionMode: this.state.interactionMode,
      ...(this.state.activeProposedPlan
        ? { activeProposedPlan: { ...this.state.activeProposedPlan } }
        : {})
    };
  }

  bind(session: PlanModeSession): void {
    this.session = session;
    this.state = restorePlanModeState(session.sessionManager.getBranch());
  }

  unbind(): void {
    this.session = undefined;
    this.state = { interactionMode: "execute" };
  }

  setInteractionMode(interactionMode: SessionInteractionMode): void {
    const session = this.requireIdleSession();
    if (interactionMode === this.state.interactionMode && (
      interactionMode === "plan" || this.state.activeProposedPlan === undefined
    )) return;

    if (interactionMode === "execute" && this.state.activeProposedPlan) {
      appendPlanDecision(session, this.state.activeProposedPlan.planId, "dismissed");
      this.state = { interactionMode: "execute" };
    } else {
      this.state = {
        interactionMode,
        ...(this.state.activeProposedPlan ? { activeProposedPlan: this.state.activeProposedPlan } : {})
      };
    }
    appendInteractionMode(session, interactionMode);
    this.emit({ type: "session.interactionModeChanged", payload: { interactionMode } });
  }

  proposePlan(sourceOperationId: string, markdown: string): ActiveProposedPlan {
    const session = this.requireSession();
    if (this.state.interactionMode !== "plan") {
      throw new RuntimeError("INVALID_PAYLOAD", "plan_complete is available only while Plan Mode is active.");
    }
    const normalized = normalizePlanMarkdown(markdown);
    const planId = stablePlanId(session.sessionId, normalized);
    const active = this.state.activeProposedPlan;
    if (active?.planId === planId && active.markdown === normalized) return { ...active };

    const plan: ActiveProposedPlan = {
      planId,
      sourceOperationId: boundedIdentifier(sourceOperationId, "sourceOperationId"),
      markdown: normalized,
      createdAt: Date.now()
    };
    session.sessionManager.appendCustomEntry(PROPOSED_PLAN_ENTRY_TYPE, plan);
    this.state = { interactionMode: "plan", activeProposedPlan: plan };
    this.emit({ type: "plan.proposed", payload: { plan } });
    return { ...plan };
  }

  async implementPlan(planId: string): Promise<void> {
    const session = this.requireIdleSession();
    const plan = this.state.activeProposedPlan;
    if (!plan || plan.planId !== planId) {
      throw new RuntimeError("INVALID_PAYLOAD", "The proposed Plan is no longer active for this Pi Session.");
    }

    appendPlanDecision(session, planId, "implement");
    appendInteractionMode(session, "execute");
    this.state = { interactionMode: "execute" };
    this.emit({
      type: "session.interactionModeChanged",
      payload: { interactionMode: "execute" }
    });
    await session.sendCustomMessage({
      customType: PLAN_IMPLEMENTATION_MESSAGE_TYPE,
      content: implementationPrompt(plan.markdown),
      display: false,
      details: { planId: plan.planId, sourceOperationId: plan.sourceOperationId }
    }, { triggerTurn: true });
  }

  createTools(): ToolDefinition[] {
    return [createPlanAskTool(this), createPlanCompleteTool(this)];
  }

  private requireSession(): PlanModeSession {
    if (!this.session) throw new RuntimeError("RUNTIME_NOT_READY", "Pi Plan Mode is not bound to a Session.");
    return this.session;
  }

  private requireIdleSession(): PlanModeSession {
    const session = this.requireSession();
    if (session.isStreaming) {
      throw new RuntimeError("BUSY", "Plan Mode cannot change while the current Pi operation is running.", {
        details: { retryable: true }
      });
    }
    return session;
  }
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
            content: `[PI-67 PLAN MODE ACTIVE]\nYou are preparing a plan, not implementing it.\n\nRules:\n- Inspect and reason with read-only tools only.\n- Do not edit files, install dependencies, run builds/tests, publish, upload, or cause external side effects.\n- Use plan_ask when a missing decision materially changes the plan.\n- When the plan is complete, call plan_complete with the full Markdown plan.\n- Never begin implementation until the user explicitly chooses Start implementation in Pi-67 Desktop.`,
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

function restorePlanModeState(entries: readonly SessionEntry[]): SessionInteractionState {
  let interactionMode: SessionInteractionMode = "execute";
  let activeProposedPlan: ActiveProposedPlan | undefined;
  for (const entry of entries) {
    if (entry.type !== "custom") continue;
    if (entry.customType === INTERACTION_MODE_ENTRY_TYPE) {
      const data = asRecord(entry.data);
      if (data.interactionMode === "execute" || data.interactionMode === "plan") {
        interactionMode = data.interactionMode;
      }
      continue;
    }
    if (entry.customType === PROPOSED_PLAN_ENTRY_TYPE) {
      const plan = parseActiveProposedPlan(entry.data);
      if (plan) activeProposedPlan = plan;
      continue;
    }
    if (entry.customType === PLAN_DECISION_ENTRY_TYPE) {
      const data = asRecord(entry.data);
      if (
        activeProposedPlan
        && data.planId === activeProposedPlan.planId
        && (data.decision === "dismissed" || data.decision === "implement")
      ) activeProposedPlan = undefined;
    }
  }
  return {
    interactionMode,
    ...(activeProposedPlan ? { activeProposedPlan } : {})
  };
}

function createPlanAskTool(controller: PlanModeController): ToolDefinition {
  return {
    name: "plan_ask",
    label: "Ask a planning question",
    description: "Ask the user one blocking planning question through the native Pi-67 dialog. Use only in Plan Mode.",
    promptSnippet: "Ask one blocking question while preparing a Plan.",
    promptGuidelines: ["Use plan_ask only when the answer materially changes the proposed Plan."],
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["question"],
      properties: {
        question: { type: "string", minLength: 1, maxLength: 2_000 },
        options: { type: "array", items: { type: "string", minLength: 1, maxLength: 500 }, maxItems: 20 },
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
      const options = stringArray(input.options, 20);
      const answer = options.length > 0
        ? await ctx.ui.select(question, options)
        : await ctx.ui.input(question, optionalString(input.placeholder));
      return textToolResult(answer === undefined
        ? "The user cancelled the planning question. Do not infer an answer."
        : `User answer: ${answer}`);
    }
  };
}

function createPlanCompleteTool(controller: PlanModeController): ToolDefinition {
  return {
    name: "plan_complete",
    label: "Propose Plan",
    description: "Submit the completed Markdown Plan to the native Pi-67 Plan card. This never starts implementation.",
    promptSnippet: "Finish Plan Mode by proposing a Markdown Plan for explicit user review.",
    promptGuidelines: ["Call plan_complete once with the complete implementation Plan; do not implement it yourself."],
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

function appendInteractionMode(session: PlanModeSession, interactionMode: SessionInteractionMode): void {
  const data: InteractionModeEntryData = { interactionMode, changedAt: Date.now() };
  session.sessionManager.appendCustomEntry(INTERACTION_MODE_ENTRY_TYPE, data);
}

function appendPlanDecision(
  session: PlanModeSession,
  planId: string,
  decision: PlanDecisionEntryData["decision"]
): void {
  const data: PlanDecisionEntryData = { planId, decision, decidedAt: Date.now() };
  session.sessionManager.appendCustomEntry(PLAN_DECISION_ENTRY_TYPE, data);
}

function implementationPrompt(markdown: string): string {
  return `[PI-67 APPROVED PLAN]\nThe user explicitly chose to start implementation of the stored Plan below. Implement it in this same Pi Session. Re-check live repository state before editing, preserve unrelated work, and validate the completed change.\n\n${markdown}`;
}

function stablePlanId(sessionId: string, markdown: string): string {
  return `plan_${createHash("sha256").update(sessionId).update("\0").update(markdown).digest("hex").slice(0, 32)}`;
}

function normalizePlanMarkdown(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new RuntimeError("INVALID_PAYLOAD", "The proposed Plan cannot be empty.");
  if (normalized.length > MAX_PLAN_MARKDOWN_CHARS) {
    throw new RuntimeError("INVALID_PAYLOAD", "The proposed Plan exceeds the Pi-67 size limit.");
  }
  return normalized;
}

function boundedIdentifier(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 512) {
    throw new RuntimeError("INVALID_PAYLOAD", `${label} is invalid.`);
  }
  return normalized;
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
