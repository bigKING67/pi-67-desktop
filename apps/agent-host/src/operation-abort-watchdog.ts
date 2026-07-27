export class AbortWatchdogExpiredError extends Error {
  constructor() {
    super("Pi abort watchdog expired.");
    this.name = "AbortWatchdogExpiredError";
  }
}

export function withAbortWatchdog(abort: Promise<void>, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new AbortWatchdogExpiredError()), timeoutMs);
    void abort.then(
      () => {
        clearTimeout(timeout);
        resolve();
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      }
    );
  });
}
