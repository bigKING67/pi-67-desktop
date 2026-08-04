import type {
  RuntimeInitializationObservation,
  RuntimeInitializationObserver,
  RuntimeInitializationStage
} from "./agent-runtime.js";

export async function runRuntimeInitializationStage<T>(
  observer: RuntimeInitializationObserver | undefined,
  stage: RuntimeInitializationStage,
  action: () => T | Promise<T>,
  now: () => number = () => performance.now()
): Promise<T> {
  const startedAt = now();
  reportRuntimeInitializationObservation(observer, {
    stage,
    outcome: "started",
    durationMs: 0
  });
  try {
    const result = await action();
    reportRuntimeInitializationObservation(observer, {
      stage,
      outcome: "completed",
      durationMs: elapsedMilliseconds(startedAt, now())
    });
    return result;
  } catch (error) {
    reportRuntimeInitializationObservation(observer, {
      stage,
      outcome: "failed",
      durationMs: elapsedMilliseconds(startedAt, now())
    });
    throw error;
  }
}

function reportRuntimeInitializationObservation(
  observer: RuntimeInitializationObserver | undefined,
  observation: RuntimeInitializationObservation
): void {
  try {
    observer?.(observation);
  } catch {
    // Observability must not change Pi Runtime initialization behavior.
  }
}

function elapsedMilliseconds(startedAt: number, finishedAt: number): number {
  if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt)) return 0;
  return Math.max(0, Math.round(finishedAt - startedAt));
}
