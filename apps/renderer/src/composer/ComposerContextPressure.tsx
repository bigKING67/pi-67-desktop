import { CircleGauge, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useAppStore } from "../app/app-store.js";
import { compactRendererSession } from "../operation/operation-controller.js";
import { isActiveOperationLifecycle } from "../operation/operation-lifecycle.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { selectSessionStats } from "../session/session-projection-selectors.js";
import styles from "./Composer.module.css";

export function ComposerContextPressure() {
  const contextPercent = useSessionProjectionStore(selectSessionStats)?.contextPercent;
  const operation = useAppStore((state) => state.operation);
  const sessionTransitionPending = useAppStore((state) => state.sessionTransitionPending);
  const [compacting, setCompacting] = useState(false);
  if (contextPercent === undefined) return null;

  const boundedPercent = Math.max(0, Math.min(100, contextPercent));
  const tone = contextPressureTone(boundedPercent);
  const automaticCompaction = operation?.kind !== "compaction"
    && operation?.activity?.kind === "compaction";
  const manualCompaction = operation?.kind === "compaction"
    && isActiveOperationLifecycle(operation.lifecycle);
  const operationActive = Boolean(operation && isActiveOperationLifecycle(operation.lifecycle));
  const label = automaticCompaction
    ? "自动压缩中"
    : manualCompaction || compacting
      ? "手动压缩中"
      : tone === "critical"
        ? "上下文接近上限"
        : tone === "warning"
          ? "上下文偏高"
          : "上下文";
  const showCompact = tone !== "normal" && !automaticCompaction && !manualCompaction;

  return (
    <div
      aria-label={`${label} ${boundedPercent.toFixed(0)}%`}
      className={styles.contextPressure}
      data-tone={tone}
      role="status"
      title={`${label}：${boundedPercent.toFixed(1)}%`}
    >
      <CircleGauge aria-hidden="true" size={14} />
      <span>{boundedPercent.toFixed(0)}%</span>
      {automaticCompaction || manualCompaction || compacting ? (
        <small><RefreshCw aria-hidden="true" className={styles.contextPressureSpin} size={12} />{label}</small>
      ) : showCompact ? (
        <button
          disabled={operationActive || sessionTransitionPending}
          onClick={() => void compact()}
          type="button"
        >压缩</button>
      ) : null}
    </div>
  );

  async function compact(): Promise<void> {
    if (compacting || operationActive || sessionTransitionPending) return;
    setCompacting(true);
    try {
      await compactRendererSession();
    } finally {
      setCompacting(false);
    }
  }
}

export function contextPressureTone(percent: number): "normal" | "warning" | "critical" {
  if (percent >= 92) return "critical";
  if (percent >= 75) return "warning";
  return "normal";
}
