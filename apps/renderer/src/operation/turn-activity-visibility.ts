import type { OperationView, RuntimePhase } from "@pi67/domain";
import {
  timelineMatchesOperation,
  type OperationActivityTimeline
} from "./operation-activity-timeline-store.js";

export function hasVisibleTurnActivity(
  runtimePhase: RuntimePhase,
  operation: OperationView | undefined,
  sessionId?: string,
  sessionGeneration?: number
): boolean {
  if (
    operation
    && sessionId !== undefined
    && sessionGeneration !== undefined
    && (operation.sessionId !== sessionId || operation.sessionGeneration !== sessionGeneration)
  ) return false;
  if (runtimePhase === "recovering") return true;
  return operation !== undefined && operation.lifecycle !== "completed";
}

export function hasVisibleOperationTimeline(
  timeline: OperationActivityTimeline | undefined,
  operation: OperationView | undefined,
  sessionId?: string,
  sessionGeneration?: number
): boolean {
  return timelineMatchesOperation(timeline, operation, sessionId, sessionGeneration)
    && timeline.steps.length > 0;
}
