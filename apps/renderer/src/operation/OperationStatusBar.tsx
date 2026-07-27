import type {
  OperationActivity,
  OperationFreshnessPhase,
  OperationKind,
  OperationLifecycle
} from "@pi67/domain";
import { CheckCircle2, CircleAlert, CircleDashed, CircleX, RefreshCw, Square, Wrench } from "lucide-react";
import { Button } from "react-aria-components";
import { useAppStore } from "../app/app-store.js";
import { messages } from "../localization/message-catalog.js";
import { abortActiveOperation } from "./operation-controller.js";
import { useOperationFreshnessStore } from "./operation-freshness-store.js";
import styles from "./OperationStatusBar.module.css";

export function OperationStatusBar() {
  const runtime = useAppStore((state) => state.runtime);
  const operation = useAppStore((state) => state.operation);
  const freshnessPhase = useOperationFreshnessStore((state) => state.freshness?.phase);
  const detail = useAppStore((state) => state.operationDetail);
  const progress = useAppStore((state) => state.operationProgress);

  if (runtime.phase === "recovering") {
    return (
      <div className={`${styles.bar} ${styles.recovering}`} role="status" aria-live="polite">
        <RefreshCw aria-hidden="true" className={styles.spinning} size={15} />
        <strong>{runtime.detail}</strong>
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
  const active = isActiveOperationLifecycle(operation.lifecycle);
  const lifecycleClass = styles[operation.lifecycle];
  const freshnessClass = freshnessPhase ? styles[freshnessPhase] : undefined;
  const className = [styles.bar, lifecycleClass, freshnessClass].filter(Boolean).join(" ");

  return (
    <div
      aria-live="polite"
      className={className}
      data-operation-freshness={freshnessPhase}
      data-operation-lifecycle={operation.lifecycle}
      role="status"
    >
      <span className={styles.icon}>{presentation.icon}</span>
      <span className={styles.copy}>
        <strong>{presentation.label}</strong>
        {progress || presentation.detail ? <small>{progress ?? presentation.detail}</small> : null}
      </span>
      {active && operation.cancellable ? (
        <Button className={styles.stopButton!} onPress={() => void abortActiveOperation()}>
          <Square aria-hidden="true" size={12} />{messages.common.stop}
        </Button>
      ) : null}
    </div>
  );
}

export function operationPresentation(
  kind: OperationKind,
  lifecycle: OperationLifecycle,
  activity: OperationActivity["kind"] | undefined,
  freshness: OperationFreshnessPhase | undefined,
  detail: string | undefined
): { icon: React.ReactNode; label: string; detail?: string } {
  if (lifecycle === "completed") return { icon: <CheckCircle2 aria-hidden="true" size={15} />, label: messages.operation.completed, ...(detail ? { detail } : {}) };
  if (lifecycle === "failed") return { icon: <CircleX aria-hidden="true" size={15} />, label: messages.operation.failed, ...(detail ? { detail } : {}) };
  if (lifecycle === "cancelled") return { icon: <Square aria-hidden="true" size={13} />, label: messages.operation.cancelled, ...(detail ? { detail } : {}) };
  if (lifecycle === "lost") return { icon: <CircleAlert aria-hidden="true" size={15} />, label: messages.operation.lost, ...(detail ? { detail } : {}) };
  if (freshness === "recovering") return { icon: <RefreshCw aria-hidden="true" className={styles.spinning} size={15} />, label: messages.operation.recovering, detail: messages.operation.recoveringDetail };
  if (freshness === "stalled") return { icon: <RefreshCw aria-hidden="true" className={styles.spinning} size={15} />, label: messages.operation.stalled, detail: messages.operation.stalledDetail };
  if (freshness === "quiet") return { icon: <CircleAlert aria-hidden="true" size={15} />, label: messages.operation.quiet, detail: messages.operation.quietDetail };
  if (activity === "approval") return { icon: <CircleAlert aria-hidden="true" size={15} />, label: messages.operation.needsApproval };
  if (activity === "extension-input") return { icon: <CircleAlert aria-hidden="true" size={15} />, label: messages.operation.waitingInput };
  if (activity === "compaction") return { icon: <RefreshCw aria-hidden="true" className={styles.spinning} size={15} />, label: messages.operation.compacting };
  if (activity === "tool") return { icon: <Wrench aria-hidden="true" size={15} />, label: messages.operation.usingTool };
  if (activity === "responding") return { icon: <CircleDashed aria-hidden="true" className={styles.spinning} size={15} />, label: messages.operation.responding };
  if (activity === "thinking") return { icon: <CircleDashed aria-hidden="true" className={styles.spinning} size={15} />, label: messages.operation.thinking };
  if (kind === "session-import") return { icon: <CircleDashed aria-hidden="true" className={styles.spinning} size={15} />, label: messages.operation.importingSession, ...(detail ? { detail } : {}) };
  if (kind === "compaction") return { icon: <RefreshCw aria-hidden="true" className={styles.spinning} size={15} />, label: messages.operation.compacting, ...(detail ? { detail } : {}) };
  if (lifecycle === "accepted") return { icon: <CircleDashed aria-hidden="true" size={15} />, label: messages.operation.accepted, ...(detail ? { detail } : {}) };
  return { icon: <CircleDashed aria-hidden="true" className={styles.spinning} size={15} />, label: messages.operation.running, ...(detail ? { detail } : {}) };
}

export function isActiveOperationLifecycle(lifecycle: OperationLifecycle): boolean {
  return lifecycle === "submitting"
    || lifecycle === "accepted"
    || lifecycle === "running"
    || lifecycle === "waiting-input";
}
