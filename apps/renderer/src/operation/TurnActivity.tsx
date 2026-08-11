import type {
  OperationActivity,
  OperationFreshnessPhase,
  OperationKind,
  OperationLifecycle,
  OperationView
} from "@pi67/domain";
import {
  Check,
  ChevronRight,
  CircleAlert,
  CircleDashed,
  CircleX,
  RefreshCw,
  Square,
  Wrench
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAppStore } from "../app/app-store.js";
import { messages } from "../localization/message-catalog.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import {
  selectSessionGeneration,
  selectSessionId
} from "../session/session-projection-selectors.js";
import {
  timelineMatchesOperation,
  type OperationActivityTimeline,
  type OperationTimelineStep,
  useOperationActivityTimelineStore
} from "./operation-activity-timeline-store.js";
import { useOperationFreshnessStore } from "./operation-freshness-store.js";
import {
  hasVisibleOperationTimeline,
  hasVisibleTurnActivity
} from "./turn-activity-visibility.js";
import styles from "./TurnActivity.module.css";

const MAX_VISIBLE_LIVE_STEPS = 4;

export { isActiveOperationLifecycle } from "./operation-lifecycle.js";

export function TurnActivity() {
  const runtime = useAppStore((state) => state.runtime);
  const operation = useAppStore((state) => state.operation);
  const sessionId = useSessionProjectionStore(selectSessionId);
  const sessionGeneration = useSessionProjectionStore(selectSessionGeneration);
  const freshnessPhase = useOperationFreshnessStore((state) => state.freshness?.phase);
  const detail = useAppStore((state) => state.operationDetail);
  const progress = useAppStore((state) => state.operationProgress);
  const timeline = useOperationActivityTimelineStore((state) => state.timeline);
  const matchingTimeline = timelineMatchesOperation(timeline, operation, sessionId, sessionGeneration)
    ? timeline
    : undefined;

  if (
    !hasVisibleTurnActivity(runtime.phase, operation, sessionId, sessionGeneration)
    && !hasVisibleOperationTimeline(matchingTimeline, operation, sessionId, sessionGeneration)
  ) return null;
  if (runtime.phase === "recovering") {
    return (
      <div
        aria-live="polite"
        className={`${styles.activity} ${styles.recovering}`}
        data-turn-activity="true"
        role="status"
      >
        <RefreshCw aria-hidden="true" className={styles.spinning} size={14} />
        <span className={styles.copy}><strong>{runtime.detail}</strong></span>
      </div>
    );
  }
  if (!operation) return null;
  if (matchingTimeline) {
    return (
      <OperationTimeline
        detail={detail}
        freshness={freshnessPhase}
        operation={operation}
        progress={progress}
        timeline={matchingTimeline}
      />
    );
  }

  const presentation = operationPresentation(
    operation.kind,
    operation.lifecycle,
    operation.activity,
    freshnessPhase,
    detail
  );
  const lifecycleClass = styles[operation.lifecycle];
  const freshnessClass = freshnessPhase ? styles[freshnessPhase] : undefined;
  const className = [styles.activity, lifecycleClass, freshnessClass].filter(Boolean).join(" ");

  return (
    <div
      aria-live="polite"
      className={className}
      data-operation-freshness={freshnessPhase}
      data-operation-lifecycle={operation.lifecycle}
      data-turn-activity="true"
      role="status"
    >
      <span className={styles.icon}>{presentation.icon}</span>
      <span className={styles.copy}>
        <strong>{presentation.label}</strong>
        {progress || presentation.detail ? <small>{progress ?? presentation.detail}</small> : null}
      </span>
    </div>
  );
}

export function operationPresentation(
  kind: OperationKind,
  lifecycle: OperationLifecycle,
  activity: OperationActivity | undefined,
  freshness: OperationFreshnessPhase | undefined,
  detail: string | undefined
): { icon: ReactNode; label: string; detail?: string } {
  if (lifecycle === "failed") return { icon: <CircleX aria-hidden="true" size={14} />, label: messages.operation.failed, ...(detail ? { detail } : {}) };
  if (lifecycle === "cancelled") return { icon: <Square aria-hidden="true" size={12} />, label: messages.operation.cancelled, ...(detail ? { detail } : {}) };
  if (lifecycle === "lost") return { icon: <CircleAlert aria-hidden="true" size={14} />, label: messages.operation.lost, ...(detail ? { detail } : {}) };
  if (freshness === "recovering") return { icon: <RefreshCw aria-hidden="true" className={styles.spinning} size={14} />, label: messages.operation.recovering, detail: messages.operation.recoveringDetail };
  if (freshness === "stalled") return { icon: <RefreshCw aria-hidden="true" className={styles.spinning} size={14} />, label: messages.operation.stalled, detail: messages.operation.stalledDetail };
  if (freshness === "quiet") return { icon: <CircleAlert aria-hidden="true" size={14} />, label: messages.operation.quiet, detail: messages.operation.quietDetail };
  if (activity?.kind === "approval") return { icon: <CircleAlert aria-hidden="true" size={14} />, label: messages.operation.needsApproval };
  if (activity?.kind === "extension-input") return { icon: <CircleAlert aria-hidden="true" size={14} />, label: messages.operation.waitingInput };
  if (activity?.kind === "compaction") return { icon: <RefreshCw aria-hidden="true" className={styles.spinning} size={14} />, label: messages.operation.compacting };
  if (activity?.kind === "tool") {
    return {
      icon: <Wrench aria-hidden="true" size={14} />,
      label: activity.toolKind === "subagent"
        ? delegatedToolStatusLabel(activity.status)
        : activity.status === "running"
          ? messages.operation.callingNamedTool(activity.toolName)
          : messages.operation.calledNamedTool(activity.toolName)
    };
  }
  if (activity?.kind === "responding") return { icon: <CircleDashed aria-hidden="true" className={styles.spinning} size={14} />, label: messages.operation.responding };
  if (activity?.kind === "thinking") return { icon: <CircleDashed aria-hidden="true" className={styles.spinning} size={14} />, label: messages.operation.thinking };
  if (kind === "session-import") return { icon: <CircleDashed aria-hidden="true" className={styles.spinning} size={14} />, label: messages.operation.importingSession, ...(detail ? { detail } : {}) };
  if (kind === "compaction") return { icon: <RefreshCw aria-hidden="true" className={styles.spinning} size={14} />, label: messages.operation.compacting, ...(detail ? { detail } : {}) };
  if (lifecycle === "accepted") return { icon: <CircleDashed aria-hidden="true" size={14} />, label: messages.operation.accepted, ...(detail ? { detail } : {}) };
  return { icon: <CircleDashed aria-hidden="true" className={styles.spinning} size={14} />, label: messages.operation.running, ...(detail ? { detail } : {}) };
}

function OperationTimeline({
  timeline,
  operation,
  freshness,
  detail,
  progress
}: {
  timeline: OperationActivityTimeline;
  operation: OperationView;
  freshness: OperationFreshnessPhase | undefined;
  detail: string | undefined;
  progress: string | undefined;
}) {
  const autoExpanded = timeline.lifecycle !== "completed";
  const [open, setOpen] = useState(autoExpanded);
  const previousAutoExpanded = useRef(autoExpanded);

  useEffect(() => {
    if (previousAutoExpanded.current !== autoExpanded) setOpen(autoExpanded);
    previousAutoExpanded.current = autoExpanded;
  }, [autoExpanded]);

  if (timeline.lifecycle === "completed") {
    return (
      <details
        className={`${styles.timeline} ${styles.timelineSettled}`}
        data-operation-lifecycle="completed"
        data-turn-activity="true"
        open={open}
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary>
          <Check aria-hidden="true" size={14} />
          <strong>{messages.operation.timelineCompleted(
            timeline.steps.length,
            formatTimelineDuration(timeline.startedAt, timeline.settledAt)
          )}</strong>
        </summary>
        <TimelineSteps operationKind={timeline.operationKind} steps={timeline.steps} />
      </details>
    );
  }

  const currentPresentation = operationPresentation(
    operation.kind,
    operation.lifecycle,
    operation.activity,
    freshness,
    detail
  );
  const terminal = operation.lifecycle === "failed"
    || operation.lifecycle === "cancelled"
    || operation.lifecycle === "lost";
  const earlierCount = Math.max(0, timeline.steps.length - MAX_VISIBLE_LIVE_STEPS);
  const recentSteps = timeline.steps.slice(-MAX_VISIBLE_LIVE_STEPS);
  const earlierSteps = earlierCount > 0 ? timeline.steps.slice(0, earlierCount) : [];

  return (
    <details
      aria-label="当前任务执行过程"
      className={`${styles.timeline} ${styles.timelineDisclosure} ${terminal ? styles.timelineTerminal : ""}`}
      data-operation-freshness={freshness}
      data-operation-lifecycle={operation.lifecycle}
      data-turn-activity="true"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary aria-live="polite">
        <span className={styles.icon}>{currentPresentation.icon}</span>
        <span className={styles.timelineSummaryCopy}>
          <strong>{currentPresentation.label}</strong>
          <small>{messages.operation.timelineSteps(timeline.steps.length)}</small>
        </span>
        <ChevronRight aria-hidden="true" className={styles.timelineChevron} size={14} />
      </summary>
      <div className={styles.timelineBody}>
        {(freshness && freshness !== "fresh") || (terminal && currentPresentation.detail) ? (
          <div className={styles.timelineNotice}>
            <span className={styles.icon}>{currentPresentation.icon}</span>
            <span className={styles.copy}>
              <strong>{currentPresentation.label}</strong>
              {currentPresentation.detail ? <small>{currentPresentation.detail}</small> : null}
            </span>
          </div>
        ) : null}
        {earlierSteps.length > 0 ? (
          <details className={styles.timelineEarlier}>
            <summary>{messages.operation.timelineEarlier(earlierSteps.length)}</summary>
            <TimelineSteps operationKind={timeline.operationKind} steps={earlierSteps} />
          </details>
        ) : null}
        <TimelineSteps
          operationKind={timeline.operationKind}
          progress={progress}
          steps={recentSteps}
        />
      </div>
    </details>
  );
}

function TimelineSteps({
  operationKind,
  steps,
  progress
}: {
  operationKind: OperationKind;
  steps: OperationTimelineStep[];
  progress?: string | undefined;
}) {
  return (
    <ol className={styles.timelineSteps}>
      {steps.map((step, index) => {
        const active = step.status === "running" || step.status === "pending";
        const stepDetail = active && index === steps.length - 1 ? progress ?? step.detail : step.detail;
        const duration = !active
          ? step.toolExecution
            ? formatDurationMs(step.toolExecution.durationMs)
            : step.settledAt === undefined ? undefined : formatStepDuration(step.startedAt, step.settledAt)
          : undefined;
        return (
          <li className={styles.timelineStep} data-step-status={step.status} key={step.id}>
            <span className={styles.stepIcon}>{timelineStepIcon(step.status)}</span>
            <span className={styles.stepCopy}>
              <strong>{timelineStepLabel(operationKind, step, active)}</strong>
              {stepDetail ? <small>{stepDetail}</small> : null}
            </span>
            {duration ? <time>{duration}</time> : null}
          </li>
        );
      })}
    </ol>
  );
}

function timelineStepLabel(
  operationKind: OperationKind,
  step: OperationTimelineStep,
  active: boolean
): string {
  if (step.activity === undefined) {
    if (active) {
      if (operationKind === "session-import") return messages.operation.importingSession;
      if (operationKind === "compaction") return messages.operation.compacting;
      return messages.operation.accepted;
    }
    if (operationKind === "session-import") return "导入 Pi 会话";
    if (operationKind === "compaction") return "压缩上下文";
    return operationKind === "command" ? "准备命令" : "准备任务";
  }
  if (step.activity === null) return active ? messages.operation.running : "继续处理";
  if (step.activity.kind === "tool") {
    if (step.activity.toolKind === "subagent") return delegatedToolStatusLabel(step.activity.status);
    return active
      ? messages.operation.callingNamedTool(step.activity.toolName)
      : messages.operation.calledNamedTool(step.activity.toolName);
  }
  if (active) return operationPresentation(operationKind, "running", step.activity, undefined, undefined).label;
  switch (step.activity.kind) {
    case "thinking": return "分析问题";
    case "responding": return "组织回复";
    case "compaction": return "压缩上下文";
    case "approval": return "等待确认";
    case "extension-input": return "等待扩展输入";
  }
}

function delegatedToolStatusLabel(status: Extract<OperationActivity, { kind: "tool" }>["status"]): string {
  switch (status) {
    case "pending": return messages.operation.delegatedToolPending;
    case "running": return messages.operation.delegatedToolRunning;
    case "completed": return messages.operation.delegatedToolCompleted;
    case "failed": return messages.operation.delegatedToolFailed;
    case "interrupted": return messages.operation.delegatedToolInterrupted;
    case "cancelled": return messages.operation.delegatedToolCancelled;
    case "lost": return messages.operation.delegatedToolLost;
    case "unreconciled": return messages.operation.delegatedToolUnreconciled;
  }
}

function timelineStepIcon(status: OperationTimelineStep["status"]): ReactNode {
  switch (status) {
    case "pending": return <CircleDashed aria-hidden="true" size={14} />;
    case "running": return <CircleDashed aria-hidden="true" className={styles.spinning} size={14} />;
    case "completed": return <Check aria-hidden="true" size={14} />;
    case "failed": return <CircleX aria-hidden="true" size={14} />;
    case "interrupted":
    case "unreconciled": return <CircleAlert aria-hidden="true" size={14} />;
    case "cancelled": return <Square aria-hidden="true" size={11} />;
    case "lost": return <CircleAlert aria-hidden="true" size={14} />;
  }
}

function formatDurationMs(elapsed: number | undefined): string | undefined {
  if (elapsed === undefined) return undefined;
  if (elapsed < 1_000) return elapsed === 0 ? undefined : `${elapsed}ms`;
  if (elapsed < 10_000) return `${(elapsed / 1_000).toFixed(1)}s`;
  return `${Math.round(elapsed / 1_000)}s`;
}

function formatStepDuration(startedAt: number, settledAt: number): string | undefined {
  const elapsed = Math.max(0, settledAt - startedAt);
  if (elapsed < 1_000) return undefined;
  if (elapsed < 10_000) return `${(elapsed / 1_000).toFixed(1)}s`;
  return `${Math.round(elapsed / 1_000)}s`;
}

function formatTimelineDuration(startedAt: number, settledAt: number | undefined): string {
  if (settledAt === undefined) return "进行中";
  const seconds = Math.max(0, Math.round((settledAt - startedAt) / 1_000));
  if (seconds < 1) return "不到 1 秒";
  if (seconds < 60) return `${seconds} 秒`;
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}
