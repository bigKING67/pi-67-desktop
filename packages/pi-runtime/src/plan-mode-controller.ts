import { createHash } from "node:crypto";
import type {
  AgentSession,
  AgentSessionEvent,
  SessionEntry,
  ToolDefinition
} from "@earendil-works/pi-coding-agent";
import {
  MAX_PLAN_MARKDOWN_CHARS,
  RuntimeError,
  parseActiveProposedPlan,
  parsePlanImplementation,
  type ActiveProposedPlan,
  type PlanDecision,
  type PlanImplementationRequestLineage,
  type PlanImplementationView,
  type PlanLifecycleChange,
  type SessionInteractionMode,
  type SessionInteractionState
} from "@pi67/domain";
import type { AgentEvent } from "@pi67/protocol";
import { createPlanModeTools } from "./plan-mode-tools.js";
export { createDesktopPlanModeExtension } from "./plan-mode-tools.js";

export const INTERACTION_MODE_ENTRY_TYPE = "pi67.interaction-mode.v1";
export const PROPOSED_PLAN_ENTRY_TYPE = "pi67.proposed-plan.v1";
export const PLAN_DECISION_ENTRY_TYPE = "pi67.plan-decision.v1";
export const PLAN_IMPLEMENTATION_ENTRY_TYPE = "pi67.plan-implementation.v1";
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

interface ActivePlanImplementationAttempt {
  implementation: PlanImplementationView;
  started: boolean;
}

export class PlanModeController {
  private session: PlanModeSession | undefined;
  private state: SessionInteractionState = { interactionMode: "execute" };
  private activeAttempt: ActivePlanImplementationAttempt | undefined;

  constructor(private readonly emit: (event: AgentEvent) => void) {}

  get interactionMode(): SessionInteractionMode {
    return this.state.interactionMode;
  }

  snapshot(): SessionInteractionState {
    return {
      interactionMode: this.state.interactionMode,
      ...(this.state.activeProposedPlan
        ? { activeProposedPlan: { ...this.state.activeProposedPlan } }
        : {}),
      ...(this.state.planLifecycle ? { planLifecycle: { ...this.state.planLifecycle } } : {})
    };
  }

  bind(session: PlanModeSession): void {
    this.session = session;
    this.activeAttempt = undefined;
    this.state = restorePlanModeState(session.sessionManager.getBranch());
  }

  unbind(): void {
    this.session = undefined;
    this.activeAttempt = undefined;
    this.state = { interactionMode: "execute" };
  }

  setInteractionMode(interactionMode: SessionInteractionMode): void {
    const session = this.requireIdleSession();
    if (interactionMode === this.state.interactionMode && (
      interactionMode === "plan" || this.state.activeProposedPlan === undefined
    )) return;

    if (interactionMode === "execute" && this.state.activeProposedPlan) {
      const planId = this.state.activeProposedPlan.planId;
      const decidedAt = appendPlanDecision(session, planId, "dismissed");
      const planLifecycle: PlanLifecycleChange = { phase: "dismissed", planId, timestamp: decidedAt };
      this.state = { interactionMode: "execute", planLifecycle };
      this.emit({ type: "plan.lifecycleChanged", payload: planLifecycle });
    } else {
      this.state = {
        interactionMode,
        ...(this.state.activeProposedPlan ? { activeProposedPlan: this.state.activeProposedPlan } : {}),
        ...(this.state.planLifecycle ? { planLifecycle: this.state.planLifecycle } : {})
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
    const boundedSourceOperationId = boundedIdentifier(sourceOperationId, "sourceOperationId");
    const planId = stablePlanId(session.sessionId, boundedSourceOperationId, normalized);
    const active = this.state.activeProposedPlan;
    if (active?.planId === planId && active.markdown === normalized) return { ...active };

    const plan: ActiveProposedPlan = {
      planId,
      sourceOperationId: boundedSourceOperationId,
      markdown: normalized,
      createdAt: Date.now()
    };
    session.sessionManager.appendCustomEntry(PROPOSED_PLAN_ENTRY_TYPE, plan);
    this.state = { interactionMode: "plan", activeProposedPlan: plan };
    this.emit({ type: "plan.proposed", payload: { plan } });
    return { ...plan };
  }

  async implementPlan(
    planId: string,
    lineage: PlanImplementationRequestLineage
  ): Promise<void> {
    const session = this.requireIdleSession();
    const plan = this.state.activeProposedPlan;
    if (!plan || plan.planId !== planId) {
      throw new RuntimeError("INVALID_PAYLOAD", "The proposed Plan is no longer active for this Pi Session.");
    }
    const implementation = requirePlanImplementation({
      ...lineage,
      planId,
      sourceOperationId: plan.sourceOperationId,
      phase: "requested",
      timestamp: Date.now()
    });
    if (implementation.sessionId !== session.sessionId) {
      throw new RuntimeError("SESSION_CHANGED_EXTERNALLY", "The Plan implementation belongs to a stale Pi Session.");
    }

    appendPlanImplementation(session, implementation);
    appendInteractionMode(session, "execute");
    const requested = lifecycleChange(implementation);
    const attempt: ActivePlanImplementationAttempt = { implementation, started: false };
    this.activeAttempt = attempt;
    this.state = {
      interactionMode: "execute",
      activeProposedPlan: plan,
      planLifecycle: requested
    };
    this.emit({ type: "plan.lifecycleChanged", payload: requested });
    this.emit({
      type: "session.interactionModeChanged",
      payload: { interactionMode: "execute" }
    });
    try {
      await session.sendCustomMessage({
        customType: PLAN_IMPLEMENTATION_MESSAGE_TYPE,
        content: implementationPrompt(plan.markdown),
        display: false,
        details: { planId: plan.planId, sourceOperationId: plan.sourceOperationId }
      }, { triggerTurn: true });
      if (!attempt.started) {
        throw new RuntimeError("INTERNAL", "Pi returned before the Plan implementation Turn started.");
      }
    } catch (error) {
      if (!attempt.started && this.activeAttempt === attempt && this.session === session) {
        this.failImplementationStart(session, plan, implementation);
      }
      throw error;
    } finally {
      if (this.activeAttempt === attempt) this.activeAttempt = undefined;
    }
  }

  observeSessionEvent(session: PlanModeSession, event: AgentSessionEvent): void {
    if (session !== this.session || event.type !== "agent_start") return;
    const attempt = this.activeAttempt;
    if (!attempt || attempt.started) return;
    const started = { ...attempt.implementation, phase: "started" as const, timestamp: Date.now() };
    appendPlanImplementation(session, started);
    attempt.started = true;
    this.state = {
      interactionMode: "execute",
      planLifecycle: lifecycleChange(started)
    };
    appendPlanDecision(session, started.planId, "implement");
    this.emit({ type: "plan.lifecycleChanged", payload: lifecycleChange(started) });
  }

  createTools(): ToolDefinition[] {
    return createPlanModeTools(this);
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

  private failImplementationStart(
    session: PlanModeSession,
    plan: ActiveProposedPlan,
    implementation: PlanImplementationView
  ): void {
    const failed = { ...implementation, phase: "start-failed" as const, timestamp: Date.now() };
    appendPlanImplementation(session, failed);
    appendInteractionMode(session, "plan");
    const planLifecycle = lifecycleChange(failed);
    this.state = { interactionMode: "plan", activeProposedPlan: plan, planLifecycle };
    this.emit({ type: "plan.lifecycleChanged", payload: planLifecycle });
    this.emit({
      type: "session.interactionModeChanged",
      payload: { interactionMode: "plan" }
    });
  }
}

function restorePlanModeState(entries: readonly SessionEntry[]): SessionInteractionState {
  let interactionMode: SessionInteractionMode = "execute";
  let activeProposedPlan: ActiveProposedPlan | undefined;
  let planLifecycle: PlanLifecycleChange | undefined;
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
      if (plan) {
        activeProposedPlan = plan;
        planLifecycle = undefined;
      }
      continue;
    }
    if (entry.customType === PLAN_IMPLEMENTATION_ENTRY_TYPE) {
      const implementation = parsePlanImplementation(entry.data);
      if (!implementation || implementation.planId !== activeProposedPlan?.planId) continue;
      planLifecycle = lifecycleChange(implementation);
      if (implementation.phase === "started") {
        activeProposedPlan = undefined;
        interactionMode = "execute";
      } else if (implementation.phase === "start-failed") {
        interactionMode = "plan";
      }
      continue;
    }
    if (entry.customType === PLAN_DECISION_ENTRY_TYPE) {
      const data = asRecord(entry.data);
      if (
        activeProposedPlan
        && data.planId === activeProposedPlan.planId
        && (data.decision === "dismissed" || data.decision === "implement")
      ) {
        if (data.decision === "dismissed") {
          planLifecycle = {
            phase: "dismissed",
            planId: activeProposedPlan.planId,
            timestamp: typeof data.decidedAt === "number" ? data.decidedAt : 0
          };
        }
        activeProposedPlan = undefined;
      }
    }
  }
  if (planLifecycle?.phase === "implementation-requested" && activeProposedPlan) {
    interactionMode = "plan";
    planLifecycle = undefined;
  }
  return {
    interactionMode,
    ...(activeProposedPlan ? { activeProposedPlan } : {}),
    ...(planLifecycle ? { planLifecycle } : {})
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
): number {
  const decidedAt = Date.now();
  const data: PlanDecisionEntryData = { planId, decision, decidedAt };
  session.sessionManager.appendCustomEntry(PLAN_DECISION_ENTRY_TYPE, data);
  return decidedAt;
}

function appendPlanImplementation(
  session: PlanModeSession,
  implementation: PlanImplementationView
): void {
  session.sessionManager.appendCustomEntry(PLAN_IMPLEMENTATION_ENTRY_TYPE, implementation);
}

function implementationPrompt(markdown: string): string {
  return `[PI-67 APPROVED PLAN]\nThe user explicitly chose to implement the stored Plan below in this same Pi Session. Re-check the live repository and runtime state before editing, preserve unrelated work in progress, implement the approved scope, and validate the result. If material drift makes the approved Plan unsafe or no longer decision-complete, report the drift instead of silently rewriting the Plan or broadening scope.\n\n${markdown}`;
}

function stablePlanId(sessionId: string, sourceOperationId: string, markdown: string): string {
  return `plan_${createHash("sha256")
    .update(sessionId)
    .update("\0")
    .update(sourceOperationId)
    .update("\0")
    .update(markdown)
    .digest("hex")
    .slice(0, 32)}`;
}

function requirePlanImplementation(value: PlanImplementationView): PlanImplementationView {
  const implementation = parsePlanImplementation(value);
  if (!implementation) {
    throw new RuntimeError("INVALID_PAYLOAD", "The Plan implementation lineage is invalid.");
  }
  return implementation;
}

function lifecycleChange(implementation: PlanImplementationView): PlanLifecycleChange {
  const phase = implementation.phase === "requested"
    ? "implementation-requested"
    : implementation.phase === "started"
      ? "implementation-started"
      : "implementation-start-failed";
  return { ...implementation, phase };
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
