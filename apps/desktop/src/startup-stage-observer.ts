interface StartupStageObserverOptions {
  log?: (message: string) => void;
  now?: () => number;
  slowThresholdMs?: number;
}

const DEFAULT_SLOW_THRESHOLD_MS = 1_000;

export async function observeStartupStage<T>(
  stage: string,
  operation: () => Promise<T>,
  options: StartupStageObserverOptions = {}
): Promise<T> {
  const now = options.now ?? performance.now.bind(performance);
  const startedAt = now();
  try {
    return await operation();
  } finally {
    const durationMs = Math.round(now() - startedAt);
    if (durationMs >= (options.slowThresholdMs ?? DEFAULT_SLOW_THRESHOLD_MS)) {
      (options.log ?? console.info)(
        `Application startup slow stage=${stage} durationMs=${durationMs}`
      );
    }
  }
}
