interface BeforeQuitEvent {
  preventDefault(): void;
}

export interface ApplicationShutdownController {
  isShuttingDown(): boolean;
  handleBeforeQuit(event: BeforeQuitEvent): void;
}

interface ApplicationShutdownReport {
  budgetMs: number;
  deadlineExceeded: boolean;
  durationMs: number;
  rendererCheckpointed: boolean;
  rendererCheckpointDurationMs?: number;
  agentHostStopped: boolean;
  agentHostStopDurationMs?: number;
}

interface ApplicationShutdownOptions {
  checkpointRenderer?: (deadlineMs: number) => Promise<boolean>;
  stopAgentHost: (deadlineMs: number) => Promise<unknown>;
  afterAgentHostStop?: () => Promise<unknown>;
  markCleanExit?: () => Promise<unknown>;
  quit: () => void;
  onError?: (error: unknown) => void;
  onComplete?: (report: ApplicationShutdownReport) => void;
  shutdownBudgetMs?: number;
  rendererCheckpointBudgetMs?: number;
  finalizationReserveMs?: number;
  now?: () => number;
}

// Leave 750ms of the Windows 5s product gate for Electron process teardown.
const APPLICATION_SHUTDOWN_BUDGET_MS = 4_250;
const RENDERER_CHECKPOINT_BUDGET_MS = 750;
const FINALIZATION_RESERVE_MS = 500;
const MINIMUM_STAGE_DEADLINE_MS = 100;

export function createApplicationShutdownController(
  options: ApplicationShutdownOptions
): ApplicationShutdownController {
  const shutdownBudgetMs = resolveDeadline(
    options.shutdownBudgetMs,
    APPLICATION_SHUTDOWN_BUDGET_MS,
    "Application shutdown budget"
  );
  const rendererCheckpointBudgetMs = resolveDeadline(
    options.rendererCheckpointBudgetMs,
    RENDERER_CHECKPOINT_BUDGET_MS,
    "Renderer checkpoint budget"
  );
  const finalizationReserveMs = resolveDeadline(
    options.finalizationReserveMs,
    FINALIZATION_RESERVE_MS,
    "Application shutdown finalization reserve"
  );
  if (
    rendererCheckpointBudgetMs
    + finalizationReserveMs
    + MINIMUM_STAGE_DEADLINE_MS
    > shutdownBudgetMs
  ) {
    throw new RangeError("Application shutdown stage budgets exceed the total budget.");
  }

  const now = options.now ?? (() => performance.now());
  let phase: "running" | "stopping" | "ready-to-quit" = "running";
  let shutdownPromise: Promise<void> | undefined;
  const readyToQuit = (): boolean => phase === "ready-to-quit";

  return {
    isShuttingDown: () => phase !== "running",
    handleBeforeQuit: (event) => {
      if (phase === "ready-to-quit") return;
      event.preventDefault();
      if (shutdownPromise) return;

      phase = "stopping";
      const startedAt = now();
      const deadlineAt = startedAt + shutdownBudgetMs;
      let rendererCheckpointed = options.checkpointRenderer === undefined;
      let rendererCheckpointDurationMs: number | undefined;
      let agentHostStopped = false;
      let agentHostStopDurationMs: number | undefined;
      let watchdog: ReturnType<typeof setTimeout> | undefined;

      const reportError = (error: unknown): void => {
        try {
          options.onError?.(error);
        } catch {
          // Shutdown must keep progressing even if diagnostic reporting fails.
        }
      };
      const finishQuit = (deadlineExceeded: boolean): void => {
        if (readyToQuit()) return;
        phase = "ready-to-quit";
        if (watchdog) clearTimeout(watchdog);
        const report: ApplicationShutdownReport = {
          budgetMs: shutdownBudgetMs,
          deadlineExceeded,
          durationMs: Math.max(0, now() - startedAt),
          rendererCheckpointed,
          ...(rendererCheckpointDurationMs === undefined ? {} : { rendererCheckpointDurationMs }),
          agentHostStopped,
          ...(agentHostStopDurationMs === undefined ? {} : { agentHostStopDurationMs })
        };
        try {
          options.onComplete?.(report);
        } catch (error) {
          reportError(error);
        }
        options.quit();
      };

      watchdog = setTimeout(() => finishQuit(true), shutdownBudgetMs);
      shutdownPromise = (async () => {
        if (options.checkpointRenderer) {
          const checkpointStartedAt = now();
          const checkpointDeadlineMs = Math.min(
            rendererCheckpointBudgetMs,
            remainingStageBudget(deadlineAt, now(), finalizationReserveMs + MINIMUM_STAGE_DEADLINE_MS)
          );
          try {
            rendererCheckpointed = await options.checkpointRenderer(checkpointDeadlineMs);
          } catch (error) {
            reportError(error);
          } finally {
            rendererCheckpointDurationMs = Math.max(0, now() - checkpointStartedAt);
          }
        }
        if (readyToQuit()) return;

        const hostStopStartedAt = now();
        const hostDeadlineMs = remainingStageBudget(deadlineAt, now(), finalizationReserveMs);
        try {
          await options.stopAgentHost(hostDeadlineMs);
          agentHostStopped = true;
        } catch (error) {
          reportError(error);
        } finally {
          agentHostStopDurationMs = Math.max(0, now() - hostStopStartedAt);
        }
        if (readyToQuit()) return;

        if (agentHostStopped && options.afterAgentHostStop) {
          await options.afterAgentHostStop().catch(reportError);
        }
        if (readyToQuit()) return;

        if (rendererCheckpointed && agentHostStopped && options.markCleanExit) {
          await options.markCleanExit().catch(reportError);
        }
      })().catch(reportError).finally(() => finishQuit(false));
    }
  };
}

function remainingStageBudget(deadlineAt: number, now: number, reserveMs: number): number {
  return Math.max(MINIMUM_STAGE_DEADLINE_MS, Math.floor(deadlineAt - now - reserveMs));
}

function resolveDeadline(value: number | undefined, fallback: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < MINIMUM_STAGE_DEADLINE_MS || resolved > 30_000) {
    throw new RangeError(`${label} must be an integer between 100 and 30000.`);
  }
  return resolved;
}
