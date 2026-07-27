import type { OperationActivity, OperationView, RuntimeOperationActivity } from "@pi67/domain";
import type { AgentEvent } from "@pi67/protocol";

const MAX_INTERACTIVE_OVERLAYS = 512;

type InteractiveActivity = Extract<OperationActivity, { kind: "approval" | "extension-input" }>;

export interface OperationActivityTarget {
  view: OperationView;
}

/** Keeps Pi's base activity separate from Desktop-owned interactive waits. */
export class OperationActivityController {
  private base: RuntimeOperationActivity = null;
  private readonly overlays = new Map<string, InteractiveActivity>();
  private current: OperationActivity | null = null;

  constructor(private readonly emit: (event: AgentEvent) => void) {}

  updateBase(target: OperationActivityTarget | undefined, activity: RuntimeOperationActivity): boolean {
    if (!target) return false;
    this.base = activity;
    return this.reconcile(target);
  }

  beginInteractive(target: OperationActivityTarget | undefined, activity: InteractiveActivity): boolean {
    if (!target) return false;
    this.overlays.delete(activity.requestId);
    this.overlays.set(activity.requestId, activity);
    while (this.overlays.size > MAX_INTERACTIVE_OVERLAYS) {
      const oldest = this.overlays.keys().next().value;
      if (oldest === undefined) break;
      this.overlays.delete(oldest);
    }
    return this.reconcile(target);
  }

  completeInteractive(target: OperationActivityTarget | undefined, requestId: string): boolean {
    if (!target || !this.overlays.delete(requestId)) return false;
    return this.reconcile(target);
  }

  reset(): void {
    this.base = null;
    this.overlays.clear();
    this.current = null;
  }

  private reconcile(target: OperationActivityTarget): boolean {
    const activity = lastOverlay(this.overlays) ?? this.base;
    if (sameActivity(this.current, activity)) return false;
    this.current = activity;
    if (activity === null) {
      const { activity: _activity, ...view } = target.view;
      target.view = { ...view, lifecycle: "running" };
    } else {
      target.view = {
        ...target.view,
        lifecycle: isInteractiveActivity(activity) ? "waiting-input" : "running",
        activity
      };
    }
    this.emit({
      type: "operation.activityChanged",
      payload: { operationId: target.view.operationId, activity }
    });
    return true;
  }
}

function isInteractiveActivity(activity: OperationActivity): boolean {
  return activity.kind === "approval" || activity.kind === "extension-input";
}

function lastOverlay(overlays: ReadonlyMap<string, InteractiveActivity>): InteractiveActivity | undefined {
  let latest: InteractiveActivity | undefined;
  for (const activity of overlays.values()) latest = activity;
  return latest;
}

function sameActivity(left: OperationActivity | null, right: OperationActivity | null): boolean {
  if (left === null || right === null) return left === right;
  if (left.kind !== right.kind) return false;
  if (left.kind === "tool" && right.kind === "tool") {
    return left.toolCallId === right.toolCallId && left.toolKind === right.toolKind;
  }
  if (left.kind === "approval" && right.kind === "approval") return left.requestId === right.requestId;
  if (left.kind === "extension-input" && right.kind === "extension-input") {
    return left.requestId === right.requestId;
  }
  return true;
}
