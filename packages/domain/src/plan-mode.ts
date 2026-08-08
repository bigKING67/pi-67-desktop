export type SessionInteractionMode = "execute" | "plan";

export const MAX_PLAN_MARKDOWN_CHARS = 200_000;

export interface ActiveProposedPlan {
  planId: string;
  sourceOperationId: string;
  markdown: string;
  createdAt: number;
}

export type PlanProposalStatus = "proposed" | "implemented" | "dismissed";

export interface PlanProposalTimelineView extends ActiveProposedPlan {
  entryId: string;
  status: PlanProposalStatus;
}

export interface PlanProposalPart {
  type: "plan-proposal";
  plan: PlanProposalTimelineView;
}

export type PlanDecision = "dismissed" | "implement";

export function parseActiveProposedPlan(value: unknown): ActiveProposedPlan | undefined {
  const plan = recordValue(value);
  if (
    typeof plan.planId !== "string"
    || plan.planId.length === 0
    || plan.planId.length > 128
    || typeof plan.sourceOperationId !== "string"
    || plan.sourceOperationId.length === 0
    || plan.sourceOperationId.length > 512
    || typeof plan.markdown !== "string"
    || plan.markdown.trim().length === 0
    || plan.markdown.length > MAX_PLAN_MARKDOWN_CHARS
    || typeof plan.createdAt !== "number"
    || !Number.isSafeInteger(plan.createdAt)
    || plan.createdAt < 0
  ) return undefined;
  return {
    planId: plan.planId,
    sourceOperationId: plan.sourceOperationId,
    markdown: plan.markdown,
    createdAt: plan.createdAt
  };
}

export function parsePlanDecision(value: unknown): {
  planId: string;
  decision: PlanDecision;
  decidedAt: number;
} | undefined {
  const decision = recordValue(value);
  if (
    typeof decision.planId !== "string"
    || decision.planId.length === 0
    || decision.planId.length > 128
    || (decision.decision !== "dismissed" && decision.decision !== "implement")
    || typeof decision.decidedAt !== "number"
    || !Number.isSafeInteger(decision.decidedAt)
    || decision.decidedAt < 0
  ) return undefined;
  return {
    planId: decision.planId,
    decision: decision.decision,
    decidedAt: decision.decidedAt
  };
}

export interface SessionInteractionState {
  interactionMode: SessionInteractionMode;
  activeProposedPlan?: ActiveProposedPlan;
}

function recordValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}
