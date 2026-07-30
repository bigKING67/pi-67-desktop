import type {
  OperationActivity,
  OperationFreshnessPhase,
  OperationKind,
  OperationLifecycle,
  OperationView,
  RuntimePhase
} from "@pi67/domain";
import { CircleAlert, CircleDashed, CircleX, RefreshCw, Square, Wrench } from "lucide-react";
import { useAppStore } from "../app/app-store.js";
import { messages } from "../localization/message-catalog.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import {
  selectSessionGeneration,
  selectSessionId
} from "../session/session-projection-selectors.js";
import { useOperationFreshnessStore } from "./operation-freshness-store.js";
import styles from "./TurnActivity.module.css";

export { isActiveOperationLifecycle } from "./operation-lifecycle.js";

export function TurnActivity() {
  const runtime = useAppStore((state) => state.runtime);
  const operation = useAppStore((state) => state.operation);
  const sessionId = useSessionProjectionStore(selectSessionId);
  const sessionGeneration = useSessionProjectionStore(selectSessionGeneration);
  const freshnessPhase = useOperationFreshnessStore((state) => state.freshness?.phase);
  const detail = useAppStore((state) => state.operationDetail);
  const progress = useAppStore((state) => state.operationProgress);

  if (!hasVisibleTurnActivity(runtime.phase, operation, sessionId, sessionGeneration)) return null;
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

  const presentation = operationPresentation(
    operation.kind,
    operation.lifecycle,
    operation.activity?.kind,
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

export function operationPresentation(
  kind: OperationKind,
  lifecycle: OperationLifecycle,
  activity: OperationActivity["kind"] | undefined,
  freshness: OperationFreshnessPhase | undefined,
  detail: string | undefined
): { icon: React.ReactNode; label: string; detail?: string } {
  if (lifecycle === "failed") return { icon: <CircleX aria-hidden="true" size={14} />, label: messages.operation.failed, ...(detail ? { detail } : {}) };
  if (lifecycle === "cancelled") return { icon: <Square aria-hidden="true" size={12} />, label: messages.operation.cancelled, ...(detail ? { detail } : {}) };
  if (lifecycle === "lost") return { icon: <CircleAlert aria-hidden="true" size={14} />, label: messages.operation.lost, ...(detail ? { detail } : {}) };
  if (freshness === "recovering") return { icon: <RefreshCw aria-hidden="true" className={styles.spinning} size={14} />, label: messages.operation.recovering, detail: messages.operation.recoveringDetail };
  if (freshness === "stalled") return { icon: <RefreshCw aria-hidden="true" className={styles.spinning} size={14} />, label: messages.operation.stalled, detail: messages.operation.stalledDetail };
  if (freshness === "quiet") return { icon: <CircleAlert aria-hidden="true" size={14} />, label: messages.operation.quiet, detail: messages.operation.quietDetail };
  if (activity === "approval") return { icon: <CircleAlert aria-hidden="true" size={14} />, label: messages.operation.needsApproval };
  if (activity === "extension-input") return { icon: <CircleAlert aria-hidden="true" size={14} />, label: messages.operation.waitingInput };
  if (activity === "compaction") return { icon: <RefreshCw aria-hidden="true" className={styles.spinning} size={14} />, label: messages.operation.compacting };
  if (activity === "tool") return { icon: <Wrench aria-hidden="true" size={14} />, label: messages.operation.usingTool };
  if (activity === "responding") return { icon: <CircleDashed aria-hidden="true" className={styles.spinning} size={14} />, label: messages.operation.responding };
  if (activity === "thinking") return { icon: <CircleDashed aria-hidden="true" className={styles.spinning} size={14} />, label: messages.operation.thinking };
  if (kind === "session-import") return { icon: <CircleDashed aria-hidden="true" className={styles.spinning} size={14} />, label: messages.operation.importingSession, ...(detail ? { detail } : {}) };
  if (kind === "compaction") return { icon: <RefreshCw aria-hidden="true" className={styles.spinning} size={14} />, label: messages.operation.compacting, ...(detail ? { detail } : {}) };
  if (lifecycle === "accepted") return { icon: <CircleDashed aria-hidden="true" size={14} />, label: messages.operation.accepted, ...(detail ? { detail } : {}) };
  return { icon: <CircleDashed aria-hidden="true" className={styles.spinning} size={14} />, label: messages.operation.running, ...(detail ? { detail } : {}) };
}
