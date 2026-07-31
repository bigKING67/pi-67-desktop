import type {
  OperationActivity,
  OperationFreshnessPhase,
  OperationKind,
  OperationLifecycle,
  OperationView,
  RuntimePhase,
  ToolPresentationKind
} from "@pi67/domain";
import {
  Check,
  CircleAlert,
  CircleDashed,
  CircleX,
  RefreshCw,
  Square,
  Wrench
} from "lucide-react";
import type { ReactNode } from "react";
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
  if (activity?.kind === "tool") return { icon: <Wrench aria-hidden="true" size={14} />, label: activeToolLabel(activity.toolKind) };
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
  if (timeline.lifecycle === "completed") {
    return (
      <details
        className={`${styles.timeline} ${styles.timelineSettled}`}
        data-operation-lifecycle="completed"
        data-turn-activity="true"
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

  const terminalPresentation = operationPresentation(
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
    <section
      aria-label="当前任务执行过程"
      aria-live="polite"
      className={`${styles.timeline} ${terminal ? styles.timelineTerminal : ""}`}
      data-operation-freshness={freshness}
      data-operation-lifecycle={operation.lifecycle}
      data-turn-activity="true"
      role="status"
    >
      <header className={styles.timelineHeader}>
        <strong>{terminal ? terminalPresentation.label : messages.operation.timelineTitle}</strong>
        <small>{messages.operation.timelineSteps(timeline.steps.length)}</small>
      </header>
      {freshness && freshness !== "fresh" ? (
        <div className={styles.timelineNotice}>
          <span className={styles.icon}>{terminalPresentation.icon}</span>
          <span className={styles.copy}>
            <strong>{terminalPresentation.label}</strong>
            {terminalPresentation.detail ? <small>{terminalPresentation.detail}</small> : null}
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
    </section>
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
        const active = step.status === "running";
        const stepDetail = active && index === steps.length - 1 ? progress ?? step.detail : step.detail;
        const duration = !active && step.settledAt !== undefined
          ? formatStepDuration(step.startedAt, step.settledAt)
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

function activeToolLabel(kind: ToolPresentationKind): string {
  switch (kind) {
    case "read": return messages.operation.readingFiles;
    case "search": return messages.operation.searchingProject;
    case "edit": return messages.operation.editingFiles;
    case "shell": return messages.operation.runningCommand;
    case "managed-process": return messages.operation.runningTask;
    case "subagent": return messages.operation.coordinatingTask;
    case "image": return messages.operation.processingImage;
    case "extension": return messages.operation.callingExtension;
    case "approval": return messages.operation.needsApproval;
    case "generic": return messages.operation.usingTool;
  }
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
  if (active) return operationPresentation(operationKind, "running", step.activity, undefined, undefined).label;
  switch (step.activity.kind) {
    case "thinking": return "分析问题";
    case "responding": return "组织回复";
    case "compaction": return "压缩上下文";
    case "approval": return "等待确认";
    case "extension-input": return "等待扩展输入";
    case "tool": return settledToolLabel(step.activity.toolKind);
  }
}

function settledToolLabel(kind: ToolPresentationKind): string {
  switch (kind) {
    case "read": return "读取文件";
    case "search": return "搜索项目";
    case "edit": return "修改文件";
    case "shell": return "执行命令";
    case "managed-process": return "运行任务";
    case "subagent": return "协调子任务";
    case "image": return "处理图片";
    case "approval": return "等待确认";
    case "extension": return "调用扩展";
    case "generic": return "执行工具";
  }
}

function timelineStepIcon(status: OperationTimelineStep["status"]): ReactNode {
  switch (status) {
    case "running": return <CircleDashed aria-hidden="true" className={styles.spinning} size={14} />;
    case "completed": return <Check aria-hidden="true" size={14} />;
    case "failed": return <CircleX aria-hidden="true" size={14} />;
    case "cancelled": return <Square aria-hidden="true" size={11} />;
    case "lost": return <CircleAlert aria-hidden="true" size={14} />;
  }
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
