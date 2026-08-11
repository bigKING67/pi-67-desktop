import type {
  OperationActivity,
  OperationKind,
  OperationLifecycle,
  OperationView,
  ToolExecutionStatus,
  ToolExecutionView
} from "@pi67/domain";
import { create } from "zustand";

const MAX_TIMELINE_STEPS = 64;

type OperationTimelineStepStatus = ToolExecutionStatus;

export interface OperationTimelineStep {
  id: string;
  activity: OperationActivity | null | undefined;
  status: OperationTimelineStepStatus;
  startedAt: number;
  settledAt?: number | undefined;
  detail?: string | undefined;
  toolExecution?: ToolExecutionView | undefined;
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
  recordToolExecution: (operationId: string, execution: ToolExecutionView) => void;
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

  recordToolExecution(operationId, execution) {
    set((state) => ({
      timeline: state.timeline?.operationId === operationId
        ? recordOperationTimelineToolExecution(state.timeline, execution)
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
  const activityTimeline = operation.activity
    ? recordOperationTimelineActivity(base, operation.activity, operation.startedAt)
    : base;
  return (operation.toolExecutions ?? []).reduce(
    recordOperationTimelineToolExecution,
    activityTimeline
  );
}

export function createResynchronizedOperationActivityTimeline(
  operation: OperationView,
  observedAt: number
): OperationActivityTimeline {
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
      activity: operation.activity,
      status: "running",
      startedAt: observedAt
    }]
  };
  return (operation.toolExecutions ?? []).reduce(
    recordOperationTimelineToolExecution,
    base
  );
}

export function recordOperationTimelineToolExecution(
  timeline: OperationActivityTimeline,
  execution: ToolExecutionView
): OperationActivityTimeline {
  const activity = toolExecutionActivity(execution);
  const index = timeline.steps.findIndex((step) => (
    step.activity?.kind === "tool" && step.activity.toolCallId === execution.toolCallId
  ));
  const current = index < 0 ? undefined : timeline.steps[index];
  const step: OperationTimelineStep = {
    id: current?.id ?? `${timeline.operationId}:${timeline.nextStepSequence}`,
    activity,
    toolExecution: execution,
    status: execution.status,
    startedAt: execution.startedAt ?? current?.startedAt ?? timeline.startedAt,
    settledAt: execution.completedAt,
    detail: toolExecutionDetail(execution)
  };
  if (index >= 0) {
    return {
      ...timeline,
      steps: timeline.steps.map((candidate, stepIndex) => stepIndex === index ? step : candidate)
    };
  }
  return {
    ...timeline,
    nextStepSequence: timeline.nextStepSequence + 1,
    steps: [...timeline.steps, step].slice(-MAX_TIMELINE_STEPS)
  };
}

export function recordOperationTimelineActivity(
  timeline: OperationActivityTimeline,
  activity: OperationActivity | null,
  observedAt: number
): OperationActivityTimeline {
  const current = timeline.steps.at(-1);
  if (activity?.kind === "tool" && activity.status !== "running") {
    return settleToolTimelineStep(timeline, activity, observedAt);
  }
  if (
    activity?.kind === "tool"
    && activity.status === "running"
    && current?.status === "running"
    && current.activity?.kind === "tool"
    && current.activity.toolCallId === activity.toolCallId
  ) {
    if (sameTimelineActivity(current.activity, activity)) return timeline;
    return {
      ...timeline,
      steps: timeline.steps.map((step) => step === current ? {
        ...step,
        activity,
        detail: toolActivityDetail(activity)
      } : step)
    };
  }
  if (
    activity === null
    && current?.activity?.kind === "tool"
    && current.activity.status !== "running"
  ) return timeline;
  if (current?.status === "running" && sameTimelineActivity(current.activity, activity)) return timeline;

  const settledSteps = settleRunningStep(timeline.steps, "completed", undefined, observedAt);
  const nextStep: OperationTimelineStep = {
    id: `${timeline.operationId}:${timeline.nextStepSequence}`,
      activity,
      status: "running",
      startedAt: observedAt,
      ...(activity?.kind === "tool" ? { detail: toolActivityDetail(activity) } : {})
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

function settleToolTimelineStep(
  timeline: OperationActivityTimeline,
  activity: Extract<OperationActivity, { kind: "tool" }>,
  observedAt: number
): OperationActivityTimeline {
  const index = timeline.steps.findLastIndex((step) => (
    step.status === "running"
    && step.activity?.kind === "tool"
    && step.activity.toolCallId === activity.toolCallId
  ));
  if (index < 0) {
    return {
      ...timeline,
      nextStepSequence: timeline.nextStepSequence + 1,
      steps: [...timeline.steps, {
        id: `${timeline.operationId}:${timeline.nextStepSequence}`,
        activity,
        status: activity.status,
        startedAt: observedAt,
        settledAt: observedAt,
        detail: toolActivityDetail(activity)
      }].slice(-MAX_TIMELINE_STEPS)
    };
  }
  return {
    ...timeline,
    steps: timeline.steps.map((step, stepIndex) => stepIndex === index ? {
      ...step,
      activity,
      status: activity.status,
      settledAt: observedAt,
      detail: toolActivityDetail(activity)
    } : step)
  };
}

function toolActivityDetail(activity: Extract<OperationActivity, { kind: "tool" }>): string {
  const result = toolStatusDetail(activity.status);
  return [
    activity.authorization === undefined
      ? undefined
      : activity.authorization.reason === "configured-source"
        ? "AUTO · 已配置来源"
        : activity.authorization.reason === "read-only"
          ? "AUTO · 只读"
          : activity.authorization.reason === "workspace-command"
            ? "AUTO · 工作区命令"
            : "AUTO · Workspace 内写入",
    activity.aliasTarget === undefined ? undefined : `已兼容转发到 ${activity.aliasTarget}`,
    result
  ].filter((value): value is string => value !== undefined).join(" · ");
}

function toolExecutionActivity(execution: ToolExecutionView): Extract<OperationActivity, { kind: "tool" }> {
  return {
    kind: "tool",
    toolCallId: execution.toolCallId,
    toolName: execution.toolName,
    toolKind: execution.toolKind,
    status: execution.status,
    ...(execution.aliasTarget === undefined ? {} : { aliasTarget: execution.aliasTarget }),
    ...(execution.authorization === undefined ? {} : { authorization: execution.authorization })
  };
}

function toolExecutionDetail(execution: ToolExecutionView): string {
  return toolActivityDetail(toolExecutionActivity(execution));
}

function toolStatusDetail(status: ToolExecutionStatus): string {
  switch (status) {
    case "pending": return "等待执行";
    case "running": return "执行中";
    case "completed": return "执行成功";
    case "failed": return "执行失败";
    case "interrupted": return "执行被中断";
    case "cancelled": return "执行已取消";
    case "lost": return "执行状态丢失";
    case "unreconciled": return "结果未核对";
  }
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
    return left.toolCallId === right.toolCallId
      && left.toolName === right.toolName
      && left.toolKind === right.toolKind
      && left.status === right.status
      && left.aliasTarget === right.aliasTarget
      && left.authorization?.mode === right.authorization?.mode
      && left.authorization?.reason === right.authorization?.reason;
  }
  if (left.kind === "approval" && right.kind === "approval") return left.requestId === right.requestId;
  if (left.kind === "extension-input" && right.kind === "extension-input") {
    return left.requestId === right.requestId;
  }
  return true;
}
