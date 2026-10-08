import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { useAppStore } from "../app/app-store.js";
import { compactRendererSession } from "../operation/operation-controller.js";
import { isActiveOperationLifecycle } from "../operation/operation-lifecycle.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { selectSessionStats } from "../session/session-projection-selectors.js";
import styles from "./ComposerContextPressure.module.css";

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
  // Below half the window the context needs no attention; the Inspector keeps the exact value.
  if (!automaticCompaction && !manualCompaction && !compacting && !isContextPressureVisible(boundedPercent)) return null;

  return (
    <div
      aria-label={`${label} ${boundedPercent.toFixed(0)}%`}
      className={styles.contextPressure}
      data-tone={tone}
      role="status"
      title={`${label}：${boundedPercent.toFixed(1)}%`}
    >
      <ContextPressureValue percent={boundedPercent} />
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

/** The Composer shows context pressure only from half the window, as a ring plus the percent. */
const CONTEXT_PRESSURE_VISIBLE_FROM = 50;
const RING_RADIUS = 5.25;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** Compares the rounded value so the visible number and the status name never disagree. */
export function isContextPressureVisible(percent: number): boolean {
  return Number(percent.toFixed(0)) >= CONTEXT_PRESSURE_VISIBLE_FROM;
}

export function ContextPressureValue({ percent }: { percent: number }) {
  return (
    <>
      <ContextRing percent={percent} />
      <span>{percent.toFixed(0)}%</span>
    </>
  );
}

function ContextRing({ percent }: { percent: number }) {
  return (
    <svg aria-hidden="true" className={styles.contextRing} height={14} viewBox="0 0 14 14" width={14}>
      <circle className={styles.contextRingTrack} cx={7} cy={7} r={RING_RADIUS} />
      {percent > 0 ? <circle
        className={styles.contextRingValue}
        cx={7}
        cy={7}
        r={RING_RADIUS}
        strokeDasharray={`${(percent / 100) * RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`}
        transform="rotate(-90 7 7)"
      /> : null}
    </svg>
  );
}

export function contextPressureTone(percent: number): "normal" | "warning" | "critical" {
  if (percent >= 92) return "critical";
  if (percent >= 75) return "warning";
  return "normal";
}
