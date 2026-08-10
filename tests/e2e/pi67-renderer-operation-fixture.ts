import type { FixtureAgentState, FixtureWindow } from "./pi67-renderer-fixture-types.js";

export type MockOperationViewFactory = (
  operationId: string,
  kind: string,
  lifecycle: string,
  state: FixtureAgentState
) => Record<string, unknown>;

export type MockProjectionAcknowledgementFactory = (
  state: FixtureAgentState,
  hostEpoch: number
) => Record<string, unknown>;

export type MockPlanImplementationLifecycleScheduler = (
  state: FixtureAgentState,
  hostEpoch: number,
  payload: Record<string, unknown> | undefined,
  operationId: string,
  startDelayMs: number,
  emit: (event: { type: string; payload: unknown }, operationId?: string) => void
) => void;

export function installMockOperationFactories(): void {
  const testWindow = window as FixtureWindow & {
    __pi67MockOperationView?: MockOperationViewFactory;
    __pi67MockProjectionAcknowledgement?: MockProjectionAcknowledgementFactory;
    __pi67ScheduleMockPlanImplementationLifecycle?: MockPlanImplementationLifecycleScheduler;
  };
  testWindow.__pi67MockOperationView = (operationId, kind, lifecycle, state) => ({
    operationId,
    kind,
    lifecycle,
    cancellable: kind === "prompt" || kind === "compaction",
    sessionId: String(state.snapshot.sessionId),
    sessionFileIdentity: String(state.snapshot.sessionFileIdentity),
    sessionGeneration: state.sessionGeneration,
    startedAt: Date.now()
  });
  testWindow.__pi67MockProjectionAcknowledgement = (state, hostEpoch) => ({
    accepted: true,
    hostEpoch,
    sessionId: String(state.snapshot.sessionId),
    sessionFileIdentity: String(state.snapshot.sessionFileIdentity),
    sessionGeneration: state.sessionGeneration,
    eventSequence: state.sequence
  });
  testWindow.__pi67ScheduleMockPlanImplementationLifecycle = (
    state,
    hostEpoch,
    payload,
    operationId,
    startDelayMs,
    emit
  ) => {
    const activePlan = state.snapshot.activeProposedPlan as Record<string, unknown> | undefined;
    const payloadPlanId = payload?.planId;
    const payloadSubmissionId = payload?.submissionId;
    const lineage = {
      planId: typeof payloadPlanId === "string"
        ? payloadPlanId
        : typeof activePlan?.planId === "string" ? activePlan.planId : "plan-fixture",
      sourceOperationId: typeof activePlan?.sourceOperationId === "string"
        ? activePlan.sourceOperationId
        : "operation-plan-source",
      submissionId: typeof payloadSubmissionId === "string" ? payloadSubmissionId : "submission-plan",
      operationId,
      hostEpoch,
      sessionId: String(state.snapshot.sessionId),
      sessionFileIdentity: String(state.snapshot.sessionFileIdentity),
      sessionGeneration: state.sessionGeneration,
      timestamp: Date.now()
    };
    const requested = { ...lineage, phase: "implementation-requested" };
    state.snapshot = { ...state.snapshot, interactionMode: "execute", planLifecycle: requested };
    emit({ type: "plan.lifecycleChanged", payload: requested }, operationId);
    emit({
      type: "session.interactionModeChanged",
      payload: { interactionMode: "execute" }
    });
    setTimeout(() => {
      const started = { ...lineage, phase: "implementation-started", timestamp: Date.now() };
      const snapshot: Record<string, unknown> = {
        ...state.snapshot,
        interactionMode: "execute",
        planLifecycle: started
      };
      delete snapshot.activeProposedPlan;
      state.snapshot = snapshot;
      emit({ type: "plan.lifecycleChanged", payload: started }, operationId);
    }, startDelayMs);
  };
}
