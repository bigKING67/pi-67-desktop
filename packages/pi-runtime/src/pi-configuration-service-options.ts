import { RuntimeError } from "@pi67/domain";

export interface PiConfigurationServiceOptions {
  fallbackPollMs?: number;
  watchDebounceMs?: number;
  runtimeReloadWaitMs?: number;
  fileAccessWaitMs?: number;
  validationRuntimeWaitMs?: number;
  settingsReloadWaitMs?: number;
  modelCatalogRefreshWaitMs?: number;
}

export interface ResolvedPiConfigurationServiceOptions {
  fallbackPollMs: number;
  watchDebounceMs: number;
  runtimeReloadWaitMs: number;
  fileAccessWaitMs: number;
  validationRuntimeWaitMs: number;
  settingsReloadWaitMs: number;
  modelCatalogRefreshWaitMs: number;
}

export type PiConfigurationBudgetStage =
  | "configuration-file-access"
  | "provider-validation-runtime"
  | "settings-reload"
  | "session-model-runtime";

export function resolvePiConfigurationServiceOptions(
  options: PiConfigurationServiceOptions
): ResolvedPiConfigurationServiceOptions {
  return {
    fallbackPollMs: boundedWaitMilliseconds(options.fallbackPollMs, 2_000),
    watchDebounceMs: boundedWaitMilliseconds(options.watchDebounceMs, 200),
    runtimeReloadWaitMs: boundedWaitMilliseconds(options.runtimeReloadWaitMs, 1_000),
    fileAccessWaitMs: boundedWaitMilliseconds(options.fileAccessWaitMs, 4_000),
    validationRuntimeWaitMs: boundedWaitMilliseconds(options.validationRuntimeWaitMs, 4_000),
    settingsReloadWaitMs: boundedWaitMilliseconds(options.settingsReloadWaitMs, 2_000),
    modelCatalogRefreshWaitMs: boundedWaitMilliseconds(options.modelCatalogRefreshWaitMs, 15_000)
  };
}

export async function withPiConfigurationBudget<T>(
  operation: Promise<T>,
  waitMs: number,
  stage: PiConfigurationBudgetStage
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new RuntimeError(
      "RUNTIME_NOT_READY",
      configurationBudgetMessage(stage),
      { recoverable: true, details: { stage, waitMs } }
    )), waitMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function boundedWaitMilliseconds(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("Pi configuration wait budget must be a finite non-negative number.");
  }
  return Math.floor(value);
}

function configurationBudgetMessage(stage: PiConfigurationBudgetStage): string {
  switch (stage) {
    case "configuration-file-access":
      return "Pi configuration file access did not complete within the bounded startup budget.";
    case "provider-validation-runtime":
      return "Pi offline Provider validation did not complete within the bounded startup budget.";
    case "settings-reload":
      return "Pi settings reload did not complete within the bounded startup budget.";
    case "session-model-runtime":
      return "Pi Task model runtime did not initialize within the bounded startup budget.";
  }
}
