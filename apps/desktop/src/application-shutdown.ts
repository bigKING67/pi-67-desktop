interface BeforeQuitEvent {
  preventDefault(): void;
}

export interface ApplicationShutdownController {
  isShuttingDown(): boolean;
  handleBeforeQuit(event: BeforeQuitEvent): void;
}

interface ApplicationShutdownOptions {
  stopAgentHost: () => Promise<unknown>;
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
      shutdownPromise = Promise.resolve()
        .then(() => options.stopAgentHost())
        .catch((error: unknown) => options.onError?.(error))
        .then(() => {
          phase = "ready-to-quit";
          options.quit();
        });
    }
  };
}
