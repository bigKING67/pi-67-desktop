import type {
  OperationActivity,
  OperationKind,
  OperationLifecycle,
  OperationView
} from "@pi67/domain";
import { create } from "zustand";

const MAX_TIMELINE_STEPS = 64;

type OperationTimelineStepStatus = "running" | "completed" | "failed" | "cancelled" | "lost";

export interface OperationTimelineStep {
  id: string;
  activity: OperationActivity | null | undefined;
  status: OperationTimelineStepStatus;
  startedAt: number;
  settledAt?: number | undefined;
  detail?: string | undefined;
}

export interface OperationActivityTimeline {
  operationId: string;
  operationKind: OperationKind;
  sessionId: string;
  sessionGeneration: number;
  lifecycle: OperationLifecycle;
  startedAt: number;
  settledAt?: number | undefined;
  nextStepSequence: number;
  steps: OperationTimelineStep[];
}

interface OperationActivityTimelineState {
  timeline: OperationActivityTimeline | undefined;
  begin: (operation: OperationView) => void;
  restoreFromProjection: (operation: OperationView, observedAt?: number) => void;
  recordActivity: (operationId: string, activity: OperationActivity | null, observedAt?: number) => void;
  updateProgress: (operationId: string, detail: string) => void;
  finish: (
    operationId: string,
    lifecycle: Extract<OperationLifecycle, "completed" | "failed" | "cancelled" | "lost">,
    detail: string | undefined,
    settledAt: number
  ) => void;
  reset: () => void;
}

export const useOperationActivityTimelineStore = create<OperationActivityTimelineState>((set) => ({
  timeline: undefined,

  begin(operation) {
    set({ timeline: createOperationActivityTimeline(operation) });
  },

  restoreFromProjection(operation, observedAt = Date.now()) {
    set({ timeline: createResynchronizedOperationActivityTimeline(operation, observedAt) });
  },

  recordActivity(operationId, activity, observedAt = Date.now()) {
    set((state) => ({
      timeline: state.timeline?.operationId === operationId
        ? recordOperationTimelineActivity(state.timeline, activity, observedAt)
        : state.timeline
    }));
  },

  updateProgress(operationId, detail) {
    set((state) => ({
      timeline: state.timeline?.operationId === operationId
        ? updateOperationTimelineProgress(state.timeline, detail)
        : state.timeline
    }));
  },

  finish(operationId, lifecycle, detail, settledAt) {
    set((state) => ({
      timeline: state.timeline?.operationId === operationId
        ? finishOperationActivityTimeline(state.timeline, lifecycle, detail, settledAt)
        : state.timeline
    }));
  },

  reset() {
    set({ timeline: undefined });
  }
}));

export function createOperationActivityTimeline(operation: OperationView): OperationActivityTimeline {
  const base: OperationActivityTimeline = {
    operationId: operation.operationId,
    operationKind: operation.kind,
    sessionId: operation.sessionId,
    sessionGeneration: operation.sessionGeneration,
    lifecycle: operation.lifecycle,
    startedAt: operation.startedAt,
    nextStepSequence: 1,
    steps: [{
      id: `${operation.operationId}:0`,
      activity: undefined,
      status: "running",
      startedAt: operation.startedAt
    }]
  };
  return operation.activity
    ? recordOperationTimelineActivity(base, operation.activity, operation.startedAt)
    : base;
}

export function createResynchronizedOperationActivityTimeline(
  operation: OperationView,
  observedAt: number
): OperationActivityTimeline {
  return {
    operationId: operation.operationId,
    operationKind: operation.kind,
    sessionId: operation.sessionId,
    sessionGeneration: operation.sessionGeneration,
    lifecycle: operation.lifecycle,
    startedAt: operation.startedAt,
    nextStepSequence: 1,
    steps: [{
      id: `${operation.operationId}:0`,
      activity: operation.activity,
      status: "running",
      startedAt: observedAt
    }]
  };
}

export function recordOperationTimelineActivity(
  timeline: OperationActivityTimeline,
  activity: OperationActivity | null,
  observedAt: number
): OperationActivityTimeline {
  const current = timeline.steps.at(-1);
  if (current?.status === "running" && sameTimelineActivity(current.activity, activity)) return timeline;

  const settledSteps = settleRunningStep(timeline.steps, "completed", undefined, observedAt);
  const nextStep: OperationTimelineStep = {
    id: `${timeline.operationId}:${timeline.nextStepSequence}`,
    activity,
    status: "running",
    startedAt: observedAt
  };
  return {
    ...timeline,
    lifecycle: activity?.kind === "approval" || activity?.kind === "extension-input"
      ? "waiting-input"
      : "running",
    nextStepSequence: timeline.nextStepSequence + 1,
    steps: [...settledSteps, nextStep].slice(-MAX_TIMELINE_STEPS)
  };
}

export function updateOperationTimelineProgress(
  timeline: OperationActivityTimeline,
  detail: string
): OperationActivityTimeline {
  const index = timeline.steps.length - 1;
  if (index < 0 || timeline.steps[index]?.detail === detail) return timeline;
  return {
    ...timeline,
    steps: timeline.steps.map((step, stepIndex) => stepIndex === index ? { ...step, detail } : step)
  };
}

export function finishOperationActivityTimeline(
  timeline: OperationActivityTimeline,
  lifecycle: Extract<OperationLifecycle, "completed" | "failed" | "cancelled" | "lost">,
  detail: string | undefined,
  settledAt: number
): OperationActivityTimeline {
  const stepStatus = lifecycle === "completed" ? "completed" : lifecycle;
  return {
    ...timeline,
    lifecycle,
    settledAt,
    steps: settleRunningStep(timeline.steps, stepStatus, detail, settledAt)
  };
}

export function timelineMatchesOperation(
  timeline: OperationActivityTimeline | undefined,
  operation: OperationView | undefined,
  sessionId: string | undefined,
  sessionGeneration: number | undefined
): timeline is OperationActivityTimeline {
  return Boolean(
    timeline
    && operation
    && sessionId !== undefined
    && sessionGeneration !== undefined
    && timeline.operationId === operation.operationId
    && timeline.sessionId === sessionId
    && timeline.sessionGeneration === sessionGeneration
  );
}

function settleRunningStep(
  steps: OperationTimelineStep[],
  status: OperationTimelineStepStatus,
  detail: string | undefined,
  settledAt: number
): OperationTimelineStep[] {
  const index = steps.length - 1;
  if (index < 0 || steps[index]?.status !== "running") return steps;
  return steps.map((step, stepIndex) => stepIndex === index ? {
    ...step,
    status,
    settledAt,
    ...(detail === undefined ? {} : { detail })
  } : step);
}

function sameTimelineActivity(
  left: OperationActivity | null | undefined,
  right: OperationActivity | null
): boolean {
  if (left === null || right === null) return left === right;
  if (left === undefined || left.kind !== right.kind) return false;
  if (left.kind === "tool" && right.kind === "tool") {
    return left.toolCallId === right.toolCallId && left.toolKind === right.toolKind;
  }
  if (left.kind === "approval" && right.kind === "approval") return left.requestId === right.requestId;
  if (left.kind === "extension-input" && right.kind === "extension-input") {
    return left.requestId === right.requestId;
  }
  return true;
}
