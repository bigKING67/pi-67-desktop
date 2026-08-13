interface BeforeQuitEvent {
  preventDefault(): void;
}

export interface ApplicationShutdownController {
  isShuttingDown(): boolean;
  handleBeforeQuit(event: BeforeQuitEvent): void;
}

interface ApplicationShutdownOptions {
  checkpointRenderer?: () => Promise<boolean>;
  stopAgentHost: () => Promise<unknown>;
  afterAgentHostStop?: () => Promise<unknown>;
  markCleanExit?: () => Promise<unknown>;
  quit: () => void;
  onError?: (error: unknown) => void;
}

export function createApplicationShutdownController(
  options: ApplicationShutdownOptions
): ApplicationShutdownController {
  let phase: "running" | "stopping" | "ready-to-quit" = "running";
  let shutdownPromise: Promise<void> | undefined;

  return {
    isShuttingDown: () => phase !== "running",
    handleBeforeQuit: (event) => {
      if (phase === "ready-to-quit") return;
      event.preventDefault();
      if (shutdownPromise) return;

      phase = "stopping";
      let rendererCheckpointed = options.checkpointRenderer === undefined;
      let agentHostStopped = false;
      shutdownPromise = Promise.resolve()
        .then(async () => {
          if (!options.checkpointRenderer) return;
          rendererCheckpointed = await options.checkpointRenderer();
        })
        .catch((error: unknown) => options.onError?.(error))
        .then(() => options.stopAgentHost())
        .then(() => { agentHostStopped = true; })
        .catch((error: unknown) => options.onError?.(error))
        .then(async () => {
          if (!agentHostStopped || !options.afterAgentHostStop) return;
          await options.afterAgentHostStop().catch((error: unknown) => options.onError?.(error));
        })
        .then(async () => {
          if (!rendererCheckpointed || !agentHostStopped || !options.markCleanExit) return;
          await options.markCleanExit().catch((error: unknown) => options.onError?.(error));
        })
        .then(() => {
          phase = "ready-to-quit";
          options.quit();
        });
    }
  };
}
