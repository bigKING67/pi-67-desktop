import { MAX_SESSION_FILE_IDENTITY_CHARS } from "./projection-limits.js";

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

export interface PlanImplementationRequestLineage {
  submissionId: string;
  operationId: string;
  hostEpoch: number;
  sessionId: string;
  sessionFileIdentity: string;
  sessionGeneration: number;
}

export type PlanImplementationEntryPhase = "requested" | "started" | "start-failed";

export interface PlanImplementationView extends PlanImplementationRequestLineage {
  planId: string;
  sourceOperationId: string;
  phase: PlanImplementationEntryPhase;
  timestamp: number;
}

export type PlanLifecycleChange =
  | {
      phase: "dismissed";
      planId: string;
      timestamp: number;
    }
  | (Omit<PlanImplementationView, "phase"> & {
      phase: "implementation-requested" | "implementation-started" | "implementation-start-failed";
    });

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

export function parsePlanImplementation(value: unknown): PlanImplementationView | undefined {
  const implementation = recordValue(value);
  if (
    !boundedString(implementation.planId, 128)
    || !boundedString(implementation.sourceOperationId, 512)
    || !boundedString(implementation.submissionId, 512)
    || !boundedString(implementation.operationId, 512)
    || !positiveSafeInteger(implementation.hostEpoch)
    || !boundedString(implementation.sessionId, 512)
    || !boundedString(implementation.sessionFileIdentity, MAX_SESSION_FILE_IDENTITY_CHARS)
    || !nonNegativeSafeInteger(implementation.sessionGeneration)
    || (
      implementation.phase !== "requested"
      && implementation.phase !== "started"
      && implementation.phase !== "start-failed"
    )
    || !nonNegativeSafeInteger(implementation.timestamp)
  ) return undefined;
  return {
    planId: implementation.planId,
    sourceOperationId: implementation.sourceOperationId,
    submissionId: implementation.submissionId,
    operationId: implementation.operationId,
    hostEpoch: implementation.hostEpoch,
    sessionId: implementation.sessionId,
    sessionFileIdentity: implementation.sessionFileIdentity,
    sessionGeneration: implementation.sessionGeneration,
    phase: implementation.phase,
    timestamp: implementation.timestamp
  };
}

export interface SessionInteractionState {
  interactionMode: SessionInteractionMode;
  activeProposedPlan?: ActiveProposedPlan;
  planLifecycle?: PlanLifecycleChange;
}

function recordValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function boundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function positiveSafeInteger(value: unknown): value is number {
  return nonNegativeSafeInteger(value) && value > 0;
}
